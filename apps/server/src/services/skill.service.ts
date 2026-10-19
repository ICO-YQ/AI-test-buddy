/**
 * SkillService —— 技能生命周期（FR-SK-01~08）
 *
 * 三条铁律：
 *  1. `validate`：静态检查命中危险 API → pass=false；脚本调用了**未声明**的能力 → 阻断发布。
 *  2. `execute`：按该版本**权限声明白名单**校验，未声明能力被调用 →
 *     `403 PERMISSION_UNDECLARED` + 审计（skill_rejected）；执行一律走沙箱，本地落盘恒为 0。
 *  3. `offline`：若 `impact.blocked === true`（被 Agent / 工作流引用）→ `409 SKILL_IN_USE` 并返回引用方。
 */

import {
  ALL_CAPABILITIES,
  ErrCode,
  PERMISSION_CAPABILITY_LABEL,
  SKILL_STATUS_TRANSITIONS,
  SkillExecutionStatus,
  SkillSource,
  SkillStatus,
  TrustLevel,
  type CreateSkillReq,
  type CreateSkillVersionReq,
  type ExecuteSkillReq,
  type HubSkill,
  type ImpactAnalysis,
  type PermissionCapability,
  type PermissionDecl,
  type RollbackSkillReq,
  type Skill,
  type SkillExecutionResult,
  type SkillVersion,
  type UpdateSkillReq,
  type ValidateResult,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { mockSandbox, type Sandbox } from '../ai/sandbox';
import { staticCheck, type StaticCheck } from '../ai/static-check';
import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { MetricEvent } from '@huanbuddy/shared';
import { trace } from '../core/trace';
import {
  getDb,
  isoNow,
  parseJsonArray,
  parseJsonArrayOf,
  parseJsonObject,
  toBool,
  type Db,
} from '../db/client';

/* ═══════════════ 行结构 ═══════════════ */

export interface SkillRow {
  id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  tags: string;
  source: string;
  hub_skill_id: string | null;
  trust_level: string;
  status: string;
  current_version: string | null;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SkillVersionRow {
  id: string;
  skill_id: string;
  version: string;
  status: string;
  input_schema: string;
  output_schema: string;
  prompt: string | null;
  script: string | null;
  script_lang: string | null;
  static_check: string;
  change_note: string | null;
  rollback_from: string | null;
  created_by: string;
  created_at: string;
  published_at: string | null;
}

interface SkillPermissionRow {
  id: string;
  skill_version_id: string;
  capability: string;
  granted: number;
  detail: string | null;
}

/* ═══════════════ 映射（导出：供其他服务复用，保持单一来源） ═══════════════ */

export function mapSkillRow(row: SkillRow): Skill {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    icon: row.icon ?? undefined,
    tags: parseJsonArray(row.tags),
    source: row.source as Skill['source'],
    hubSkillId: row.hub_skill_id ?? undefined,
    trustLevel: row.trust_level as TrustLevel,
    status: row.status as SkillStatus,
    currentVersion: row.current_version ?? undefined,
    enabled: toBool(row.enabled),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPermissionRow(row: SkillPermissionRow): PermissionDecl {
  return {
    capability: row.capability as PermissionCapability,
    granted: toBool(row.granted),
    detail: row.detail ?? undefined,
  };
}

export function loadPermissions(db: Db, skillVersionId: string): PermissionDecl[] {
  const rows = db.all<SkillPermissionRow>(
    'SELECT * FROM skill_permission WHERE skill_version_id = ? ORDER BY capability ASC',
    [skillVersionId],
  );
  const byCapability = new Map(rows.map((r) => [r.capability, mapPermissionRow(r)]));
  // 补齐未登记的能力项（未声明 = 未授予）
  return ALL_CAPABILITIES.map(
    (capability) =>
      byCapability.get(capability) ?? ({ capability, granted: false, detail: undefined } as PermissionDecl),
  );
}

export function mapVersionRow(db: Db, row: SkillVersionRow): SkillVersion {
  return {
    id: row.id,
    skillId: row.skill_id,
    version: row.version,
    status: row.status as SkillStatus,
    inputSchema: parseJsonObject(row.input_schema),
    outputSchema: parseJsonObject(row.output_schema),
    prompt: row.prompt ?? undefined,
    script: row.script ?? undefined,
    scriptLang: (row.script_lang as SkillVersion['scriptLang']) ?? undefined,
    staticCheck: (() => {
      const parsed = parseJsonObject<{ pass?: boolean; issues?: { line: number; msg: string }[] }>(
        row.static_check,
      );
      return { pass: parsed.pass ?? true, issues: parsed.issues ?? [] };
    })(),
    changeNote: row.change_note ?? undefined,
    rollbackFrom: row.rollback_from ?? undefined,
    permissions: loadPermissions(db, row.id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
  };
}

/** 供 TaskService / HubService 复用：加载某技能当前已发布版本（含权限声明） */
export function loadCurrentVersion(db: Db, skill: Skill): SkillVersion | undefined {
  if (!skill.currentVersion) return undefined;
  const row = db.get<SkillVersionRow>('SELECT * FROM skill_version WHERE skill_id = ? AND version = ?', [
    skill.id,
    skill.currentVersion,
  ]);
  return row ? mapVersionRow(db, row) : undefined;
}

/* ═══════════════ 服务 ═══════════════ */

const DEFAULT_WORKSPACE = 'ws-huan-0001';

export interface ListSkillFilters {
  status?: string;
  source?: string;
  q?: string;
}

export class SkillService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly sandbox: Sandbox;
  private readonly checker: StaticCheck;

  constructor(db: Db = getDb(), deps: { sandbox?: Sandbox; checker?: StaticCheck } = {}) {
    this.db = db;
    this.audit = new AuditService(db);
    this.sandbox = deps.sandbox ?? mockSandbox;
    this.checker = deps.checker ?? staticCheck;
  }

  /* ─────────── 查询 ─────────── */

  list(filters: ListSkillFilters = {}): Skill[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push('status = ?');
      params.push(filters.status);
    }
    if (filters.source) {
      where.push('source = ?');
      params.push(filters.source);
    }
    if (filters.q) {
      where.push('(name LIKE ? OR slug LIKE ? OR description LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like, like);
    }
    const sql = `SELECT * FROM skill ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY updated_at DESC, rowid ASC`;
    return this.db.all<SkillRow>(sql, params).map(mapSkillRow);
  }

  private rawOrThrow(id: string): SkillRow {
    const row = this.db.get<SkillRow>('SELECT * FROM skill WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `技能不存在：${id}`);
    return row;
  }

  get(id: string): Skill & { versions: SkillVersion[] } {
    const skill = mapSkillRow(this.rawOrThrow(id));
    return { ...skill, versions: this.versions(id) };
  }

  versions(id: string): SkillVersion[] {
    this.rawOrThrow(id);
    const rows = this.db.all<SkillVersionRow>(
      'SELECT * FROM skill_version WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC',
      [id],
    );
    return rows.map((row) => mapVersionRow(this.db, row));
  }

  private versionRowOrThrow(skillId: string, version: string): SkillVersionRow {
    const row = this.db.get<SkillVersionRow>(
      'SELECT * FROM skill_version WHERE skill_id = ? AND version = ?',
      [skillId, version],
    );
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `技能版本不存在：${skillId}@${version}`);
    return row;
  }

  /* ─────────── 技能 CRUD ─────────── */

  create(req: CreateSkillReq): Skill {
    if (!req.slug || !req.name) {
      throw new AppError(ErrCode.BAD_REQUEST, 'slug 与 name 为必填');
    }
    const now = isoNow();
    const id = `skl-${nanoid(10)}`;
    const workspaceId = DEFAULT_WORKSPACE;

    const dup = this.db.get<{ id: string }>('SELECT id FROM skill WHERE workspace_id = ? AND slug = ?', [
      workspaceId,
      req.slug,
    ]);
    if (dup) {
      throw new AppError(ErrCode.CONFLICT, `技能标识已存在：${req.slug}`, { slug: req.slug });
    }

    const source = req.source === SkillSource.HUB ? SkillSource.HUB : SkillSource.LOCAL;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO skill (
           id, workspace_id, slug, name, description, icon, tags, source, hub_skill_id,
           trust_level, status, current_version, enabled, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workspaceId,
          req.slug,
          req.name,
          req.description ?? null,
          req.icon ?? null,
          JSON.stringify(req.tags ?? []),
          source,
          req.hubSkillId ?? null,
          req.trustLevel ?? TrustLevel.ORG,
          SkillStatus.DRAFT,
          null,
          1,
          req.createdBy,
          now,
          now,
        ],
      );
      this.audit.write({
        action: 'skill_created',
        actorId: req.createdBy,
        actorType: 'human',
        initiatorId: req.createdBy,
        resourceType: 'skill',
        resourceId: id,
        resourceName: req.name,
        detail: { slug: req.slug, source },
        workspaceId,
      });
    });

    return mapSkillRow(this.rawOrThrow(id));
  }

  update(id: string, req: UpdateSkillReq): Skill {
    this.rawOrThrow(id);
    const fields: string[] = [];
    const params: unknown[] = [];
    const now = isoNow();

    if (req.name !== undefined) {
      fields.push('name = ?');
      params.push(req.name);
    }
    if (req.description !== undefined) {
      fields.push('description = ?');
      params.push(req.description);
    }
    if (req.icon !== undefined) {
      fields.push('icon = ?');
      params.push(req.icon);
    }
    if (req.tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(req.tags));
    }
    if (req.status !== undefined) {
      fields.push('status = ?');
      params.push(req.status);
    }
    if (req.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(req.enabled ? 1 : 0);
    }

    if (fields.length === 0) return mapSkillRow(this.rawOrThrow(id));

    fields.push('updated_at = ?');
    params.push(now);

    this.db.tx(() => {
      this.db.run(`UPDATE skill SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      this.audit.write({
        action: 'skill_updated',
        resourceType: 'skill',
        resourceId: id,
        detail: req as unknown as Record<string, unknown>,
      });
    });

    return mapSkillRow(this.rawOrThrow(id));
  }

  remove(id: string): { id: string } {
    const row = this.rawOrThrow(id);

    // 被 Agent 引用则禁止删除
    const impact = this.impact(id, row.current_version ?? '');
    if (impact.referencedByAgents.length > 0) {
      throw new AppError(ErrCode.SKILL_IN_USE, '技能被 AI 成员引用，无法删除', {
        referencedByAgents: impact.referencedByAgents,
      });
    }

    this.db.tx(() => {
      this.db.run('DELETE FROM skill_permission WHERE skill_version_id IN (SELECT id FROM skill_version WHERE skill_id = ?)', [id]);
      this.db.run('DELETE FROM skill_version WHERE skill_id = ?', [id]);
      this.db.run('DELETE FROM skill WHERE id = ?', [id]);
      this.audit.write({
        action: 'skill_deleted',
        resourceType: 'skill',
        resourceId: id,
        resourceName: row.name,
      });
    });

    return { id };
  }

  /* ─────────── 版本 ─────────── */

  createVersion(id: string, req: CreateSkillVersionReq): SkillVersion {
    this.rawOrThrow(id);
    if (!req.version) throw new AppError(ErrCode.BAD_REQUEST, 'version 为必填');

    const exists = this.db.get<{ id: string }>(
      'SELECT id FROM skill_version WHERE skill_id = ? AND version = ?',
      [id, req.version],
    );
    if (exists) {
      throw new AppError(ErrCode.CONFLICT, `版本已存在：${req.version}`, { version: req.version });
    }

    const check = this.checker.scan(req.script ?? null, req.scriptLang ?? null);
    const now = isoNow();
    const versionId = `skv-${nanoid(10)}`;
    const permissions = this.normalizePermissions(req.permissions);

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO skill_version (
           id, skill_id, version, status, input_schema, output_schema, prompt, script, script_lang,
           static_check, change_note, rollback_from, created_by, created_at, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          versionId,
          id,
          req.version,
          SkillStatus.DRAFT,
          JSON.stringify(req.inputSchema ?? {}),
          JSON.stringify(req.outputSchema ?? {}),
          req.prompt ?? null,
          req.script ?? null,
          req.scriptLang ?? null,
          JSON.stringify({ pass: check.pass, issues: check.issues }),
          req.changeNote ?? null,
          null,
          req.createdBy,
          now,
        ],
      );

      for (const decl of permissions) {
        this.db.run(
          'INSERT INTO skill_permission (id, skill_version_id, capability, granted, detail) VALUES (?, ?, ?, ?, ?)',
          [`skp-${nanoid(10)}`, versionId, decl.capability, decl.granted ? 1 : 0, decl.detail ?? null],
        );
      }

      this.db.run('UPDATE skill SET updated_at = ? WHERE id = ?', [now, id]);
      this.audit.write({
        action: 'skill_version_created',
        actorId: req.createdBy,
        actorType: 'human',
        resourceType: 'skill',
        resourceId: id,
        resourceName: `${id}@${req.version}`,
        detail: { version: req.version, staticCheckPass: check.pass },
      });
    });

    return mapVersionRow(this.db, this.versionRowOrThrow(id, req.version));
  }

  /** 补齐六个能力项，未提供的默认未授予 */
  private normalizePermissions(declared?: PermissionDecl[]): PermissionDecl[] {
    const map = new Map((declared ?? []).map((d) => [d.capability, d]));
    return ALL_CAPABILITIES.map(
      (capability) =>
        map.get(capability) ?? ({ capability, granted: false, detail: undefined } as PermissionDecl),
    );
  }

  /* ─────────── 校验（铁律 1） ─────────── */

  validate(id: string, versionId: string): ValidateResult {
    this.rawOrThrow(id);
    const row =
      this.db.get<SkillVersionRow>('SELECT * FROM skill_version WHERE id = ? AND skill_id = ?', [
        versionId,
        id,
      ]) ?? null;
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `技能版本不存在：${versionId}`);

    const check = this.checker.scan(row.script, row.script_lang);
    const permissions = loadPermissions(this.db, row.id);
    const granted = new Set(permissions.filter((p) => p.granted).map((p) => p.capability));

    // 权限声明与实际调用一致性：脚本调用但未声明 → 阻断
    const permissionIssues: string[] = [];
    for (const capability of check.capabilities) {
      if (!granted.has(capability)) {
        permissionIssues.push(
          `脚本调用了未声明的能力「${PERMISSION_CAPABILITY_LABEL[capability]}（${capability}）」，请在权限声明中开启或移除该调用`,
        );
      }
    }
    for (const pattern of check.forbidden) {
      permissionIssues.push(`脚本包含禁止调用的 API「${pattern}」，无法通过声明解决，必须移除`);
    }

    const result: ValidateResult = {
      pass: check.issues.length === 0 && permissionIssues.length === 0,
      permissionIssues,
      staticIssues: check.issues,
    };

    this.db.run('UPDATE skill_version SET static_check = ? WHERE id = ?', [
      JSON.stringify({ pass: check.pass, issues: check.issues }),
      versionId,
    ]);

    return result;
  }

  /* ─────────── 发布 / 下线 / 影响面 / 回滚 ─────────── */

  publish(id: string, version: string): SkillVersion {
    const skillRow = this.rawOrThrow(id);
    const versionRow = this.versionRowOrThrow(id, version);

    const result = this.validate(id, versionRow.id);
    if (!result.pass) {
      throw new AppError(
        ErrCode.BAD_REQUEST,
        '静态检查或权限声明校验未通过，禁止发布',
        result as unknown as Record<string, unknown>,
      );
    }

    const from = versionRow.status as SkillStatus;
    if (!SKILL_STATUS_TRANSITIONS[from].includes(SkillStatus.PUBLISHED)) {
      throw new AppError(ErrCode.STATE_ILLEGAL, `版本状态 ${from} 不允许发布`, { from });
    }

    const now = isoNow();

    this.db.tx(() => {
      // 同技能的其他已发布版本自动下线（版本唯一生效）
      this.db.run(
        "UPDATE skill_version SET status = 'offline' WHERE skill_id = ? AND status = 'published' AND id <> ?",
        [id, versionRow.id],
      );
      this.db.run("UPDATE skill_version SET status = 'published', published_at = ? WHERE id = ?", [
        now,
        versionRow.id,
      ]);
      this.db.run(
        "UPDATE skill SET current_version = ?, status = 'published', updated_at = ? WHERE id = ?",
        [version, now, id],
      );

      this.audit.write({
        action: 'skill_published',
        actorId: versionRow.created_by,
        actorType: 'human',
        resourceType: 'skill',
        resourceId: id,
        resourceName: `${skillRow.name} ${version}`,
        detail: { version, from },
        workspaceId: skillRow.workspace_id,
      });
    });

    metrics.emit(MetricEvent.SKILL_PUBLISHED, { skillId: id, version });
    return mapVersionRow(this.db, this.versionRowOrThrow(id, version));
  }

  offline(id: string, version: string): SkillVersion {
    const skillRow = this.rawOrThrow(id);
    const versionRow = this.versionRowOrThrow(id, version);

    const impact = this.impact(id, version);
    if (impact.blocked) {
      throw new AppError(
        ErrCode.SKILL_IN_USE,
        '该版本被引用，无法下线',
        impact as unknown as Record<string, unknown>,
      );
    }

    const from = versionRow.status as SkillStatus;
    if (!SKILL_STATUS_TRANSITIONS[from].includes(SkillStatus.OFFLINE)) {
      throw new AppError(ErrCode.STATE_ILLEGAL, `版本状态 ${from} 不允许下线`, { from });
    }

    const now = isoNow();

    this.db.tx(() => {
      this.db.run("UPDATE skill_version SET status = 'offline' WHERE id = ?", [versionRow.id]);
      const stillPublished = this.db.get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM skill_version WHERE skill_id = ? AND status = 'published'",
        [id],
      );
      if (!stillPublished || Number(stillPublished.c) === 0) {
        this.db.run(
          "UPDATE skill SET status = 'offline', current_version = NULL, updated_at = ? WHERE id = ?",
          [now, id],
        );
      } else {
        this.db.run('UPDATE skill SET updated_at = ? WHERE id = ?', [now, id]);
      }

      this.audit.write({
        action: 'skill_offline',
        resourceType: 'skill',
        resourceId: id,
        resourceName: `${skillRow.name} ${version}`,
        detail: { version, from },
        workspaceId: skillRow.workspace_id,
      });
    });

    return mapVersionRow(this.db, this.versionRowOrThrow(id, version));
  }

  /** 影响面分析：被哪些 AI 成员 / 工作流引用（工作流本期为占位，见 §8 #4） */
  impact(id: string, version: string): ImpactAnalysis {
    const skillRow = this.rawOrThrow(id);

    const agents = this.db.all<{ id: string; name: string; skill_ids: string }>(
      'SELECT m.id, m.name, ac.skill_ids FROM agent_config ac JOIN member m ON m.id = ac.member_id',
    );
    const referencedByAgents = agents
      .filter((a) => parseJsonArray(a.skill_ids).includes(id))
      .map((a) => `${a.name}(${a.id})`);

    // 工作流本期不实现（§8 #4），保留占位字段以稳定接口
    const referencedByWorkflows: string[] = [];

    return {
      version,
      referencedByAgents,
      referencedByWorkflows,
      blocked: referencedByAgents.length > 0 || referencedByWorkflows.length > 0,
    };
  }

  /**
   * 回滚：以目标版本内容生成一个**新版本**（保持版本历史不可变、可审计），
   * 并将 `current_version` 指向新版本，同时标记 `rollback_from`。
   */
  rollback(id: string, req: RollbackSkillReq): SkillVersion {
    const skillRow = this.rawOrThrow(id);
    const sourceRow = this.versionRowOrThrow(id, req.toVersion);

    const newest = this.db.get<{ version: string }>(
      'SELECT version FROM skill_version WHERE skill_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      [id],
    );
    const nextVersion = bumpVersion(newest?.version ?? sourceRow.version);

    const now = isoNow();
    const versionId = `skv-${nanoid(10)}`;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO skill_version (
           id, skill_id, version, status, input_schema, output_schema, prompt, script, script_lang,
           static_check, change_note, rollback_from, created_by, created_at, published_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          versionId,
          id,
          nextVersion,
          SkillStatus.PUBLISHED,
          sourceRow.input_schema,
          sourceRow.output_schema,
          sourceRow.prompt,
          sourceRow.script,
          sourceRow.script_lang,
          sourceRow.static_check,
          `回滚至 ${req.toVersion}：${req.reason}`,
          req.toVersion,
          sourceRow.created_by,
          now,
          now,
        ],
      );

      // 复制权限声明
      const perms = this.db.all<SkillPermissionRow>(
        'SELECT * FROM skill_permission WHERE skill_version_id = ?',
        [sourceRow.id],
      );
      for (const perm of perms) {
        this.db.run(
          'INSERT INTO skill_permission (id, skill_version_id, capability, granted, detail) VALUES (?, ?, ?, ?, ?)',
          [`skp-${nanoid(10)}`, versionId, perm.capability, perm.granted, perm.detail],
        );
      }

      this.db.run(
        "UPDATE skill_version SET status = 'offline' WHERE skill_id = ? AND status = 'published'",
        [id],
      );
      this.db.run(
        "UPDATE skill SET current_version = ?, status = 'published', updated_at = ? WHERE id = ?",
        [nextVersion, now, id],
      );

      this.audit.write({
        action: 'skill_rolled_back',
        actorId: sourceRow.created_by,
        actorType: 'human',
        resourceType: 'skill',
        resourceId: id,
        resourceName: `${skillRow.name} ${nextVersion}`,
        detail: { from: req.toVersion, to: nextVersion, reason: req.reason },
        workspaceId: skillRow.workspace_id,
      });
    });

    return mapVersionRow(this.db, this.versionRowOrThrow(id, nextVersion));
  }

  /* ─────────── 执行（铁律 2） ─────────── */

  execute(id: string, req: ExecuteSkillReq, actorId?: string, initiatorId?: string): SkillExecutionResult {
    const skillRow = this.rawOrThrow(id);
    const versionRow = this.db.get<SkillVersionRow>(
      'SELECT * FROM skill_version WHERE id = ? AND skill_id = ?',
      [req.versionId, id],
    );
    if (!versionRow) throw new AppError(ErrCode.NOT_FOUND, `技能版本不存在：${req.versionId}`);

    // 信任等级前置校验（Hub 来源技能）
    this.assertTrust(skillRow);

    const permissions = loadPermissions(this.db, versionRow.id);
    const traceId = trace.current();

    const result = this.sandbox.run({
      script: versionRow.script,
      scriptLang: versionRow.script_lang,
      permissions,
      input: req.input,
    });

    const skill = mapSkillRow(skillRow);
    const executionId = `ske-${nanoid(10)}`;
    const now = isoNow();

    if (result.status !== SkillExecutionStatus.SUCCESS) {
      // 越权调用：写审计 + 记录执行 + 抛 403
      this.db.tx(() => {
        this.db.run(
          `INSERT INTO skill_execution (
             id, skill_id, skill_version, source, trust_level, sandbox_id, input, output, status,
             block_reason, duration_ms, local_files, trace_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
          [
            executionId,
            id,
            versionRow.version,
            skill.source,
            skill.trustLevel,
            result.sandboxId,
            JSON.stringify(req.input),
            SkillExecutionStatus.BLOCKED,
            result.blockReason ?? '未知原因',
            result.durationMs,
            result.localFiles,
            traceId,
            now,
          ],
        );

        this.audit.write({
          action: 'skill_rejected',
          actorId: actorId ?? null,
          actorType: 'ai',
          initiatorId: initiatorId ?? null,
          resourceType: 'skill',
          resourceId: id,
          resourceName: `${skill.name} ${versionRow.version}`,
          durationMs: result.durationMs,
          result: 'blocked',
          detail: {
            reason: result.violationKind ?? 'PERMISSION_UNDECLARED',
            capability: result.violatedCapability ?? null,
            violatedApi: result.violatedApi ?? null,
            blockReason: result.blockReason ?? null,
            declared: permissions.filter((p) => p.granted).map((p) => p.capability),
          },
          workspaceId: skillRow.workspace_id,
        });
      });

      metrics.emit(MetricEvent.SKILL_REJECTED, { skillId: id, reason: result.blockReason });

      throw new AppError(
        ErrCode.PERMISSION_UNDECLARED,
        result.blockReason ?? '技能尝试越权操作，已阻断',
        {
          reason: result.violationKind ?? 'PERMISSION_UNDECLARED',
          executedCapability: result.violatedCapability ?? null,
          violatedApi: result.violatedApi ?? null,
          declared: permissions.filter((p) => p.granted).map((p) => p.capability),
          sandboxId: result.sandboxId,
        },
      );
    }

    const output = result.output ?? {};
    const tokenUsed = 320;
    const cost = 0.004;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO skill_execution (
           id, skill_id, skill_version, source, trust_level, sandbox_id, input, output, status,
           block_reason, duration_ms, local_files, trace_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        [
          executionId,
          id,
          versionRow.version,
          skill.source,
          skill.trustLevel,
          result.sandboxId,
          JSON.stringify(req.input),
          JSON.stringify(output),
          SkillExecutionStatus.SUCCESS,
          result.durationMs,
          result.localFiles,
          traceId,
          now,
        ],
      );

      metrics.recordUsage(
        {
          workspaceId: skillRow.workspace_id,
          category: 'sandbox',
          agentId: actorId ?? null,
          cost,
          traceId,
        },
        this.db,
      );

      this.audit.write({
        action: 'skill_executed',
        actorId: actorId ?? null,
        actorType: 'ai',
        initiatorId: initiatorId ?? null,
        resourceType: 'skill',
        resourceId: id,
        resourceName: `${skill.name} ${versionRow.version}`,
        durationMs: result.durationMs,
        tokenUsed,
        detail: {
          sandboxId: result.sandboxId,
          declared: permissions.filter((p) => p.granted).map((p) => p.capability),
          localFiles: result.localFiles,
        },
        workspaceId: skillRow.workspace_id,
      });
    });

    metrics.emit(MetricEvent.SKILL_EXECUTED, { skillId: id, version: versionRow.version });

    return {
      executionId,
      skillId: id,
      version: versionRow.version,
      status: SkillExecutionStatus.SUCCESS,
      output,
      sandboxId: result.sandboxId,
      localFiles: result.localFiles,
      durationMs: result.durationMs,
      tokenUsed,
      cost,
      traceId,
    };
  }

  /** Hub 来源技能的信任等级与签名校验 */
  private assertTrust(skillRow: SkillRow): void {
    if (skillRow.source !== SkillSource.HUB) return;
    if (!skillRow.hub_skill_id) return;

    const hubSkill = this.db.get<{ id: string; review_status: string; signature_ok: number | null; name: string }>(
      'SELECT id, review_status, signature_ok, name FROM hub_skill WHERE id = ?',
      [skillRow.hub_skill_id],
    );
    if (!hubSkill) {
      throw new AppError(ErrCode.SIGNATURE_INVALID, '技能来源索引缺失，已阻断', {
        hubSkillId: skillRow.hub_skill_id,
      });
    }

    const repo = this.db.get<{ trust_level: string; signature_required: number }>(
      'SELECT r.trust_level, r.signature_required FROM hub_repo r JOIN hub_skill h ON h.repo_id = r.id WHERE h.id = ?',
      [hubSkill.id],
    );

    if (hubSkill.review_status !== 'approved') {
      throw new AppError(ErrCode.TRUST_PENDING, `技能「${hubSkill.name}」尚未审核通过，禁止调用`, {
        reviewStatus: hubSkill.review_status,
        trustLevel: repo?.trust_level ?? TrustLevel.COMMUNITY,
      });
    }

    if (repo && Number(repo.signature_required) === 1 && hubSkill.signature_ok !== 1) {
      throw new AppError(ErrCode.SIGNATURE_INVALID, 'Skill 来源校验失败，已阻断', {
        hubSkillId: hubSkill.id,
      });
    }
  }

  /** 加载 Hub 技能索引（供 HubService 复用） */
  hubSkillOf(id: string): HubSkill | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM hub_skill WHERE id = ?', [id]);
    if (!row) return undefined;
    return {
      id: String(row.id),
      repoId: String(row.repo_id),
      name: String(row.name),
      slug: String(row.slug),
      description: row.description ? String(row.description) : undefined,
      version: String(row.version),
      tags: parseJsonArray(row.tags),
      permissions: parseJsonArrayOf<PermissionDecl>(row.permissions),
      installCount: Number(row.install_count),
      successRate: row.success_rate === null || row.success_rate === undefined ? undefined : Number(row.success_rate),
      reportCount: Number(row.report_count),
      reviewStatus: String(row.review_status) as HubSkill['reviewStatus'],
      signatureOk:
        row.signature_ok === null || row.signature_ok === undefined ? undefined : toBool(row.signature_ok),
      cachedMeta: parseJsonObject(row.cached_meta),
      cacheExpireAt: row.cache_expire_at ? String(row.cache_expire_at) : undefined,
      createdAt: String(row.created_at),
    };
  }
}

/** v1.2.0 → v1.2.1 */
export function bumpVersion(version: string): string {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) return `${version}-rollback`;
  const [, major, minor, patch] = match;
  return `v${major}.${minor}.${Number(patch) + 1}`;
}

export const skillService = new SkillService();

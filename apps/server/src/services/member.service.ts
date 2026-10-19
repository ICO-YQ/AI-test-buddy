/**
 * MemberService —— 人 + AI 成员 CRUD、AI 配置、有效权限（FR-AG-01~06 / FR-GOV-01）
 *
 * 铁律：
 *  - 创建 AI 成员必须带 `creatorId`，且创建者有效权限即该 AI 的权限上限；
 *  - `agent_config.declaredScope` 不得超出创建者有效数据域（否则 403 SCOPE_DENIED）；
 *  - 有效权限 = min(自身声明, 创建者权限)，由 PermissionService 统一计算（服务端强制）。
 */

import {
  ErrCode,
  MemberStatus,
  MemberType,
  type AgentConfig,
  type CreateMemberReq,
  type EffectivePermission,
  type Member,
  type MemberRole,
  type UpdateMemberReq,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { AppError } from '../core/errors';
import { PermissionService } from '../core/permission';
import { AuditService } from '../core/audit';
import {
  getDb,
  isoNow,
  parseJsonArray,
  toBool,
  type Db,
} from '../db/client';

interface MemberRow {
  id: string;
  workspace_id: string;
  type: string;
  name: string;
  handle: string | null;
  avatar_text: string;
  avatar_color: string;
  role: string;
  capability_tags: string;
  data_scope: string;
  creator_id: string | null;
  status: string;
  created_at: string;
}

interface AgentConfigRow {
  member_id: string;
  role_prompt: string;
  primary_model_id: string | null;
  fallback_model_ids: string;
  skill_ids: string;
  tool_ids: string;
  kb_space_ids: string;
  declared_scope: string;
  context_budget: number;
  context_priority: string;
  quota_monthly: number;
  quota_used: number;
  version: string;
  gray_ratio: number;
}

/** 默认工作空间（演示单空间） */
const DEFAULT_WORKSPACE = 'ws-huan-0001';

export class MemberService {
  private readonly db: Db;
  private readonly permissions: PermissionService;
  private readonly audit: AuditService;

  constructor(db: Db = getDb()) {
    this.db = db;
    this.permissions = new PermissionService(db);
    this.audit = new AuditService(db);
  }

  /* ═══════ 映射 ═══════ */

  private toAgentConfig(row: AgentConfigRow): AgentConfig {
    return {
      memberId: row.member_id,
      rolePrompt: row.role_prompt,
      primaryModelId: row.primary_model_id ?? undefined,
      fallbackModelIds: parseJsonArray(row.fallback_model_ids),
      skillIds: parseJsonArray(row.skill_ids),
      toolIds: parseJsonArray(row.tool_ids),
      kbSpaceIds: parseJsonArray(row.kb_space_ids),
      declaredScope: parseJsonArray(row.declared_scope),
      contextBudget: Number(row.context_budget),
      contextPriority: parseJsonArray(row.context_priority),
      quotaMonthly: Number(row.quota_monthly),
      quotaUsed: Number(row.quota_used),
      version: row.version,
      grayRatio: Number(row.gray_ratio),
    };
  }

  private toMember(row: MemberRow, withConfig = true): Member {
    const type = row.type as MemberType;
    const member: Member = {
      id: row.id,
      workspaceId: row.workspace_id,
      type,
      name: row.name,
      handle: row.handle ?? undefined,
      avatarText: row.avatar_text,
      avatarColor: row.avatar_color,
      role: row.role as MemberRole,
      capabilityTags: parseJsonArray(row.capability_tags),
      dataScope: parseJsonArray(row.data_scope),
      creatorId: row.creator_id ?? undefined,
      status: row.status as MemberStatus,
      createdAt: row.created_at,
    };
    if (withConfig && type === MemberType.AI) {
      const cfg = this.db.get<AgentConfigRow>('SELECT * FROM agent_config WHERE member_id = ?', [row.id]);
      if (cfg) member.agentConfig = this.toAgentConfig(cfg);
    }
    return member;
  }

  /* ═══════ 查询 ═══════ */

  list(type?: string): Member[] {
    const rows = type
      ? this.db.all<MemberRow>('SELECT * FROM member WHERE type = ? ORDER BY created_at ASC, rowid ASC', [type])
      : this.db.all<MemberRow>('SELECT * FROM member ORDER BY type ASC, created_at ASC, rowid ASC');
    return rows.map((row) => this.toMember(row));
  }

  getOrThrow(id: string): Member {
    const row = this.db.get<MemberRow>('SELECT * FROM member WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `成员不存在：${id}`);
    return this.toMember(row);
  }

  private rawOrThrow(id: string): MemberRow {
    const row = this.db.get<MemberRow>('SELECT * FROM member WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `成员不存在：${id}`);
    return row;
  }

  /* ═══════ 创建 ═══════ */

  create(req: CreateMemberReq): Member {
    if (!req.name || req.name.trim() === '') {
      throw new AppError(ErrCode.BAD_REQUEST, '成员名称不能为空');
    }
    const type: MemberType = req.type === MemberType.AI ? MemberType.AI : MemberType.HUMAN;

    const id = `${type === MemberType.AI ? 'm-ai' : 'm-human'}-${nanoid(8)}`;
    const workspaceId = DEFAULT_WORKSPACE;
    const now = isoNow();

    const avatarText = req.avatarText ?? (type === MemberType.AI ? 'AI' : req.name.trim().slice(0, 1));
    const avatarColor = req.avatarColor ?? (type === MemberType.AI ? 'var(--ac)' : 'var(--st-2)');
    const role: MemberRole = req.role ?? 'member';
    const dataScope = req.dataScope ?? [];
    const capabilityTags = req.capabilityTags ?? [];

    // AI 成员必须带创建者，且创建者即权限上限
    let creatorId: string | null = null;
    let declaredScope: string[] = [];
    if (type === MemberType.AI) {
      if (!req.creatorId) {
        throw new AppError(ErrCode.BAD_REQUEST, '创建 AI 成员必须指定 creatorId（权限上限来源）', {
          field: 'creatorId',
        });
      }
      const creator = this.rawOrThrow(req.creatorId);
      creatorId = creator.id;
      declaredScope = req.agentConfig?.declaredScope ?? dataScope;

      // 声明数据域不得超出创建者有效数据域
      this.permissions.assertScope(creatorId, declaredScope);
    }

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO member (
           id, workspace_id, type, name, handle, avatar_text, avatar_color,
           role, capability_tags, data_scope, creator_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          workspaceId,
          type,
          req.name.trim(),
          req.handle ?? null,
          avatarText,
          avatarColor,
          role,
          JSON.stringify(capabilityTags),
          JSON.stringify(dataScope),
          creatorId,
          MemberStatus.ACTIVE,
          now,
        ],
      );

      if (type === MemberType.AI) {
        const cfg = req.agentConfig ?? {};
        this.db.run(
          `INSERT INTO agent_config (
             member_id, role_prompt, primary_model_id, fallback_model_ids, skill_ids, tool_ids,
             kb_space_ids, declared_scope, context_budget, context_priority,
             quota_monthly, quota_used, version, gray_ratio
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            cfg.rolePrompt ?? `${req.name}：请在此填写角色定义与系统指令。`,
            cfg.primaryModelId ?? null,
            JSON.stringify(cfg.fallbackModelIds ?? []),
            JSON.stringify(cfg.skillIds ?? []),
            JSON.stringify(cfg.toolIds ?? []),
            JSON.stringify(cfg.kbSpaceIds ?? []),
            JSON.stringify(declaredScope),
            cfg.contextBudget ?? 8192,
            JSON.stringify(cfg.contextPriority ?? ['system', 'task', 'kb', 'history']),
            cfg.quotaMonthly ?? 0,
            0,
            cfg.version ?? 'v1.0',
            cfg.grayRatio ?? 100,
          ],
        );
      }

      this.audit.write({
        action: 'member_created',
        actorId: creatorId,
        actorType: creatorId ? MemberType.HUMAN : MemberType.HUMAN,
        initiatorId: creatorId,
        resourceType: 'member',
        resourceId: id,
        resourceName: req.name,
        detail: { type, role, dataScope, declaredScope },
        workspaceId,
      });
    });

    return this.getOrThrow(id);
  }

  /* ═══════ 更新 ═══════ */

  update(id: string, req: UpdateMemberReq): Member {
    const row = this.rawOrThrow(id);

    const fields: string[] = [];
    const params: unknown[] = [];
    const detail: Record<string, unknown> = {};

    if (req.name !== undefined) {
      fields.push('name = ?');
      params.push(req.name);
      detail.name = req.name;
    }
    if (req.handle !== undefined) {
      fields.push('handle = ?');
      params.push(req.handle);
      detail.handle = req.handle;
    }
    if (req.avatarText !== undefined) {
      fields.push('avatar_text = ?');
      params.push(req.avatarText);
    }
    if (req.avatarColor !== undefined) {
      fields.push('avatar_color = ?');
      params.push(req.avatarColor);
    }
    if (req.role !== undefined) {
      fields.push('role = ?');
      params.push(req.role);
      detail.role = req.role;
    }
    if (req.capabilityTags !== undefined) {
      fields.push('capability_tags = ?');
      params.push(JSON.stringify(req.capabilityTags));
      detail.capabilityTags = req.capabilityTags;
    }
    if (req.dataScope !== undefined) {
      fields.push('data_scope = ?');
      params.push(JSON.stringify(req.dataScope));
      detail.dataScope = req.dataScope;

      // 人类成员收窄数据域时，其名下 AI 成员的有效权限同步收窄（由 min() 计算自动生效）
    }
    if (req.status !== undefined) {
      fields.push('status = ?');
      params.push(req.status);
      detail.status = req.status;
    }

    if (fields.length === 0) return this.getOrThrow(id);

    this.db.tx(() => {
      this.db.run(`UPDATE member SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      this.audit.write({
        action: 'member_updated',
        actorId: row.creator_id,
        actorType: MemberType.HUMAN,
        initiatorId: row.creator_id,
        resourceType: 'member',
        resourceId: id,
        resourceName: row.name,
        detail,
        workspaceId: row.workspace_id,
      });
    });

    return this.getOrThrow(id);
  }

  /* ═══════ 删除 ═══════ */

  remove(id: string): { id: string } {
    const row = this.rawOrThrow(id);

    // 被任务引用时禁止删除（保持演示数据完整性）
    const refs = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM task WHERE creator_id = ? OR assignee_id = ?',
      [id, id],
    );
    if (refs && Number(refs.c) > 0) {
      throw new AppError(ErrCode.CONFLICT, `成员被 ${refs.c} 个任务引用，无法删除`, {
        memberId: id,
        referencedTasks: Number(refs.c),
      });
    }

    this.db.tx(() => {
      this.db.run('DELETE FROM agent_config WHERE member_id = ?', [id]);
      this.db.run('DELETE FROM member WHERE id = ?', [id]);
      this.audit.write({
        action: 'member_deleted',
        actorId: row.creator_id,
        actorType: MemberType.HUMAN,
        resourceType: 'member',
        resourceId: id,
        resourceName: row.name,
        detail: { type: row.type },
        workspaceId: row.workspace_id,
      });
    });

    return { id };
  }

  /* ═══════ 有效权限 ═══════ */

  effectivePermissions(id: string): EffectivePermission {
    this.rawOrThrow(id); // 存在性校验
    return this.permissions.computeEffective(id);
  }

  /** 供其他服务复用：AI 成员的有效数据域 */
  effectiveScopeOf(id: string): string[] {
    return this.permissions.effectiveScopeOf(id);
  }

  /* ═══════ AI 配置 ═══════ */

  updateAgentConfig(id: string, cfg: Partial<AgentConfig>): AgentConfig {
    const row = this.rawOrThrow(id);
    if (row.type !== MemberType.AI) {
      throw new AppError(ErrCode.BAD_REQUEST, '仅 AI 成员可配置 agent-config', { memberId: id });
    }

    const current = this.db.get<AgentConfigRow>('SELECT * FROM agent_config WHERE member_id = ?', [id]);
    if (!current) throw new AppError(ErrCode.NOT_FOUND, `AI 成员配置不存在：${id}`);

    // 声明的数据域不得超出创建者有效数据域
    if (cfg.declaredScope !== undefined) {
      if (!row.creator_id) {
        throw new AppError(ErrCode.BAD_REQUEST, 'AI 成员缺失创建者，无法设置数据域', { memberId: id });
      }
      this.permissions.assertScope(row.creator_id, cfg.declaredScope);
    }

    // 校验 skillIds / kbSpaceIds 合法
    const skillIds = cfg.skillIds ?? parseJsonArray(current.skill_ids);
    for (const skillId of skillIds) {
      const exists = this.db.get<{ id: string }>('SELECT id FROM skill WHERE id = ?', [skillId]);
      if (!exists) throw new AppError(ErrCode.BAD_REQUEST, `技能不存在：${skillId}`, { skillId });
    }

    const kbSpaceIds = cfg.kbSpaceIds ?? parseJsonArray(current.kb_space_ids);
    for (const spaceId of kbSpaceIds) {
      const exists = this.db.get<{ id: string }>('SELECT id FROM kb_space WHERE id = ?', [spaceId]);
      if (!exists) throw new AppError(ErrCode.BAD_REQUEST, `知识空间不存在：${spaceId}`, { spaceId });
    }

    if (cfg.primaryModelId) {
      const model = this.db.get<{ id: string }>('SELECT id FROM model_config WHERE id = ?', [
        cfg.primaryModelId,
      ]);
      if (!model) {
        throw new AppError(ErrCode.BAD_REQUEST, `模型不存在：${cfg.primaryModelId}`, {
          modelId: cfg.primaryModelId,
        });
      }
    }

    const next = {
      rolePrompt: cfg.rolePrompt ?? current.role_prompt,
      primaryModelId: cfg.primaryModelId ?? current.primary_model_id,
      fallbackModelIds: cfg.fallbackModelIds ?? parseJsonArray(current.fallback_model_ids),
      skillIds,
      toolIds: cfg.toolIds ?? parseJsonArray(current.tool_ids),
      kbSpaceIds,
      declaredScope: cfg.declaredScope ?? parseJsonArray(current.declared_scope),
      contextBudget: cfg.contextBudget ?? Number(current.context_budget),
      contextPriority: cfg.contextPriority ?? parseJsonArray(current.context_priority),
      quotaMonthly: cfg.quotaMonthly ?? Number(current.quota_monthly),
      version: cfg.version ?? current.version,
      grayRatio: cfg.grayRatio ?? Number(current.gray_ratio),
    };

    this.db.tx(() => {
      this.db.run(
        `UPDATE agent_config SET
           role_prompt = ?, primary_model_id = ?, fallback_model_ids = ?, skill_ids = ?, tool_ids = ?,
           kb_space_ids = ?, declared_scope = ?, context_budget = ?, context_priority = ?,
           quota_monthly = ?, version = ?, gray_ratio = ?
         WHERE member_id = ?`,
        [
          next.rolePrompt,
          next.primaryModelId,
          JSON.stringify(next.fallbackModelIds),
          JSON.stringify(next.skillIds),
          JSON.stringify(next.toolIds),
          JSON.stringify(next.kbSpaceIds),
          JSON.stringify(next.declaredScope),
          next.contextBudget,
          JSON.stringify(next.contextPriority),
          next.quotaMonthly,
          next.version,
          next.grayRatio,
          id,
        ],
      );

      // 敏感操作：审计失败即阻断
      this.audit.write({
        action: 'agent_config_updated',
        actorId: row.creator_id,
        actorType: MemberType.HUMAN,
        initiatorId: row.creator_id,
        resourceType: 'member',
        resourceId: id,
        resourceName: row.name,
        detail: {
          declaredScope: next.declaredScope,
          skillIds: next.skillIds,
          kbSpaceIds: next.kbSpaceIds,
          grayRatio: next.grayRatio,
        },
        workspaceId: row.workspace_id,
      });
    });

    const updated = this.db.get<AgentConfigRow>('SELECT * FROM agent_config WHERE member_id = ?', [id]);
    return this.toAgentConfig(updated as AgentConfigRow);
  }

  /** 统计信息（供 UI 展示 quota_used 等） */
  configRaw(id: string): Record<string, unknown> | undefined {
    const row = this.db.get<AgentConfigRow>('SELECT * FROM agent_config WHERE member_id = ?', [id]);
    if (!row) return undefined;
    return this.toAgentConfig(row) as unknown as Record<string, unknown>;
  }

  /** 简易状态判断（供路由层使用） */
  isActive(id: string): boolean {
    const row = this.rawOrThrow(id);
    return toBool(row.status === MemberStatus.ACTIVE ? 1 : 0);
  }
}

export const memberService = new MemberService();

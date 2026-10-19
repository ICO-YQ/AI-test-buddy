/**
 * HubService —— 技能市场（FR-HB-01~10）
 *
 * 铁律：
 *  - 社区源技能 `reviewStatus !== 'approved'` → 不可 `load`（403 TRUST_PENDING）
 *  - 签名校验失败 → 403 SIGNATURE_INVALID 并写审计告警
 *  - `load` 返回 `sandboxRequired: true`；执行一律走沙箱，本地落盘数必须为 0
 *  - 远程只同步**元数据**，不落盘
 */

import {
  ErrCode,
  MetricEvent,
  ReviewStatus,
  SkillSource,
  TrustLevel,
  type CreateRepoReq,
  type HubLoadResult,
  type HubRepo,
  type HubSkill,
  type PermissionDecl,
  type UpdateRepoReq,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { mockHubClient, type HubClient } from '../ai/hub-client';
import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { NotificationService } from './notification.service';
import {
  getDb,
  isoNow,
  parseJsonArray,
  parseJsonArrayOf,
  parseJsonObject,
  toBool,
  type Db,
} from '../db/client';

const DEFAULT_WORKSPACE = 'ws-huan-0001';

interface RepoRow {
  id: string;
  name: string;
  url: string;
  type: string;
  auth_type: string | null;
  trust_level: string;
  signature_required: number;
  skill_count: number;
  status: string;
  fallback_policy: string;
  last_sync_at: string | null;
  created_at: string;
}

interface HubSkillRow {
  id: string;
  repo_id: string;
  name: string;
  slug: string;
  description: string | null;
  version: string;
  tags: string;
  permissions: string;
  install_count: number;
  success_rate: number | null;
  report_count: number;
  review_status: string;
  signature_ok: number | null;
  cached_meta: string;
  cache_expire_at: string | null;
  created_at: string;
}

export interface ListHubSkillFilters {
  repoId?: string;
  q?: string;
  trust?: string;
}

export interface HubSyncResult {
  synced: number;
  failed: number;
  lastSyncAt: string;
}

export class HubService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly client: HubClient;
  private readonly notifications: NotificationService;

  constructor(db: Db = getDb(), deps: { client?: HubClient } = {}) {
    this.db = db;
    this.audit = new AuditService(db);
    this.client = deps.client ?? mockHubClient;
    this.notifications = new NotificationService(db);
  }

  /* ═══════ 映射 ═══════ */

  private toRepo(row: RepoRow): HubRepo {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      type: row.type as HubRepo['type'],
      authType: (row.auth_type as HubRepo['authType']) ?? undefined,
      trustLevel: row.trust_level as TrustLevel,
      signatureRequired: toBool(row.signature_required),
      skillCount: Number(row.skill_count),
      status: row.status as HubRepo['status'],
      fallbackPolicy: row.fallback_policy as HubRepo['fallbackPolicy'],
      lastSyncAt: row.last_sync_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  private toHubSkill(row: HubSkillRow): HubSkill {
    return {
      id: row.id,
      repoId: row.repo_id,
      name: row.name,
      slug: row.slug,
      description: row.description ?? undefined,
      version: row.version,
      tags: parseJsonArray(row.tags),
      permissions: parseJsonArrayOf<PermissionDecl>(row.permissions),
      installCount: Number(row.install_count),
      successRate: row.success_rate === null ? undefined : Number(row.success_rate),
      reportCount: Number(row.report_count),
      reviewStatus: row.review_status as HubSkill['reviewStatus'],
      signatureOk: row.signature_ok === null ? undefined : toBool(row.signature_ok),
      cachedMeta: parseJsonObject(row.cached_meta),
      cacheExpireAt: row.cache_expire_at ?? undefined,
      createdAt: row.created_at,
    };
  }

  private repoOrThrow(id: string): RepoRow {
    const row = this.db.get<RepoRow>('SELECT * FROM hub_repo WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `Hub 仓库不存在：${id}`);
    return row;
  }

  private hubSkillOrThrow(id: string): HubSkillRow {
    const row = this.db.get<HubSkillRow>('SELECT * FROM hub_skill WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `Hub 技能不存在：${id}`);
    return row;
  }

  /* ═══════ 仓库 ═══════ */

  listRepos(): HubRepo[] {
    return this.db
      .all<RepoRow>('SELECT * FROM hub_repo ORDER BY trust_level ASC, created_at ASC')
      .map((row) => this.toRepo(row));
  }

  registerRepo(req: CreateRepoReq, actor: string): HubRepo {
    if (!req.name || !req.url) {
      throw new AppError(ErrCode.BAD_REQUEST, '仓库 name 与 url 为必填');
    }
    const dup = this.db.get<{ id: string }>('SELECT id FROM hub_repo WHERE name = ?', [req.name]);
    if (dup) throw new AppError(ErrCode.CONFLICT, `仓库名称已存在：${req.name}`, { name: req.name });

    const id = `repo-${nanoid(10)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO hub_repo (
           id, name, url, type, auth_type, trust_level, signature_required,
           skill_count, status, fallback_policy, last_sync_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, NULL, ?)`,
        [
          id,
          req.name,
          req.url,
          req.type,
          req.authType ?? 'none',
          req.trustLevel,
          req.signatureRequired === false ? 0 : 1,
          req.fallbackPolicy ?? (req.trustLevel === TrustLevel.COMMUNITY ? 'block' : 'cache'),
          now,
        ],
      );
      this.audit.write({
        action: 'hub_repo_registered',
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'hub_repo',
        resourceId: id,
        resourceName: req.name,
        detail: { url: req.url, trustLevel: req.trustLevel, type: req.type },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toRepo(this.repoOrThrow(id));
  }

  updateRepo(id: string, req: UpdateRepoReq, actor: string): HubRepo {
    const row = this.repoOrThrow(id);
    const fields: string[] = [];
    const params: unknown[] = [];

    if (req.name !== undefined) {
      fields.push('name = ?');
      params.push(req.name);
    }
    if (req.url !== undefined) {
      fields.push('url = ?');
      params.push(req.url);
    }
    if (req.trustLevel !== undefined) {
      fields.push('trust_level = ?');
      params.push(req.trustLevel);
    }
    if (req.signatureRequired !== undefined) {
      fields.push('signature_required = ?');
      params.push(req.signatureRequired ? 1 : 0);
    }
    if (req.status !== undefined) {
      fields.push('status = ?');
      params.push(req.status);
    }
    if (req.fallbackPolicy !== undefined) {
      fields.push('fallback_policy = ?');
      params.push(req.fallbackPolicy);
    }

    if (fields.length === 0) return this.toRepo(row);

    this.db.tx(() => {
      this.db.run(`UPDATE hub_repo SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      this.audit.write({
        action: 'hub_repo_updated',
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'hub_repo',
        resourceId: id,
        resourceName: req.name ?? row.name,
        detail: req as unknown as Record<string, unknown>,
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toRepo(this.repoOrThrow(id));
  }

  removeRepo(id: string, actor: string): { id: string } {
    const row = this.repoOrThrow(id);
    this.db.tx(() => {
      this.db.run(
        'UPDATE skill SET hub_skill_id = NULL WHERE hub_skill_id IN (SELECT id FROM hub_skill WHERE repo_id = ?)',
        [id],
      );
      this.db.run('DELETE FROM hub_skill WHERE repo_id = ?', [id]);
      this.db.run('DELETE FROM hub_repo WHERE id = ?', [id]);
      this.audit.write({
        action: 'hub_repo_deleted',
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'hub_repo',
        resourceId: id,
        resourceName: row.name,
        workspaceId: DEFAULT_WORKSPACE,
      });
    });
    return { id };
  }

  /* ═══════ 同步（仅元数据） ═══════ */

  sync(repoId: string, actor: string): HubSyncResult {
    const repo = this.repoOrThrow(repoId);
    if (repo.status !== 'active') {
      throw new AppError(ErrCode.BAD_REQUEST, `仓库已停用，无法同步：${repo.name}`, { repoId });
    }

    const now = isoNow();
    const skills = this.db.all<HubSkillRow>('SELECT * FROM hub_skill WHERE repo_id = ?', [repoId]);

    let synced = 0;
    let failed = 0;

    this.db.tx(() => {
      for (const row of skills) {
        const hubSkill = this.toHubSkill(row);
        // 仅拉取元数据（不落盘），并重新核验签名
        const meta = this.client.fetchMetadata({
          repo: this.toRepo(repo),
          skill: hubSkill,
        });

        if (!meta.signatureOk && toBool(repo.signature_required)) {
          failed += 1;
          // 签名失败的社区源 → 阻塞加载 + 告警
          this.db.run('UPDATE hub_skill SET signature_ok = 0 WHERE id = ?', [row.id]);
          this.audit.write({
            action: 'signature_invalid',
            actorId: actor,
            actorType: 'human',
            initiatorId: actor,
            resourceType: 'hub_skill',
            resourceId: row.id,
            resourceName: `${hubSkill.name} ${hubSkill.version}`,
            result: 'blocked',
            detail: { reason: 'SIGNATURE_INVALID', repoId, signature: meta.signature },
            workspaceId: DEFAULT_WORKSPACE,
          });
          continue;
        }

        this.db.run(
          'UPDATE hub_skill SET cached_meta = ?, cache_expire_at = ?, signature_ok = ? WHERE id = ?',
          [
            JSON.stringify({
              ...(parseJsonObject(row.cached_meta) as Record<string, unknown>),
              sizeBytes: meta.sizeBytes,
              lang: meta.lang,
              source: meta.source,
              signature: meta.signature,
              fetchedAt: meta.fetchedAt,
            }),
            new Date(Date.now() + 6 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
            meta.signatureOk ? 1 : 0,
            row.id,
          ],
        );
        synced += 1;
      }

      this.db.run('UPDATE hub_repo SET last_sync_at = ?, skill_count = ? WHERE id = ?', [
        now,
        skills.length,
        repoId,
      ]);

      this.audit.write({
        action: 'hub_repo_synced',
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'hub_repo',
        resourceId: repoId,
        resourceName: repo.name,
        detail: { synced, failed, skillCount: skills.length },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    metrics.emit(MetricEvent.HUB_SYNCED, { repoId, synced, failed });

    return { synced, failed, lastSyncAt: now };
  }

  /* ═══════ 技能索引 ═══════ */

  listSkills(filters: ListHubSkillFilters = {}): HubSkill[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.repoId) {
      where.push('h.repo_id = ?');
      params.push(filters.repoId);
    }
    if (filters.q) {
      where.push('(h.name LIKE ? OR h.slug LIKE ? OR h.description LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like, like);
    }
    if (filters.trust) {
      where.push('r.trust_level = ?');
      params.push(filters.trust);
    }

    const sql = `SELECT h.* FROM hub_skill h JOIN hub_repo r ON r.id = h.repo_id
                 ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY h.install_count DESC, h.created_at ASC`;
    return this.db.all<HubSkillRow>(sql, params).map((row) => this.toHubSkill(row));
  }

  /**
   * 加载（本地索引 + 安全检查），返回是否可用与是否强制沙箱。
   * 社区技能未审核通过 → 403 TRUST_PENDING；签名失败 → 403 SIGNATURE_INVALID。
   */
  load(skillId: string, actor: string): HubLoadResult {
    const row = this.hubSkillOrThrow(skillId);
    const repo = this.repoOrThrow(row.repo_id);
    const hubSkill = this.toHubSkill(row);

    const meta = this.client.fetchMetadata({ repo: this.toRepo(repo), skill: hubSkill });

    const denyAndAudit = (error: AppError, action = 'hub_skill_rejected'): never => {
      this.db.tx(() => {
        this.audit.write({
          action,
          // 双主体留痕：执行主体 = 发起本次加载/审核的成员（§7.1 审计约定）
          actorId: actor,
          actorType: 'human',
          initiatorId: actor,
          resourceType: 'hub_skill',
          resourceId: row.id,
          resourceName: `${hubSkill.name} ${hubSkill.version}`,
          result: 'blocked',
          detail: {
            reason: error.code === ErrCode.TRUST_PENDING ? 'TRUST_PENDING' : 'SIGNATURE_INVALID',
            trustLevel: repo.trust_level,
            reviewStatus: row.review_status,
            signatureOk: meta.signatureOk,
          },
          workspaceId: DEFAULT_WORKSPACE,
        });
        this.notifications.notifySecurity({
          workspaceId: DEFAULT_WORKSPACE,
          recipientId: 'm-human-zhangwei',
          title: `技能「${hubSkill.name}」加载被阻断：${error.message}`,
          refType: 'hub_skill',
          refId: row.id,
        });
      });
      throw error;
    };

    // 信任等级判定：社区源必须已审核通过
    if (repo.trust_level === TrustLevel.COMMUNITY && row.review_status !== ReviewStatus.APPROVED) {
      denyAndAudit(
        new AppError(ErrCode.TRUST_PENDING, `技能「${hubSkill.name}」尚未审核通过`, {
          reviewStatus: row.review_status,
          trustLevel: repo.trust_level,
        }),
      );
    }

    // 签名校验
    if (toBool(repo.signature_required) && !meta.signatureOk) {
      denyAndAudit(
        new AppError(ErrCode.SIGNATURE_INVALID, 'Skill 来源校验失败，已阻断', {
          hubSkillId: row.id,
          signature: meta.signature,
        }),
      );
    }

    // 通过：登记本地技能（若尚未登记），标记需沙箱
    const existing = this.db.get<{ id: string }>(
      'SELECT id FROM skill WHERE hub_skill_id = ? AND workspace_id = ?',
      [row.id, DEFAULT_WORKSPACE],
    );

    this.db.tx(() => {
      if (!existing) {
        const localId = `skl-${nanoid(10)}`;
        const now = isoNow();
        this.db.run(
          `INSERT INTO skill (
             id, workspace_id, slug, name, description, icon, tags, source, hub_skill_id,
             trust_level, status, current_version, enabled, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'draft', NULL, 1, ?, ?, ?)`,
          [
            localId,
            DEFAULT_WORKSPACE,
            `hub-${row.slug}`,
            row.name,
            row.description,
            row.tags,
            SkillSource.HUB,
            row.id,
            repo.trust_level,
            'm-human-zhangwei',
            now,
            now,
          ],
        );
      }

      this.audit.write({
        action: 'hub_skill_loaded',
        // 双主体留痕：供应链安全事件必须能追溯到「谁加载了它」
        actorId: actor,
        actorType: 'human',
        initiatorId: actor,
        resourceType: 'hub_skill',
        resourceId: row.id,
        resourceName: `${hubSkill.name} ${hubSkill.version}`,
        detail: {
          trustLevel: repo.trust_level,
          signatureOk: meta.signatureOk,
          sandboxRequired: true,
          source: meta.source,
        },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return {
      loaded: true,
      trustLevel: repo.trust_level as TrustLevel,
      signatureOk: meta.signatureOk,
      sandboxRequired: true,
    };
  }

  /** 一键熔断：停用该技能索引，并联动停用本地技能 */
  disable(skillId: string): { id: string; disabledAt: string } {
    const row = this.hubSkillOrThrow(skillId);
    const now = isoNow();

    this.db.tx(() => {
      this.db.run("UPDATE hub_repo SET fallback_policy = 'block' WHERE id = ?", [row.repo_id]);
      this.db.run('UPDATE skill SET enabled = 0, status = ?, updated_at = ? WHERE hub_skill_id = ?', [
        'offline',
        now,
        row.id,
      ]);
      this.audit.write({
        action: 'hub_skill_disabled',
        resourceType: 'hub_skill',
        resourceId: row.id,
        resourceName: `${row.name} ${row.version}`,
        detail: { reason: '一键熔断', disabledAt: now },
        workspaceId: DEFAULT_WORKSPACE,
      });
      this.notifications.notifySecurity({
        workspaceId: DEFAULT_WORKSPACE,
        recipientId: 'm-human-zhangwei',
        title: `技能「${row.name}」已一键熔断停用`,
        refType: 'hub_skill',
        refId: row.id,
      });
    });

    return { id: row.id, disabledAt: now };
  }

  /** 安全检查清单（技能市场页面用） */
  securityChecklist(skillId: string): {
    signatureOk: boolean;
    reviewStatus: string;
    trustLevel: string;
    permissions: PermissionDecl[];
    sandboxRequired: boolean;
    localFilesMustBeZero: boolean;
    installCount: number;
    reportCount: number;
    successRate?: number;
  } {
    const row = this.hubSkillOrThrow(skillId);
    const repo = this.repoOrThrow(row.repo_id);
    return {
      signatureOk: toBool(row.signature_ok),
      reviewStatus: row.review_status,
      trustLevel: repo.trust_level,
      permissions: parseJsonArrayOf<PermissionDecl>(row.permissions),
      sandboxRequired: true,
      localFilesMustBeZero: true,
      installCount: Number(row.install_count),
      reportCount: Number(row.report_count),
      successRate: row.success_rate === null ? undefined : Number(row.success_rate),
    };
  }
}

export const hubService = new HubService();

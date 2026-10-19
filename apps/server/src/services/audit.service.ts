/**
 * AuditService（业务层）—— 审计查询 / Trace 全链路回放 / 安全事件统计 / 用量与对账
 *
 * 写入能力见 `core/audit.ts`（与业务同事务、失败即阻断）。
 * 本文件负责**读取与聚合**，供治理页面使用。
 */

import {
  AuditResult,
  ErrCode,
  SECURITY_EVENT_LABEL,
  SecurityEventType,
  USAGE_CATEGORY_LABEL,
  type AuditLog,
  type ListAuditQuery,
  type Paginated,
  type SecurityEventStat,
  type UsageRecord,
  type UsageSummary,
} from '@huanbuddy/shared';

import { AuditService as AuditWriter } from '../core/audit';
import { AppError } from '../core/errors';
import { getDb, parseJsonObject, type Db } from '../db/client';

interface AuditRow {
  id: string;
  trace_id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_type: string | null;
  actor_name: string | null;
  initiator_id: string | null;
  initiator_name: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  resource_name: string | null;
  duration_ms: number | null;
  token_used: number | null;
  result: string;
  detail: string;
  workspace_id: string | null;
  created_at: string;
}

interface UsageRow {
  id: string;
  workspace_id: string;
  occurred_at: string;
  category: string;
  model_id: string | null;
  agent_id: string | null;
  api_key_id: string | null;
  task_id: string | null;
  project: string | null;
  token_in: number;
  token_out: number;
  cost: number;
  trace_id: string | null;
}

export interface UsageQuery {
  apiKeyId?: string;
  agentId?: string;
  taskId?: string;
  workspaceId?: string;
}

export interface UsageSummaryQuery {
  from?: string;
  to?: string;
  groupBy?: 'model' | 'caller';
}

/** 审计 detail.reason → 安全事件类型 */
const REASON_TO_EVENT: Record<string, SecurityEventType> = {
  PERMISSION_UNDECLARED: SecurityEventType.SKILL_REJECTED,
  SCOPE_DENIED: SecurityEventType.SCOPE_DENIED,
  TRUST_PENDING: SecurityEventType.TRUST_PENDING,
  SIGNATURE_INVALID: SecurityEventType.SIGNATURE_INVALID,
  DOMAIN_NOT_ALLOWED: SecurityEventType.DOMAIN_NOT_ALLOWED,
  RATE_LIMITED: SecurityEventType.RATE_LIMITED,
  BUDGET_EXCEEDED: SecurityEventType.BUDGET_EXCEEDED,
  DELEGATION_DEPTH_EXCEEDED: SecurityEventType.DELEGATION_DEPTH_EXCEEDED,
};

function isoAgo(days: number, base = new Date()): string {
  return new Date(base.getTime() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function startOfUtcDay(now = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function startOfUtcMonth(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class AuditService {
  private readonly db: Db;
  private readonly writer: AuditWriter;

  constructor(db: Db = getDb()) {
    this.db = db;
    this.writer = new AuditWriter(db);
  }

  /* ═══════ 映射 ═══════ */

  private toAuditLog(row: AuditRow): AuditLog {
    return {
      id: row.id,
      traceId: row.trace_id,
      occurredAt: row.occurred_at,
      actorId: row.actor_id ?? undefined,
      actorType: (row.actor_type as AuditLog['actorType']) ?? undefined,
      actorName: row.actor_name ?? undefined,
      initiatorId: row.initiator_id ?? undefined,
      initiatorName: row.initiator_name ?? undefined,
      action: row.action,
      resourceType: row.resource_type ?? undefined,
      resourceId: row.resource_id ?? undefined,
      resourceName: row.resource_name ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      tokenUsed: row.token_used ?? undefined,
      result: row.result as AuditResult,
      detail: parseJsonObject(row.detail),
      workspaceId: row.workspace_id ?? undefined,
      createdAt: row.created_at,
    };
  }

  private toUsage(row: UsageRow): UsageRecord {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      occurredAt: row.occurred_at,
      category: row.category as UsageRecord['category'],
      modelId: row.model_id ?? undefined,
      agentId: row.agent_id ?? undefined,
      apiKeyId: row.api_key_id ?? undefined,
      taskId: row.task_id ?? undefined,
      project: row.project ?? undefined,
      tokenIn: Number(row.token_in),
      tokenOut: Number(row.token_out),
      cost: Number(row.cost),
      traceId: row.trace_id ?? undefined,
    };
  }

  /* ═══════ 审计查询 ═══════ */

  list(query: ListAuditQuery = {}): Paginated<AuditLog> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.traceId) {
      where.push('trace_id = ?');
      params.push(query.traceId);
    }
    if (query.actorId) {
      where.push('actor_id = ?');
      params.push(query.actorId);
    }
    if (query.action) {
      where.push('action = ?');
      params.push(query.action);
    }
    if (query.resourceType) {
      where.push('resource_type = ?');
      params.push(query.resourceType);
    }
    if (query.from) {
      where.push('occurred_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      where.push('occurred_at <= ?');
      params.push(query.to);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM audit_log ${clause}`, params);
    const total = totalRow ? Number(totalRow.c) : 0;

    const page = Math.max(1, Number(query.page ?? 1));
    const size = Math.min(200, Math.max(1, Number(query.size ?? 50)));
    const offset = (page - 1) * size;

    const rows = this.db.all<AuditRow>(
      `SELECT * FROM audit_log ${clause} ORDER BY occurred_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    return { items: rows.map((row) => this.toAuditLog(row)), total, page, size };
  }

  /** 全链路回放（按 traceId 时间正序） */
  byTrace(traceId: string): AuditLog[] {
    if (!traceId) throw new AppError(ErrCode.BAD_REQUEST, 'traceId 不能为空');
    return this.db
      .all<AuditRow>(
        'SELECT * FROM audit_log WHERE trace_id = ? ORDER BY occurred_at ASC, rowid ASC',
        [traceId],
      )
      .map((row) => this.toAuditLog(row));
  }

  /** 按资源查询该资源的所有审计记录（详情页用） */
  byResource(resourceId: string): AuditLog[] {
    return this.db
      .all<AuditRow>(
        'SELECT * FROM audit_log WHERE resource_id = ? ORDER BY occurred_at DESC',
        [resourceId],
      )
      .map((row) => this.toAuditLog(row));
  }

  /* ═══════ 安全事件统计 ═══════ */

  private eventTypeOf(row: AuditRow): SecurityEventType | undefined {
    const detail = parseJsonObject(row.detail);
    const reason = detail['reason'];
    if (typeof reason === 'string' && REASON_TO_EVENT[reason]) return REASON_TO_EVENT[reason];
    if (Object.prototype.hasOwnProperty.call(SECURITY_EVENT_LABEL, row.action)) {
      return row.action as SecurityEventType;
    }
    return undefined;
  }

  securityEvents(): SecurityEventStat[] {
    const todayStart = startOfUtcDay();
    const monthStart = startOfUtcMonth();

    const rows = this.db.all<AuditRow>(
      `SELECT * FROM audit_log
       WHERE result = 'blocked' OR action IN (${Object.keys(SECURITY_EVENT_LABEL)
         .map(() => '?')
         .join(', ')})
       ORDER BY occurred_at DESC`,
      Object.keys(SECURITY_EVENT_LABEL),
    );

    const counters = new Map<SecurityEventType, { today: number; month: number }>();
    for (const key of Object.keys(SECURITY_EVENT_LABEL) as SecurityEventType[]) {
      counters.set(key, { today: 0, month: 0 });
    }

    for (const row of rows) {
      const type = this.eventTypeOf(row);
      if (!type) continue;
      const bucket = counters.get(type) ?? { today: 0, month: 0 };
      if (row.occurred_at >= monthStart) bucket.month += 1;
      if (row.occurred_at >= todayStart) bucket.today += 1;
      counters.set(type, bucket);
    }

    return Array.from(counters.entries()).map(([type, stat]) => ({
      type,
      today: stat.today,
      month: stat.month,
    }));
  }

  /** 异常清单：blocked / failed 的审计记录 */
  anomalies(limit = 50): AuditLog[] {
    return this.db
      .all<AuditRow>(
        "SELECT * FROM audit_log WHERE result <> 'success' ORDER BY occurred_at DESC LIMIT ?",
        [limit],
      )
      .map((row) => this.toAuditLog(row));
  }

  /** 可用动作清单（前端筛选下拉） */
  actions(): string[] {
    return this.db
      .all<{ action: string }>('SELECT DISTINCT action FROM audit_log ORDER BY action ASC')
      .map((r) => r.action);
  }

  /* ═══════ 用量与对账 ═══════ */

  usage(query: UsageQuery = {}): UsageRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.apiKeyId) {
      where.push('api_key_id = ?');
      params.push(query.apiKeyId);
    }
    if (query.agentId) {
      where.push('agent_id = ?');
      params.push(query.agentId);
    }
    if (query.taskId) {
      where.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query.workspaceId) {
      where.push('workspace_id = ?');
      params.push(query.workspaceId);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .all<UsageRow>(`SELECT * FROM usage_record ${clause} ORDER BY occurred_at DESC LIMIT 500`, params)
      .map((row) => this.toUsage(row));
  }

  /**
   * 用量汇总：可按模型 / 调用方归因，并给出**对账差异百分比**。
   * 对账口径：usage_record 中 model 类目合计 vs agent_config.quota_used 合计。
   */
  usageSummary(query: UsageSummaryQuery = {}): UsageSummary {
    const from = query.from ?? isoAgo(30);
    const to = query.to ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    const byModelRows = this.db.all<Record<string, unknown>>(
      `SELECT u.model_id AS model_id, COALESCE(m.name, u.model_id, '未归因') AS name,
              COALESCE(SUM(u.token_in + u.token_out), 0) AS tokens,
              COALESCE(SUM(u.cost), 0) AS cost
       FROM usage_record u
       LEFT JOIN model_config m ON m.id = u.model_id
       WHERE u.occurred_at >= ? AND u.occurred_at <= ? AND u.model_id IS NOT NULL
       GROUP BY u.model_id, m.name
       ORDER BY cost DESC`,
      [from, to],
    );

    const byCallerRows = this.db.all<Record<string, unknown>>(
      `SELECT u.api_key_id AS api_key_id, u.agent_id AS agent_id,
              COALESCE(k.name, '内部调用') AS key_name,
              COALESCE(a.name, '内部调用') AS agent_name,
              COALESCE(SUM(u.token_in + u.token_out), 0) AS tokens,
              COALESCE(SUM(u.cost), 0) AS cost
       FROM usage_record u
       LEFT JOIN api_key k ON k.id = u.api_key_id
       LEFT JOIN member a ON a.id = u.agent_id
       WHERE u.occurred_at >= ? AND u.occurred_at <= ?
       GROUP BY u.api_key_id, u.agent_id, k.name, a.name
       ORDER BY cost DESC`,
      [from, to],
    );

    const byModel = byModelRows.map((row) => ({
      modelId: String(row.model_id),
      name: String(row.name),
      tokens: Number(row.tokens),
      cost: Math.round(Number(row.cost) * 10000) / 10000,
    }));

    const byCaller = byCallerRows.map((row) => {
      const keyName = String(row.key_name ?? '');
      const agentName = String(row.agent_name ?? '');
      const isKey = row.api_key_id !== null && row.api_key_id !== undefined;
      return {
        apiKeyId: isKey ? String(row.api_key_id) : undefined,
        name: isKey ? keyName : agentName,
        tokens: Number(row.tokens),
        cost: Math.round(Number(row.cost) * 10000) / 10000,
        attribution: isKey ? `API Key 调用（${keyName}）` : `AI 成员内调用（${agentName}）`,
      };
    });

    const totalCost = Math.round(byCaller.reduce((sum, r) => sum + r.cost, 0) * 10000) / 10000;

    const agentTotalRow = this.db.get<{ c: number }>(
      'SELECT COALESCE(SUM(quota_used), 0) AS c FROM agent_config',
    );
    const agentTotal = agentTotalRow ? Number(agentTotalRow.c) : 0;
    const baseline = Math.max(totalCost, 1);
    const reconcileDiffPct = Math.round((Math.abs(totalCost - agentTotal) / baseline) * 1000) / 10;

    return { byModel, byCaller, totalCost, reconcileDiffPct };
  }

  /** 用量分类汇总（饼图/条形用） */
  usageByCategory(from?: string, to?: string): { category: string; label: string; cost: number }[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT category, COALESCE(SUM(cost), 0) AS cost
       FROM usage_record WHERE occurred_at >= ? AND occurred_at <= ?
       GROUP BY category ORDER BY cost DESC`,
      [
        from ?? isoAgo(30),
        to ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ],
    );
    return rows.map((row) => {
      const category = String(row.category);
      return {
        category,
        label: USAGE_CATEGORY_LABEL[category as keyof typeof USAGE_CATEGORY_LABEL] ?? category,
        cost: Math.round(Number(row.cost) * 10000) / 10000,
      };
    });
  }

  /** 写入通道（供路由层在需要时直接落审计） */
  write(entry: Parameters<AuditWriter['write']>[0]): string {
    return this.writer.write(entry);
  }
}

export const auditService = new AuditService();

/**
 * Metrics —— 埋点写入（PRD §9.2 事件）+ 用量记录落库
 *
 * 设计取舍：埋点事件为**运行时高写入、低价值持久化**数据，使用进程内环形缓冲
 * （不落表），避免污染 §3.1 的 28 张业务表；用量记录（可归因、需对账）落 `usage_record` 表。
 */

import { UsageCategory, type UsageCategory as UsageCategoryType } from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { getDb, type Db } from '../db/client';
import { trace } from './trace';

export interface MetricRecord {
  id: string;
  name: string;
  traceId: string;
  actorId?: string;
  props: Record<string, unknown>;
  occurredAt: string;
}

export interface UsageEntry {
  workspaceId: string;
  category: UsageCategoryType;
  modelId?: string | null;
  agentId?: string | null;
  apiKeyId?: string | null;
  taskId?: string | null;
  project?: string | null;
  tokenIn?: number;
  tokenOut?: number;
  cost?: number;
  traceId?: string;
  occurredAt?: string;
}

const MAX_BUFFER = 1000;

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class Metrics {
  private readonly buffer: MetricRecord[] = [];
  private readonly db: Db | null;

  constructor(db: Db | null = null) {
    this.db = db;
  }

  /** 记录埋点事件 */
  emit(name: string, props: Record<string, unknown> = {}, actorId?: string): MetricRecord {
    const record: MetricRecord = {
      id: `met-${nanoid(10)}`,
      name,
      traceId: trace.current(),
      actorId,
      props,
      occurredAt: isoNow(),
    };
    this.buffer.push(record);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    return record;
  }

  /** 最近事件（可过滤 name） */
  recent(limit = 100, name?: string): MetricRecord[] {
    const source = name ? this.buffer.filter((r) => r.name === name) : this.buffer;
    return source.slice(-limit).reverse();
  }

  /** 按事件名统计次数 */
  countByName(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const record of this.buffer) {
      out[record.name] = (out[record.name] ?? 0) + 1;
    }
    return out;
  }

  clear(): void {
    this.buffer.length = 0;
  }

  /* ═══════ 用量记录落库（class diagram: Metrics --> UsageRecord） ═══════ */

  /** 写入一条可归因的用量记录 */
  recordUsage(entry: UsageEntry, db: Db = this.db ?? getDb()): string {
    const id = `usg-${nanoid(10)}`;
    db.run(
      `INSERT INTO usage_record (
         id, workspace_id, occurred_at, category, model_id, agent_id, api_key_id,
         task_id, project, token_in, token_out, cost, trace_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.workspaceId,
        entry.occurredAt ?? isoNow(),
        entry.category,
        entry.modelId ?? null,
        entry.agentId ?? null,
        entry.apiKeyId ?? null,
        entry.taskId ?? null,
        entry.project ?? null,
        entry.tokenIn ?? 0,
        entry.tokenOut ?? 0,
        entry.cost ?? 0,
        entry.traceId ?? trace.current(),
      ],
    );
    return id;
  }
}

/** 全局单例 */
export const metrics = new Metrics();

export { UsageCategory };

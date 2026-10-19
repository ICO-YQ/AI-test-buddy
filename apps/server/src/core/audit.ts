/**
 * AuditService —— 双主体（执行主体 + 发起人）+ TraceID 审计写入
 *
 * 铁律（EX-19）：审计写入失败必须**阻断**敏感操作。
 *  - `write()` 捕获底层异常后抛 `AppError(1018 AUDIT_UNAVAILABLE)`；
 *  - 调用方必须把「业务写 + audit.write()」放在**同一个 `db.tx()`** 内，
 *    这样审计失败会连带回滚业务写入（见 services/*.service.ts）。
 */

import { AuditResult, ErrCode, SYSTEM_ACTOR_ID, type MemberType } from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { getDb, type Db } from '../db/client';
import { AppError } from './errors';
import { DEFAULT_ACTOR_HEADER } from './response';
import { trace } from './trace';

export interface AuditEntry {
  /** 动作标识，如 task_created / skill_executed / model_called */
  action: string;
  traceId?: string;
  occurredAt?: string;
  actorId?: string | null;
  actorType?: MemberType | null;
  actorName?: string | null;
  /** 发起人（双主体留痕） */
  initiatorId?: string | null;
  initiatorName?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  resourceName?: string | null;
  durationMs?: number | null;
  tokenUsed?: number | null;
  result?: AuditResult;
  /** JSON 入参出参（脱敏） */
  detail?: Record<string, unknown>;
  workspaceId?: string | null;
}

export interface AuditLogRow {
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

/** 需要脱敏的 detail 字段名 */
const REDACT_KEYS = ['apiKey', 'api_key', 'plaintext', 'keyHash', 'key_hash', 'password', 'token', 'secret'];

function redact(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (REDACT_KEYS.includes(k)) {
      out[k] = '***redacted***';
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class AuditService {
  private readonly db: Db;

  constructor(db: Db = getDb()) {
    this.db = db;
  }

  /** 从 member 表补齐 actor/initiator 姓名 */
  private resolveName(memberId?: string | null): string | null {
    if (!memberId) return null;
    try {
      const row = this.db.get<{ name: string }>('SELECT name FROM member WHERE id = ?', [memberId]);
      return row?.name ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 查主体在 `member` 表中的记录（同时承担存在性校验）。
   *
   * 一次查询同时满足三件事，避免每个审计写入各查一遍：
   *   1. **存在性校验** —— 拒绝指向不存在主体的悬空审计行。
   *      `x-actor-id` 是纯客户端控制的头（演示模式无鉴权），只校验「非空」的话，
   *      任何调用方都能塞一个不存在的 id，写出 `actor_id` 有值但 `actor_name`/
   *      `actor_type` 为 null 的坏行 —— 它在审计页看起来像「操作者未知」，实为伪造。
   *      （注意：冒用**已存在**的成员是接受的，身份切换器就靠这个工作；但指向不存在
   *      的主体必须拒绝，那是数据完整性问题。）
   *   2. **actorName 推导** —— 由 id 取真实姓名。
   *   3. **actorType 推导** —— 由 id 取 `human` / `ai`。
   *      这一点是根治性的：过去调用方各自硬编码 `actorType: 'ai'`，导致
   *      「actor_id 是人类成员、actor_type 却是 ai」这类自相矛盾的行。
   *      actorType 本就是 actorId 的属性，不该由调用方猜测。
   *
   * @returns 系统主体返回 null；其余返回 record；不存在则抛 400
   */
  private lookupActor(actorId: string): { name: string; type: MemberType } | null {
    if (actorId === SYSTEM_ACTOR_ID) return null;
    const row = this.db.get<{ name: string; type: string }>(
      'SELECT name, type FROM member WHERE id = ?',
      [actorId],
    );
    if (!row) {
      throw new AppError(ErrCode.BAD_REQUEST, `未知操作者：${actorId}`, {
        actorId,
        hint:
          '操作者必须存在于 member 表。演示环境可用身份：' +
          'm-human-zhangwei / m-human-liuyang / m-human-chenjing / m-ai-analyst / m-ai-writer / m-ai-inspector；' +
          `系统自动动作请传 SYSTEM_ACTOR_ID='${SYSTEM_ACTOR_ID}'`,
      });
    }
    return { name: row.name, type: row.type as MemberType };
  }

  /**
   * 写入审计记录。
   * @returns 审计记录 id
   * @throws AppError(1018) 当 actorId 缺失或写入失败时（调用方的外层事务会因此回滚）
   */
  write(entry: AuditEntry): string {
    // ── 根因防御：actorId 必填 ──
    // 取值顺序：调用方显式传入 → 请求上下文（x-actor-id，由 onRequest 登记）→ 抛错。
    //
    // `null` 只能表示「数据缺失」，不能用来表示「没有发起人」。系统自动行为必须
    // 显式传 SYSTEM_ACTOR_ID。缺少这道校验时，「写审计忘了传 actor」会静默成功，
    // 且单元测试通常只断言审计行存在、不断言字段完整，因此无法被发现
    // （历史上 hub_skill_*/api_key_revoked 等 21 类动作就是这么漏掉的）。
    const actorId = entry.actorId ?? trace.currentActor();
    if (!actorId || String(actorId).trim() === '') {
      throw new AppError(
        ErrCode.AUDIT_UNAVAILABLE,
        `审计写入缺少 actorId（action=${entry.action}）`,
        {
          action: entry.action,
          hint:
            `用户动作应由请求头 ${DEFAULT_ACTOR_HEADER} 提供（onRequest 已自动登记）；` +
            `系统自动动作请显式传 SYSTEM_ACTOR_ID='${SYSTEM_ACTOR_ID}'`,
        },
      );
    }

    const id = `aud-${nanoid(12)}`;
    // 存在性校验 + actorName / actorType 推导（一次查询）
    const actor = this.lookupActor(actorId);
    const traceId = entry.traceId ?? trace.current();
    const occurredAt = entry.occurredAt ?? isoNow();
    // actorName / actorType 一律以 member 表为准：调用方显式传的值可能与之矛盾
    // （如 actor_id 是人类却传 actorType:'ai'），这里以真实记录覆盖。
    const actorName = actor?.name ?? entry.actorName ?? this.resolveName(entry.actorId);
    const actorType = actor ? actor.type : (entry.actorType ?? null);

    // ── initiator 兜底（与 actorId 同等重要）──
    // 绝大多数动作是「人自己操作」：发起人 = 执行主体，调用方不必重复写两遍。
    // 只有「AI 代替人执行」才需要区分（actor=AI、initiator=发起那个人的成员 id），
    // 这类路径（skill/task 的 AI 执行链）都会显式传两个值，不会走到这里的兜底。
    // 系统自动动作确实没有人类发起人 → 保持 null（配合 SYSTEM_ACTOR_ID 语义）。
    //
    // 历史缺陷：早先只兜底了 actorId，导致 initiatorId 未显式提供时为 null ——
    // 26 处审计（kb_space_created / skill_version_created / task_deleted 等）因此
    // 长期只有「执行主体」没有「发起人」，而这正是双主体留痕的核心。
    const initiatorId = entry.initiatorId ?? (actorId === SYSTEM_ACTOR_ID ? null : actorId);
    const initiatorName =
      entry.initiatorName ??
      (initiatorId === actorId ? actorName : this.resolveName(initiatorId));

    const detail = redact(entry.detail ?? {});

    try {
      this.db.run(
        `INSERT INTO audit_log (
           id, trace_id, occurred_at, actor_id, actor_type, actor_name,
           initiator_id, initiator_name, action, resource_type, resource_id, resource_name,
           duration_ms, token_used, result, detail, workspace_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          traceId,
          occurredAt,
          actorId,
          actorType,
          actorName,
          initiatorId,
          initiatorName,
          entry.action,
          entry.resourceType ?? null,
          entry.resourceId ?? null,
          entry.resourceName ?? null,
          entry.durationMs ?? null,
          entry.tokenUsed ?? null,
          entry.result ?? AuditResult.SUCCESS,
          JSON.stringify(detail),
          entry.workspaceId ?? null,
          occurredAt,
        ],
      );
    } catch (cause) {
      // EX-19：审计不可用 → 阻断业务
      throw new AppError(ErrCode.AUDIT_UNAVAILABLE, '审计写入失败，操作已阻断', {
        action: entry.action,
        cause: (cause as Error).message,
      });
    }

    return id;
  }

  /** 在业务事务中执行「业务写 + 审计写」，任一步骤失败整体回滚 */
  inTransaction<T>(fn: (audit: AuditService) => T): T {
    return this.db.tx(() => fn(this));
  }

  /** 显式阻断语义：记录一条 blocked 审计并抛出原始错误 */
  failBlocks(entry: AuditEntry, error: AppError): never {
    this.write({ ...entry, result: AuditResult.BLOCKED });
    throw error;
  }

  /* ═══════ 查询能力（供 audit.service.ts 复用） ═══════ */

  /** 按 TraceID 全链路回放 */
  byTrace(traceId: string): AuditLogRow[] {
    return this.db.all<AuditLogRow>(
      'SELECT * FROM audit_log WHERE trace_id = ? ORDER BY occurred_at ASC, rowid ASC',
      [traceId],
    );
  }
}

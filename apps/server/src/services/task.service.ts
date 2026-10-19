/**
 * TaskService —— 任务 CRUD / 流转 / 指派 / 验收 / 活动 / 度量（FR-TK-01~10）
 *
 * 服务端强制约束：
 *  - 状态流转必须命中 `TRANSITIONS`（shared/constants），否则 409 STATE_ILLEGAL（**不可回退**）
 *  - 指派/流转携带 `lockVersion`，不匹配 → 409 CONFLICT_LOCK
 *  - `done` 状态禁止 PATCH → 409 TASK_IMMUTABLE
 *  - 验收驳回必须带 `rejectReasonCode` → 422 REJECT_REASON_REQUIRED
 *  - 每次流转/验收与审计**同事务**，审计失败整体回滚（503 AUDIT_UNAVAILABLE）
 *  - 指派给 AI 成员时按 effectiveScope 校验（越界 403 SCOPE_DENIED）
 */

import {
  ActivityType,
  ArtifactType,
  ErrCode,
  IMMUTABLE_STATUSES,
  MemberType,
  MetricEvent,
  PAGINATION,
  RejectReason,
  TASK_STATUS_LABEL,
  TaskStatus,
  type Artifact,
  type CreateArtifactReq,
  type CreateTaskReq,
  type ListTasksQuery,
  type MemberRole,
  type Paginated,
  type Priority,
  type Task,
  type TaskActivity,
  type TaskMetrics,
  type UpdateTaskReq,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { mockExecutor, type MockExecutor } from '../ai/mock-executor';
import type { AgentExecutionInput, ExecutableSkill } from '../ai/executor';
import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics as metricsSink } from '../core/metrics';
import { PermissionService } from '../core/permission';
import { StateMachine } from '../core/state-machine';
import { newTraceId, trace } from '../core/trace';
import { getDb, isoNow, parseJsonArray, parseJsonObject, type Db } from '../db/client';
import { NotificationService } from './notification.service';
import {
  loadCurrentVersion,
  mapSkillRow,
  type SkillRow,
  type SkillVersionRow,
  mapVersionRow,
} from './skill.service';

const DEFAULT_WORKSPACE = 'ws-huan-0001';
/** 演示默认身份（§8 #1：不做真实登录，前端顶栏身份切换器） */
export const DEFAULT_ACTOR_ID = 'm-human-zhangwei';

interface TaskRow {
  id: string;
  code: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  tags: string;
  creator_id: string;
  assignee_id: string | null;
  assignee_type: string | null;
  sla_due_at: string | null;
  sla_policy: string | null;
  accept_criteria: string | null;
  reject_reason_code: string | null;
  trace_id: string | null;
  cost: number;
  token_used: number;
  lock_version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ActivityRow {
  id: string;
  task_id: string;
  type: string;
  actor_id: string;
  actor_type: string;
  initiator_id: string | null;
  content: string | null;
  payload: string;
  reason_code: string | null;
  trace_id: string | null;
  duration_ms: number | null;
  token_used: number | null;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  code: string;
  task_id: string | null;
  type: string;
  title: string;
  uri: string | null;
  content: string | null;
  size_bytes: number;
  submitted_by: string | null;
  trace_id: string | null;
  version: number;
  created_at: string;
}

export interface AssignInput {
  assigneeId: string;
  lockVersion: number;
}

export interface TransitionInput {
  to: TaskStatus;
  reasonCode?: RejectReason;
  comment?: string;
  lockVersion: number;
}

export interface AcceptInput {
  decision: 'accept' | 'reject';
  rejectReasonCode?: RejectReason;
  comment?: string;
}

export class TaskService {
  private readonly db: Db;
  private readonly audit: AuditService;
  private readonly permissions: PermissionService;
  private readonly notifications: NotificationService;
  private readonly stateMachine: StateMachine;
  private readonly executor: MockExecutor;

  constructor(db: Db = getDb()) {
    this.db = db;
    this.audit = new AuditService(db);
    this.permissions = new PermissionService(db);
    this.notifications = new NotificationService(db);
    this.stateMachine = new StateMachine();
    this.executor = mockExecutor;
  }

  /* ═══════════ 映射 ═══════════ */

  private toTask(row: TaskRow): Task {
    return {
      id: row.id,
      code: row.code,
      workspaceId: row.workspace_id,
      title: row.title,
      description: row.description ?? undefined,
      status: row.status as TaskStatus,
      priority: row.priority as Priority,
      tags: parseJsonArray(row.tags),
      creatorId: row.creator_id,
      assigneeId: row.assignee_id ?? undefined,
      assigneeType: (row.assignee_type as MemberType | null) ?? undefined,
      slaDueAt: row.sla_due_at ?? undefined,
      slaPolicy: (row.sla_policy as Task['slaPolicy']) ?? undefined,
      acceptCriteria: row.accept_criteria ?? undefined,
      rejectReasonCode: (row.reject_reason_code as RejectReason | null) ?? undefined,
      traceId: row.trace_id ?? undefined,
      cost: Number(row.cost),
      tokenUsed: Number(row.token_used),
      lockVersion: Number(row.lock_version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private toActivity(row: ActivityRow): TaskActivity {
    return {
      id: row.id,
      taskId: row.task_id,
      type: row.type,
      actorId: row.actor_id,
      actorType: row.actor_type as MemberType,
      initiatorId: row.initiator_id ?? undefined,
      content: row.content ?? undefined,
      payload: parseJsonObject(row.payload),
      reasonCode: (row.reason_code as RejectReason | null) ?? undefined,
      traceId: row.trace_id ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      tokenUsed: row.token_used ?? undefined,
      createdAt: row.created_at,
    };
  }

  private toArtifact(row: ArtifactRow, withContent = true): Artifact {
    return {
      id: row.id,
      code: row.code,
      taskId: row.task_id ?? undefined,
      type: row.type as Artifact['type'],
      title: row.title,
      uri: row.uri ?? undefined,
      content: withContent ? (row.content ?? undefined) : undefined,
      sizeBytes: Number(row.size_bytes),
      submittedBy: row.submitted_by ?? undefined,
      traceId: row.trace_id ?? undefined,
      version: Number(row.version),
      createdAt: row.created_at,
    };
  }

  private rawOrThrow(id: string): TaskRow {
    const row = this.db.get<TaskRow>('SELECT * FROM task WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `任务不存在：${id}`);
    return row;
  }

  /* ═══════════ 查询 ═══════════ */

  list(query: ListTasksQuery = {}): Paginated<Task> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query.status) {
      where.push('status = ?');
      params.push(query.status);
    }
    if (query.assigneeId) {
      where.push('assignee_id = ?');
      params.push(query.assigneeId);
    }
    if (query.tag) {
      where.push("EXISTS (SELECT 1 FROM json_each(task.tags) WHERE json_each.value = ?)");
      params.push(query.tag);
    }
    if (query.q) {
      where.push('(title LIKE ? OR description LIKE ? OR code LIKE ?)');
      const like = `%${query.q}%`;
      params.push(like, like, like);
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const totalRow = this.db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM task ${clause}`, params);
    const total = totalRow ? Number(totalRow.c) : 0;

    const page = Math.max(1, Number(query.page ?? PAGINATION.defaultPage));
    const size = Math.min(PAGINATION.maxSize, Math.max(1, Number(query.size ?? PAGINATION.defaultSize)));
    const offset = (page - 1) * size;

    const rows = this.db.all<TaskRow>(
      `SELECT * FROM task ${clause}
       ORDER BY
         CASE priority WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 ELSE 2 END ASC,
         updated_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
      [...params, size, offset],
    );

    return {
      items: rows.map((row) => this.toTask(row)),
      total,
      page,
      size,
    };
  }

  get(id: string): Task & { activities: TaskActivity[]; artifacts: Artifact[] } {
    const task = this.toTask(this.rawOrThrow(id));
    return {
      ...task,
      activities: this.activities(id),
      artifacts: this.artifacts(id),
    };
  }

  listAll(limit = 500): Task[] {
    return this.db
      .all<TaskRow>('SELECT * FROM task ORDER BY updated_at DESC LIMIT ?', [limit])
      .map((row) => this.toTask(row));
  }

  /* ═══════════ 创建 ═══════════ */

  create(req: CreateTaskReq, actorId: string = DEFAULT_ACTOR_ID): Task {
    if (!req.title || req.title.trim() === '') {
      throw new AppError(ErrCode.BAD_REQUEST, '任务标题不能为空', { field: 'title' });
    }
    const creator = this.db.get<{ id: string; workspace_id: string }>(
      'SELECT id, workspace_id FROM member WHERE id = ?',
      [actorId],
    );
    if (!creator) throw new AppError(ErrCode.NOT_FOUND, `发起人不存在：${actorId}`);

    const id = `tsk-${nanoid(10)}`;
    const code = this.nextTaskCode();
    const now = isoNow();
    const traceId = newTraceId();

    // 指派合法性前置校验（越界 403）
    if (req.assigneeId) {
      this.assertAssignable(actorId, req.assigneeId, req.tags ?? []);
    }

    const assignee = req.assigneeId
      ? this.db.get<{ id: string; type: string; name: string }>(
          'SELECT id, type, name FROM member WHERE id = ?',
          [req.assigneeId],
        )
      : undefined;

    const status: TaskStatus = assignee ? TaskStatus.TODO : TaskStatus.BACKLOG;

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO task (
           id, code, workspace_id, title, description, status, priority, tags, creator_id,
           assignee_id, assignee_type, sla_due_at, sla_policy, accept_criteria,
           reject_reason_code, trace_id, cost, token_used, lock_version, created_at, updated_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, 0, 0, ?, ?, NULL)`,
        [
          id,
          code,
          creator.workspace_id,
          req.title.trim(),
          req.description ?? null,
          status,
          req.priority ?? 'p3',
          JSON.stringify(req.tags ?? []),
          actorId,
          assignee?.id ?? null,
          assignee?.type ?? null,
          req.slaDueAt ?? null,
          req.slaPolicy ?? 'notify',
          req.acceptCriteria ?? null,
          traceId,
          now,
          now,
        ],
      );

      // 事务内写审计（失败即阻断并回滚）
      this.audit.write({
        action: 'task_created',
        traceId,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: `${code} ${req.title}`,
        detail: {
          title: req.title,
          priority: req.priority ?? 'p3',
          assigneeId: req.assigneeId ?? null,
          tags: req.tags ?? [],
        },
        workspaceId: creator.workspace_id,
      });

      this.addActivityInternal({
        taskId: id,
        type: ActivityType.STATUS_CHANGE,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        content: '创建任务',
        payload: { from: null, to: status, assigneeId: assignee?.id ?? null },
        traceId,
      });

      if (assignee) {
        this.audit.write({
          action: 'task_assigned',
          traceId,
          actorId,
          actorType: MemberType.HUMAN,
          initiatorId: actorId,
          resourceType: 'task',
          resourceId: id,
          resourceName: code,
          detail: { assigneeId: assignee.id, assigneeType: assignee.type },
          workspaceId: creator.workspace_id,
        });
      }
    });

    metricsSink.emit(MetricEvent.TASK_CREATED, { taskId: id, code, assigneeId: req.assigneeId ?? null }, actorId);

    // 指派给 AI：立即触发一次执行（todo → in_progress → in_review）
    if (assignee && assignee.type === MemberType.AI) {
      this.runAgent(id, assignee.id, actorId, traceId);
    }

    return this.toTask(this.rawOrThrow(id));
  }

  /** 生成 TSK-xxxx（自增 4 位，从 8400 起以贴合原型） */
  private nextTaskCode(): string {
    const row = this.db.get<{ max_code: string | null }>(
      "SELECT MAX(CAST(substr(code, 5) AS INTEGER)) AS max_code FROM task WHERE code LIKE 'TSK-%'",
    );
    const current = row?.max_code ? Number(row.max_code) : 8400;
    const next = Number.isFinite(current) && current >= 8400 ? current + 1 : 8401;
    return `TSK-${next}`;
  }

  private nextArtifactCode(): string {
    const row = this.db.get<{ max_code: string | null }>(
      "SELECT MAX(CAST(substr(code, 5) AS INTEGER)) AS max_code FROM artifact WHERE code LIKE 'ART-%'",
    );
    const current = row?.max_code ? Number(row.max_code) : 1190;
    const next = Number.isFinite(current) && current >= 1190 ? current + 1 : 1191;
    return `ART-${next}`;
  }

  /* ═══════════ 更新 / 删除 ═══════════ */

  update(id: string, req: UpdateTaskReq, actorId: string = DEFAULT_ACTOR_ID): Task {
    const row = this.rawOrThrow(id);

    // 已验收不可修改
    if (IMMUTABLE_STATUSES.includes(row.status as TaskStatus)) {
      throw new AppError(ErrCode.TASK_IMMUTABLE, '已验收任务不可修改', {
        taskId: id,
        status: row.status,
      });
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const detail: Record<string, unknown> = {};

    if (req.title !== undefined) {
      fields.push('title = ?');
      params.push(req.title);
      detail.title = req.title;
    }
    if (req.description !== undefined) {
      fields.push('description = ?');
      params.push(req.description);
      detail.description = req.description;
    }
    if (req.priority !== undefined) {
      fields.push('priority = ?');
      params.push(req.priority);
      detail.priority = req.priority;
    }
    if (req.tags !== undefined) {
      fields.push('tags = ?');
      params.push(JSON.stringify(req.tags));
      detail.tags = req.tags;
    }
    if (req.acceptCriteria !== undefined) {
      fields.push('accept_criteria = ?');
      params.push(req.acceptCriteria);
      detail.acceptCriteria = req.acceptCriteria;
    }
    if (req.slaDueAt !== undefined) {
      fields.push('sla_due_at = ?');
      params.push(req.slaDueAt);
      detail.slaDueAt = req.slaDueAt;
    }

    if (fields.length === 0) return this.toTask(row);

    const now = isoNow();
    fields.push('updated_at = ?');
    params.push(now);

    this.db.tx(() => {
      this.db.run(`UPDATE task SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      this.audit.write({
        action: 'task_updated',
        traceId: row.trace_id ?? trace.current(),
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: row.code,
        detail,
        workspaceId: row.workspace_id,
      });
    });

    return this.toTask(this.rawOrThrow(id));
  }

  remove(id: string, actorId: string = DEFAULT_ACTOR_ID): { id: string } {
    const row = this.rawOrThrow(id);

    // 终态任务不可删除 —— 与「已验收任务不可修改」保持同一原则。
    // 若允许删除 done 任务，等于给「已验收结果」开了一个不可追溯的出口：
    // 审计里只留一条 task_deleted，而验收记录、交付物、活动轨迹全部随之消失。
    // 需要清理请走归档（语义是「移出视图」而非「抹除证据」）。
    if (IMMUTABLE_STATUSES.includes(row.status as TaskStatus)) {
      throw new AppError(
        ErrCode.STATE_ILLEGAL,
        '已验收的任务不可删除（如需清理请使用归档）',
        {
          taskId: id,
          status: row.status,
          immutableStatuses: IMMUTABLE_STATUSES,
        },
      );
    }

    this.db.tx(() => {
      // 先解除无级联的外键引用（usage_record / skill_execution），避免删除失败
      this.db.run('UPDATE usage_record SET task_id = NULL WHERE task_id = ?', [id]);
      this.db.run('UPDATE skill_execution SET task_id = NULL WHERE task_id = ?', [id]);
      this.db.run('UPDATE artifact SET task_id = NULL WHERE task_id = ?', [id]);
      this.db.run('DELETE FROM task_activity WHERE task_id = ?', [id]);
      this.db.run('DELETE FROM task WHERE id = ?', [id]);
      this.audit.write({
        action: 'task_deleted',
        // 用传入的 actorId，不再硬编码 —— 否则「谁删了任务」永远记成同一个人
        actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: row.code,
        detail: { title: row.title, status: row.status },
        workspaceId: row.workspace_id,
      });
    });
    return { id };
  }

  /* ═══════════ 指派 ═══════════ */

  assign(id: string, input: AssignInput, actorId: string = DEFAULT_ACTOR_ID): Task {
    const row = this.rawOrThrow(id);
    this.assertLock(row, input.lockVersion);

    if (this.stateMachine.isTerminal(row.status as TaskStatus)) {
      throw new AppError(ErrCode.STATE_ILLEGAL, `任务处于终态（${TASK_STATUS_LABEL[row.status as TaskStatus]}），不可再指派`, {
        taskId: id,
        status: row.status,
      });
    }

    const assignee = this.db.get<{ id: string; type: string; name: string; status: string }>(
      'SELECT id, type, name, status FROM member WHERE id = ?',
      [input.assigneeId],
    );
    if (!assignee) throw new AppError(ErrCode.NOT_FOUND, `被指派成员不存在：${input.assigneeId}`);
    if (assignee.status !== 'active') {
      throw new AppError(ErrCode.BAD_REQUEST, `被指派成员已停用：${assignee.name}`, {
        assigneeId: assignee.id,
      });
    }

    // 数据域校验（越界 403）
    this.assertAssignable(row.creator_id, assignee.id, parseJsonArray(row.tags));

    const now = isoNow();
    const traceId = row.trace_id ?? newTraceId();

    this.db.tx(() => {
      this.db.run(
        'UPDATE task SET assignee_id = ?, assignee_type = ?, lock_version = lock_version + 1, updated_at = ? WHERE id = ?',
        [assignee.id, assignee.type, now, id],
      );

      this.audit.write({
        action: 'task_assigned',
        traceId,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: row.code,
        detail: { assigneeId: assignee.id, assigneeType: assignee.type },
        workspaceId: row.workspace_id,
      });

      this.addActivityInternal({
        taskId: id,
        type: ActivityType.STATUS_CHANGE,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        content: `指派给 ${assignee.name}`,
        payload: { assigneeId: assignee.id, assigneeType: assignee.type },
        traceId,
      });
    });

    metricsSink.emit(MetricEvent.TASK_ASSIGNED, { taskId: id, assigneeId: assignee.id }, actorId);

    // 指派给 AI → 自动认领并执行
    if (assignee.type === MemberType.AI) {
      this.runAgent(id, assignee.id, row.creator_id, traceId);
    } else if (row.status === TaskStatus.BACKLOG) {
      this.transition(id, { to: TaskStatus.TODO, lockVersion: this.rawOrThrow(id).lock_version }, actorId);
    }

    return this.toTask(this.rawOrThrow(id));
  }

  /** 优化锁校验 */
  private assertLock(row: TaskRow, lockVersion: number): void {
    if (typeof lockVersion !== 'number' || Number.isNaN(lockVersion)) {
      throw new AppError(ErrCode.BAD_REQUEST, '缺少 lockVersion（并发分配乐观锁）', {
        field: 'lockVersion',
      });
    }
    if (Number(row.lock_version) !== Number(lockVersion)) {
      throw new AppError(ErrCode.CONFLICT_LOCK, '任务已被他人/Agent 认领', {
        expected: Number(row.lock_version),
        received: Number(lockVersion),
      });
    }
  }

  /**
   * 指派合法性：双主体数据域校验。
   *  - 任务显式声明 `proj:*` 标签时，被指派人必须完整覆盖这些项目；
   *  - 且被指派人有效数据域必须与「发起人」的有效数据域有交集（AI 不得跨到创建者无权域）。
   */
  private assertAssignable(creatorId: string, assigneeId: string, tags: string[]): void {
    const required = tags.filter((t) => t.startsWith('proj:')).map((t) => t.slice(5));
    if (required.length > 0) {
      this.permissions.assertScope(assigneeId, required);
    }
    const creatorScope = this.permissions.effectiveScopeOf(creatorId);
    const assigneeScope = this.permissions.effectiveScopeOf(assigneeId);
    const overlapped = PermissionService.intersect(creatorScope, assigneeScope);
    if (overlapped.length === 0) {
      throw new AppError(ErrCode.SCOPE_DENIED, '被指派人可访问的数据域与发起人无交集，已阻断', {
        creatorId,
        creatorScope,
        assigneeId,
        assigneeScope,
      });
    }
  }

  /* ═══════════ 状态流转 ═══════════ */

  transition(id: string, input: TransitionInput, actorId: string = DEFAULT_ACTOR_ID): Task {
    const row = this.rawOrThrow(id);
    this.assertLock(row, input.lockVersion);

    const from = row.status as TaskStatus;
    const to = input.to;

    // 中央状态转移表校验（不可回退）
    this.stateMachine.assert(from, to);

    const isReject = this.stateMachine.isReject(from, to);
    if (isReject && !input.reasonCode) {
      throw new AppError(ErrCode.REJECT_REASON_REQUIRED, '驳回必须选择原因', { from, to });
    }

    const now = isoNow();
    const traceId = row.trace_id ?? newTraceId();
    const actor = this.db.get<{ type: string }>('SELECT type FROM member WHERE id = ?', [actorId]);
    const nowIso = to === TaskStatus.DONE ? now : null;

    this.db.tx(() => {
      this.db.run(
        `UPDATE task SET status = ?, lock_version = lock_version + 1, updated_at = ?,
           completed_at = COALESCE(?, completed_at),
           reject_reason_code = CASE WHEN ? = 1 THEN ? ELSE reject_reason_code END
         WHERE id = ?`,
        [to, now, nowIso, isReject ? 1 : 0, input.reasonCode ?? null, id],
      );

      this.audit.write({
        action: isReject ? 'task_rejected' : 'task_transitioned',
        traceId,
        actorId,
        actorType: (actor?.type as MemberType) ?? MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: row.code,
        detail: { from, to, reasonCode: input.reasonCode ?? null, comment: input.comment ?? null },
        workspaceId: row.workspace_id,
      });

      this.addActivityInternal({
        taskId: id,
        type: ActivityType.STATUS_CHANGE,
        actorId,
        actorType: (actor?.type as MemberType) ?? MemberType.HUMAN,
        initiatorId: actorId,
        content: input.comment ?? `${TASK_STATUS_LABEL[from]} → ${TASK_STATUS_LABEL[to]}`,
        payload: { from, to, isReject },
        reasonCode: input.reasonCode,
        traceId,
      });

      // 任务离开「审核中」→ 解除「待你验收」通知。
      //
      // 与 `accept()` 保持**同一副作用**：无论走 accept 还是 transition，
      // 只要离开 in_review，「待你验收」这个待办就失去意义。
      // 此前只有 accept 会解除，导致 `transition {to:'done'}` 之后
      // 通知仍挂在收件箱 —— 同一个业务状态变化，走不同接口产生不同结果。
      if (from === TaskStatus.IN_REVIEW) {
        this.notifications.resolveByRef('task', id);
      }
    });

    metricsSink.emit(MetricEvent.TASK_TRANSITIONED, { taskId: id, from, to }, actorId);

    // 流转到 in_progress 且被指派人是 AI → 触发执行
    if (to === TaskStatus.IN_PROGRESS) {
      const fresh = this.rawOrThrow(id);
      if (fresh.assignee_id && fresh.assignee_type === MemberType.AI) {
        this.runAgent(id, fresh.assignee_id, fresh.creator_id, traceId);
      }
    }

    return this.toTask(this.rawOrThrow(id));
  }

  /* ═══════════ 验收 ═══════════ */

  accept(id: string, input: AcceptInput, actorId: string = DEFAULT_ACTOR_ID): Task {
    const row = this.rawOrThrow(id);
    const from = row.status as TaskStatus;

    if (from !== TaskStatus.IN_REVIEW) {
      throw new AppError(ErrCode.STATE_ILLEGAL, '仅「审核中」的任务可以验收', { taskId: id, status: from });
    }

    const now = isoNow();
    const traceId = row.trace_id ?? newTraceId();

    if (input.decision === 'accept') {
      this.stateMachine.assert(from, TaskStatus.DONE);
      this.db.tx(() => {
        this.db.run(
          `UPDATE task SET status = ?, lock_version = lock_version + 1, updated_at = ?, completed_at = ?
           WHERE id = ?`,
          [TaskStatus.DONE, now, now, id],
        );
        this.audit.write({
          action: 'task_accepted',
          traceId,
          actorId,
          actorType: MemberType.HUMAN,
          initiatorId: actorId,
          resourceType: 'task',
          resourceId: id,
          resourceName: row.code,
          detail: { decision: 'accept', from, to: TaskStatus.DONE },
          workspaceId: row.workspace_id,
        });
        this.addActivityInternal({
          taskId: id,
          type: ActivityType.APPROVAL,
          actorId,
          actorType: MemberType.HUMAN,
          initiatorId: actorId,
          content: input.comment ?? '验收通过',
          payload: { decision: 'accept', from, to: TaskStatus.DONE },
          traceId,
        });
        // 任务离开「审核中」→ 解除「待你验收」通知。
        // 不这么做的话，已验证的任务会一直挂在收件箱里（inbox 返回全部通知，含已读）。
        this.notifications.resolveByRef('task', id);
      });

      metricsSink.emit(MetricEvent.TASK_ACCEPTED, { taskId: id }, actorId);
      return this.toTask(this.rawOrThrow(id));
    }

    // 驳回：必须带原因（422），且为「前向跳转」in_review → in_progress
    if (!input.rejectReasonCode) {
      throw new AppError(ErrCode.REJECT_REASON_REQUIRED, '请选择驳回原因', {
        field: 'rejectReasonCode',
        allowed: ['info_insufficient', 'wrong_direction', 'quality_fail', 'other'],
      });
    }

    this.stateMachine.assert(from, TaskStatus.IN_PROGRESS);

    this.db.tx(() => {
      this.db.run(
        `UPDATE task SET status = ?, reject_reason_code = ?, lock_version = lock_version + 1, updated_at = ?
         WHERE id = ?`,
        [TaskStatus.IN_PROGRESS, input.rejectReasonCode ?? null, now, id],
      );

      this.audit.write({
        action: 'task_rejected',
        traceId,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        resourceType: 'task',
        resourceId: id,
        resourceName: row.code,
        detail: {
          decision: 'reject',
          reasonCode: input.rejectReasonCode,
          from,
          to: TaskStatus.IN_PROGRESS,
          comment: input.comment ?? null,
        },
        workspaceId: row.workspace_id,
      });

      this.addActivityInternal({
        taskId: id,
        type: ActivityType.APPROVAL,
        actorId,
        actorType: MemberType.HUMAN,
        initiatorId: actorId,
        content: input.comment ?? '驳回',
        payload: { decision: 'reject', from, to: TaskStatus.IN_PROGRESS },
        reasonCode: input.rejectReasonCode,
        traceId,
      });
      // 驳回同样离开「审核中」→ 解除旧通知；AI 重新执行后会产生新的「待验收」通知，
      // 若不解旧通知，收件箱会出现同一任务的多条重复待办。
      this.notifications.resolveByRef('task', id);
    });

    metricsSink.emit(MetricEvent.TASK_REJECTED, { taskId: id, reasonCode: input.rejectReasonCode }, actorId);

    return this.toTask(this.rawOrThrow(id));
  }

  /* ═══════════ 活动 / 交付物 ═══════════ */

  activities(id: string): TaskActivity[] {
    this.rawOrThrow(id);
    const rows = this.db.all<ActivityRow>(
      'SELECT * FROM task_activity WHERE task_id = ? ORDER BY created_at ASC, rowid ASC',
      [id],
    );
    return rows.map((row) => this.toActivity(row));
  }

  addActivity(
    id: string,
    input: { content: string; type?: 'comment' },
    actorId: string = DEFAULT_ACTOR_ID,
  ): TaskActivity {
    const row = this.rawOrThrow(id);
    if (!input.content || input.content.trim() === '') {
      throw new AppError(ErrCode.BAD_REQUEST, '评论内容不能为空');
    }
    const actor = this.db.get<{ type: string }>('SELECT type FROM member WHERE id = ?', [actorId]);
    const activityId = this.addActivityInternal({
      taskId: id,
      type: ActivityType.COMMENT,
      actorId,
      actorType: (actor?.type as MemberType) ?? MemberType.HUMAN,
      initiatorId: actorId,
      content: input.content,
      payload: {},
      traceId: row.trace_id ?? trace.current(),
    });

    const created = this.db.get<ActivityRow>('SELECT * FROM task_activity WHERE id = ?', [activityId]);
    return this.toActivity(created as ActivityRow);
  }

  artifacts(id: string): Artifact[] {
    this.rawOrThrow(id);
    const rows = this.db.all<ArtifactRow>(
      'SELECT * FROM artifact WHERE task_id = ? ORDER BY created_at ASC, rowid ASC',
      [id],
    );
    return rows.map((row) => this.toArtifact(row));
  }

  addArtifact(id: string, req: CreateArtifactReq, actorId: string = DEFAULT_ACTOR_ID): Artifact {
    const row = this.rawOrThrow(id);
    if (!req.title) throw new AppError(ErrCode.BAD_REQUEST, '交付物标题不能为空');

    const artifactId = `art-${nanoid(10)}`;
    const code = this.nextArtifactCode();
    const now = isoNow();
    const content = req.content ?? '';
    const sizeBytes = req.sizeBytes ?? Buffer.byteLength(content, 'utf8');
    const versionRow = this.db.get<{ v: number }>(
      'SELECT COALESCE(MAX(version), 0) AS v FROM artifact WHERE task_id = ?',
      [id],
    );

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO artifact (
           id, code, task_id, type, title, uri, content, size_bytes, submitted_by, trace_id, version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          artifactId,
          code,
          id,
          req.type ?? ArtifactType.DOC,
          req.title,
          req.uri ?? null,
          content,
          sizeBytes,
          actorId,
          row.trace_id ?? trace.current(),
          Number(versionRow?.v ?? 0) + 1,
          now,
        ],
      );

      this.addActivityInternal({
        taskId: id,
        type: ActivityType.ARTIFACT_SUBMITTED,
        actorId,
        actorType: 'human',
        initiatorId: actorId,
        content: `提交交付物：${req.title}`,
        payload: { artifactCode: code },
        traceId: row.trace_id ?? trace.current(),
      });

      this.audit.write({
        action: 'artifact_submitted',
        actorId,
        actorType: 'human',
        initiatorId: actorId,
        resourceType: 'artifact',
        resourceId: artifactId,
        resourceName: `${code} ${req.title}`,
        detail: { taskId: id, sizeBytes },
        workspaceId: row.workspace_id,
      });
    });

    const created = this.db.get<ArtifactRow>('SELECT * FROM artifact WHERE id = ?', [artifactId]);
    return this.toArtifact(created as ArtifactRow);
  }

  /** 内部使用：追加活动记录（不单独开事务，须在调用方事务内） */
  private addActivityInternal(input: {
    taskId: string;
    type: ActivityType | string;
    actorId: string;
    actorType: MemberType;
    initiatorId?: string | null;
    content?: string | null;
    payload?: Record<string, unknown>;
    reasonCode?: RejectReason;
    traceId?: string;
    durationMs?: number;
    tokenUsed?: number;
  }): string {
    const id = `act-${nanoid(10)}`;
    this.db.run(
      `INSERT INTO task_activity (
         id, task_id, type, actor_id, actor_type, initiator_id, content, payload,
         reason_code, trace_id, duration_ms, token_used, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.taskId,
        input.type,
        input.actorId,
        input.actorType,
        input.initiatorId ?? null,
        input.content ?? null,
        JSON.stringify(input.payload ?? {}),
        input.reasonCode ?? null,
        input.traceId ?? trace.current(),
        input.durationMs ?? null,
        input.tokenUsed ?? null,
        isoNow(),
      ],
    );
    return id;
  }

  /* ═══════════ AI 执行（Mock） ═══════════ */

  /**
   * 触发 AI 成员执行：todo/backlog → in_progress → 交付物 → in_review
   * 全流程与审计同事务；执行轨迹写入 task_activity。
   */
  runAgent(taskId: string, agentId: string, initiatorId: string, traceIdOverride?: string): Task {
    const row = this.rawOrThrow(taskId);
    const agentRow = this.db.get<{
      id: string;
      type: string;
      name: string;
      status: string;
      workspace_id: string;
    }>('SELECT id, type, name, status, workspace_id FROM member WHERE id = ?', [agentId]);

    if (!agentRow) throw new AppError(ErrCode.NOT_FOUND, `AI 成员不存在：${agentId}`);
    if (agentRow.type !== MemberType.AI) {
      throw new AppError(ErrCode.BAD_REQUEST, '仅 AI 成员可触发自动执行', { agentId });
    }
    if (agentRow.status !== 'active') {
      throw new AppError(ErrCode.BAD_REQUEST, `AI 成员已停用：${agentRow.name}`, { agentId });
    }

    const traceId = traceIdOverride ?? row.trace_id ?? newTraceId();

    // 预算熔断：已用配额 ≥ 月度配额 → 402
    const quota = this.db.get<{ quota_monthly: number; quota_used: number }>(
      'SELECT quota_monthly, quota_used FROM agent_config WHERE member_id = ?',
      [agentId],
    );
    if (quota && Number(quota.quota_monthly) > 0 && Number(quota.quota_used) >= Number(quota.quota_monthly)) {
      throw new AppError(ErrCode.BUDGET_EXCEEDED, '已达预算上限，执行已停止', {
        agentId,
        quotaMonthly: Number(quota.quota_monthly),
        quotaUsed: Number(quota.quota_used),
      });
    }

    // ── 状态推进到 in_progress（前向） ──
    const path = this.pathToInProgress(row.status as TaskStatus);
    for (const step of path) {
      this.db.tx(() => {
        this.db.run('UPDATE task SET status = ?, lock_version = lock_version + 1, updated_at = ? WHERE id = ?', [
          step,
          isoNow(),
          taskId,
        ]);
        this.addActivityInternal({
          taskId,
          type: ActivityType.STATUS_CHANGE,
          actorId: agentId,
          actorType: MemberType.AI,
          initiatorId,
          content: step === TaskStatus.IN_PROGRESS ? 'AI 认领任务' : `状态推进至 ${TASK_STATUS_LABEL[step]}`,
          payload: { to: step, by: 'ai' },
          traceId,
        });
      });
    }

    // ── 组装执行输入 ──
    const agent = this.db.get<Record<string, unknown>>('SELECT * FROM member WHERE id = ?', [agentId]);
    const cfgRow = this.db.get<Record<string, unknown>>(
      'SELECT * FROM agent_config WHERE member_id = ?',
      [agentId],
    );

    const skills = this.loadExecutableSkills(cfgRow ? parseJsonArray(cfgRow.skill_ids) : []);

    // 可读知识空间 = 成员 ACL 可读 ∩ 创建者 ACL 可读（双主体）
    const creatorId = row.creator_id;
    const agentSpaces = this.permissions.resolveReadableSpaces(agentId);
    const creatorSpaces = this.permissions.resolveReadableSpaces(creatorId);
    const allowedSpaceIds = agentSpaces.filter((s) => creatorSpaces.includes(s));

    const input: AgentExecutionInput = {
      task: this.toTask(row),
      agent: {
        id: String(agent?.id ?? agentId),
        workspaceId: String(agent?.workspace_id ?? row.workspace_id),
        type: MemberType.AI,
        name: String(agent?.name ?? 'AI'),
        avatarText: String(agent?.avatar_text ?? 'AI'),
        avatarColor: String(agent?.avatar_color ?? 'var(--ac)'),
        role: String(agent?.role ?? 'member') as MemberRole,
        capabilityTags: [],
        dataScope: [],
        status: 'active',
        createdAt: String(agent?.created_at ?? isoNow()),
      },
      agentConfig: cfgRow
        ? {
            memberId: agentId,
            rolePrompt: String(cfgRow.role_prompt ?? ''),
            primaryModelId: cfgRow.primary_model_id ? String(cfgRow.primary_model_id) : undefined,
            fallbackModelIds: parseJsonArray(cfgRow.fallback_model_ids),
            skillIds: parseJsonArray(cfgRow.skill_ids),
            toolIds: parseJsonArray(cfgRow.tool_ids),
            kbSpaceIds: parseJsonArray(cfgRow.kb_space_ids),
            declaredScope: parseJsonArray(cfgRow.declared_scope),
            contextBudget: Number(cfgRow.context_budget ?? 8192),
            contextPriority: parseJsonArray(cfgRow.context_priority),
            quotaMonthly: Number(cfgRow.quota_monthly ?? 0),
            quotaUsed: Number(cfgRow.quota_used ?? 0),
            version: String(cfgRow.version ?? 'v1.0'),
            grayRatio: Number(cfgRow.gray_ratio ?? 100),
          }
        : undefined,
      initiatorId,
      allowedSpaceIds,
      skills,
      traceId,
    };

    metricsSink.emit(MetricEvent.AGENT_RUN_START, { taskId, agentId }, agentId);

    const execution = trace.run(traceId, () => this.executor.execute(input));

    // ── 落库：轨迹 + 交付物 + 审计 + 用量 + 收件箱，全部同事务 ──
    const artifactId = `art-${nanoid(10)}`;
    const artifactCode = this.nextArtifactCode();
    const now = isoNow();
    const versionRow = this.db.get<{ v: number }>(
      'SELECT COALESCE(MAX(version), 0) AS v FROM artifact WHERE task_id = ?',
      [taskId],
    );

    const result = this.db.tx(() => {
      // 1) 执行轨迹
      for (const step of execution.steps) {
        this.addActivityInternal({
          taskId,
          type:
            step.kind === 'plan'
              ? ActivityType.AGENT_PLAN
              : step.kind === 'skill'
                ? ActivityType.TOOL_CALL
                : step.kind === 'artifact'
                  ? ActivityType.ARTIFACT_SUBMITTED
                  : ActivityType.COMMENT,
          actorId: agentId,
          actorType: MemberType.AI,
          initiatorId,
          content: `${step.title}：${step.detail}`,
          payload: step.payload,
          traceId,
          durationMs: step.durationMs,
          tokenUsed: step.tokenUsed,
        });
      }

      // 2) 交付物
      this.db.run(
        `INSERT INTO artifact (
           id, code, task_id, type, title, uri, content, size_bytes, submitted_by, trace_id, version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          artifactId,
          artifactCode,
          taskId,
          execution.artifact.type,
          execution.artifact.title,
          execution.artifact.uri ?? null,
          execution.artifact.content,
          execution.artifact.sizeBytes,
          agentId,
          traceId,
          Number(versionRow?.v ?? 0) + 1,
          now,
        ],
      );

      // 3) 审计（双主体：actor=AI，initiator=发起人）
      for (const step of execution.steps) {
        if (step.kind !== 'skill' && step.kind !== 'model') continue;
        const blocked = step.kind === 'skill' && step.payload['status'] === 'blocked';
        this.audit.write({
          action: blocked ? 'skill_rejected' : step.kind === 'skill' ? 'skill_executed' : 'model_called',
          traceId,
          actorId: agentId,
          actorType: MemberType.AI,
          actorName: agentRow.name,
          initiatorId,
          resourceType: step.kind === 'skill' ? 'skill' : 'model',
          resourceId: String(
            step.payload['skillId'] ?? step.payload['modelId'] ?? '',
          ) || null,
          resourceName: step.title,
          durationMs: step.durationMs,
          tokenUsed: step.tokenUsed,
          result: blocked ? 'blocked' : 'success',
          detail: step.payload,
          workspaceId: row.workspace_id,
        });
      }

      this.audit.write({
        action: 'artifact_submitted',
        traceId,
        actorId: agentId,
        actorType: MemberType.AI,
        actorName: agentRow.name,
        initiatorId,
        resourceType: 'artifact',
        resourceId: artifactId,
        resourceName: `${artifactCode} ${execution.artifact.title}`,
        tokenUsed: execution.tokenUsed,
        durationMs: execution.durationMs,
        detail: { taskId, citationCount: execution.citations.length },
        workspaceId: row.workspace_id,
      });

      // 4) 交付后置为 in_review
      this.db.run(
        `UPDATE task SET status = ?, trace_id = ?, cost = cost + ?, token_used = token_used + ?,
           lock_version = lock_version + 1, updated_at = ? WHERE id = ?`,
        [TaskStatus.IN_REVIEW, traceId, execution.cost, execution.tokenUsed, now, taskId],
      );

      // 5) 用量归因（模型 + 沙箱）
      metricsSink.recordUsage(
        {
          workspaceId: row.workspace_id,
          category: 'model',
          modelId: this.resolveModelIdFromTrace(execution.steps),
          agentId,
          taskId,
          project: parseJsonArray(row.tags).find((t) => t.startsWith('proj:'))?.slice(5) ?? null,
          tokenIn: execution.steps
            .filter((s) => s.kind === 'model')
            .reduce((sum, s) => sum + Number(s.payload['tokenIn'] ?? 0), 0),
          tokenOut: execution.steps
            .filter((s) => s.kind === 'model')
            .reduce((sum, s) => sum + Number(s.payload['tokenOut'] ?? 0), 0),
          cost: execution.cost,
          traceId,
        },
        this.db,
      );

      // 6) 配额累计
      this.db.run('UPDATE agent_config SET quota_used = quota_used + ? WHERE member_id = ?', [
        execution.cost,
        agentId,
      ]);

      // 7) 收件箱：通知发起人待验收
      this.notifications.notifyApproval({
        workspaceId: row.workspace_id,
        recipientId: initiatorId,
        taskId,
        taskCode: row.code,
        title: row.title,
      });

      return execution;
    });

    metricsSink.emit(
      MetricEvent.AGENT_RUN_FINISH,
      {
        taskId,
        agentId,
        artifactId,
        tokenUsed: result.tokenUsed,
        cost: result.cost,
        citationCount: result.citations.length,
      },
      agentId,
    );

    return this.toTask(this.rawOrThrow(taskId));
  }

  /** 从轨迹中解析实际使用的模型 id */
  private resolveModelIdFromTrace(steps: { kind: string; payload: Record<string, unknown> }[]): string | null {
    const modelStep = steps.find((s) => s.kind === 'model');
    return modelStep ? String(modelStep.payload['modelId'] ?? '') || null : null;
  }

  /** 计算推进到 in_progress 的最短前向路径 */
  private pathToInProgress(status: TaskStatus): TaskStatus[] {
    if (status === TaskStatus.IN_PROGRESS) return [];
    if (status === TaskStatus.IN_REVIEW) return [];
    if (status === TaskStatus.TODO) return [TaskStatus.IN_PROGRESS];
    if (status === TaskStatus.BACKLOG) return [TaskStatus.TODO, TaskStatus.IN_PROGRESS];
    if (status === TaskStatus.SUSPENDED) return [TaskStatus.IN_PROGRESS];
    throw new AppError(
      ErrCode.STATE_ILLEGAL,
      `任务处于终态（${TASK_STATUS_LABEL[status]}），无法触发 AI 执行`,
      { status },
    );
  }

  /** 加载 AI 成员绑定技能的可执行形态（当前已发布版本 + 权限声明） */
  private loadExecutableSkills(skillIds: string[]): ExecutableSkill[] {
    const out: ExecutableSkill[] = [];
    for (const skillId of skillIds) {
      const skillRow = this.db.get<SkillRow>('SELECT * FROM skill WHERE id = ?', [skillId]);
      if (!skillRow) continue;
      const skill = mapSkillRow(skillRow);
      if (!skill.enabled) continue;
      const version = loadCurrentVersion(this.db, skill);
      if (!version) continue;
      if (version.status !== 'published') continue;
      out.push({ skill, version, permissions: version.permissions });
    }
    return out;
  }

  /** 供 SkillService / 其他服务复用的版本映射（保持单一来源） */
  versionOf(skillId: string, version: string): { row: SkillVersionRow; mapped: ReturnType<typeof mapVersionRow> } {
    const row = this.db.get<SkillVersionRow>(
      'SELECT * FROM skill_version WHERE skill_id = ? AND version = ?',
      [skillId, version],
    );
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `技能版本不存在：${skillId}@${version}`);
    return { row, mapped: mapVersionRow(this.db, row) };
  }

  /* ═══════════ 度量 ═══════════ */

  metrics(): TaskMetrics {
    const total = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM task');
    const done = this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM task WHERE status = 'done'");
    const rejected = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM task WHERE reject_reason_code IS NOT NULL',
    );
    const duration = this.db.get<{ avg_min: number | null }>(
      `SELECT AVG((julianday(completed_at) - julianday(created_at)) * 24 * 60) AS avg_min
       FROM task WHERE status = 'done' AND completed_at IS NOT NULL`,
    );
    const aiDone = this.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM task WHERE status = 'done' AND assignee_type = 'ai'",
    );
    const aiFirstPass = this.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM task WHERE status = 'done' AND assignee_type = 'ai' AND reject_reason_code IS NULL",
    );

    const totalCount = total ? Number(total.c) : 0;
    const doneCount = done ? Number(done.c) : 0;
    const rejectedCount = rejected ? Number(rejected.c) : 0;
    const aiDoneCount = aiDone ? Number(aiDone.c) : 0;
    const aiFirstPassCount = aiFirstPass ? Number(aiFirstPass.c) : 0;

    return {
      throughput: doneCount,
      avgDurationMin: duration?.avg_min ? Math.round(Number(duration.avg_min) * 10) / 10 : 0,
      rejectRate: totalCount === 0 ? 0 : Math.round((rejectedCount / totalCount) * 1000) / 1000,
      agentFirstPassRate: aiDoneCount === 0 ? 0 : Math.round((aiFirstPassCount / aiDoneCount) * 1000) / 1000,
    };
  }

  /** 按看板列聚合（前端看板一次性拿全量数据） */
  board(): Record<string, Task[]> {
    const list = this.db.all<TaskRow>(
      `SELECT * FROM task ORDER BY
         CASE priority WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 ELSE 2 END ASC,
         updated_at DESC`,
    );
    const out: Record<string, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    };
    for (const row of list.map((r) => this.toTask(r))) {
      const key =
        row.status === 'suspended' ? 'in_progress' : row.status === 'cancelled' ? 'done' : row.status;
      (out[key] ??= []).push(row);
    }
    return out;
  }

  /** 未读通知数（供 UI 顶栏） */
  unreadNotifications(recipientId: string): number {
    return this.notifications.unreadCount(recipientId);
  }
}

export const taskService = new TaskService();

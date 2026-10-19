/**
 * NotificationService —— 收件箱聚合（approval / mention / kb_feedback / sla / security）
 */

import {
  NotificationPriority,
  type MemberType,
  type Notification,
  type NotificationKind,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { getDb, isoNow, toBool, type Db } from '../db/client';
import { AppError } from '../core/errors';

interface NotificationRow {
  id: string;
  workspace_id: string;
  recipient_id: string;
  kind: string;
  title: string;
  ref_type: string | null;
  ref_id: string | null;
  priority: string;
  read: number;
  created_at: string;
}

export interface CreateNotificationInput {
  workspaceId: string;
  recipientId: string;
  kind: NotificationKind;
  title: string;
  refType?: string;
  refId?: string;
  priority?: NotificationPriority;
}

export class NotificationService {
  private readonly db: Db;

  constructor(db: Db = getDb()) {
    this.db = db;
  }

  private toNotification(row: NotificationRow): Notification {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      recipientId: row.recipient_id,
      kind: row.kind as NotificationKind,
      title: row.title,
      refType: row.ref_type ?? undefined,
      refId: row.ref_id ?? undefined,
      priority: row.priority as NotificationPriority,
      read: toBool(row.read),
      createdAt: row.created_at,
    };
  }

  /** GET /api/inbox?recipientId= （缺省返回全部，便于演示） */
  inbox(recipientId?: string): Notification[] {
    const rows = recipientId
      ? this.db.all<NotificationRow>(
          'SELECT * FROM notification WHERE recipient_id = ? ORDER BY read ASC, created_at DESC',
          [recipientId],
        )
      : this.db.all<NotificationRow>(
          'SELECT * FROM notification ORDER BY read ASC, created_at DESC LIMIT 100',
        );
    return rows.map((row) => this.toNotification(row));
  }

  /** 创建通知（在调用方事务内执行，保证与业务一致） */
  create(input: CreateNotificationInput): string {
    const id = `ntf-${nanoid(10)}`;
    this.db.run(
      `INSERT INTO notification (
         id, workspace_id, recipient_id, kind, title, ref_type, ref_id, priority, read, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        id,
        input.workspaceId,
        input.recipientId,
        input.kind,
        input.title,
        input.refType ?? null,
        input.refId ?? null,
        input.priority ?? NotificationPriority.NORMAL,
        isoNow(),
      ],
    );
    return id;
  }

  /** 标记已读 */
  markRead(id: string): Notification {
    const row = this.db.get<NotificationRow>('SELECT * FROM notification WHERE id = ?', [id]);
    if (!row) throw new AppError(1004, `通知不存在：${id}`);
    this.db.run('UPDATE notification SET read = 1 WHERE id = ?', [id]);
    return this.toNotification({ ...row, read: 1 });
  }

  /**
   * 按业务引用**解除**通知（任务离开「审核中」后调用）。
   *
   * 为什么是删除而不是标记已读：`approval` 类通知是**任务状态的派生物** ——
   * 任务一旦不再处于 in_review，「待你验收」这个待办就失去意义。
   * 而 `inbox()` 会返回全部通知（含已读），只置 read=1 的话条目仍留在收件箱，
   * 造成「已验证的任务还挂着待验收」的错觉（实测 E2E 后堆积 23 条）。
   * 历史可追溯性由 audit_log 的 task_accepted / task_rejected 保证，不会丢失。
   *
   * @returns 被解除的通知条数
   */
  resolveByRef(refType: string, refId: string): number {
    const row = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM notification WHERE ref_type = ? AND ref_id = ?',
      [refType, refId],
    );
    this.db.run('DELETE FROM notification WHERE ref_type = ? AND ref_id = ?', [refType, refId]);
    return row ? Number(row.c) : 0;
  }

  /** 未读数量（供顶栏红点） */
  unreadCount(recipientId: string): number {
    const row = this.db.get<{ c: number }>(
      'SELECT COUNT(*) AS c FROM notification WHERE recipient_id = ? AND read = 0',
      [recipientId],
    );
    return row ? Number(row.c) : 0;
  }

  /** 通知某人「任务待验收」（便捷方法，供 TaskService 复用） */
  notifyApproval(params: {
    workspaceId: string;
    recipientId: string;
    taskId: string;
    taskCode: string;
    title: string;
    urgent?: boolean;
  }): string {
    return this.create({
      workspaceId: params.workspaceId,
      recipientId: params.recipientId,
      kind: 'approval',
      title: `${params.taskCode} ${params.title} 待你验收`,
      refType: 'task',
      refId: params.taskId,
      priority: params.urgent ? NotificationPriority.URGENT : NotificationPriority.NORMAL,
    });
  }

  /** 通知「安全事件」 */
  notifySecurity(params: {
    workspaceId: string;
    recipientId: string;
    title: string;
    refType?: string;
    refId?: string;
  }): string {
    return this.create({
      workspaceId: params.workspaceId,
      recipientId: params.recipientId,
      kind: 'security',
      title: params.title,
      refType: params.refType,
      refId: params.refId,
      priority: NotificationPriority.URGENT,
    });
  }
}

export type { MemberType };
export const notificationService = new NotificationService();

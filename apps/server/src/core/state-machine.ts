/**
 * 任务状态机（§4.2 / §7.1）
 *
 * 铁律：只允许**前向**流转。`in_review → in_progress` 的「驳回」是前向跳转而非回退，
 * 通过 `isReject()` 单独识别，用于区分审计动作（task_rejected vs task_transitioned）。
 */

import {
  REJECT_TRANSITION,
  TERMINAL_STATUSES,
  TRANSITIONS,
  TASK_STATUS_LABEL,
  ErrCode,
  type TaskStatus,
} from '@huanbuddy/shared';

import { AppError } from './errors';

export class StateMachine {
  /** 该状态是否允许流转到目标状态 */
  can(from: TaskStatus, to: TaskStatus): boolean {
    const allowed = TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
  }

  /** 校验流转合法性，非法抛 409 STATE_ILLEGAL（不可回退） */
  assert(from: TaskStatus, to: TaskStatus): void {
    if (this.can(from, to)) return;
    throw new AppError(
      ErrCode.STATE_ILLEGAL,
      `当前状态不支持该操作：${TASK_STATUS_LABEL[from]} → ${TASK_STATUS_LABEL[to]}`,
      {
        from,
        to,
        fromLabel: TASK_STATUS_LABEL[from],
        toLabel: TASK_STATUS_LABEL[to],
        allowed: this.allowed(from),
        allowedLabels: this.allowed(from).map((s) => TASK_STATUS_LABEL[s]),
      },
    );
  }

  /** 某状态允许的全部目标状态 */
  allowed(from: TaskStatus): TaskStatus[] {
    return [...(TRANSITIONS[from] ?? [])];
  }

  /** 是否终态（终态不可再流转） */
  isTerminal(status: TaskStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
  }

  /** 该流转是否为「驳回」语义（in_review → in_progress） */
  isReject(from: TaskStatus, to: TaskStatus): boolean {
    return from === REJECT_TRANSITION.from && to === REJECT_TRANSITION.to;
  }

  /** 是否为合法状态值 */
  isValidStatus(value: unknown): value is TaskStatus {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
  }
}

/** 全局单例 */
export const stateMachine = new StateMachine();

/**
 * 状态机单测（T04 验收标准 1）
 * 覆盖：合法流转、非法流转（不可回退）、终态、驳回语义识别。
 */

import { describe, expect, it } from 'vitest';

import { TRANSITIONS, TaskStatus } from '@huanbuddy/shared';

import { AppError } from '../core/errors';
import { StateMachine, stateMachine } from '../core/state-machine';

const sm = new StateMachine();

/** 期望抛出指定错误码 */
function expectCode(fn: () => unknown, code: number): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error('预期抛出 AppError，但未抛出');
}

describe('StateMachine · 合法流转', () => {
  it('backlog → todo 合法', () => {
    expect(sm.can('backlog', 'todo')).toBe(true);
    expect(() => sm.assert('backlog', 'todo')).not.toThrow();
  });

  it('todo → in_progress 合法', () => {
    expect(sm.can('todo', 'in_progress')).toBe(true);
  });

  it('in_progress → in_review 合法', () => {
    expect(sm.can('in_progress', 'in_review')).toBe(true);
  });

  it('in_review → done 合法', () => {
    expect(sm.can('in_review', 'done')).toBe(true);
  });

  it('in_review → in_progress 为「驳回」前向跳转，合法', () => {
    expect(sm.can('in_review', 'in_progress')).toBe(true);
    expect(sm.isReject('in_review', 'in_progress')).toBe(true);
  });

  it('suspended → in_progress 合法（恢复执行）', () => {
    expect(sm.can('suspended', 'in_progress')).toBe(true);
  });

  it('backlog → cancelled / todo → cancelled / suspended → cancelled 合法', () => {
    expect(sm.can('backlog', 'cancelled')).toBe(true);
    expect(sm.can('todo', 'cancelled')).toBe(true);
    expect(sm.can('suspended', 'cancelled')).toBe(true);
  });

  it('全部合法转移与 TRANSITIONS 表完全一致', () => {
    for (const [from, targets] of Object.entries(TRANSITIONS)) {
      for (const to of targets) {
        expect(sm.can(from as TaskStatus, to), `${from} → ${to}`).toBe(true);
      }
    }
  });
});

describe('StateMachine · 非法流转（不可回退）', () => {
  it('todo → backlog（回退）非法，抛 409 STATE_ILLEGAL', () => {
    expect(sm.can('todo', 'backlog')).toBe(false);
    const error = expectCode(() => sm.assert('todo', 'backlog'), 1006);
    expect(error.http).toBe(409);
    expect(error.details).toMatchObject({ from: 'todo', to: 'backlog' });
  });

  it('in_progress → todo（回退）非法', () => {
    expect(sm.can('in_progress', 'todo')).toBe(false);
    expectCode(() => sm.assert('in_progress', 'todo'), 1006);
  });

  it('in_review → todo（跨列回退）非法', () => {
    expect(sm.can('in_review', 'todo')).toBe(false);
    expectCode(() => sm.assert('in_review', 'todo'), 1006);
  });

  it('done → 任意状态非法（终态）', () => {
    for (const to of Object.keys(TRANSITIONS) as TaskStatus[]) {
      expect(sm.can('done', to), `done → ${to}`).toBe(false);
    }
    expect(sm.isTerminal('done')).toBe(true);
    expectCode(() => sm.assert('done', 'in_progress'), 1006);
  });

  it('cancelled → 任意状态非法（终态）', () => {
    for (const to of Object.keys(TRANSITIONS) as TaskStatus[]) {
      expect(sm.can('cancelled', to), `cancelled → ${to}`).toBe(false);
    }
    expect(sm.isTerminal('cancelled')).toBe(true);
  });

  it('backlog → in_progress（跳步）非法', () => {
    expect(sm.can('backlog', 'in_progress')).toBe(false);
    expectCode(() => sm.assert('backlog', 'in_progress'), 1006);
  });

  it('backlog → done（跳步）非法', () => {
    expect(sm.can('backlog', 'done')).toBe(false);
  });

  it('in_progress → done（跳过审核）非法', () => {
    expect(sm.can('in_progress', 'done')).toBe(false);
  });
});

describe('StateMachine · 辅助能力', () => {
  it('allowed() 返回合法目标集合', () => {
    expect(sm.allowed('in_review').sort()).toEqual(['done', 'in_progress', 'suspended']);
    expect(sm.allowed('done')).toEqual([]);
    expect(sm.allowed('cancelled')).toEqual([]);
  });

  it('isReject() 仅识别 in_review → in_progress', () => {
    expect(sm.isReject('in_review', 'in_progress')).toBe(true);
    expect(sm.isReject('todo', 'in_progress')).toBe(false);
    expect(sm.isReject('in_review', 'done')).toBe(false);
  });

  it('isValidStatus() 正确识别状态值', () => {
    expect(sm.isValidStatus('in_progress')).toBe(true);
    expect(sm.isValidStatus('nonsense')).toBe(false);
    expect(sm.isValidStatus(undefined)).toBe(false);
  });

  it('全局单例可用', () => {
    expect(stateMachine.can('backlog', 'todo')).toBe(true);
  });
});

/**
 * 有效权限单测（T03/T04 验收标准）
 * 覆盖：min(自身声明, 创建者权限) = intersect、通配、越界 403、ACL 可读空间、委派层级上限。
 */

import { describe, expect, it } from 'vitest';

import { MAX_DELEGATION_DEPTH } from '@huanbuddy/shared';

import { AppError } from '../core/errors';
import { PermissionService, permissionService } from '../core/permission';

/** 种子固定 ID */
const ZHANGWEI = 'm-human-zhangwei'; // dataScope: proj-ops, proj-growth, proj-platform
const CHENJING = 'm-human-chenjing'; // dataScope: proj-ops, proj-growth
const LIUYANG = 'm-human-liuyang'; // dataScope: proj-ops
const AI_ANALYST = 'm-ai-analyst'; // declared: ops, growth  ← 张伟
const AI_WRITER = 'm-ai-writer'; // declared: ops, growth, platform ← 陈静
const AI_INSPECTOR = 'm-ai-inspector'; // declared: ops, platform ← 刘洋

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

describe('PermissionService.intersect（min 语义）', () => {
  it('取交集', () => {
    expect(PermissionService.intersect(['a', 'b', 'c'], ['b', 'c', 'd']).sort()).toEqual(['b', 'c']);
  });

  it('无交集 → 空数组', () => {
    expect(PermissionService.intersect(['a'], ['b'])).toEqual([]);
  });

  it('自身声明为空 → 空（AI 未声明即无权限）', () => {
    expect(PermissionService.intersect([], ['a', 'b'])).toEqual([]);
  });

  it('创建者权限为空 → 空（创建者无权则 AI 无权）', () => {
    expect(PermissionService.intersect(['a', 'b'], [])).toEqual([]);
  });

  it('单方通配 `*` → 取另一方（管理员可授权全集，但仍受对方声明约束）', () => {
    expect(PermissionService.intersect(['a', 'b'], ['*']).sort()).toEqual(['a', 'b']);
    expect(PermissionService.intersect(['*'], ['a']).sort()).toEqual(['a']);
    expect(PermissionService.intersect(['*'], ['*'])).toEqual(['*']);
  });

  it('结果去重', () => {
    expect(PermissionService.intersect(['a', 'a', 'b'], ['a', 'b']).sort()).toEqual(['a', 'b']);
  });
});

describe('PermissionService.computeEffective（seed 数据）', () => {
  it('人类成员有效数据域 = 自身 dataScope', () => {
    expect(permissionService.computeEffective(ZHANGWEI).scope.sort()).toEqual([
      'proj-growth',
      'proj-ops',
      'proj-platform',
    ]);
  });

  it('AI·数据分析师 = min(自身声明 3 域, 张伟 3 域) = ops + growth', () => {
    const effective = permissionService.computeEffective(AI_ANALYST);
    expect(effective.scope.sort()).toEqual(['proj-growth', 'proj-ops']);
    expect(effective.note).toContain('min(自身声明, 创建者权限)');
  });

  it('AI·投放文案 = min(声明 ops/growth/platform, 陈静 ops/growth) = ops + growth', () => {
    expect(permissionService.computeEffective(AI_WRITER).scope.sort()).toEqual([
      'proj-growth',
      'proj-ops',
    ]);
  });

  it('AI·质量巡检 = min(声明 ops/platform, 刘洋 ops) = ops（platform 被创建者权限裁掉）', () => {
    expect(permissionService.computeEffective(AI_INSPECTOR).scope).toEqual(['proj-ops']);
  });

  it('有效权限不超过创建者权限（逐项断言）', () => {
    const creator = permissionService.effectiveScopeOf(LIUYANG);
    const agent = permissionService.effectiveScopeOf(AI_INSPECTOR);
    for (const scope of agent) {
      expect(creator).toContain(scope);
    }
  });
});

describe('PermissionService.assertScope（越界 403）', () => {
  it('在授权范围内通过', () => {
    expect(() => permissionService.assertScope(AI_ANALYST, ['proj-ops'])).not.toThrow();
  });

  it('越界抛 403 SCOPE_DENIED（AI·质量巡检 无 proj-platform）', () => {
    const error = expectCode(() => permissionService.assertScope(AI_INSPECTOR, ['proj-platform']), 1011);
    expect(error.http).toBe(403);
    expect(error.details).toMatchObject({ denied: ['proj-platform'] });
  });

  it('空需求视为通过', () => {
    expect(() => permissionService.assertScope(AI_ANALYST, [])).not.toThrow();
  });

  it('部分越界时整体拒绝', () => {
    expectCode(() => permissionService.assertScope(AI_ANALYST, ['proj-ops', 'proj-platform']), 1011);
  });
});

describe('PermissionService · 委派层级上限', () => {
  it('超过 MAX_DELEGATION_DEPTH 抛 1022', () => {
    expectCode(
      () => permissionService.effectiveScopeOf(ZHANGWEI, MAX_DELEGATION_DEPTH + 1),
      1022,
    );
  });
});

describe('PermissionService · 知识空间 ACL', () => {
  it('ACL 命中成员 → 可读', () => {
    const spaces = permissionService.resolveReadableSpaces(ZHANGWEI);
    expect(spaces).toContain('kbs-ops-spec');
    expect(spaces).toContain('kbs-growth');
  });

  it('AI 成员仅能读到 ACL 中列出的空间（先过滤再召回）', () => {
    const spaces = permissionService.resolveReadableSpaces(AI_WRITER);
    expect(spaces).toContain('kbs-ops-spec');
    expect(spaces).toContain('kbs-platform-doc');
    // 增长方法论 ACL 仅含张伟与分析师
    expect(spaces).not.toContain('kbs-growth');
  });

  it('assertSpaceReadable 越权抛 403', () => {
    expectCode(() => permissionService.assertSpaceReadable(AI_WRITER, 'kbs-growth'), 1011);
  });

  it('人类成员可读空间与 ACL 一致', () => {
    const spaces = permissionService.resolveReadableSpaces(LIUYANG);
    expect(spaces).toContain('kbs-ops-spec');
  });

  it('不存在的成员抛 404', () => {
    expectCode(() => permissionService.effectiveScopeOf('m-not-exist'), 1004);
  });
});

describe('PermissionService · 角色动作矩阵', () => {
  it('admin 拥有 task:* 通配权限', () => {
    expect(permissionService.canAction('admin', 'task:delete')).toBe(true);
  });

  it('member 无 member:write 权限', () => {
    expect(permissionService.canAction('member', 'member:write')).toBe(false);
    expectCode(() => permissionService.assertAction(LIUYANG, 'member:write'), 1003);
  });

  it('member 可读任务', () => {
    expect(permissionService.canAction('member', 'task:read')).toBe(true);
    expect(() => permissionService.assertAction(LIUYANG, 'task:read')).not.toThrow();
  });
});

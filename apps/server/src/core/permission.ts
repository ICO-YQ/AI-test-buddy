/**
 * PermissionService —— 双主体权限（人 + AI），**服务端强制**
 *
 * 铁律（FR-AG-04）：
 *   AI 成员有效权限 = min(自身声明, 创建者有效权限) = intersect(declaredScope, creatorEffectiveScope)
 *   任何跨域读写按 effectiveScope 校验，越界抛 403 SCOPE_DENIED。
 *   若创建者本身也是 AI，则递归上溯，层级超过 MAX_DELEGATION_DEPTH 抛 1022。
 */

import {
  ErrCode,
  MAX_DELEGATION_DEPTH,
  PERMISSION_MATRIX,
  type EffectivePermission,
  type MemberRole,
  type MemberType,
} from '@huanbuddy/shared';

import { getDb, type Db } from '../db/client';
import { AppError } from './errors';

interface MemberRow {
  id: string;
  workspace_id: string;
  type: MemberType;
  name: string;
  role: MemberRole;
  data_scope: string;
  creator_id: string | null;
  status: string;
}

interface AgentConfigRow {
  member_id: string;
  declared_scope: string;
  kb_space_ids: string;
  skill_ids: string;
}

interface KbSpaceRow {
  id: string;
  workspace_id: string;
  acl: string;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    return [];
  }
}

export class PermissionService {
  private readonly db: Db;

  constructor(db: Db = getDb()) {
    this.db = db;
  }

  /* ═══════ 纯函数：min() 有效权限计算 ═══════ */

  /**
   * 有效数据域 = intersect(自身声明, 创建者有效权限)
   * 支持 `*` 通配（平台管理员）：
   *   - 双方均为 `*` → `*`
   *   - 单方为 `*` → 取另一方
   *   - 否则取交集
   */
  static intersect(declared: string[], creatorScope: string[]): string[] {
    const uniq = (arr: string[]): string[] => Array.from(new Set(arr.filter((x) => x !== '')));
    const d = uniq(declared);
    const c = uniq(creatorScope);
    if (d.includes('*') && c.includes('*')) return ['*'];
    if (d.includes('*')) return c;
    if (c.includes('*')) return d;
    return d.filter((x) => c.includes(x));
  }

  /** min(自身声明, 创建者权限) 的语义说明（用于 EffectivePermission.note） */
  static effectiveNote(agentType: MemberType, creatorId?: string | null): string {
    if (agentType === 'ai' && creatorId) {
      return 'min(自身声明, 创建者权限)：AI 成员有效数据域为自身声明与创建者有效权限的交集，服务端强制';
    }
    if (agentType === 'ai') {
      return 'AI 成员未设置创建者，有效数据域为空（禁止跨域读写）';
    }
    return '人类成员有效数据域 = 自身授权范围';
  }

  /* ═══════ 数据读取 ═══════ */

  private memberOrThrow(memberId: string): MemberRow {
    const row = this.db.get<MemberRow>(
      'SELECT id, workspace_id, type, name, role, data_scope, creator_id, status FROM member WHERE id = ?',
      [memberId],
    );
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `成员不存在：${memberId}`);
    return row;
  }

  private agentConfigOf(memberId: string): AgentConfigRow | undefined {
    return this.db.get<AgentConfigRow>(
      'SELECT member_id, declared_scope, kb_space_ids, skill_ids FROM agent_config WHERE member_id = ?',
      [memberId],
    );
  }

  /** 人类成员的有效数据域 = dataScope；AI 成员 = 递归 min() */
  effectiveScopeOf(memberId: string, depth = 0): string[] {
    if (depth > MAX_DELEGATION_DEPTH) {
      throw new AppError(
        ErrCode.DELEGATION_DEPTH_EXCEEDED,
        `委派层级超过上限 ${MAX_DELEGATION_DEPTH}，已终止`,
        { memberId, depth },
      );
    }
    const member = this.memberOrThrow(memberId);
    if (member.type === 'human') {
      return parseJsonArray(member.data_scope);
    }

    const cfg = this.agentConfigOf(memberId);
    const declared = parseJsonArray(cfg?.declared_scope);
    const creatorScope = member.creator_id ? this.effectiveScopeOf(member.creator_id, depth + 1) : [];
    return PermissionService.intersect(declared, creatorScope);
  }

  /** GET /api/members/:id/effective-permissions */
  computeEffective(memberId: string): EffectivePermission {
    const member = this.memberOrThrow(memberId);
    const scope = this.effectiveScopeOf(memberId);
    return {
      memberId,
      scope,
      note: PermissionService.effectiveNote(member.type, member.creator_id),
    };
  }

  /** 兼容类图签名：computeEffective(agent, creator) —— 传两人的数据域取交集 */
  static computeFromScopes(declared: string[], creatorScope: string[]): string[] {
    return PermissionService.intersect(declared, creatorScope);
  }

  /* ═══════ 断言 ═══════ */

  /** 数据域断言：required 必须全部落在 effectiveScope 内 */
  assertScope(memberId: string, required: string[]): void {
    if (required.length === 0) return;
    const scope = this.effectiveScopeOf(memberId);
    if (scope.includes('*')) return;
    const denied = required.filter((r) => !scope.includes(r));
    if (denied.length > 0) {
      throw new AppError(ErrCode.SCOPE_DENIED, `超出授权范围：${denied.join(', ')}`, {
        memberId,
        effectiveScope: scope,
        denied,
      });
    }
  }

  /** 角色动作断言（PERMISSION_MATRIX，支持 `task:*` 通配） */
  assertAction(memberId: string, action: string): void {
    const member = this.memberOrThrow(memberId);
    const allowed = PERMISSION_MATRIX[member.role] ?? [];
    const matched = allowed.some((rule) => {
      if (rule === action) return true;
      if (rule.endsWith(':*')) {
        const prefix = rule.slice(0, -1); // 'task:'
        return action.startsWith(prefix);
      }
      return false;
    });
    if (!matched) {
      throw new AppError(ErrCode.FORBIDDEN, `角色「${member.role}」无权执行：${action}`, {
        role: member.role,
        action,
        allowed,
      });
    }
  }

  /** 是否具备某动作权限（不抛错版本） */
  canAction(role: MemberRole, action: string): boolean {
    const allowed = PERMISSION_MATRIX[role] ?? [];
    return allowed.some((rule) =>
      rule === action ? true : rule.endsWith(':*') ? action.startsWith(rule.slice(0, -1)) : false,
    );
  }

  /* ═══════ 知识库 ACL ═══════ */

  /**
   * 解析某成员**可读**的知识空间集合（先 ACL 过滤，再用于检索召回）。
   * ACL 语义：空数组 = 工作空间内全体可读；否则须命中 memberId / 角色 / `*`。
   */
  resolveReadableSpaces(memberId: string): string[] {
    const member = this.memberOrThrow(memberId);
    const spaces = this.db.all<KbSpaceRow>(
      'SELECT id, workspace_id, acl FROM kb_space WHERE workspace_id = ?',
      [member.workspace_id],
    );
    return spaces
      .filter((space) => {
        const acl = parseJsonArray(space.acl);
        if (acl.length === 0) return true;
        return acl.includes(memberId) || acl.includes(member.role) || acl.includes('*');
      })
      .map((space) => space.id);
  }

  /** AI 成员配置中绑定的知识空间（用于校验配置合法性） */
  boundSpacesOf(memberId: string): string[] {
    const cfg = this.agentConfigOf(memberId);
    return parseJsonArray(cfg?.kb_space_ids);
  }

  /** 校验成员可读某空间，否则 403 SCOPE_DENIED */
  assertSpaceReadable(memberId: string, spaceId: string): void {
    const readable = this.resolveReadableSpaces(memberId);
    if (!readable.includes(spaceId)) {
      throw new AppError(ErrCode.SCOPE_DENIED, `无权访问知识空间：${spaceId}`, {
        memberId,
        spaceId,
        readable,
      });
    }
  }
}

/** 全局单例 */
export const permissionService = new PermissionService();

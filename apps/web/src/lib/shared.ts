/**
 * 前端类型/常量统一出口。
 *
 * 契约唯一来源：`@huanbuddy/shared`（由后端同事维护）。
 * 本文件只做两件事：
 *  1) 透传 shared 的枚举 / 实体类型 / DTO / 错误码 / 契约常量；
 *  2) 补充「仅前端使用」的少量辅助（视觉别名、看板列定义、演示身份、ApiError 类）。
 *
 * 所有页面/组件统一从 `@/lib/shared` 引用，保证与后端契约零漂移。
 */

/* ═══════════ 1. 透传 shared（枚举 / 实体 / 常量） ═══════════ */
export * from '@huanbuddy/shared/enums';
export * from '@huanbuddy/shared/types';
export * from '@huanbuddy/shared/constants';

/* ═══════════ 2. 透传 shared 的 API 契约层 ═══════════
 * 注意：这里刻意不 `export *`，因为 shared 的 `ApiError` 是「响应体接口」，
 * 而前端需要一个同名的「异常类」，故将其重命名为 `ApiErrorBody`。
 */
export { EP } from '@huanbuddy/shared/api';
export type { ApiError as ApiErrorBody } from '@huanbuddy/shared/api';
export type {
  ApiResponse,
  ApiEnvelope,
  Paginated,
  ListTasksQuery,
  CreateTaskReq,
  UpdateTaskReq,
  AssignTaskReq,
  TransitionTaskReq,
  AcceptTaskReq,
  CreateActivityReq,
  CreateArtifactReq,
  TaskDetail,
  CreateMemberReq,
  UpdateMemberReq,
  MemberWithConfig,
  CreateSessionReq,
  SendMessageReq,
  SendMessageResp,
  SwitchModelReq,
  EditMessageReq,
  SessionDetail,
  CreateSkillReq,
  UpdateSkillReq,
  CreateSkillVersionReq,
  ValidateSkillReq,
  RollbackSkillReq,
  ExecuteSkillReq,
  SkillDetail,
  CreateRepoReq,
  UpdateRepoReq,
  ListHubSkillsQuery,
  HubSkillDisabledResp,
  CreateSpaceReq,
  KbSpaceDetail,
  CreateDocReq,
  UpdateDocReq,
  KbDocDetail,
  RollbackDocReq,
  PolishReq,
  CreateSourceReq,
  KbQueryReq,
  KbFeedbackReq,
  OkResp,
  ListAuditQuery,
  CreateKeyReq,
  IssuedKeyResp,
  UsageSummaryQuery,
  ListUsageQuery,
  CreateModelReq,
  UpdateModelReq,
  SetSceneRoutesReq,
} from '@huanbuddy/shared/api';

/* ═══════════ 3. 前后端命名差异的兼容别名 ═══════════ */
export {
  TaskStatus as TASK_STATUS,
  Priority as PRIORITY,
  PermissionCapability as CAPABILITY,
  MemberType as MEMBER_TYPE,
  Feedback as FEEDBACK,
  TrustLevel as TRUST_LEVEL,
  MemberRole as MEMBER_ROLE,
  RejectReason as REJECT_REASON,
  SkillStatus as SKILL_STATUS,
} from '@huanbuddy/shared/enums';

export type { Feedback as FeedbackValue } from '@huanbuddy/shared/enums';
export type { KbSyncSource as SyncSource } from '@huanbuddy/shared/types';

/* ═══════════ 4. 前端专属辅助 ═══════════ */
import { ERRORS, ErrCode, TRANSITIONS } from '@huanbuddy/shared';
import type { TaskStatus } from '@huanbuddy/shared';

/** 网络层错误码（非业务码，仅前端使用） */
export const NETWORK_CODE = -1;

const BY_CODE: Map<number, string> = new Map(Object.values(ERRORS).map((d) => [d.code, d.message]));

/** 由数值错误码取用户提示；未知码回退 fallback */
export function messageForCode(code: number, fallback?: string): string {
  if (code === NETWORK_CODE) return '无法连接服务端，请确认后端已启动（:3001）';
  return BY_CODE.get(code) ?? fallback ?? `请求失败（${code}）`;
}

/** 客户端异常类（与 shared 的 ApiErrorBody 接口语义对应） */
export class ApiError extends Error {
  public readonly code: number;
  public readonly traceId?: string;
  public readonly details?: unknown;
  public readonly httpStatus?: number;

  constructor(code: number, message: string, opts?: { traceId?: string; details?: unknown; httpStatus?: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.traceId = opts?.traceId;
    this.details = opts?.details;
    this.httpStatus = opts?.httpStatus;
  }
}

/** 错误码常量（前端便捷引用） */
export const ERR_CODES = {
  NETWORK: { code: NETWORK_CODE, cn: '无法连接服务端' },
  BAD_REQUEST: { code: ErrCode.BAD_REQUEST, cn: '请求参数有误' },
  INTERNAL: { code: ErrCode.INTERNAL, cn: '服务异常，请稍后重试' },
} as const;

/** 状态机前向校验（复用 shared 的 TRANSITIONS） */
export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** 看板列定义（§7.1 颜色令牌） */
export interface BoardColumnDef {
  key: TaskStatus;
  label: string;
  colorVar: string;
}

export const BOARD_COLUMNS: BoardColumnDef[] = [
  { key: 'backlog', label: '待排期', colorVar: 'var(--st-1)' },
  { key: 'todo', label: '待办', colorVar: 'var(--st-2)' },
  { key: 'in_progress', label: '进行中', colorVar: 'var(--st-3)' },
  { key: 'in_review', label: '审核中', colorVar: 'var(--st-4)' },
  { key: 'done', label: '已完成', colorVar: 'var(--st-5)' },
];

/** 演示身份（§8 默认假设：不做真实登录，顶部身份用于演示双主体）
 *  id 必须与后端 seed（apps/server/src/db/seed.ts）中的成员 id 对齐。 */
export const DEMO_USER = { id: 'm-human-zhangwei', name: '张伟', avatarText: '张' };

/** 演示工作空间（与后端种子 DEFAULT_WORKSPACE_ID 对齐）
 *  演示环境仅单工作区，切换器为不可用态。 */
export const DEMO_WORKSPACE = { id: 'ws-huan-0001', name: '欢网 · 平台产品组' };

/**
 * 错误码表（对应 architecture.md §4.9，共 23 项）
 *
 * 约定：HTTP 200 时 code=0 表示成功；其余 code 与 HTTP 状态一一对应。
 * 服务端 `core/errors.ts` 中的 AppError 引用本表；前端 api/client.ts 用 messageOf() 转提示。
 */

/** 错误码数值常量 */
export const ErrCode = {
  OK: 0,
  BAD_REQUEST: 1001,
  UNAUTHORIZED: 1002,
  FORBIDDEN: 1003,
  NOT_FOUND: 1004,
  CONFLICT_LOCK: 1005,
  STATE_ILLEGAL: 1006,
  TASK_IMMUTABLE: 1007,
  SKILL_IN_USE: 1008,
  REJECT_REASON_REQUIRED: 1009,
  PERMISSION_UNDECLARED: 1010,
  SCOPE_DENIED: 1011,
  TRUST_PENDING: 1012,
  SIGNATURE_INVALID: 1013,
  DOMAIN_NOT_ALLOWED: 1014,
  TIMESTAMP_EXPIRED: 1015,
  RATE_LIMITED: 1016,
  BUDGET_EXCEEDED: 1017,
  AUDIT_UNAVAILABLE: 1018,
  SANDBOX_UNAVAILABLE: 1019,
  MODEL_UNAVAILABLE: 1020,
  CONFLICT: 1021,
  DELEGATION_DEPTH_EXCEEDED: 1022,
  INTERNAL: 1023,
} as const;
export type ErrCode = (typeof ErrCode)[keyof typeof ErrCode];

/** 错误码枚举名（与 ErrCode 键一一对应） */
export type ErrName = keyof typeof ErrCode;

export interface ErrorDescriptor {
  /** 数值错误码 */
  code: ErrCode;
  /** 枚举名 */
  name: ErrName;
  /** HTTP 状态码 */
  http: number;
  /** 面向用户的中文提示 */
  message: string;
}

/** 23 项错误码表（§4.9） */
export const ERRORS: Record<ErrName, ErrorDescriptor> = {
  OK: { code: 0, name: 'OK', http: 200, message: 'ok' },
  BAD_REQUEST: { code: 1001, name: 'BAD_REQUEST', http: 400, message: '请求参数有误' },
  UNAUTHORIZED: { code: 1002, name: 'UNAUTHORIZED', http: 401, message: '请先登录' },
  FORBIDDEN: { code: 1003, name: 'FORBIDDEN', http: 403, message: '你无访问权限' },
  NOT_FOUND: { code: 1004, name: 'NOT_FOUND', http: 404, message: '资源不存在' },
  CONFLICT_LOCK: { code: 1005, name: 'CONFLICT_LOCK', http: 409, message: '任务已被他人/Agent 认领' },
  STATE_ILLEGAL: { code: 1006, name: 'STATE_ILLEGAL', http: 409, message: '当前状态不支持该操作' },
  TASK_IMMUTABLE: { code: 1007, name: 'TASK_IMMUTABLE', http: 409, message: '已验收任务不可修改' },
  SKILL_IN_USE: { code: 1008, name: 'SKILL_IN_USE', http: 409, message: '该版本被引用，无法下线' },
  REJECT_REASON_REQUIRED: { code: 1009, name: 'REJECT_REASON_REQUIRED', http: 422, message: '请选择驳回原因' },
  PERMISSION_UNDECLARED: {
    code: 1010,
    name: 'PERMISSION_UNDECLARED',
    http: 403,
    message: '技能尝试越权操作，已阻断',
  },
  SCOPE_DENIED: { code: 1011, name: 'SCOPE_DENIED', http: 403, message: '超出授权范围' },
  TRUST_PENDING: { code: 1012, name: 'TRUST_PENDING', http: 403, message: '该技能尚未审核通过' },
  SIGNATURE_INVALID: { code: 1013, name: 'SIGNATURE_INVALID', http: 403, message: 'Skill 来源校验失败，已阻断' },
  DOMAIN_NOT_ALLOWED: { code: 1014, name: 'DOMAIN_NOT_ALLOWED', http: 403, message: '目标域名不在白名单' },
  TIMESTAMP_EXPIRED: { code: 1015, name: 'TIMESTAMP_EXPIRED', http: 401, message: '请求已过期，请重试' },
  RATE_LIMITED: { code: 1016, name: 'RATE_LIMITED', http: 429, message: '超出配额，请稍后重试' },
  BUDGET_EXCEEDED: { code: 1017, name: 'BUDGET_EXCEEDED', http: 402, message: '已达预算上限，执行已停止' },
  AUDIT_UNAVAILABLE: { code: 1018, name: 'AUDIT_UNAVAILABLE', http: 503, message: '审计不可用，操作已阻断' },
  SANDBOX_UNAVAILABLE: { code: 1019, name: 'SANDBOX_UNAVAILABLE', http: 503, message: '沙箱资源不足，任务已挂起' },
  MODEL_UNAVAILABLE: { code: 1020, name: 'MODEL_UNAVAILABLE', http: 502, message: '模型服务全部不可用，任务已挂起' },
  CONFLICT: { code: 1021, name: 'CONFLICT', http: 409, message: '标识已存在' },
  DELEGATION_DEPTH_EXCEEDED: {
    code: 1022,
    name: 'DELEGATION_DEPTH_EXCEEDED',
    http: 403,
    message: '委派层级超限，已终止',
  },
  INTERNAL: { code: 1023, name: 'INTERNAL', http: 500, message: '服务异常，请稍后重试' },
};

/** 按数值错误码反查描述 */
const BY_CODE: Record<number, ErrorDescriptor> = Object.fromEntries(
  Object.values(ERRORS).map((d) => [d.code, d]),
) as Record<number, ErrorDescriptor>;

export function descriptorOf(code: number): ErrorDescriptor {
  return BY_CODE[code] ?? ERRORS.INTERNAL;
}

/** 取用户提示文案 */
export function messageOf(code: number): string {
  return descriptorOf(code).message;
}

/** 取 HTTP 状态码 */
export function httpStatusOf(code: number): number {
  return descriptorOf(code).http;
}

/** 取枚举名 */
export function nameOf(code: number): string {
  return descriptorOf(code).name;
}

/** 全部错误码数值（用于断言覆盖 §4.9 的 23 项） */
export const ALL_ERR_CODES: number[] = Object.values(ERRORS).map((d) => d.code);

/** 仅业务错误（排除 OK） */
export const BUSINESS_ERR_CODES: number[] = ALL_ERR_CODES.filter((c) => c !== ErrCode.OK);

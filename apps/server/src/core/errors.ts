/**
 * AppError 类 + Fastify 统一错误映射
 *
 * 约定（§4.1 / §4.9）：
 *   成功 → { code: 0, data: T, message: 'ok' }
 *   失败 → { code: <错误码>, data: null, message: <提示>, traceId?, details? }
 */

import {
  ErrCode,
  ERRORS,
  descriptorOf,
  httpStatusOf,
  nameOf,
  type ApiError,
  type ErrName,
} from '@huanbuddy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { trace } from './trace';

/** 业务异常：携带数值错误码、HTTP 状态与可选详情 */
export class AppError extends Error {
  readonly code: number;
  readonly http: number;
  readonly details?: unknown;

  constructor(code: number | ErrName, message?: string, details?: unknown) {
    const descriptor =
      typeof code === 'number' ? descriptorOf(code) : (ERRORS[code] ?? ERRORS.INTERNAL);
    super(message ?? descriptor.message);
    this.name = `AppError(${descriptor.name})`;
    this.code = descriptor.code;
    this.http = descriptor.http;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  /** 是否携带结构化 details */
  hasDetails(): boolean {
    return this.details !== undefined;
  }

  toPayload(traceId?: string): ApiError {
    const payload: ApiError = {
      code: this.code,
      data: null,
      message: this.message || descriptorOf(this.code).message,
    };
    if (traceId) payload.traceId = traceId;
    if (this.details !== undefined) payload.details = this.details;
    return payload;
  }
}

/** 类型守卫 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** 任意异常归一化为 AppError */
export function toAppError(err: unknown): AppError {
  if (isAppError(err)) return err;
  if (err instanceof Error) {
    return new AppError(ErrCode.INTERNAL, err.message, { stack: err.stack });
  }
  return new AppError(ErrCode.INTERNAL, String(err));
}

/** 便捷构造器 */
export const err = {
  badRequest: (message?: string, details?: unknown) =>
    new AppError(ErrCode.BAD_REQUEST, message, details),
  unauthorized: (message?: string) => new AppError(ErrCode.UNAUTHORIZED, message),
  forbidden: (message?: string) => new AppError(ErrCode.FORBIDDEN, message),
  notFound: (message?: string) => new AppError(ErrCode.NOT_FOUND, message),
  conflictLock: (message?: string) => new AppError(ErrCode.CONFLICT_LOCK, message),
  stateIllegal: (message?: string, details?: unknown) =>
    new AppError(ErrCode.STATE_ILLEGAL, message, details),
  taskImmutable: (message?: string) => new AppError(ErrCode.TASK_IMMUTABLE, message),
  skillInUse: (message?: string, details?: unknown) => new AppError(ErrCode.SKILL_IN_USE, message, details),
  rejectReasonRequired: (message?: string) => new AppError(ErrCode.REJECT_REASON_REQUIRED, message),
  permissionUndeclared: (message?: string, details?: unknown) =>
    new AppError(ErrCode.PERMISSION_UNDECLARED, message, details),
  scopeDenied: (message?: string, details?: unknown) => new AppError(ErrCode.SCOPE_DENIED, message, details),
  trustPending: (message?: string, details?: unknown) => new AppError(ErrCode.TRUST_PENDING, message, details),
  signatureInvalid: (message?: string, details?: unknown) =>
    new AppError(ErrCode.SIGNATURE_INVALID, message, details),
  domainNotAllowed: (message?: string, details?: unknown) =>
    new AppError(ErrCode.DOMAIN_NOT_ALLOWED, message, details),
  timestampExpired: (message?: string) => new AppError(ErrCode.TIMESTAMP_EXPIRED, message),
  rateLimited: (message?: string, details?: unknown) => new AppError(ErrCode.RATE_LIMITED, message, details),
  budgetExceeded: (message?: string, details?: unknown) =>
    new AppError(ErrCode.BUDGET_EXCEEDED, message, details),
  auditUnavailable: (message?: string, details?: unknown) =>
    new AppError(ErrCode.AUDIT_UNAVAILABLE, message, details),
  sandboxUnavailable: (message?: string, details?: unknown) =>
    new AppError(ErrCode.SANDBOX_UNAVAILABLE, message, details),
  modelUnavailable: (message?: string, details?: unknown) =>
    new AppError(ErrCode.MODEL_UNAVAILABLE, message, details),
  conflict: (message?: string, details?: unknown) => new AppError(ErrCode.CONFLICT, message, details),
  delegationDepthExceeded: (message?: string, details?: unknown) =>
    new AppError(ErrCode.DELEGATION_DEPTH_EXCEEDED, message, details),
  internal: (message?: string, details?: unknown) => new AppError(ErrCode.INTERNAL, message, details),
};

/** 把 AppError 写入 reply（保持统一包装） */
export function replyWithError(reply: FastifyReply, error: AppError, traceIdOverride?: string): void {
  const traceId = traceIdOverride ?? trace.current();
  const headers: Record<string, string> = {};
  if (error.code === ErrCode.RATE_LIMITED) {
    const details = (error.details ?? {}) as { retryAfterSec?: number };
    headers['retry-after'] = String(details.retryAfterSec ?? 60);
  }
  void reply.status(error.http).headers(headers).send(error.toPayload(traceId));
}

/**
 * 注册全局错误处理器：
 *  - AppError → 按错误码表映射 HTTP 状态
 *  - 框架校验错误（Fastify/Zod 抛出）→ 1001 BAD_REQUEST
 *  - 其他 → 1023 INTERNAL
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
    replyWithError(
      reply,
      new AppError(ErrCode.NOT_FOUND, `路由不存在：${req.method} ${req.url}`),
    );
  });

  app.setErrorHandler((error, req: FastifyRequest, reply: FastifyReply) => {
    const traceId = trace.current();

    if (isAppError(error)) {
      replyWithError(reply, error, traceId);
      return;
    }

    // Fastify 内建校验 / 400 类错误
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      replyWithError(
        reply,
        new AppError(ErrCode.BAD_REQUEST, (error as Error).message, {
          validation: (error as { validation?: unknown }).validation,
        }),
        traceId,
      );
      return;
    }

    req.log.error({ err: error }, '未捕获的服务内部错误');
    const fallback = descriptorOf(ErrCode.INTERNAL);
    void reply.status(fallback.http).send({
      code: ErrCode.INTERNAL,
      data: null,
      message: fallback.message,
      traceId,
      details: { name: nameOf(ErrCode.INTERNAL), cause: (error as Error).message },
    } satisfies ApiError);
  });
}

export { ErrCode, httpStatusOf, nameOf };

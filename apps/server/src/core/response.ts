/**
 * 统一响应包装（§4.1 / §7.5）
 *
 *   成功：{ code: 0, data: T, message: 'ok' }
 *   失败：{ code: <错误码>, data: null, message: <提示>, traceId?, details? }
 *   分页：data 为 { items: T[], total, page, size }
 */

import {
  messageOf,
  type ApiError,
  type ApiResponse,
  type Paginated,
} from '@huanbuddy/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import { AppError, replyWithError } from './errors';
import { ErrCode } from '@huanbuddy/shared';
import { trace } from './trace';

export type { ApiError, ApiResponse, Paginated };

/** 演示默认身份（前端顶栏身份切换器通过 `x-actor-id` 头覆盖） */
export const DEFAULT_ACTOR_HEADER = 'x-actor-id';
export const DEFAULT_ACTOR = 'm-human-zhangwei';

/**
 * Zod 解析（路由层统一入口）：失败 → 1001 BAD_REQUEST，携带字段级 issues。
 */
export function parseBody<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(ErrCode.BAD_REQUEST, result.error.issues[0]?.message ?? '请求参数有误', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** 当前操作者：优先 `x-actor-id` 请求头，其次查询参数，最后默认身份 */
export function actorOf(req: FastifyRequest, fallback: string = DEFAULT_ACTOR): string {
  const header = req.headers[DEFAULT_ACTOR_HEADER];
  if (typeof header === 'string' && header.trim() !== '') return header.trim();
  const query = req.query as Record<string, unknown> | undefined;
  const fromQuery = query?.['actorId'];
  if (typeof fromQuery === 'string' && fromQuery.trim() !== '') return fromQuery.trim();
  return fallback;
}

/** 解析正整数查询参数 */
export function intQuery(raw: unknown, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export class ResponseKit {
  /** 成功响应体 */
  ok<T>(data: T): ApiResponse<T> {
    return { code: 0, data, message: 'ok' };
  }

  /** 失败响应体 */
  fail(code: number, message?: string, details?: unknown, traceId?: string): ApiError {
    const payload: ApiError = {
      code,
      data: null,
      message: message ?? messageOf(code),
    };
    const tid = traceId ?? trace.current();
    if (tid && tid !== 'tr-nocontext') payload.traceId = tid;
    if (details !== undefined) payload.details = details;
    return payload;
  }

  /** 分页包装 */
  paginate<T>(items: T[], total: number, page: number, size: number): Paginated<T> {
    return { items, total, page, size };
  }

  /** 直接向 reply 发送成功（HTTP 200） */
  send<T>(reply: FastifyReply, data: T, status = 200): FastifyReply {
    return reply.status(status).send(this.ok(data));
  }

  /** 直接向 reply 发送业务异常 */
  sendError(reply: FastifyReply, error: AppError | number, message?: string, details?: unknown): FastifyReply {
    if (error instanceof AppError) {
      replyWithError(reply, error);
      return reply;
    }
    replyWithError(reply, new AppError(error, message, details));
    return reply;
  }
}

/** 全局单例（路由层直接调用） */
export const response = new ResponseKit();

/** 快捷函数（保持与设计文档一致的命名） */
export const ok = <T>(data: T): ApiResponse<T> => response.ok(data);
export const fail = (code: number, message?: string, details?: unknown): ApiError =>
  response.fail(code, message, details);
export const paginated = <T>(items: T[], total: number, page: number, size: number): Paginated<T> =>
  response.paginate(items, total, page, size);

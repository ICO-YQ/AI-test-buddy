/**
 * 统一 HTTP 客户端。
 * - 自动解包后端统一响应 `{ code, data, message }`（§7.5）
 * - 业务错误码 → ApiError（含中文提示）
 * - 网络 / 非 JSON 响应 → ApiError(NETWORK)
 * - **身份透传**：所有请求携带 `x-actor-id`，取值来自 ui.store.currentUserId
 *   （后端以此做权限判定与审计「双主体留痕」的发起人列，缺省 m-human-zhangwei）
 */
import { ApiError, ERR_CODES, messageForCode, type ApiErrorBody, type ApiResponse } from '@/lib/shared';
import { useUiStore } from '@/store/ui.store';

const BASE = '/api';

/** 当前操作者 id（供请求头与 body 中的 ownerId/creatorId 共用，保证两者一致） */
export function getActorId(): string {
  return useUiStore.getState().currentUserId;
}

export interface RequestOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  if (!params) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.append(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, opts.params);

  const headers: Record<string, string> = {
    // 身份头：后端用它做权限判定 + 审计双主体留痕（必须每次都带）
    'x-actor-id': getActorId(),
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    // 网络层失败（后端未启动 / 代理不可达）
    throw new ApiError(ERR_CODES.NETWORK.code, ERR_CODES.NETWORK.cn, { details: String(err) });
  }

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  // 统一响应体判定
  if (payload && typeof payload === 'object' && 'code' in (payload as Record<string, unknown>)) {
    const env = payload as ApiResponse<T> | ApiErrorBody;
    if (env.code === 0) return (env as ApiResponse<T>).data;
    const body = env as ApiErrorBody;
    // 优先使用后端返回的 message（更具体，例如会点明违规 API「subprocess」），
    // 仅在其缺失/为空时回退到错误码表的中文提示。
    const backendMsg = typeof body.message === 'string' ? body.message.trim() : '';
    const message = backendMsg && backendMsg !== 'ok' ? backendMsg : messageForCode(body.code);
    throw new ApiError(body.code, message, {
      traceId: body.traceId,
      details: body.details,
      httpStatus: res.status,
    });
  }

  // 非统一响应（意外格式）
  if (!res.ok) {
    throw new ApiError(
      res.status >= 500 ? ERR_CODES.INTERNAL.code : ERR_CODES.BAD_REQUEST.code,
      messageForCode(res.status >= 500 ? ERR_CODES.INTERNAL.code : ERR_CODES.BAD_REQUEST.code),
      { httpStatus: res.status },
    );
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>, signal?: AbortSignal) =>
    request<T>('GET', path, { params, signal }),
  post: <T>(path: string, body?: unknown, params?: Record<string, unknown>) =>
    request<T>('POST', path, { body, params }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
};

/** 从任意 error 提取用户可读提示 */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return '未知错误';
}

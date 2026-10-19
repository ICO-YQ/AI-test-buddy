/**
 * TraceID 生成与上下文传播（AsyncLocalStorage）
 *
 * 每个请求一个 traceId；AI 执行、审计、用量记录共享同一 traceId 以支持全链路回放。
 *
 * 实现说明：本机内网源的 `@types/node@22.20.5` 镜像不完整（缺失 `async_hooks.d.ts`），
 * 因此这里通过 `createRequire` 加载模块并自行声明**最小必要类型**，
 * 运行期行为与官方 `AsyncLocalStorage` 完全一致，且不依赖该缺失的类型声明。
 */

import { createRequire } from 'node:module';

import { nanoid } from 'nanoid';

export interface TraceStore {
  traceId: string;
  startedAt: number;
  /**
   * 当前请求的操作者 id（来自 `x-actor-id` 头）。
   *
   * 与 traceId 同源同命：都是**请求级上下文**，通过 AsyncLocalStorage 传递，
   * 避免逐层透传（service 方法签名不必都带 actor 参数）。
   * `AuditService.write()` 在调用方未显式给 actorId 时从这里兜底取，
   * 保证任何代码路径写出的审计都带得上双主体归属。
   */
  actorId?: string;
}

/** AsyncLocalStorage 最小类型（仅用到 getStore / run） */
interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R;
}

interface AsyncHooksModule {
  AsyncLocalStorage: new <T>() => AsyncLocalStorageLike<T>;
}

const require = createRequire(import.meta.url);
const { AsyncLocalStorage } = require('node:async_hooks') as AsyncHooksModule;

const storage = new AsyncLocalStorage<TraceStore>();

export const TRACE_HEADER = 'x-trace-id';

/** 生成新的 TraceID（形如 tr-V1StGXR8_Z） */
export function newTraceId(): string {
  return `tr-${nanoid(10)}`;
}

export class TraceContext {
  /** 当前上下文 traceId（无上下文时返回 `tr-nocontext`） */
  current(): string {
    return storage.getStore()?.traceId ?? 'tr-nocontext';
  }

  /** 当前上下文（含开始时间） */
  store(): TraceStore | undefined {
    return storage.getStore();
  }

  /** 在当前 traceId 上下文中同步执行（继承已有上下文中的 actorId） */
  run<T>(traceId: string, fn: () => T): T {
    const existing = storage.getStore();
    return storage.run(
      { traceId, startedAt: existing?.startedAt ?? Date.now(), actorId: existing?.actorId },
      fn,
    );
  }

  /** 在当前 traceId 上下文中异步执行（继承已有上下文中的 actorId） */
  runAsync<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
    const existing = storage.getStore();
    return storage.run(
      { traceId, startedAt: existing?.startedAt ?? Date.now(), actorId: existing?.actorId },
      fn,
    );
  }

  /** 在当前上下文中登记操作者（onRequest 阶段调用一次即可） */
  setActor(actorId: string): void {
    const store = storage.getStore();
    if (store) store.actorId = actorId;
  }

  /** 当前上下文的操作者 id（无上下文时为 undefined） */
  currentActor(): string | undefined {
    const actorId = storage.getStore()?.actorId;
    return actorId && actorId.trim() !== '' ? actorId : undefined;
  }

  /** 从请求头读取 traceId，缺失则新建 */
  fromHeader(header: unknown): string {
    if (typeof header === 'string' && header.trim().length > 0) return header.trim();
    return newTraceId();
  }
}

/** 全局单例（服务层与路由层共用） */
export const trace = new TraceContext();

export const TraceService = trace;

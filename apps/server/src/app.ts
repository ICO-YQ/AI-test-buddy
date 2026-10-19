/**
 * Fastify 应用装配（§2 / §1.3）
 *
 * 分层：routes（HTTP 层，仅参数解析与响应包装）→ services（业务编排）
 *       → core（权限/审计/状态机/响应等横切能力）→ db（数据访问）
 *
 * 本文件负责：日志、CORS、TraceID 上下文、统一错误处理、路由注册、健康检查。
 */

import cors from '@fastify/cors';
import { ErrCode } from '@huanbuddy/shared';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { createRequire } from 'node:module';

import { AppError, registerErrorHandler } from './core/errors';
import { actorOf, response } from './core/response';
import { TRACE_HEADER, newTraceId, trace } from './core/trace';
import { getDb } from './db/client';
import { registerRoutes } from './routes/index';

export const SERVER_VERSION = '1.0.0';

export interface BuildAppOptions {
  /** 是否打印请求日志（测试时传 false） */
  logger?: boolean;
}

/** 从 request 上取出 traceId（由 hook 注入） */
export function traceIdOf(req: FastifyRequest): string {
  const stored = (req as FastifyRequest & { traceId?: string }).traceId;
  return stored ?? trace.current();
}

/** 读取环境变量开关（1/true/yes 视为开） */
function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * 探测 pino-pretty 是否**真正可加载**（不是只看目录是否存在）。
 *
 * 背景：本机内网 npm 镜像存在「包目录在、内容缺失」的情况，已知三例：
 *   - `@types/node@22.20.5` 缺 `async_hooks.d.ts`
 *   - `@vitest/runner@2.1.9` 缺 `dist/chunk-tasks.js`
 *   - `fast-copy@4.1.2` 缺 `dist/cjs/index.cjs` 与 `dist/es/index.mjs`
 * pino-pretty 依赖 fast-copy，一旦其入口解析失败，pino 的 transport **worker 线程**
 * 会抛出未捕获异常并**直接终止进程**——这个错误发生在子线程，既不会被 try/catch 捕获，
 * 也不会自动回退到 JSON 日志。因此必须在创建 Fastify 实例之前，在主线程主动探测。
 *
 * 实测：`require('pino-pretty')` 在主线程即会因 fast-copy 入口缺失而抛错，
 * 所以这个探测是可靠的。
 */
function canLoadPretty(): boolean {
  try {
    const req = createRequire(import.meta.url);
    req(req.resolve('pino-pretty'));
    return true;
  } catch {
    return false;
  }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const loggerEnabled = options.logger ?? envFlag('LOG_REQUESTS', true);

  // 美化日志默认**关闭**：pino-pretty 在镜像不完整时会直接让进程崩溃，
  // 不能让它成为开箱即用的默认路径。需要时显式设 LOG_PRETTY=1。
  const wantPretty = envFlag('LOG_PRETTY', false);
  const usePretty = loggerEnabled && wantPretty && canLoadPretty();
  if (loggerEnabled && wantPretty && !usePretty) {
    process.emitWarning(
      'LOG_PRETTY=1 但 pino-pretty 无法加载（依赖包内容不完整），已回退为 JSON 日志。' +
        '排查：node -e "require(\'pino-pretty\')"',
    );
  }

  const app = Fastify({
    logger: loggerEnabled
      ? {
          level: process.env.LOG_LEVEL ?? 'info',
          transport: usePretty
            ? {
                target: 'pino-pretty',
                options: { translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
              }
            : undefined,
        }
      : false,
    // TraceID 作为请求 id，贯穿日志
    genReqId: () => newTraceId(),
  });

  // ── CORS：前后端分端口开发必需 ──
  await app.register(cors, {
    origin: true,
    credentials: false,
    exposedHeaders: [TRACE_HEADER, 'retry-after'],
  });

  // ── TraceID 上下文：onRequest 建立，preHandler 再次确保（handler 内可用 trace.current()） ──
  app.addHook('onRequest', (req, reply, done) => {
    const traceId = trace.fromHeader(req.headers[TRACE_HEADER]);
    (req as FastifyRequest & { traceId?: string }).traceId = traceId;
    reply.header(TRACE_HEADER, traceId);
    // 在同一上下文中登记操作者：后续所有 service / audit 都能通过 trace.currentActor() 取到，
    // 无需逐层透传 actor 参数（audit.write 会在调用方未显式给 actorId 时自动兜底）。
    trace.run(traceId, () => {
      trace.setActor(actorOf(req));
      done();
    });
  });

  app.addHook('preHandler', (req, _reply, done) => {
    trace.run(traceIdOf(req), done);
  });

  // ── 统一错误处理 ──
  registerErrorHandler(app);

  // ── 保留原始请求体：/v1 签名验签需要 HMAC 覆盖 body 的 sha256 ──
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const text = typeof body === 'string' ? body : '';
    (req as FastifyRequest & { rawBody?: string }).rawBody = text;
    if (text.trim() === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      // 畸形 JSON 属于**客户端错误**，必须映射为 400。
      // 若把原始 SyntaxError 交给 done()，Fastify 找不到 statusCode 会按 500 处理 ——
      // 调用方会以为服务端故障，而实际是自己发错了 body。
      done(
        new AppError(ErrCode.BAD_REQUEST, '请求体不是合法 JSON', {
          cause: (error as Error).message.slice(0, 120),
          receivedPreview: text.slice(0, 80),
        }),
        undefined,
      );
    }
  });

  // ── 健康检查（GET /health → 200） ──
  app.get('/health', () => {
    const db = getDb();
    return response.ok({
      status: 'ok',
      version: SERVER_VERSION,
      uptimeSec: Math.round(process.uptime()),
      driver: db.driver,
      dbFile: db.file,
      time: new Date().toISOString(),
    });
  });

  // ── 业务路由（/api 内部接口 + /v1 对外能力） ──
  await registerRoutes(app);

  return app;
}

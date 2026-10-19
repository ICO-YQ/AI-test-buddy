/**
 * 对外能力路由 `/v1/*`（§4.8，FR-API-01~10）
 *
 * 每个写操作强制：
 *   1) Key 鉴权（`x-api-key`，仅比对 sha256 哈希）
 *   2) 幂等键（`x-idempotency-key`，重复请求返回首次结果）
 *   3) 签名 + 时间戳窗口 5 分钟（`x-signature` / `x-timestamp`）
 *   4) 三级限流（Key / 租户 / 模型）→ 429 + Retry-After
 *   5) 出网域名白名单校验（如请求携带目标域名）
 */

import {
  DEFAULT_WORKSPACE_ID,
  ErrCode,
  MetricEvent,
  SIGNATURE_WINDOW_MS,
  type ApiKeyRecord,
  type AuditResult,
  type V1AgentInvokeReq,
  type V1KnowledgeQueryReq,
  type V1SkillExecuteReq,
  type V1WorkflowRunReq,
} from '@huanbuddy/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { parseBody, response } from '../core/response';
import { trace } from '../core/trace';
import { apiKeyService } from '../services/apikey.service';
import { auditService } from '../services/audit.service';
import { chatService } from '../services/chat.service';
import { kbService } from '../services/kb.service';
import { skillService } from '../services/skill.service';
import { taskService } from '../services/task.service';

const OPENAPI_PREFIX = '/v1';

/** 请求上下文中携带的原始体（由 app.ts 的 content type parser 注入） */
export interface RawBodyRequest extends FastifyRequest {
  rawBody?: string;
}

const skillExecuteSchema = z.object({
  versionId: z.string().min(1),
  input: z.record(z.unknown()).default({}),
});

const agentInvokeSchema = z.object({
  message: z.string().min(1).max(20000),
  sessionId: z.string().optional(),
  stream: z.boolean().optional(),
});

const workflowRunSchema = z.object({
  mode: z.enum(['sync', 'async']),
  callbackUrl: z.string().optional(),
  input: z.record(z.unknown()).optional(),
});

const kbQuerySchema = z.object({
  query: z.string().min(1).max(2000),
  scope: z.string().optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

interface GuardResult {
  key: ApiKeyRecord;
  idempotencyKey: string;
}

/**
 * 统一守卫：鉴权 → 时间戳 → 签名 → 幂等 → 限流。
 */
function guard(
  req: FastifyRequest,
  scope: string,
  modelId?: string,
): GuardResult {
  const headers = req.headers;
  const plaintextKey = headers['x-api-key'];
  const timestamp = headers['x-timestamp'];
  const signature = headers['x-signature'];
  const idempotencyKey = headers['x-idempotency-key'];

  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw new AppError(ErrCode.BAD_REQUEST, '缺少 x-idempotency-key（写操作必须幂等）');
  }

  const rawBody = (req as RawBodyRequest).rawBody ?? '';
  const record = apiKeyService.verifySignature({
    plaintextKey: typeof plaintextKey === 'string' ? plaintextKey : undefined,
    method: req.method,
    path: req.url.split('?')[0] ?? req.url,
    timestamp: typeof timestamp === 'string' ? timestamp : undefined,
    signature: typeof signature === 'string' ? signature : undefined,
    rawBody,
  });

  apiKeyService.requireScope(record, scope);
  apiKeyService.checkRateLimit({
    keyId: record.id,
    tenantId: record.workspaceId,
    modelId,
    keyLimit: record.rateLimitPerMin,
  });

  return { key: record, idempotencyKey: idempotencyKey.trim() };
}

/** 幂等包装：命中已存在键则原样返回首次结果 */
function withIdempotency(
  idempotencyKey: string,
  reply: FastifyReply,
  execute: () => { statusCode: number; body: unknown },
): unknown {
  const existing = apiKeyService.idempotencyGet(idempotencyKey);
  if (existing) {
    return reply
      .status(existing.statusCode)
      .header('x-idempotent-replay', 'true')
      .send(existing.body);
  }
  const result = execute();
  apiKeyService.idempotencySet(idempotencyKey, result.statusCode, result.body);
  return reply.status(result.statusCode).send(result.body);
}

/**
 * 对外调用审计（`openapi_invoked`）。
 *
 * 为什么单独写：`openapi_invoked` 属于 `AUDIT_CRITICAL_ACTIONS`，
 * 但 4 个 `/v1` 端点原先只发了 metrics、没写审计 —— 结果是「谁、用哪个 Key、
 * 调了什么」在审计里无迹可循，只在指标里留一个计数。对外调用恰恰是最需要留痕的入口。
 *
 * 双主体语义（§7.1）：
 *   actor     = API Key 的 owner（「谁的能力被使用」）
 *   initiator = 调用方标识（Key id / Key 名），因为对外调用没有人在界面上操作
 */
function auditOpenApiInvoked(
  key: ApiKeyRecord,
  path: string,
  detail: Record<string, unknown> = {},
  result: AuditResult = 'success',
): void {
  auditService.write({
    action: 'openapi_invoked',
    actorId: key.ownerId,
    actorType: 'human',
    initiatorId: key.id,
    initiatorName: key.name,
    resourceType: 'apikey',
    resourceId: key.id,
    resourceName: key.name,
    durationMs: null,
    result,
    detail: { path, apiKeyId: key.id, ...detail },
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
}

export function registerOpenApiRoutes(app: FastifyInstance): void {
  /* ── /v1/skills/:id/execute ── */
  app.post('/v1/skills/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(skillExecuteSchema, req.body) as V1SkillExecuteReq;
    const { key, idempotencyKey } = guard(req, 'skill:execute');

    return withIdempotency(idempotencyKey, reply, () => {
      const result = skillService.execute(id, body, key.ownerId, key.ownerId);
      metrics.emit(MetricEvent.OPENAPI_INVOKED, {
        path: `${OPENAPI_PREFIX}/skills/${id}/execute`,
        apiKeyId: key.id,
      });
      auditOpenApiInvoked(key, `${OPENAPI_PREFIX}/skills/${id}/execute`, {
        skillId: id,
        versionId: body.versionId,
      });
      return { statusCode: 200, body: response.ok({ ...result, idempotencyKey }) };
    });
  });

  /* ── /v1/agents/:id/invoke（支持 stream 标记） ── */
  app.post('/v1/agents/:id/invoke', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(agentInvokeSchema, req.body) as V1AgentInvokeReq;
    const { key, idempotencyKey } = guard(req, 'agent:invoke');

    return withIdempotency(idempotencyKey, reply, () => {
      const agent = apiKeyService;
      void agent;

      // 复用 ChatService：为本次调用创建/复用会话
      let sessionId = body.sessionId;
      if (!sessionId) {
        const session = chatService.createSession({
          title: `[对外调用] ${body.message.slice(0, 40)}`,
          ownerId: key.ownerId,
          agentId: id,
        });
        sessionId = session.id;
      }

      const result = chatService.sendMessage(sessionId, { content: body.message }, key.ownerId);

      metrics.emit(MetricEvent.OPENAPI_INVOKED, {
        path: `${OPENAPI_PREFIX}/agents/${id}/invoke`,
        apiKeyId: key.id,
      });
      auditOpenApiInvoked(key, `${OPENAPI_PREFIX}/agents/${id}/invoke`, {
        agentId: id,
        sessionId,
        stream: Boolean(body.stream),
      });

      return {
        statusCode: 200,
        body: response.ok({
          sessionId,
          agentId: id,
          stream: Boolean(body.stream),
          reply: result.assistantMessage,
          traceId: trace.current(),
          idempotencyKey,
        }),
      };
    });
  });

  /* ── /v1/workflows/:id/run（本期为轻量编排：把 input 转为任务并触发 AI 执行） ── */
  app.post('/v1/workflows/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(workflowRunSchema, req.body) as V1WorkflowRunReq;
    const { key, idempotencyKey } = guard(req, 'workflow:run');

    return withIdempotency(idempotencyKey, reply, () => {
      const runId = `run-${nanoid(10)}`;
      const input = body.input ?? {};
      const title = typeof input['title'] === 'string' ? String(input['title']) : `[工作流 ${id}] 自动任务`;
      const assigneeId = typeof input['assigneeId'] === 'string' ? String(input['assigneeId']) : undefined;

      const task = taskService.create(
        {
          title,
          description: `由对外工作流 ${id} 触发（runId=${runId}）`,
          priority: 'p2',
          tags: ['workflow', `wf:${id}`],
          assigneeId,
        },
        key.ownerId,
      );

      metrics.emit(MetricEvent.OPENAPI_INVOKED, {
        path: `${OPENAPI_PREFIX}/workflows/${id}/run`,
        apiKeyId: key.id,
        mode: body.mode,
      });
      auditOpenApiInvoked(key, `${OPENAPI_PREFIX}/workflows/${id}/run`, {
        workflowId: id,
        runId,
        mode: body.mode,
        taskId: task?.id ?? null,
      });

      const status = body.mode === 'async' ? 'accepted' : task.status === 'done' ? 'succeeded' : 'accepted';

      return {
        statusCode: body.mode === 'async' ? 202 : 200,
        body: response.ok({
          runId,
          mode: body.mode,
          status,
          task,
          callbackUrl: body.callbackUrl ?? null,
          idempotencyKey,
        }),
      };
    });
  });

  /* ── /v1/knowledge/query ── */
  app.post('/v1/knowledge/query', async (req, reply) => {
    const body = parseBody(kbQuerySchema, req.body) as V1KnowledgeQueryReq;
    const { key, idempotencyKey } = guard(req, 'kb:query');

    return withIdempotency(idempotencyKey, reply, () => {
      const result = kbService.query({
        query: body.query,
        scope: body.scope ?? 'all',
        topK: body.topK,
        askerId: key.ownerId,
      });

      metrics.emit(MetricEvent.OPENAPI_INVOKED, {
        path: `${OPENAPI_PREFIX}/knowledge/query`,
        apiKeyId: key.id,
      });
      auditOpenApiInvoked(key, `${OPENAPI_PREFIX}/knowledge/query`, {
        queryId: result.queryId,
        citationCount: result.citations?.length ?? 0,
        insufficient: result.insufficient,
      });

      return {
        statusCode: 200,
        body: response.ok({
          queryId: result.queryId,
          answer: result.answer,
          insufficient: result.insufficient,
          citations: result.citations,
          traceId: result.traceId,
          idempotencyKey,
        }),
      };
    });
  });

  /* ── /v1/me：Key 自检（鉴权 + 能力清单 + 限流窗口） ── */
  app.get('/v1/me', async (req) => {
    const plaintextKey = req.headers['x-api-key'];
    const record = apiKeyService.findByPlaintext(
      typeof plaintextKey === 'string' ? plaintextKey : '',
    );
    if (!record) throw new AppError(ErrCode.UNAUTHORIZED, 'API Key 无效');
    return response.ok({
      keyId: record.id,
      name: record.name,
      workspaceId: record.workspaceId,
      scopes: record.scopes,
      rateLimitPerMin: record.rateLimitPerMin,
      capabilities: apiKeyService.capabilities(record),
      status: record.status,
      signatureWindowMs: SIGNATURE_WINDOW_MS,
    });
  });

  /* ── /v1/domains/check：出网域名白名单自检 ── */
  app.post('/v1/domains/check', async (req, reply) => {
    const plaintextKey = req.headers['x-api-key'];
    const record = apiKeyService.findByPlaintext(typeof plaintextKey === 'string' ? plaintextKey : '');
    if (!record) throw new AppError(ErrCode.UNAUTHORIZED, 'API Key 无效');

    const body = req.body as { domain?: string } | undefined;
    const domain = body?.domain ?? '';
    apiKeyService.assertDomainAllowed(domain);
    return response.send(reply, { domain, allowed: true });
  });
}

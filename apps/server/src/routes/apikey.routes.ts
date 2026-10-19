/**
 * API Key 路由（§4.8，FR-API-01~10）
 *
 * 安全约定：`plaintext` 仅在签发响应中出现一次；查询接口永不返回 key_hash。
 */

import type { CreateKeyReq } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, parseBody, response } from '../core/response';
import { apiKeyService } from '../services/apikey.service';

const createKeySchema = z.object({
  workspaceId: z.string().optional(),
  name: z.string().min(1).max(64),
  scopes: z.array(z.string()).optional(),
  rateLimitPerMin: z.number().int().min(1).max(10_000).optional(),
  ownerId: z.string().optional(),
});

export function registerApiKeyRoutes(app: FastifyInstance): void {
  app.get('/api/apikeys', async (req) => {
    const query = req.query as { workspaceId?: string };
    return response.ok(apiKeyService.list(query.workspaceId));
  });

  app.post('/api/apikeys', async (req, reply) => {
    const raw = parseBody(createKeySchema, req.body) as Partial<CreateKeyReq>;
    const body: CreateKeyReq = {
      workspaceId: raw.workspaceId ?? 'ws-huan-0001',
      name: raw.name as string,
      scopes: raw.scopes,
      rateLimitPerMin: raw.rateLimitPerMin,
      ownerId: raw.ownerId ?? actorOf(req),
    };
    return response.send(reply, apiKeyService.issue(body), 201);
  });

  app.post('/api/apikeys/:id/revoke', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(apiKeyService.revoke(id, actorOf(req)));
  });

  /** 可调用能力清单（API 页面） */
  app.get('/api/apikeys/:id/capabilities', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(apiKeyService.capabilitiesOf(id));
  });

  /** 当前窗口限流用量（API 页面安全约束） */
  app.get('/api/apikeys/:id/rate-limit', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(apiKeyService.rateLimitSnapshot(id));
  });

  /** 出网域名白名单（前端展示安全约束） */
  app.get('/api/apikeys/domain-allowlist', async () => {
    const { DOMAIN_ALLOWLIST } = await import('@huanbuddy/shared');
    return response.ok(DOMAIN_ALLOWLIST);
  });
}

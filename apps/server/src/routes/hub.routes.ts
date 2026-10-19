/**
 * Hub 路由（§4.6，FR-HB-01~10）
 */

import type { CreateRepoReq, UpdateRepoReq } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, parseBody, response } from '../core/response';
import { hubService } from '../services/hub.service';

const createRepoSchema = z.object({
  name: z.string().min(1).max(64),
  url: z.string().min(1),
  type: z.enum(['git', 'http', 'registry']),
  authType: z.enum(['token', 'oauth', 'none']).optional(),
  trustLevel: z.enum(['official', 'org', 'community']),
  signatureRequired: z.boolean().optional(),
  fallbackPolicy: z.enum(['cache', 'block', 'notify']).optional(),
});

const updateRepoSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  url: z.string().min(1).optional(),
  trustLevel: z.enum(['official', 'org', 'community']).optional(),
  signatureRequired: z.boolean().optional(),
  status: z.enum(['active', 'disabled']).optional(),
  fallbackPolicy: z.enum(['cache', 'block', 'notify']).optional(),
});

export function registerHubRoutes(app: FastifyInstance): void {
  /* ── 仓库 ── */

  app.get('/api/hub/repos', async () => response.ok(hubService.listRepos()));

  app.post('/api/hub/repos', async (req, reply) => {
    const body = parseBody(createRepoSchema, req.body) as CreateRepoReq;
    return response.send(reply, hubService.registerRepo(body, actorOf(req)), 201);
  });

  app.patch('/api/hub/repos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateRepoSchema, req.body) as UpdateRepoReq;
    return response.ok(hubService.updateRepo(id, body, actorOf(req)));
  });

  app.delete('/api/hub/repos/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(hubService.removeRepo(id, actorOf(req)));
  });

  app.post('/api/hub/repos/:id/sync', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(hubService.sync(id, actorOf(req)));
  });

  /* ── 技能索引（静态段 /api/hub/skills 与参数段无冲突） ── */

  app.get('/api/hub/skills', async (req) => {
    const query = req.query as { repoId?: string; q?: string; trust?: string };
    return response.ok(hubService.listSkills(query));
  });

  app.get('/api/hub/skills/:id/checklist', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(hubService.securityChecklist(id));
  });

  app.post('/api/hub/skills/:id/load', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(hubService.load(id, actorOf(req)));
  });

  app.post('/api/hub/skills/:id/disable', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(hubService.disable(id));
  });
}

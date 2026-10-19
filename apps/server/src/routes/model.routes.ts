/**
 * 模型路由（§4.8，FR-GOV-06~09）
 *
 * 注意：静态段 `/api/models/routes`、`/api/models/degradations` 必须在 `/api/models/:id` 之前注册。
 */

import type { CreateModelReq, SceneRoute, UpdateModelReq } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { parseBody, response } from '../core/response';
import { modelService } from '../services/model.service';

const modelPriorityEnum = z.enum(['primary', 'backup', 'p1', 'p2', 'disabled']);
const modelHealthEnum = z.enum(['healthy', 'overloaded', 'unavailable']);

const createModelSchema = z.object({
  name: z.string().min(1).max(128),
  vendor: z.string().min(1).max(64),
  contextWindow: z.number().int().min(1024).max(2_000_000),
  purpose: z.string().max(128).optional(),
  priority: modelPriorityEnum.optional(),
  health: modelHealthEnum.optional(),
  baseUrl: z.string().optional(),
  apiKeyRef: z.string().optional(),
  inputPrice: z.number().min(0).optional(),
  outputPrice: z.number().min(0).optional(),
  enabled: z.boolean().optional(),
});

const updateModelSchema = createModelSchema.partial();

const sceneRouteSchema = z.object({
  id: z.string().optional(),
  scene: z.enum(['reasoning', 'daily', 'batch', 'sensitive']),
  label: z.string().min(1).max(64),
  primaryModelId: z.string().min(1),
  fallbackModelId: z.string().optional(),
});

const setRoutesSchema = z.object({ routes: z.array(sceneRouteSchema).min(1) });

const degradationSchema = z.object({
  event: z.string().min(1),
  action: z.string().min(1),
  fromModelId: z.string().optional(),
  toModelId: z.string().optional(),
  traceId: z.string().optional(),
});

export function registerModelRoutes(app: FastifyInstance): void {
  /* ── 静态段优先 ── */

  app.get('/api/models/routes', async () => response.ok(modelService.routes()));

  app.put('/api/models/routes', async (req) => {
    const body = parseBody(setRoutesSchema, req.body) as { routes: SceneRoute[] };
    return response.ok(modelService.setRoutes(body.routes));
  });

  app.get('/api/models/degradations', async (req) => {
    const query = req.query as { limit?: string };
    return response.ok(modelService.degradations(query.limit ? Number(query.limit) : 50));
  });

  app.post('/api/models/degradations', async (req, reply) => {
    const body = parseBody(degradationSchema, req.body) as {
      event: string;
      action: string;
      fromModelId?: string;
      toModelId?: string;
      traceId?: string;
    };
    return response.send(reply, modelService.recordDegradation(body), 201);
  });

  app.get('/api/models/availability', async () => response.ok(modelService.availability()));

  app.get('/api/models/usage/monthly', async () => response.ok(modelService.monthlyUsage()));

  /* ── 模型 CRUD ── */

  app.get('/api/models', async () => response.ok(modelService.listModels()));

  app.post('/api/models', async (req, reply) => {
    const body = parseBody(createModelSchema, req.body) as CreateModelReq;
    return response.send(reply, modelService.createModel(body), 201);
  });

  app.patch('/api/models/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateModelSchema, req.body) as UpdateModelReq;
    return response.ok(modelService.updateModel(id, body));
  });

  app.get('/api/models/:id/references', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(modelService.referencedBy(id));
  });
}

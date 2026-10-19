/**
 * 技能路由（§4.5，FR-SK-01~08）
 */

import type {
  CreateSkillReq,
  CreateSkillVersionReq,
  ExecuteSkillReq,
  RollbackSkillReq,
  UpdateSkillReq,
} from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, parseBody, response } from '../core/response';
import { skillService } from '../services/skill.service';

const capabilityEnum = z.enum(['fs_read', 'fs_write', 'net', 'api', 'kb_read', 'task_read']);

const permissionSchema = z.object({
  capability: capabilityEnum,
  granted: z.boolean(),
  detail: z.string().max(500).optional(),
});

const createSkillSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug 仅允许小写字母、数字与连字符'),
  name: z.string().min(1).max(64),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  tags: z.array(z.string()).optional(),
  createdBy: z.string().min(1),
  trustLevel: z.enum(['official', 'org', 'community']).optional(),
  source: z.enum(['local', 'hub']).optional(),
  hubSkillId: z.string().optional(),
});

const updateSkillSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'in_review', 'published', 'offline']).optional(),
  enabled: z.boolean().optional(),
});

const createVersionSchema = z.object({
  version: z.string().regex(/^v?\d+\.\d+\.\d+$/, '版本号须形如 v1.2.0'),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
  prompt: z.string().max(20000).optional(),
  script: z.string().max(200000).optional(),
  scriptLang: z.enum(['python', 'nodejs']).optional(),
  permissions: z.array(permissionSchema).optional(),
  changeNote: z.string().max(2000).optional(),
  createdBy: z.string().min(1),
});

const validateSchema = z.object({ versionId: z.string().min(1) });

const rollbackSchema = z.object({
  toVersion: z.string().min(1),
  reason: z.string().min(1, '回滚必须说明原因').max(2000),
});

const executeSchema = z.object({
  versionId: z.string().min(1),
  input: z.record(z.unknown()).default({}),
});

export function registerSkillRoutes(app: FastifyInstance): void {
  app.get('/api/skills', async (req) => {
    const query = req.query as { status?: string; source?: string; q?: string };
    return response.ok(skillService.list(query));
  });

  app.post('/api/skills', async (req, reply) => {
    const body = parseBody(createSkillSchema, req.body) as CreateSkillReq;
    return response.send(reply, skillService.create(body), 201);
  });

  app.get('/api/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(skillService.get(id));
  });

  app.patch('/api/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateSkillSchema, req.body) as UpdateSkillReq;
    return response.ok(skillService.update(id, body));
  });

  app.delete('/api/skills/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(skillService.remove(id));
  });

  app.get('/api/skills/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(skillService.versions(id));
  });

  app.post('/api/skills/:id/versions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(createVersionSchema, req.body) as CreateSkillVersionReq;
    return response.send(reply, skillService.createVersion(id, body), 201);
  });

  app.post('/api/skills/:id/validate', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(validateSchema, req.body) as { versionId: string };
    return response.ok(skillService.validate(id, body.versionId));
  });

  app.post('/api/skills/:id/versions/:ver/publish', async (req) => {
    const { id, ver } = req.params as { id: string; ver: string };
    return response.ok(skillService.publish(id, ver));
  });

  app.post('/api/skills/:id/versions/:ver/offline', async (req) => {
    const { id, ver } = req.params as { id: string; ver: string };
    return response.ok(skillService.offline(id, ver));
  });

  app.get('/api/skills/:id/versions/:ver/impact', async (req) => {
    const { id, ver } = req.params as { id: string; ver: string };
    return response.ok(skillService.impact(id, ver));
  });

  app.post('/api/skills/:id/rollback', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(rollbackSchema, req.body) as RollbackSkillReq;
    return response.ok(skillService.rollback(id, body));
  });

  app.post('/api/skills/:id/execute', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(executeSchema, req.body) as ExecuteSkillReq;
    const actor = actorOf(req);
    return response.ok(skillService.execute(id, body, actor, actor));
  });
}

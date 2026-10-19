/**
 * 成员路由（§4.3，FR-AG-01~06 / FR-GOV-01）
 */

import type { CreateMemberReq, MemberType, UpdateMemberReq, AgentConfig } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { response, parseBody } from '../core/response';
import { memberService } from '../services/member.service';

const memberTypeEnum = z.enum(['human', 'ai']);
const memberRoleEnum = z.enum(['admin', 'space_admin', 'member', 'external']);

const agentConfigSchema = z.object({
  rolePrompt: z.string().max(8000).optional(),
  primaryModelId: z.string().optional(),
  fallbackModelIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  toolIds: z.array(z.string()).optional(),
  kbSpaceIds: z.array(z.string()).optional(),
  declaredScope: z.array(z.string()).optional(),
  contextBudget: z.number().int().min(512).max(1_000_000).optional(),
  contextPriority: z.array(z.string()).optional(),
  quotaMonthly: z.number().min(0).optional(),
  quotaUsed: z.number().min(0).optional(),
  version: z.string().optional(),
  grayRatio: z.number().int().min(0).max(100).optional(),
});

const createMemberSchema = z.object({
  type: memberTypeEnum,
  name: z.string().min(1, '成员名称不能为空').max(64),
  handle: z.string().max(64).optional(),
  avatarText: z.string().max(4).optional(),
  avatarColor: z.string().max(64).optional(),
  role: memberRoleEnum.optional(),
  capabilityTags: z.array(z.string()).optional(),
  dataScope: z.array(z.string()).optional(),
  creatorId: z.string().optional(),
  agentConfig: agentConfigSchema.optional(),
});

const updateMemberSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  handle: z.string().max(64).optional(),
  avatarText: z.string().max(4).optional(),
  avatarColor: z.string().max(64).optional(),
  role: memberRoleEnum.optional(),
  capabilityTags: z.array(z.string()).optional(),
  dataScope: z.array(z.string()).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export function registerMemberRoutes(app: FastifyInstance): void {
  app.get('/api/members', async (req) => {
    const query = req.query as { type?: string };
    return response.ok(memberService.list(query.type as MemberType | undefined));
  });

  app.post('/api/members', async (req, reply) => {
    const body = parseBody(createMemberSchema, req.body) as CreateMemberReq;
    return response.send(reply, memberService.create(body), 201);
  });

  app.get('/api/members/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(memberService.getOrThrow(id));
  });

  app.patch('/api/members/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateMemberSchema, req.body) as UpdateMemberReq;
    return response.ok(memberService.update(id, body));
  });

  app.delete('/api/members/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(memberService.remove(id));
  });

  app.get('/api/members/:id/effective-permissions', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(memberService.effectivePermissions(id));
  });

  app.put('/api/members/:id/agent-config', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(agentConfigSchema, req.body) as Partial<AgentConfig>;
    return response.ok(memberService.updateAgentConfig(id, body));
  });

  /** 只读辅助：AI 成员配置原始视图（含配额使用情况） */
  app.get('/api/members/:id/agent-config', async (req) => {
    const { id } = req.params as { id: string };
    memberService.getOrThrow(id);
    return response.ok(memberService.configRaw(id) ?? null);
  });
}

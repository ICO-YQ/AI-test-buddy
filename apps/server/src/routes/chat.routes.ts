/**
 * 会话与消息路由（§4.4，FR-GOV-06）
 */

import type { CreateSessionReq } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, parseBody, response } from '../core/response';
import { chatService } from '../services/chat.service';

const createSessionSchema = z.object({
  title: z.string().min(1).max(200),
  ownerId: z.string().optional(),
  agentId: z.string().optional(),
  modelId: z.string().optional(),
  kbSpaceId: z.string().optional(),
  skillIds: z.array(z.string()).optional(),
  permScope: z.string().max(128).optional(),
  relatedTaskIds: z.array(z.string()).optional(),
});

const switchModelSchema = z.object({ modelId: z.string().min(1) });

const sendMessageSchema = z.object({
  content: z.string().min(1, '消息内容不能为空').max(20000),
  mentions: z.array(z.string()).optional(),
});

const editMessageSchema = z.object({ content: z.string().min(1).max(20000) });

export function registerChatRoutes(app: FastifyInstance): void {
  app.get('/api/sessions', async (req) => {
    const query = req.query as { workspaceId?: string };
    return response.ok(chatService.listSessions(query.workspaceId ?? 'ws-huan-0001'));
  });

  app.post('/api/sessions', async (req, reply) => {
    const raw = parseBody(createSessionSchema, req.body) as Partial<CreateSessionReq>;
    const body: CreateSessionReq = {
      title: raw.title as string,
      ownerId: raw.ownerId ?? actorOf(req),
      agentId: raw.agentId,
      modelId: raw.modelId,
      kbSpaceId: raw.kbSpaceId,
      skillIds: raw.skillIds,
      permScope: raw.permScope,
      relatedTaskIds: raw.relatedTaskIds,
    };
    return response.send(reply, chatService.createSession(body), 201);
  });

  app.get('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(chatService.getSession(id));
  });

  app.delete('/api/sessions/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(chatService.removeSession(id));
  });

  app.post('/api/sessions/:id/model', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(switchModelSchema, req.body) as { modelId: string };
    return response.ok(chatService.switchModel(id, body.modelId));
  });

  app.get('/api/sessions/:id/messages', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(chatService.messages(id));
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(sendMessageSchema, req.body) as { content: string; mentions?: string[] };
    return response.send(reply, chatService.sendMessage(id, body, actorOf(req)), 201);
  });

  app.patch('/api/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(editMessageSchema, req.body) as { content: string };
    return response.ok(chatService.editMessage(id, body.content));
  });

  app.delete('/api/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(chatService.deleteMessage(id));
  });
}

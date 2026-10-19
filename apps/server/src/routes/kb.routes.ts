/**
 * 知识库与文档路由（§4.7，FR-KB-01~09 / FR-KM-01~09）
 */

import type { CreateDocReq, CreateSourceReq, CreateSpaceReq, KbQueryReq, UpdateDocReq } from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, parseBody, response } from '../core/response';
import { kbService } from '../services/kb.service';

const createSpaceSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(1000).optional(),
  acl: z.array(z.string()).optional(),
});

const createDocSchema = z.object({
  spaceId: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().max(500000).optional(),
  format: z.enum(['markdown', 'richtext']).optional(),
  tags: z.array(z.string()).optional(),
  acl: z.array(z.string()).optional(),
});

const updateDocSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(500000).optional(),
  tags: z.array(z.string()).optional(),
  acl: z.array(z.string()).optional(),
  note: z.string().max(500).optional(),
  editedBy: z.string().optional(),
});

const rollbackDocSchema = z.object({ note: z.string().max(500).optional() });

const polishSchema = z.object({
  scope: z.enum(['selection', 'paragraph', 'full']),
  action: z.enum(['polish', 'expand', 'shorten', 'proofread', 'translate', 'rewrite', 'summarize']),
  selection: z.string().max(50000).optional(),
});

const createSourceSchema = z.object({
  spaceId: z.string().min(1),
  sourceType: z.enum(['confluence', 'notion', 'file', 'url']),
  target: z.string().min(1),
  intervalMin: z.number().int().min(1).max(1440).optional(),
  mirrorOnly: z.boolean().optional(),
  aclMap: z.record(z.string()).optional(),
});

const querySchema = z.object({
  query: z.string().min(1, '检索内容不能为空').max(2000),
  scope: z.string().default('all'),
  topK: z.number().int().min(1).max(20).optional(),
  askerId: z.string().optional(),
});

const feedbackSchema = z.object({
  queryId: z.string().min(1),
  feedback: z.enum(['adopt', 'reject', 'insufficient']),
  feedbackBy: z.string().optional(),
});

export function registerKbRoutes(app: FastifyInstance): void {
  /* ── 空间 ── */

  app.get('/api/kb/spaces', async () => response.ok(kbService.listSpaces()));

  app.post('/api/kb/spaces', async (req, reply) => {
    const body = parseBody(createSpaceSchema, req.body) as CreateSpaceReq;
    return response.send(reply, kbService.createSpace(body), 201);
  });

  app.get('/api/kb/spaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.getSpace(id));
  });

  app.delete('/api/kb/spaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.removeSpace(id));
  });

  /* ── 文档 ── */

  app.get('/api/kb/documents', async (req) => {
    const query = req.query as { spaceId?: string; q?: string };
    return response.ok(kbService.listDocuments(query));
  });

  app.post('/api/kb/documents', async (req, reply) => {
    const body = parseBody(createDocSchema, req.body) as CreateDocReq;
    return response.send(reply, kbService.createDoc(body), 201);
  });

  app.get('/api/kb/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.getDoc(id));
  });

  app.patch('/api/kb/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateDocSchema, req.body) as UpdateDocReq;
    return response.ok(kbService.saveDoc(id, { ...body, editedBy: body.editedBy ?? actorOf(req) }));
  });

  app.delete('/api/kb/documents/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.removeDoc(id));
  });

  app.get('/api/kb/documents/:id/versions', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.versions(id));
  });

  app.post('/api/kb/documents/:id/versions/:ver/rollback', async (req) => {
    const { id, ver } = req.params as { id: string; ver: string };
    const body = parseBody(rollbackDocSchema, req.body ?? {}) as { note?: string };
    void body;
    return response.ok(kbService.rollbackDoc(id, Number(ver)));
  });

  app.post('/api/kb/documents/:id/polish', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(polishSchema, req.body) as {
      scope: 'selection' | 'paragraph' | 'full';
      action: 'polish' | 'expand' | 'shorten' | 'proofread' | 'translate' | 'rewrite' | 'summarize';
      selection?: string;
    };
    return response.ok(kbService.polish(id, body));
  });

  /* ── 同步源 ── */

  app.get('/api/kb/sources', async (req) => {
    const query = req.query as { spaceId?: string };
    return response.ok(kbService.listSources(query.spaceId));
  });

  app.post('/api/kb/sources', async (req, reply) => {
    const body = parseBody(createSourceSchema, req.body) as CreateSourceReq;
    return response.send(reply, kbService.createSource(body), 201);
  });

  app.post('/api/kb/sources/:id/sync', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(kbService.syncSource(id));
  });

  /* ── 检索与反馈 ── */

  app.post('/api/kb/query', async (req) => {
    const body = parseBody(querySchema, req.body) as KbQueryReq;
    return response.ok(
      kbService.query({
        query: body.query,
        scope: body.scope ?? 'all',
        topK: body.topK,
        askerId: body.askerId ?? actorOf(req),
      }),
    );
  });

  app.post('/api/kb/feedback', async (req) => {
    const body = parseBody(feedbackSchema, req.body) as {
      queryId: string;
      feedback: 'adopt' | 'reject' | 'insufficient';
      feedbackBy?: string;
    };
    return response.ok(kbService.feedback(body.queryId, body.feedback, body.feedbackBy ?? actorOf(req)));
  });

  /** 问答日志（检索反馈表） */
  app.get('/api/kb/query-logs', async (req) => {
    const query = req.query as { limit?: string };
    return response.ok(kbService.queryLogs(query.limit ? Number(query.limit) : 100));
  });
}

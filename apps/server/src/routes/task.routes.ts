/**
 * 任务路由（§4.2，FR-TK-01~10）
 *
 * 路由层职责：参数解析 + Zod 校验 + 响应包装；不含业务逻辑。
 * 静态段路由（/api/tasks/metrics、/api/tasks/board）在参数路由 (:id) 之前注册。
 */

import {
  PAGINATION,
  type AcceptTaskReq,
  type AssignTaskReq,
  type CreateArtifactReq,
  type CreateTaskReq,
  type ListTasksQuery,
  type TaskStatus,
  type TransitionTaskReq,
  type UpdateTaskReq,
} from '@huanbuddy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { actorOf, intQuery, parseBody, response } from '../core/response';
import { notificationService } from '../services/notification.service';
import { taskService } from '../services/task.service';

/* ═══════════ Zod 校验 Schema ═══════════ */

const priorityEnum = z.enum(['p1', 'p2', 'p3']);
const statusEnum = z.enum([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'suspended',
  'cancelled',
]);
const rejectReasonEnum = z.enum(['info_insufficient', 'wrong_direction', 'quality_fail', 'other']);
const slaPolicyEnum = z.enum(['notify', 'retry', 'to_human']);

const createTaskSchema = z.object({
  title: z.string().min(1, '任务标题不能为空').max(200),
  description: z.string().max(5000).optional(),
  priority: priorityEnum.optional(),
  tags: z.array(z.string()).optional(),
  assigneeId: z.string().optional(),
  slaDueAt: z.string().optional(),
  slaPolicy: slaPolicyEnum.optional(),
  acceptCriteria: z.string().max(2000).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: priorityEnum.optional(),
  tags: z.array(z.string()).optional(),
  acceptCriteria: z.string().max(2000).optional(),
  slaDueAt: z.string().optional(),
});

const assignSchema = z.object({
  assigneeId: z.string().min(1),
  lockVersion: z.number().int().min(0),
});

const transitionSchema = z.object({
  to: statusEnum,
  reasonCode: rejectReasonEnum.optional(),
  comment: z.string().max(2000).optional(),
  lockVersion: z.number().int().min(0),
});

const acceptSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  rejectReasonCode: rejectReasonEnum.optional(),
  comment: z.string().max(2000).optional(),
});

const activitySchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(5000),
  type: z.literal('comment').optional(),
});

const artifactSchema = z.object({
  type: z.enum(['doc', 'report', 'chart', 'code', 'data']),
  title: z.string().min(1).max(200),
  uri: z.string().optional(),
  content: z.string().optional(),
  sizeBytes: z.number().int().min(0).optional(),
});

export function registerTaskRoutes(app: FastifyInstance): void {
  /* ── 静态段优先：度量 / 看板 / 收件箱 ── */

  app.get('/api/tasks/metrics', async () => response.ok(taskService.metrics()));

  app.get('/api/tasks/board', async () => response.ok(taskService.board()));

  app.get('/api/inbox', async (req) => {
    const query = req.query as { recipientId?: string };
    return response.ok(notificationService.inbox(query.recipientId));
  });

  /* ── 任务列表 / 创建 ── */

  app.get('/api/tasks', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const filters: ListTasksQuery = {
      status: query.status as TaskStatus | undefined,
      assigneeId: query.assigneeId,
      tag: query.tag,
      q: query.q,
      page: intQuery(query.page, PAGINATION.defaultPage),
      size: intQuery(query.size, PAGINATION.defaultSize),
    };
    return response.ok(taskService.list(filters));
  });

  app.post('/api/tasks', async (req, reply) => {
    const body = parseBody(createTaskSchema, req.body) as CreateTaskReq;
    const task = taskService.create(body, actorOf(req));
    return response.send(reply, task, 201);
  });

  /* ── 单任务读写 ── */

  app.get('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(taskService.get(id));
  });

  app.patch('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(updateTaskSchema, req.body) as UpdateTaskReq;
    return response.ok(taskService.update(id, body, actorOf(req)));
  });

  app.delete('/api/tasks/:id', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(taskService.remove(id, actorOf(req)));
  });

  /* ── 指派 / 流转 / 验收 ── */

  app.post('/api/tasks/:id/assign', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(assignSchema, req.body) as AssignTaskReq;
    return response.ok(taskService.assign(id, body, actorOf(req)));
  });

  app.post('/api/tasks/:id/transition', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(transitionSchema, req.body) as TransitionTaskReq;
    return response.ok(taskService.transition(id, body, actorOf(req)));
  });

  app.post('/api/tasks/:id/accept', async (req) => {
    const { id } = req.params as { id: string };
    const body = parseBody(acceptSchema, req.body) as AcceptTaskReq;
    return response.ok(taskService.accept(id, body, actorOf(req)));
  });

  /* ── 活动 / 交付物 ── */

  app.get('/api/tasks/:id/activities', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(taskService.activities(id));
  });

  app.post('/api/tasks/:id/activities', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(activitySchema, req.body) as { content: string; type?: 'comment' };
    return response.send(reply, taskService.addActivity(id, body, actorOf(req)), 201);
  });

  app.get('/api/tasks/:id/artifacts', async (req) => {
    const { id } = req.params as { id: string };
    return response.ok(taskService.artifacts(id));
  });

  app.post('/api/tasks/:id/artifacts', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(artifactSchema, req.body) as CreateArtifactReq;
    return response.send(reply, taskService.addArtifact(id, body, actorOf(req)), 201);
  });
}

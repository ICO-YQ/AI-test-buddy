/**
 * 路由汇总注册（§2 / §4）
 *
 * 顺序：内部接口 /api/*（任务、成员、技能、Hub、知识库、会话、模型、审计、Key）
 *       对外能力 /v1/*（Key 鉴权 + 幂等 + 签名 + 限流）
 */

import type { FastifyInstance } from 'fastify';

import { registerApiKeyRoutes } from './apikey.routes';
import { registerAuditRoutes } from './audit.routes';
import { registerChatRoutes } from './chat.routes';
import { registerHubRoutes } from './hub.routes';
import { registerKbRoutes } from './kb.routes';
import { registerMemberRoutes } from './member.routes';
import { registerModelRoutes } from './model.routes';
import { registerOpenApiRoutes } from './openapi.routes';
import { registerSkillRoutes } from './skill.routes';
import { registerTaskRoutes } from './task.routes';

/**
 * 注册全部路由。
 * 注意：`/api/tasks/metrics` 等静态段必须在 `/api/tasks/:id` 之前注册，避免被参数路由吞掉
 * （各 route 文件内部已按此顺序声明）。
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  registerTaskRoutes(app);
  registerMemberRoutes(app);
  registerSkillRoutes(app);
  registerHubRoutes(app);
  registerKbRoutes(app);
  registerChatRoutes(app);
  registerModelRoutes(app);
  registerAuditRoutes(app);
  registerApiKeyRoutes(app);
  registerOpenApiRoutes(app);
}

/**
 * 审计与用量路由（§4.8，FR-GOV-01~05 / FR-API-10）
 *
 * 注意：静态段 `/api/audit/trace/:traceId`、`/api/audit/security-events` 先于其它参数路由。
 */

import type { FastifyInstance } from 'fastify';

import { intQuery, response } from '../core/response';
import { auditService } from '../services/audit.service';

export function registerAuditRoutes(app: FastifyInstance): void {
  /* ── 审计 ── */

  app.get('/api/audit', async (req) => {
    const query = req.query as Record<string, string | undefined>;
    return response.ok(
      auditService.list({
        traceId: query.traceId,
        actorId: query.actorId,
        action: query.action,
        resourceType: query.resourceType,
        from: query.from,
        to: query.to,
        page: intQuery(query.page, 1),
        size: intQuery(query.size, 50),
      }),
    );
  });

  app.get('/api/audit/trace/:traceId', async (req) => {
    const { traceId } = req.params as { traceId: string };
    return response.ok(auditService.byTrace(traceId));
  });

  app.get('/api/audit/security-events', async () => response.ok(auditService.securityEvents()));

  app.get('/api/audit/anomalies', async (req) => {
    const query = req.query as { limit?: string };
    return response.ok(auditService.anomalies(query.limit ? Number(query.limit) : 50));
  });

  app.get('/api/audit/actions', async () => response.ok(auditService.actions()));

  app.get('/api/audit/resource/:resourceId', async (req) => {
    const { resourceId } = req.params as { resourceId: string };
    return response.ok(auditService.byResource(resourceId));
  });

  /* ── 用量与对账 ── */

  app.get('/api/usage/summary', async (req) => {
    const query = req.query as { from?: string; to?: string; groupBy?: 'model' | 'caller' };
    return response.ok(auditService.usageSummary(query));
  });

  app.get('/api/usage/by-category', async (req) => {
    const query = req.query as { from?: string; to?: string };
    return response.ok(auditService.usageByCategory(query.from, query.to));
  });

  app.get('/api/usage', async (req) => {
    const query = req.query as {
      apiKeyId?: string;
      agentId?: string;
      taskId?: string;
      workspaceId?: string;
    };
    return response.ok(auditService.usage(query));
  });
}

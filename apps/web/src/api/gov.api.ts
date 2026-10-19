/** 治理接口：模型 / 场景路由 / 降级 / 审计 / API Key / 用量（§4.8） */
import { api } from './client';
import type {
  ApiKey,
  AuditLog,
  CreateKeyReq,
  CreateModelReq,
  IssuedKeyResp,
  ModelConfig,
  ModelDegradationLog,
  Paginated,
  SceneRoute,
  SecurityEventStat,
  UpdateModelReq,
  UsageRecord,
  UsageSummary,
} from '@/lib/shared';

export interface AuditQuery {
  traceId?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
}

export const govApi = {
  /* 模型 */
  models: () => api.get<ModelConfig[]>('/models'),
  createModel: (body: CreateModelReq) => api.post<ModelConfig>('/models', body),
  updateModel: (id: string, body: UpdateModelReq) => api.patch<ModelConfig>(`/models/${id}`, body),
  routes: () => api.get<SceneRoute[]>('/models/routes'),
  /** 契约（shared/api.ts SetSceneRoutesReq）：body 为 { routes: SceneRoute[] } */
  saveRoutes: (routes: SceneRoute[]) => api.put<SceneRoute[]>('/models/routes', { routes }),
  degradations: () => api.get<ModelDegradationLog[]>('/models/degradations'),

  /* 审计 */
  audit: (q: AuditQuery = {}) => api.get<Paginated<AuditLog>>('/audit', q as Record<string, unknown>),
  trace: (traceId: string) => api.get<AuditLog[]>(`/audit/trace/${traceId}`),
  securityEvents: () => api.get<SecurityEventStat[]>('/audit/security-events'),

  /* API Key */
  apiKeys: (workspaceId?: string) => api.get<ApiKey[]>('/apikeys', { workspaceId }),
  createKey: (body: CreateKeyReq) => api.post<IssuedKeyResp>('/apikeys', body),
  revokeKey: (id: string) => api.post<ApiKey>(`/apikeys/${id}/revoke`, {}),

  /* 用量 */
  usageSummary: (from?: string, to?: string, groupBy?: string) =>
    api.get<UsageSummary>('/usage/summary', { from, to, groupBy }),
  usage: (q: { apiKeyId?: string; agentId?: string; taskId?: string } = {}) =>
    api.get<UsageRecord[]>('/usage', q as Record<string, unknown>),
};

export type { AuditQuery as GovAuditQuery };

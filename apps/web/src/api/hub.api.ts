/** 技能市场接口（§4.6） */
import { api } from './client';
import type {
  CreateRepoReq,
  HubLoadResult,
  HubRepo,
  HubSkill,
  HubSkillDisabledResp,
  HubSyncResult,
  ListHubSkillsQuery,
  UpdateRepoReq,
} from '@/lib/shared';

export const hubApi = {
  repos: () => api.get<HubRepo[]>('/hub/repos'),
  createRepo: (body: CreateRepoReq) => api.post<HubRepo>('/hub/repos', body),
  updateRepo: (id: string, body: UpdateRepoReq) => api.patch<HubRepo>(`/hub/repos/${id}`, body),
  removeRepo: (id: string) => api.del<{ id: string }>(`/hub/repos/${id}`),
  syncRepo: (id: string) => api.post<HubSyncResult>(`/hub/repos/${id}/sync`, {}),
  skills: (q: ListHubSkillsQuery = {}) => api.get<HubSkill[]>('/hub/skills', q as Record<string, unknown>),
  load: (id: string) => api.post<HubLoadResult>(`/hub/skills/${id}/load`, {}),
  disable: (id: string) => api.post<HubSkillDisabledResp>(`/hub/skills/${id}/disable`, {}),
};

export type { ListHubSkillsQuery };

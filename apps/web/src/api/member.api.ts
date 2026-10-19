/** 成员接口（人 + AI，§4.3） */
import { api } from './client';
import type { AgentConfig, CreateMemberReq, EffectivePermission, Member, UpdateMemberReq } from '@/lib/shared';

export const memberApi = {
  list: (type?: string) => api.get<Member[]>('/members', { type }),
  get: (id: string) => api.get<Member>(`/members/${id}`),
  create: (body: CreateMemberReq) => api.post<Member>('/members', body),
  update: (id: string, body: UpdateMemberReq) => api.patch<Member>(`/members/${id}`, body),
  remove: (id: string) => api.del<{ id: string }>(`/members/${id}`),
  effectivePermissions: (id: string) => api.get<EffectivePermission>(`/members/${id}/effective-permissions`),
  saveAgentConfig: (id: string, body: AgentConfig) => api.put<AgentConfig>(`/members/${id}/agent-config`, body),
};

export type { UpdateMemberReq };

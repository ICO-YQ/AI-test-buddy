/** 技能接口（§4.5） */
import { api } from './client';
import type {
  CreateSkillVersionReq,
  ImpactAnalysis,
  PermissionDecl,
  Skill,
  SkillDetail,
  SkillExecutionResult,
  SkillVersion,
  UpdateSkillReq,
  ValidateResult,
} from '@/lib/shared';

export interface SkillQuery {
  status?: string;
  source?: string;
  q?: string;
}

export const skillApi = {
  list: (q: SkillQuery = {}) => api.get<Skill[]>('/skills', q as Record<string, unknown>),
  get: (id: string) => api.get<SkillDetail>(`/skills/${id}`),
  create: (body: Partial<Skill>) => api.post<Skill>('/skills', body),
  update: (id: string, body: UpdateSkillReq) => api.patch<Skill>(`/skills/${id}`, body),
  remove: (id: string) => api.del<{ id: string }>(`/skills/${id}`),
  versions: (id: string) => api.get<SkillVersion[]>(`/skills/${id}/versions`),
  createVersion: (id: string, body: CreateSkillVersionReq) =>
    api.post<SkillVersion>(`/skills/${id}/versions`, body),
  validate: (id: string, versionId: string) => api.post<ValidateResult>(`/skills/${id}/validate`, { versionId }),
  publish: (id: string, version: string) => api.post<SkillVersion>(`/skills/${id}/versions/${version}/publish`, {}),
  offline: (id: string, version: string) => api.post<SkillVersion>(`/skills/${id}/versions/${version}/offline`, {}),
  impact: (id: string, version: string) => api.get<ImpactAnalysis>(`/skills/${id}/versions/${version}/impact`),
  rollback: (id: string, toVersion: string, reason: string) =>
    api.post<SkillVersion>(`/skills/${id}/rollback`, { toVersion, reason }),
  execute: (id: string, versionId: string, input: Record<string, unknown>) =>
    api.post<SkillExecutionResult>(`/skills/${id}/execute`, { versionId, input }),
  /**
   * 保存权限声明：契约未提供「就地更新版本」端点，故按 §4.5 通过
   * 创建一个携带权限声明的新版本（变更走版本与影响面分析，可回滚）。
   */
  savePermissions: (id: string, version: string, permissions: PermissionDecl[], createdBy: string) =>
    api.post<SkillVersion>(`/skills/${id}/versions`, {
      version,
      permissions,
      changeNote: '权限声明变更',
      createdBy,
    } satisfies CreateSkillVersionReq),
};

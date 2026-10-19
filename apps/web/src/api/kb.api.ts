/** 知识库与文档接口（§4.7） */
import { api } from './client';
import type {
  CreateDocReq,
  CreateSpaceReq,
  CreateSourceReq,
  KbDocDetail,
  KbDocVersion,
  KbDocument,
  KbSpace,
  KbSpaceDetail,
  KbSyncSource,
  KbSyncSourceResult,
  OkResp,
  PolishReq,
  PolishResult,
  QueryResult,
  UpdateDocReq,
} from '@/lib/shared';

export const kbApi = {
  /* 空间 */
  spaces: () => api.get<KbSpace[]>('/kb/spaces'),
  space: (id: string) => api.get<KbSpaceDetail>(`/kb/spaces/${id}`),
  createSpace: (body: CreateSpaceReq) => api.post<KbSpace>('/kb/spaces', body),
  removeSpace: (id: string) => api.del<{ id: string }>(`/kb/spaces/${id}`),

  /* 文档 */
  documents: (spaceId?: string, q?: string) =>
    api.get<KbDocument[]>('/kb/documents', { spaceId, q }),
  document: (id: string) => api.get<KbDocDetail>(`/kb/documents/${id}`),
  createDocument: (body: CreateDocReq) => api.post<KbDocument>('/kb/documents', body),
  updateDocument: (id: string, body: UpdateDocReq) => api.patch<KbDocument>(`/kb/documents/${id}`, body),
  removeDocument: (id: string) => api.del<{ id: string }>(`/kb/documents/${id}`),
  versions: (id: string) => api.get<KbDocVersion[]>(`/kb/documents/${id}/versions`),
  rollback: (id: string, version: number) =>
    api.post<KbDocument>(`/kb/documents/${id}/versions/${version}/rollback`, {}),
  polish: (id: string, body: PolishReq) =>
    api.post<PolishResult>(`/kb/documents/${id}/polish`, body),

  /* 同步源 */
  sources: (spaceId?: string) => api.get<KbSyncSource[]>('/kb/sources', { spaceId }),
  createSource: (body: CreateSourceReq) => api.post<KbSyncSource>('/kb/sources', body),
  syncSource: (id: string) => api.post<KbSyncSourceResult>(`/kb/sources/${id}/sync`, {}),

  /* 检索 */
  query: (body: { query: string; scope: string; topK?: number }) => api.post<QueryResult>('/kb/query', body),
  feedback: (body: { queryId: string; feedback: 'adopt' | 'reject' | 'insufficient' }) =>
    api.post<OkResp>('/kb/feedback', body),
};

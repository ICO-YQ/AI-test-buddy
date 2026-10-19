/** 会话与消息接口（§4.4） */
import { api } from './client';
import type { CreateSessionReq, Message, SendMessageReq, SendMessageResp, Session, SessionDetail } from '@/lib/shared';

export const chatApi = {
  list: () => api.get<Session[]>('/sessions'),
  get: (id: string) => api.get<SessionDetail>(`/sessions/${id}`),
  create: (body: CreateSessionReq) => api.post<Session>('/sessions', body),
  remove: (id: string) => api.del<{ id: string }>(`/sessions/${id}`),
  setModel: (id: string, modelId: string) => api.post<Session>(`/sessions/${id}/model`, { modelId }),
  messages: (id: string) => api.get<Message[]>(`/sessions/${id}/messages`),
  send: (id: string, body: SendMessageReq) => api.post<SendMessageResp>(`/sessions/${id}/messages`, body),
  updateMessage: (id: string, content: string) => api.patch<Message>(`/messages/${id}`, { content }),
  removeMessage: (id: string) => api.del<{ id: string }>(`/messages/${id}`),
};

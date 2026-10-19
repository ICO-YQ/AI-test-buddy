/** 任务接口（FR-TK-01~10，§4.2） */
import { api } from './client';
import type {
  AcceptTaskReq,
  Artifact,
  CreateTaskReq,
  Notification,
  Paginated,
  Task,
  TaskActivity,
  TaskDetail,
  TaskMetrics,
  TransitionTaskReq,
  UpdateTaskReq,
} from '@/lib/shared';

export interface TaskQuery {
  status?: string;
  assigneeId?: string;
  tag?: string;
  q?: string;
  page?: number;
  size?: number;
}

export const taskApi = {
  list: (q: TaskQuery = {}) => api.get<Paginated<Task>>('/tasks', q as Record<string, unknown>),
  get: (id: string) => api.get<TaskDetail>(`/tasks/${id}`),
  create: (body: CreateTaskReq) => api.post<Task>('/tasks', body),
  update: (id: string, body: UpdateTaskReq) => api.patch<Task>(`/tasks/${id}`, body),
  remove: (id: string) => api.del<{ id: string }>(`/tasks/${id}`),
  assign: (id: string, assigneeId: string, lockVersion: number) =>
    api.post<Task>(`/tasks/${id}/assign`, { assigneeId, lockVersion }),
  transition: (id: string, body: TransitionTaskReq) => api.post<Task>(`/tasks/${id}/transition`, body),
  accept: (id: string, body: AcceptTaskReq) => api.post<Task>(`/tasks/${id}/accept`, body),
  activities: (id: string) => api.get<TaskActivity[]>(`/tasks/${id}/activities`),
  comment: (id: string, content: string) =>
    api.post<TaskActivity>(`/tasks/${id}/activities`, { content, type: 'comment' }),
  artifacts: (id: string) => api.get<Artifact[]>(`/tasks/${id}/artifacts`),
  metrics: () => api.get<TaskMetrics>('/tasks/metrics'),
  inbox: (recipientId?: string) => api.get<Notification[]>('/inbox', { recipientId }),
};

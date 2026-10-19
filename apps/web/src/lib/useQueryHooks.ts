/**
 * 常用 react-query hooks 封装（服务端状态统一入口）。
 * 每个 hook 自带 loading / error 语义，页面据此渲染空态而非白屏。
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { taskApi, type TaskQuery } from '@/api/task.api';
import { chatApi } from '@/api/chat.api';
import { memberApi } from '@/api/member.api';
import { skillApi, type SkillQuery } from '@/api/skill.api';
import { hubApi, type ListHubSkillsQuery } from '@/api/hub.api';
import { kbApi } from '@/api/kb.api';
import { govApi, type AuditQuery } from '@/api/gov.api';
import type { AgentConfig, FeedbackValue, PolishAction, SceneRoute } from '@/lib/shared';

export const qk = {
  tasks: (q: TaskQuery) => ['tasks', q] as const,
  task: (id: string) => ['task', id] as const,
  metrics: ['task-metrics'] as const,
  inbox: (rid?: string) => ['inbox', rid] as const,
  members: (type?: string) => ['members', type] as const,
  member: (id: string) => ['member', id] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['session', id] as const,
  skills: (q: SkillQuery) => ['skills', q] as const,
  skill: (id: string) => ['skill', id] as const,
  hubRepos: ['hub-repos'] as const,
  hubSkills: (q: ListHubSkillsQuery) => ['hub-skills', q] as const,
  kbSpaces: ['kb-spaces'] as const,
  kbDocs: (spaceId?: string, q?: string) => ['kb-docs', spaceId, q] as const,
  kbDoc: (id: string) => ['kb-doc', id] as const,
  kbSources: (spaceId?: string) => ['kb-sources', spaceId] as const,
  models: ['models'] as const,
  routes: ['scene-routes'] as const,
  degradations: ['degradations'] as const,
  audit: (q: AuditQuery) => ['audit', q] as const,
  security: ['security-events'] as const,
  apiKeys: ['api-keys'] as const,
  usageSummary: ['usage-summary'] as const,
};

type Opts<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>;

/* ── 任务 ── */
export const useTasks = (q: TaskQuery = {}, opts?: Opts<Awaited<ReturnType<typeof taskApi.list>>>) =>
  useQuery({ queryKey: qk.tasks(q), queryFn: () => taskApi.list(q), ...opts });
export const useTaskDetail = (id: string | null) =>
  useQuery({ queryKey: qk.task(id ?? ''), queryFn: () => taskApi.get(id as string), enabled: !!id });
export const useTaskMetrics = () => useQuery({ queryKey: qk.metrics, queryFn: taskApi.metrics });
export const useInbox = (recipientId?: string) =>
  useQuery({ queryKey: qk.inbox(recipientId), queryFn: () => taskApi.inbox(recipientId) });

/* ── 成员 ── */
export const useMembers = (type?: string) =>
  useQuery({ queryKey: qk.members(type), queryFn: () => memberApi.list(type) });

/* ── 会话 ── */
export const useSessions = () => useQuery({ queryKey: qk.sessions, queryFn: chatApi.list });
export const useSession = (id: string | null) =>
  useQuery({ queryKey: qk.session(id ?? ''), queryFn: () => chatApi.get(id as string), enabled: !!id });

/* ── 技能 ── */
export const useSkills = (q: SkillQuery = {}) =>
  useQuery({ queryKey: qk.skills(q), queryFn: () => skillApi.list(q) });
export const useSkill = (id: string | null) =>
  useQuery({ queryKey: qk.skill(id ?? ''), queryFn: () => skillApi.get(id as string), enabled: !!id });

/* ── Hub ── */
export const useHubRepos = () => useQuery({ queryKey: qk.hubRepos, queryFn: hubApi.repos });
export const useHubSkills = (q: ListHubSkillsQuery = {}) =>
  useQuery({ queryKey: qk.hubSkills(q), queryFn: () => hubApi.skills(q) });

/* ── 知识库 ── */
export const useKbSpaces = () => useQuery({ queryKey: qk.kbSpaces, queryFn: kbApi.spaces });
export const useKbDocuments = (spaceId?: string, q?: string) =>
  useQuery({ queryKey: qk.kbDocs(spaceId, q), queryFn: () => kbApi.documents(spaceId, q) });
export const useKbDocument = (id: string | null) =>
  useQuery({ queryKey: qk.kbDoc(id ?? ''), queryFn: () => kbApi.document(id as string), enabled: !!id });
export const useKbSources = (spaceId?: string) =>
  useQuery({ queryKey: qk.kbSources(spaceId), queryFn: () => kbApi.sources(spaceId) });

/* ── 治理 ── */
export const useModels = () => useQuery({ queryKey: qk.models, queryFn: govApi.models });
export const useSceneRoutes = () => useQuery({ queryKey: qk.routes, queryFn: govApi.routes });
export const useDegradations = () => useQuery({ queryKey: qk.degradations, queryFn: govApi.degradations });
export const useAudit = (q: AuditQuery = {}) =>
  useQuery({ queryKey: qk.audit(q), queryFn: () => govApi.audit(q) });
export const useSecurityEvents = () => useQuery({ queryKey: qk.security, queryFn: govApi.securityEvents });
export const useApiKeys = () => useQuery({ queryKey: qk.apiKeys, queryFn: () => govApi.apiKeys() });
export const useUsageSummary = () =>
  useQuery({ queryKey: qk.usageSummary, queryFn: () => govApi.usageSummary() });

/* ── 变更（带自动失效） ── */
export function useSaveAgentConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AgentConfig }) => memberApi.saveAgentConfig(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members'] });
      qc.invalidateQueries({ queryKey: ['member'] });
    },
  });
}

export function useKbFeedback() {
  return useMutation({
    mutationFn: (body: { queryId: string; feedback: FeedbackValue }) => kbApi.feedback(body),
  });
}

export function useKbPolish() {
  return useMutation({
    mutationFn: (args: {
      id: string;
      scope: 'selection' | 'paragraph' | 'full';
      action: PolishAction;
      selection?: string;
    }) => kbApi.polish(args.id, { scope: args.scope, action: args.action, selection: args.selection }),
  });
}

export function useSaveRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SceneRoute[]) => govApi.saveRoutes(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.routes }),
  });
}

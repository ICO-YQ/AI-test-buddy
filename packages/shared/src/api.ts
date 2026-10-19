/**
 * API 契约层（对应 architecture.md §4）
 * - 统一响应包装（§4.1 / §7.5）
 * - 各模块请求 DTO
 * - 端点路径常量（供前后端共用，避免硬编码漂移）
 */

import type {
  AgentConfig,
  ApiKey,
  Artifact,
  AuditLog,
  EffectivePermission,
  HubLoadResult,
  HubRepo,
  HubSkill,
  HubSyncResult,
  ImpactAnalysis,
  KbDocVersion,
  KbDocument,
  KbQueryLog,
  KbSpace,
  KbSyncSource,
  KbSyncSourceResult,
  Member,
  Message,
  ModelConfig,
  ModelDegradationLog,
  Notification,
  PermissionDecl,
  PolishResult,
  QueryResult,
  SceneRoute,
  SecurityEventStat,
  Session,
  Skill,
  SkillExecutionResult,
  SkillVersion,
  Task,
  TaskActivity,
  TaskMetrics,
  UsageRecord,
  UsageSummary,
  ValidateResult,
} from './types';
import type {
  ArtifactType,
  FallbackPolicy,
  HubAuthType,
  HubRepoType,
  KbDocFormat,
  MemberRole,
  MemberType,
  ModelHealth,
  ModelPriority,
  PermissionCapability,
  PolishAction,
  PolishScope,
  Priority,
  RejectReason,
  ReviewStatus,
  Scene,
  ScriptLang,
  SkillStatus,
  SlaPolicy,
  SyncSourceType,
  TaskStatus,
  TrustLevel,
} from './enums';

/* ═══════════════ 统一响应包装（§4.1 / §7.5） ═══════════════ */

export interface ApiResponse<T> {
  code: 0;
  data: T;
  message: 'ok';
}

export interface ApiError {
  code: number;
  data: null;
  message: string;
  traceId?: string;
  details?: unknown;
}

export type ApiEnvelope<T> = ApiResponse<T> | ApiError;

/** 分页响应体（§7.5） */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

/* ═══════════════ 任务模块（§4.2） ═══════════════ */

export interface ListTasksQuery {
  status?: TaskStatus;
  assigneeId?: string;
  tag?: string;
  q?: string;
  page?: number;
  size?: number;
}

export interface CreateTaskReq {
  title: string;
  description?: string;
  priority?: Priority;
  tags?: string[];
  assigneeId?: string;
  slaDueAt?: string;
  slaPolicy?: SlaPolicy;
  acceptCriteria?: string;
}

export interface UpdateTaskReq {
  title?: string;
  description?: string;
  priority?: Priority;
  tags?: string[];
  acceptCriteria?: string;
  slaDueAt?: string;
}

export interface AssignTaskReq {
  assigneeId: string;
  lockVersion: number;
}

export interface TransitionTaskReq {
  to: TaskStatus;
  reasonCode?: RejectReason;
  comment?: string;
  lockVersion: number;
}

export interface AcceptTaskReq {
  decision: 'accept' | 'reject';
  rejectReasonCode?: RejectReason;
  comment?: string;
}

export interface CreateActivityReq {
  content: string;
  type?: 'comment';
}

export interface CreateArtifactReq {
  type: ArtifactType;
  title: string;
  uri?: string;
  content?: string;
  sizeBytes?: number;
}

export interface TaskDetail extends Task {
  activities: TaskActivity[];
  artifacts: Artifact[];
}

/* ═══════════════ 成员模块（§4.3） ═══════════════ */

export interface CreateMemberReq {
  type: MemberType;
  name: string;
  handle?: string;
  avatarText?: string;
  avatarColor?: string;
  role?: MemberRole;
  capabilityTags?: string[];
  dataScope?: string[];
  /** 创建 AI 成员必填（权限上限来源） */
  creatorId?: string;
  agentConfig?: Partial<AgentConfig>;
}

export interface UpdateMemberReq {
  name?: string;
  handle?: string;
  avatarText?: string;
  avatarColor?: string;
  role?: MemberRole;
  capabilityTags?: string[];
  dataScope?: string[];
  status?: 'active' | 'disabled';
}

export type MemberWithConfig = Member;

/* ═══════════════ 会话与模型（§4.4） ═══════════════ */

export interface CreateSessionReq {
  title: string;
  ownerId: string;
  agentId?: string;
  modelId?: string;
  kbSpaceId?: string;
  skillIds?: string[];
  permScope?: string;
  relatedTaskIds?: string[];
}

export interface SendMessageReq {
  content: string;
  mentions?: string[];
}

export interface SendMessageResp {
  userMessage: Message;
  assistantMessage: Message;
}

export interface SwitchModelReq {
  modelId: string;
}

export interface EditMessageReq {
  content: string;
}

export interface SessionDetail extends Session {
  messages: Message[];
}

/* ═══════════════ 技能模块（§4.5） ═══════════════ */

export interface CreateSkillReq {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  createdBy: string;
  trustLevel?: TrustLevel;
  source?: 'local' | 'hub';
  hubSkillId?: string;
}

export interface UpdateSkillReq {
  name?: string;
  description?: string;
  icon?: string;
  tags?: string[];
  status?: SkillStatus;
  enabled?: boolean;
}

export interface CreateSkillVersionReq {
  version: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  prompt?: string;
  script?: string;
  scriptLang?: ScriptLang;
  permissions?: PermissionDecl[];
  changeNote?: string;
  createdBy: string;
}

export interface ValidateSkillReq {
  versionId: string;
}

export interface RollbackSkillReq {
  toVersion: string;
  reason: string;
}

export interface ExecuteSkillReq {
  versionId: string;
  input: Record<string, unknown>;
}

export interface SkillDetail extends Skill {
  versions: SkillVersion[];
}

/* ═══════════════ Hub 模块（§4.6） ═══════════════ */

export interface CreateRepoReq {
  name: string;
  url: string;
  type: HubRepoType;
  authType?: HubAuthType;
  trustLevel: TrustLevel;
  signatureRequired?: boolean;
  fallbackPolicy?: FallbackPolicy;
}

export interface UpdateRepoReq {
  name?: string;
  url?: string;
  trustLevel?: TrustLevel;
  signatureRequired?: boolean;
  status?: 'active' | 'disabled';
  fallbackPolicy?: FallbackPolicy;
}

export interface ListHubSkillsQuery {
  repoId?: string;
  q?: string;
  trust?: TrustLevel;
}

export interface HubSkillDisabledResp {
  id: string;
  disabledAt: string;
}

/* ═══════════════ 知识库与文档（§4.7） ═══════════════ */

export interface CreateSpaceReq {
  name: string;
  description?: string;
  acl?: string[];
}

export interface KbSpaceDetail extends KbSpace {
  documents: KbDocument[];
}

export interface CreateDocReq {
  spaceId: string;
  title: string;
  content?: string;
  format?: KbDocFormat;
  tags?: string[];
  acl?: string[];
}

export interface UpdateDocReq {
  title?: string;
  content?: string;
  tags?: string[];
  acl?: string[];
  note?: string;
  editedBy?: string;
}

export interface KbDocDetail extends KbDocument {
  versions: KbDocVersion[];
}

export interface RollbackDocReq {
  note?: string;
}

export interface PolishReq {
  scope: PolishScope;
  action: PolishAction;
  selection?: string;
}

export interface CreateSourceReq {
  spaceId: string;
  sourceType: SyncSourceType;
  target: string;
  intervalMin?: number;
  mirrorOnly?: boolean;
  aclMap?: Record<string, string>;
}

export interface KbQueryReq {
  query: string;
  scope: string;
  topK?: number;
  askerId?: string;
}

export interface KbFeedbackReq {
  queryId: string;
  feedback: 'adopt' | 'reject' | 'insufficient';
  feedbackBy?: string;
}

export interface OkResp {
  ok: true;
}

/* ═══════════════ 治理模块（§4.8） ═══════════════ */

export interface ListAuditQuery {
  traceId?: string;
  actorId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
}

export interface CreateKeyReq {
  workspaceId: string;
  name: string;
  scopes?: string[];
  rateLimitPerMin?: number;
  ownerId: string;
}

export interface IssuedKeyResp {
  key: ApiKey;
  /** 明文仅此一次返回 */
  plaintext: string;
}

export interface UsageSummaryQuery {
  from?: string;
  to?: string;
  groupBy?: 'model' | 'caller';
}

export interface ListUsageQuery {
  apiKeyId?: string;
  agentId?: string;
  taskId?: string;
  workspaceId?: string;
}

export interface CreateModelReq {
  name: string;
  vendor: string;
  contextWindow: number;
  purpose?: string;
  priority?: ModelPriority;
  health?: ModelHealth;
  baseUrl?: string;
  apiKeyRef?: string;
  inputPrice?: number;
  outputPrice?: number;
  enabled?: boolean;
}

export interface UpdateModelReq extends Partial<CreateModelReq> {}

export interface SetSceneRoutesReq {
  routes: SceneRoute[];
}

/* ═══════════════ 开放接口 /v1（§4.8） ═══════════════ */

export interface OpenApiHeaders {
  'x-api-key': string;
  'x-idempotency-key': string;
  'x-timestamp': string;
  'x-signature': string;
}

export interface V1SkillExecuteReq {
  versionId: string;
  input: Record<string, unknown>;
}

export interface V1AgentInvokeReq {
  message: string;
  sessionId?: string;
  stream?: boolean;
}

export interface V1WorkflowRunReq {
  mode: 'sync' | 'async';
  callbackUrl?: string;
  input?: Record<string, unknown>;
}

export interface V1WorkflowRunResp {
  runId: string;
  mode: 'sync' | 'async';
  status: 'succeeded' | 'accepted' | 'failed';
  result?: Record<string, unknown>;
}

export interface V1KnowledgeQueryReq {
  query: string;
  scope?: string;
  topK?: number;
}

export interface V1KnowledgeQueryResp {
  queryId: string;
  answer: string;
  insufficient: boolean;
  citations: QueryResult['citations'];
  traceId: string;
}

/** /v1 响应中回带的限流信息 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: string;
}

/* ═══════════════ 端点路径常量（唯一来源） ═══════════════ */

export const EP = {
  health: '/health',

  tasks: '/api/tasks',
  task: (id: string) => `/api/tasks/${id}`,
  taskAssign: (id: string) => `/api/tasks/${id}/assign`,
  taskTransition: (id: string) => `/api/tasks/${id}/transition`,
  taskAccept: (id: string) => `/api/tasks/${id}/accept`,
  taskActivities: (id: string) => `/api/tasks/${id}/activities`,
  taskArtifacts: (id: string) => `/api/tasks/${id}/artifacts`,
  taskMetrics: '/api/tasks/metrics',
  inbox: '/api/inbox',

  members: '/api/members',
  member: (id: string) => `/api/members/${id}`,
  memberEffectivePermissions: (id: string) => `/api/members/${id}/effective-permissions`,
  memberAgentConfig: (id: string) => `/api/members/${id}/agent-config`,

  sessions: '/api/sessions',
  session: (id: string) => `/api/sessions/${id}`,
  sessionModel: (id: string) => `/api/sessions/${id}/model`,
  sessionMessages: (id: string) => `/api/sessions/${id}/messages`,
  message: (id: string) => `/api/messages/${id}`,

  skills: '/api/skills',
  skill: (id: string) => `/api/skills/${id}`,
  skillVersions: (id: string) => `/api/skills/${id}/versions`,
  skillValidate: (id: string) => `/api/skills/${id}/validate`,
  skillVersionPublish: (id: string, ver: string) => `/api/skills/${id}/versions/${ver}/publish`,
  skillVersionOffline: (id: string, ver: string) => `/api/skills/${id}/versions/${ver}/offline`,
  skillVersionImpact: (id: string, ver: string) => `/api/skills/${id}/versions/${ver}/impact`,
  skillRollback: (id: string) => `/api/skills/${id}/rollback`,
  skillExecute: (id: string) => `/api/skills/${id}/execute`,

  hubRepos: '/api/hub/repos',
  hubRepo: (id: string) => `/api/hub/repos/${id}`,
  hubRepoSync: (id: string) => `/api/hub/repos/${id}/sync`,
  hubSkills: '/api/hub/skills',
  hubSkillLoad: (id: string) => `/api/hub/skills/${id}/load`,
  hubSkillDisable: (id: string) => `/api/hub/skills/${id}/disable`,

  kbSpaces: '/api/kb/spaces',
  kbSpace: (id: string) => `/api/kb/spaces/${id}`,
  kbDocuments: '/api/kb/documents',
  kbDocument: (id: string) => `/api/kb/documents/${id}`,
  kbDocumentVersions: (id: string) => `/api/kb/documents/${id}/versions`,
  kbDocumentRollback: (id: string, ver: number) => `/api/kb/documents/${id}/versions/${ver}/rollback`,
  kbDocumentPolish: (id: string) => `/api/kb/documents/${id}/polish`,
  kbSources: '/api/kb/sources',
  kbSourceSync: (id: string) => `/api/kb/sources/${id}/sync`,
  kbQuery: '/api/kb/query',
  kbFeedback: '/api/kb/feedback',

  audit: '/api/audit',
  auditTrace: (traceId: string) => `/api/audit/trace/${traceId}`,
  auditSecurityEvents: '/api/audit/security-events',
  apikeys: '/api/apikeys',
  apikeyRevoke: (id: string) => `/api/apikeys/${id}/revoke`,
  usage: '/api/usage',
  usageSummary: '/api/usage/summary',

  models: '/api/models',
  model: (id: string) => `/api/models/${id}`,
  modelRoutes: '/api/models/routes',
  modelDegradations: '/api/models/degradations',

  v1SkillExecute: (id: string) => `/v1/skills/${id}/execute`,
  v1AgentInvoke: (id: string) => `/v1/agents/${id}/invoke`,
  v1WorkflowRun: (id: string) => `/v1/workflows/${id}/run`,
  v1KnowledgeQuery: '/v1/knowledge/query',
} as const;

/* ═══════════════ 各端点响应类型集合（供前端类型推导） ═══════════════ */

export interface ApiContract {
  'GET /api/tasks': Paginated<Task>;
  'POST /api/tasks': Task;
  'GET /api/tasks/:id': TaskDetail;
  'PATCH /api/tasks/:id': Task;
  'DELETE /api/tasks/:id': { id: string };
  'POST /api/tasks/:id/assign': Task;
  'POST /api/tasks/:id/transition': Task;
  'POST /api/tasks/:id/accept': Task;
  'GET /api/tasks/:id/activities': TaskActivity[];
  'POST /api/tasks/:id/activities': TaskActivity;
  'GET /api/tasks/:id/artifacts': Artifact[];
  'POST /api/tasks/:id/artifacts': Artifact;
  'GET /api/tasks/metrics': TaskMetrics;
  'GET /api/inbox': Notification[];

  'GET /api/members': Member[];
  'POST /api/members': Member;
  'GET /api/members/:id': Member;
  'PATCH /api/members/:id': Member;
  'DELETE /api/members/:id': { id: string };
  'GET /api/members/:id/effective-permissions': EffectivePermission;
  'PUT /api/members/:id/agent-config': AgentConfig;

  'GET /api/sessions': Session[];
  'POST /api/sessions': Session;
  'GET /api/sessions/:id': SessionDetail;
  'DELETE /api/sessions/:id': { id: string };
  'POST /api/sessions/:id/model': Session;
  'GET /api/sessions/:id/messages': Message[];
  'POST /api/sessions/:id/messages': SendMessageResp;
  'PATCH /api/messages/:id': Message;
  'DELETE /api/messages/:id': { id: string };

  'GET /api/skills': Skill[];
  'POST /api/skills': Skill;
  'GET /api/skills/:id': SkillDetail;
  'PATCH /api/skills/:id': Skill;
  'DELETE /api/skills/:id': { id: string };
  'GET /api/skills/:id/versions': SkillVersion[];
  'POST /api/skills/:id/versions': SkillVersion;
  'POST /api/skills/:id/validate': ValidateResult;
  'POST /api/skills/:id/versions/:ver/publish': SkillVersion;
  'POST /api/skills/:id/versions/:ver/offline': SkillVersion;
  'GET /api/skills/:id/versions/:ver/impact': ImpactAnalysis;
  'POST /api/skills/:id/rollback': SkillVersion;
  'POST /api/skills/:id/execute': SkillExecutionResult;

  'GET /api/hub/repos': HubRepo[];
  'POST /api/hub/repos': HubRepo;
  'PATCH /api/hub/repos/:id': HubRepo;
  'DELETE /api/hub/repos/:id': { id: string };
  'POST /api/hub/repos/:id/sync': HubSyncResult;
  'GET /api/hub/skills': HubSkill[];
  'POST /api/hub/skills/:id/load': HubLoadResult;
  'POST /api/hub/skills/:id/disable': HubSkillDisabledResp;

  'GET /api/kb/spaces': KbSpace[];
  'POST /api/kb/spaces': KbSpace;
  'GET /api/kb/spaces/:id': KbSpaceDetail;
  'DELETE /api/kb/spaces/:id': { id: string };
  'GET /api/kb/documents': KbDocument[];
  'POST /api/kb/documents': KbDocument;
  'GET /api/kb/documents/:id': KbDocDetail;
  'PATCH /api/kb/documents/:id': KbDocument;
  'DELETE /api/kb/documents/:id': { id: string };
  'GET /api/kb/documents/:id/versions': KbDocVersion[];
  'POST /api/kb/documents/:id/versions/:ver/rollback': KbDocument;
  'POST /api/kb/documents/:id/polish': PolishResult;
  'GET /api/kb/sources': KbSyncSource[];
  'POST /api/kb/sources': KbSyncSource;
  'POST /api/kb/sources/:id/sync': KbSyncSourceResult;
  'POST /api/kb/query': QueryResult;
  'POST /api/kb/feedback': OkResp;

  'GET /api/audit': Paginated<AuditLog>;
  'GET /api/audit/trace/:traceId': AuditLog[];
  'GET /api/audit/security-events': SecurityEventStat[];
  'GET /api/apikeys': ApiKey[];
  'POST /api/apikeys': IssuedKeyResp;
  'POST /api/apikeys/:id/revoke': ApiKey;
  'GET /api/usage/summary': UsageSummary;
  'GET /api/usage': UsageRecord[];
  'GET /api/models': ModelConfig[];
  'POST /api/models': ModelConfig;
  'PATCH /api/models/:id': ModelConfig;
  'GET /api/models/routes': SceneRoute[];
  'PUT /api/models/routes': SceneRoute[];
  'GET /api/models/degradations': ModelDegradationLog[];
}

/** 编译期约束：确保 DTO 与端点契约保持一致 */
export type ContractOf<K extends keyof ApiContract> = ApiContract[K];

/** 保留的查询类型导出（供服务端解析层复用） */
export type {
  KbQueryLog,
  PermissionCapability,
  PolishScope,
  Scene,
  ReviewStatus,
  ScriptLang,
  SyncSourceType,
  TaskStatus,
};

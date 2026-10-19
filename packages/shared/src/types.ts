/**
 * 实体类型 —— 与 SQLite 表一一对应（camelCase ↔ snake_case，§3.1 / §4）
 * 所有时间字段为 ISO 8601 UTC 字符串（含 Z）；金额为人民币元（两位精度）；布尔用 boolean。
 */

import type {
  ActivityType,
  ApiKeyStatus,
  ArtifactType,
  AuditResult,
  FallbackPolicy,
  Feedback,
  HubAuthType,
  HubRepoType,
  KbDocFormat,
  MemberRole,
  MemberStatus,
  MemberType,
  MessageBlockKind,
  ModelHealth,
  ModelPriority,
  NotificationKind,
  NotificationPriority,
  PermissionCapability,
  Priority,
  RejectReason,
  RepoStatus,
  ReviewStatus,
  Scene,
  ScriptLang,
  SessionRole,
  SkillExecutionStatus,
  SkillSource,
  SkillStatus,
  SlaPolicy,
  SyncSourceType,
  SyncStatus,
  TaskStatus,
  TrustLevel,
  UsageCategory,
} from './enums';

/* ═══════════════ 工作空间 / 看板 ═══════════════ */

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface BoardColumn {
  id: string;
  workspaceId: string;
  key: TaskStatus;
  label: string;
  /** CSS 变量名，如 --st-1 */
  colorVar: string;
  sortOrder: number;
  wipLimit?: number;
}

/* ═══════════════ 成员 ═══════════════ */

export interface Member {
  id: string;
  workspaceId: string;
  type: MemberType;
  name: string;
  /** 账号标识 @xxx */
  handle?: string;
  /** 头像文字（李/张/AI） */
  avatarText: string;
  /** 人类灰底 var(--st-2) / AI 靛蓝 var(--ac) */
  avatarColor: string;
  role: MemberRole;
  capabilityTags: string[];
  /** 可访问项目/空间 */
  dataScope: string[];
  /** AI 成员的创建者（权限上限来源） */
  creatorId?: string;
  status: MemberStatus;
  createdAt: string;
  /** AI 成员附带配置 */
  agentConfig?: AgentConfig;
}

export interface AgentConfig {
  memberId: string;
  /** 角色定义 / 系统指令 */
  rolePrompt: string;
  primaryModelId?: string;
  fallbackModelIds: string[];
  skillIds: string[];
  toolIds: string[];
  kbSpaceIds: string[];
  /** 自身声明的数据域（有效权限 = min(自身声明, 创建者权限)） */
  declaredScope: string[];
  /** Token 上限 */
  contextBudget: number;
  /** 超限压缩顺序 */
  contextPriority: string[];
  /** 月度费用配额（元） */
  quotaMonthly: number;
  quotaUsed: number;
  version: string;
  /** 灰度比例 0-100 */
  grayRatio: number;
}

export interface EffectivePermission {
  memberId: string;
  /** 实际生效数据域 */
  scope: string[];
  /** 说明，例：min(自身声明, 创建者权限) */
  note: string;
}

/* ═══════════════ 任务 ═══════════════ */

export interface Task {
  id: string;
  /** TSK-8402 */
  code: string;
  workspaceId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: Priority;
  tags: string[];
  creatorId: string;
  assigneeId?: string;
  assigneeType?: MemberType;
  /** 截止时间 */
  slaDueAt?: string;
  slaPolicy?: SlaPolicy;
  /** 验收标准 */
  acceptCriteria?: string;
  /** 最近一次驳回原因分类 */
  rejectReasonCode?: RejectReason;
  /** 关联执行 TraceID */
  traceId?: string;
  /** 累计成本（元） */
  cost: number;
  tokenUsed: number;
  /** 并发分配乐观锁（FR-TK-08） */
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  type: ActivityType | string;
  /** 执行主体 */
  actorId: string;
  actorType: MemberType;
  /** 发起人（双主体留痕） */
  initiatorId?: string;
  content?: string;
  payload: Record<string, unknown>;
  reasonCode?: RejectReason;
  traceId?: string;
  durationMs?: number;
  tokenUsed?: number;
  createdAt: string;
}

export interface Artifact {
  id: string;
  /** ART-1192 */
  code: string;
  taskId?: string;
  type: ArtifactType;
  title: string;
  uri?: string;
  /** 演示用内联内容 */
  content?: string;
  sizeBytes: number;
  submittedBy?: string;
  traceId?: string;
  version: number;
  createdAt: string;
}

export interface Notification {
  id: string;
  workspaceId: string;
  recipientId: string;
  kind: NotificationKind;
  title: string;
  refType?: string;
  refId?: string;
  priority: NotificationPriority;
  read: boolean;
  createdAt: string;
}

export interface TaskMetrics {
  throughput: number;
  avgDurationMin: number;
  rejectRate: number;
  agentFirstPassRate: number;
}

/* ═══════════════ 会话 / 消息 ═══════════════ */

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  ownerId: string;
  /** 执行成员（AI） */
  agentId?: string;
  modelId?: string;
  kbSpaceId?: string;
  skillIds: string[];
  /** 权限范围（运营组…） */
  permScope?: string;
  relatedTaskIds: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageBlock {
  kind: MessageBlockKind;
  data: Record<string, unknown>;
}

export interface Citation {
  docId: string;
  spaceName: string;
  heading?: string;
  version: number;
  snippet?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: SessionRole;
  authorId?: string;
  /** Markdown / 文本 */
  content?: string;
  /** 工具调用 / 引用等富块 */
  blocks: MessageBlock[];
  citations: Citation[];
  modelId?: string;
  tokenIn: number;
  tokenOut: number;
  cost: number;
  durationMs?: number;
  createdAt: string;
}

/* ═══════════════ 模型 ═══════════════ */

export interface ModelConfig {
  id: string;
  /** Claude Opus 4.5 */
  name: string;
  /** Anthropic / DeepSeek / 自托管 / 自建 */
  vendor: string;
  contextWindow: number;
  /** 复杂推理 / 日常执行 / 批处理 / 代码补全 */
  purpose?: string;
  priority: ModelPriority;
  health: ModelHealth;
  baseUrl?: string;
  /** 密钥引用（不落明文） */
  apiKeyRef?: string;
  /** 元 / 1K token */
  inputPrice: number;
  outputPrice: number;
  enabled: boolean;
  createdAt: string;
}

export interface SceneRoute {
  id: string;
  scene: Scene;
  label: string;
  primaryModelId: string;
  fallbackModelId?: string;
}

export interface ModelDegradationLog {
  id: string;
  occurredAt: string;
  /** Opus 超时率 >5% */
  event: string;
  /** 降级 Sonnet / 停用该模型 */
  action: string;
  fromModelId?: string;
  toModelId?: string;
  traceId?: string;
}

/* ═══════════════ 技能 ═══════════════ */

export interface Skill {
  id: string;
  workspaceId: string;
  /** 团队内唯一标识 */
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  tags: string[];
  source: SkillSource;
  hubSkillId?: string;
  trustLevel: TrustLevel;
  status: SkillStatus;
  /** v1.4.0 */
  currentVersion?: string;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface StaticIssue {
  line: number;
  msg: string;
}

export interface StaticCheckResult {
  pass: boolean;
  issues: StaticIssue[];
}

export interface PermissionDecl {
  capability: PermissionCapability;
  /** 是否声明启用 */
  granted: boolean;
  /** 白名单明细：域名/路径/大小 */
  detail?: string;
}

export interface SkillVersion {
  id: string;
  skillId: string;
  /** 语义化 v1.4.0 */
  version: string;
  status: SkillStatus;
  /** JSON Schema */
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** 提示词（含变量占位符） */
  prompt?: string;
  /** 脚本（白名单语言） */
  script?: string;
  scriptLang?: ScriptLang;
  staticCheck: StaticCheckResult;
  changeNote?: string;
  /** 回滚来源版本 */
  rollbackFrom?: string;
  permissions: PermissionDecl[];
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
}

export interface ValidateResult {
  pass: boolean;
  permissionIssues: string[];
  staticIssues: StaticIssue[];
}

export interface ImpactAnalysis {
  version: string;
  referencedByAgents: string[];
  referencedByWorkflows: string[];
  blocked: boolean;
}

export interface SkillExecution {
  id: string;
  skillId?: string;
  skillVersion?: string;
  source?: SkillSource;
  trustLevel?: TrustLevel;
  sandboxId?: string;
  taskId?: string;
  sessionId?: string;
  input?: string;
  output?: string;
  status: SkillExecutionStatus;
  /** 越权 / 签名失败 / 高危调用 */
  blockReason?: string;
  durationMs?: number;
  /** 本地落盘文件数（应恒为 0） */
  localFiles: number;
  traceId?: string;
  createdAt: string;
}

export interface SkillExecutionResult {
  executionId: string;
  skillId: string;
  version: string;
  status: SkillExecutionStatus;
  output: Record<string, unknown> | null;
  blockReason?: string;
  sandboxId: string;
  localFiles: number;
  durationMs: number;
  tokenUsed: number;
  cost: number;
  traceId: string;
}

/* ═══════════════ Hub ═══════════════ */

export interface HubRepo {
  id: string;
  /** platform-official */
  name: string;
  url: string;
  type: HubRepoType;
  authType?: HubAuthType;
  trustLevel: TrustLevel;
  signatureRequired: boolean;
  skillCount: number;
  status: RepoStatus;
  fallbackPolicy: FallbackPolicy;
  lastSyncAt?: string;
  createdAt: string;
}

export interface HubSkill {
  id: string;
  repoId: string;
  name: string;
  slug: string;
  description?: string;
  version: string;
  tags: string[];
  /** 仅元数据 */
  permissions: PermissionDecl[];
  installCount: number;
  successRate?: number;
  reportCount: number;
  reviewStatus: ReviewStatus;
  signatureOk?: boolean;
  cachedMeta: Record<string, unknown>;
  cacheExpireAt?: string;
  createdAt: string;
}

export interface HubLoadResult {
  loaded: boolean;
  trustLevel: TrustLevel;
  signatureOk: boolean;
  sandboxRequired: boolean;
}

export interface HubSyncResult {
  synced: number;
  failed: number;
  lastSyncAt: string;
}

/* ═══════════════ 知识库 ═══════════════ */

export interface KbSpace {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  /** 可读成员 / 角色 */
  acl: string[];
  docCount: number;
  createdAt: string;
}

export interface KbDocument {
  id: string;
  spaceId: string;
  title: string;
  /** 富文本 / Markdown */
  content: string;
  format: KbDocFormat;
  tags: string[];
  source: string;
  remoteId?: string;
  currentVersion: number;
  acl: string[];
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolishMeta {
  originalIndexes: number[];
  /** 保留的事实 / 数字 / 术语（便于前端对比与还原） */
  preserved?: string[];
}

export interface KbDocVersion {
  id: string;
  docId: string;
  version: number;
  content: string;
  /** 与上一版本差异（AI 润色标记） */
  diff?: string;
  polishMeta: PolishMeta;
  editedBy?: string;
  note?: string;
  createdAt: string;
}

export interface KbSyncSource {
  id: string;
  spaceId: string;
  sourceType: SyncSourceType;
  /** space key / page / 路径 / URL */
  target: string;
  /** 远端 ACL → 平台 ACL */
  aclMap: Record<string, string>;
  intervalMin: number;
  lastSyncAt?: string;
  lastStatus?: SyncStatus;
  failedCount: number;
  /** 单向镜像 */
  mirrorOnly: boolean;
  createdAt: string;
}

export interface KbChunk {
  id: string;
  docId: string;
  spaceId: string;
  version: number;
  /** 保留标题层级 */
  heading?: string;
  content: string;
  tokenCount: number;
  /** 演示用占位（真实接向量库） */
  embedding?: string;
  createdAt: string;
}

export interface KbQueryLog {
  id: string;
  workspaceId: string;
  askerId: string;
  query: string;
  /** 检索范围（空间 / 当前页） */
  scope?: string;
  topK: number;
  citationCount: number;
  answer?: string;
  /** 依据不足标记 */
  insufficient: boolean;
  feedback?: Feedback;
  feedbackBy?: string;
  traceId?: string;
  createdAt: string;
}

export interface QueryResult {
  queryId: string;
  answer: string;
  insufficient: boolean;
  citations: Citation[];
  scope: string;
  traceId: string;
}

export interface PolishResult {
  candidates: string[];
  polishMeta: PolishMeta;
}

export interface KbSyncSourceResult {
  docCount: number;
  failedCount: number;
  status: SyncStatus;
}

/* ═══════════════ 治理 ═══════════════ */

export interface AuditLog {
  id: string;
  traceId: string;
  occurredAt: string;
  actorId?: string;
  actorType?: MemberType;
  actorName?: string;
  initiatorId?: string;
  initiatorName?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  durationMs?: number;
  tokenUsed?: number;
  result: AuditResult;
  /** JSON 入参出参（脱敏） */
  detail: Record<string, unknown>;
  workspaceId?: string;
  createdAt: string;
}

/** 对外返回的 API Key（**永不包含 key_hash**，§4.8） */
export interface ApiKey {
  id: string;
  workspaceId: string;
  /** ci-pipeline */
  name: string;
  /** 展示用前缀 */
  keyPrefix: string;
  scopes: string[];
  rateLimitPerMin: number;
  ownerId: string;
  lastUsedAt?: string;
  status: ApiKeyStatus;
  createdAt: string;
}

/** 数据库行形态（含哈希，仅服务端内部使用，禁止出现在 API 响应中） */
export interface ApiKeyRecord extends ApiKey {
  keyHash: string;
}

export type ApiKeyView = ApiKey;

export interface UsageRecord {
  id: string;
  workspaceId: string;
  occurredAt: string;
  category: UsageCategory;
  modelId?: string;
  agentId?: string;
  apiKeyId?: string;
  taskId?: string;
  /** 归属项目 */
  project?: string;
  tokenIn: number;
  tokenOut: number;
  /** 元 */
  cost: number;
  traceId?: string;
}

export interface UsageSummary {
  byModel: { modelId: string; name: string; tokens: number; cost: number }[];
  byCaller: { apiKeyId?: string; name: string; tokens: number; cost: number; attribution: string }[];
  totalCost: number;
  reconcileDiffPct: number;
}

export interface SecurityEventStat {
  type: string;
  today: number;
  month: number;
}

/* ═══════════════ AI 模拟层数据结构 ═══════════════ */

/** 单步执行轨迹（§5.1 的 agent_plan / tool_call / artifact_submitted） */
export interface ExecutionStep {
  kind: 'plan' | 'retrieve' | 'skill' | 'model' | 'artifact' | 'note';
  title: string;
  detail: string;
  durationMs: number;
  tokenUsed: number;
  cost: number;
  payload: Record<string, unknown>;
}

export interface ExecutionTrace {
  traceId: string;
  taskId: string;
  agentId: string;
  steps: ExecutionStep[];
  artifact: {
    type: ArtifactType;
    title: string;
    content: string;
    uri?: string;
    sizeBytes: number;
  };
  citations: Citation[];
  tokenUsed: number;
  cost: number;
  durationMs: number;
}

/**
 * 全部状态枚举 + 中文映射 + 颜色令牌（对应 architecture.md §7.1）
 *
 * 命名规范（§7.3）：
 *  - 枚举对象/类型：PascalCase
 *  - 枚举成员：SCREAMING_SNAKE
 *  - 持久值：snake_case 小写（与 DB CHECK 约束、API 传输值一致）
 *
 * 说明：`as const` 对象 + 同名 `type` 形成 值/类型 双声明，可在运行时遍历、在编译期做字面量收窄。
 */

/* ═══════════════════════ 通用工具 ═══════════════════════ */

/** 安全地从标签映射取中文，未命中时回退原始值。 */
export function labelOf<T extends string>(
  map: Record<string, string>,
  value: T | null | undefined,
  fallback = '—',
): string {
  if (value === null || value === undefined || value === '') return fallback;
  return map[value] ?? String(value);
}

/* ═══════════════════════ 成员 ═══════════════════════ */

export const MemberType = { HUMAN: 'human', AI: 'ai' } as const;
export type MemberType = (typeof MemberType)[keyof typeof MemberType];
export const MEMBER_TYPE_LABEL: Record<MemberType, string> = { human: '人类', ai: 'AI 成员' };
/** 人类灰底 --st-2；AI 靛蓝底 --ac（§7.1） */
export const MEMBER_TYPE_COLOR: Record<MemberType, string> = { human: 'var(--st-2)', ai: 'var(--ac)' };

export const MemberRole = {
  ADMIN: 'admin',
  SPACE_ADMIN: 'space_admin',
  MEMBER: 'member',
  EXTERNAL: 'external',
} as const;
export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  admin: '平台管理员',
  space_admin: '空间管理员',
  member: '团队成员',
  external: '外部贡献者',
};

export const MemberStatus = { ACTIVE: 'active', DISABLED: 'disabled' } as const;
export type MemberStatus = (typeof MemberStatus)[keyof typeof MemberStatus];
export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = { active: '启用', disabled: '停用' };

/* ═══════════════════════ 任务 ═══════════════════════ */

export const TaskStatus = {
  BACKLOG: 'backlog',
  TODO: 'todo',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  DONE: 'done',
  SUSPENDED: 'suspended',
  CANCELLED: 'cancelled',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  backlog: '待排期',
  todo: '待办',
  in_progress: '进行中',
  in_review: '审核中',
  done: '已完成',
  suspended: '已挂起',
  cancelled: '已取消',
};
export const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'var(--st-1)',
  todo: 'var(--st-2)',
  in_progress: 'var(--st-3)',
  in_review: 'var(--st-4)',
  done: 'var(--st-5)',
  suspended: 'var(--st-3)',
  cancelled: 'var(--tx-3)',
};

export const Priority = { P1: 'p1', P2: 'p2', P3: 'p3' } as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITY_LABEL: Record<Priority, string> = { p1: '紧急', p2: '高', p3: '普通' };
export const PRIORITY_COLOR: Record<Priority, string> = {
  p1: 'var(--err)',
  p2: 'var(--warn)',
  p3: 'var(--st-1)',
};

export const RejectReason = {
  INFO_INSUFFICIENT: 'info_insufficient',
  WRONG_DIRECTION: 'wrong_direction',
  QUALITY_FAIL: 'quality_fail',
  OTHER: 'other',
} as const;
export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];
export const REJECT_REASON_LABEL: Record<RejectReason, string> = {
  info_insufficient: '信息不足',
  wrong_direction: '方向错误',
  quality_fail: '质量不合格',
  other: '其他',
};

export const SlaPolicy = { NOTIFY: 'notify', RETRY: 'retry', TO_HUMAN: 'to_human' } as const;
export type SlaPolicy = (typeof SlaPolicy)[keyof typeof SlaPolicy];
export const SLA_POLICY_LABEL: Record<SlaPolicy, string> = {
  notify: '仅提醒',
  retry: '自动重试',
  to_human: '转人工',
};

export const ActivityType = {
  STATUS_CHANGE: 'status_change',
  COMMENT: 'comment',
  AGENT_PLAN: 'agent_plan',
  TOOL_CALL: 'tool_call',
  ARTIFACT_SUBMITTED: 'artifact_submitted',
  APPROVAL: 'approval',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];
export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  status_change: '状态变更',
  comment: '评论',
  agent_plan: '执行计划',
  tool_call: '工具调用',
  artifact_submitted: '提交交付物',
  approval: '验收',
};

export const ArtifactType = {
  DOC: 'doc',
  REPORT: 'report',
  CHART: 'chart',
  CODE: 'code',
  DATA: 'data',
} as const;
export type ArtifactType = (typeof ArtifactType)[keyof typeof ArtifactType];
export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  doc: '文档',
  report: '报告',
  chart: '图表',
  code: '代码',
  data: '数据',
};

/* ═══════════════════════ 通知 ═══════════════════════ */

export const NotificationKind = {
  APPROVAL: 'approval',
  MENTION: 'mention',
  KB_FEEDBACK: 'kb_feedback',
  SLA: 'sla',
  SECURITY: 'security',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];
export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  approval: '审批',
  mention: '提及',
  kb_feedback: '问答反馈',
  sla: 'SLA',
  security: '安全',
};

export const NotificationPriority = { NORMAL: 'normal', URGENT: 'urgent' } as const;
export type NotificationPriority = (typeof NotificationPriority)[keyof typeof NotificationPriority];

/* ═══════════════════════ 会话 ═══════════════════════ */

export const SessionRole = { USER: 'user', ASSISTANT: 'assistant', TOOL: 'tool', SYSTEM: 'system' } as const;
export type SessionRole = (typeof SessionRole)[keyof typeof SessionRole];
export const SESSION_ROLE_LABEL: Record<SessionRole, string> = {
  user: '用户',
  assistant: 'AI',
  tool: '工具',
  system: '系统',
};

export const MessageBlockKind = { TOOL_CALL: 'tool_call', CITATION: 'citation', TEXT: 'text' } as const;
export type MessageBlockKind = (typeof MessageBlockKind)[keyof typeof MessageBlockKind];

/* ═══════════════════════ 模型 ═══════════════════════ */

export const ModelHealth = { HEALTHY: 'healthy', OVERLOADED: 'overloaded', UNAVAILABLE: 'unavailable' } as const;
export type ModelHealth = (typeof ModelHealth)[keyof typeof ModelHealth];
export const MODEL_HEALTH_LABEL: Record<ModelHealth, string> = {
  healthy: '正常',
  overloaded: '负载高',
  unavailable: '不可用',
};
export const MODEL_HEALTH_COLOR: Record<ModelHealth, string> = {
  healthy: 'var(--ok)',
  overloaded: 'var(--warn)',
  unavailable: 'var(--err)',
};

export const ModelPriority = {
  PRIMARY: 'primary',
  BACKUP: 'backup',
  P1: 'p1',
  P2: 'p2',
  DISABLED: 'disabled',
} as const;
export type ModelPriority = (typeof ModelPriority)[keyof typeof ModelPriority];
export const MODEL_PRIORITY_LABEL: Record<ModelPriority, string> = {
  primary: '主力',
  backup: '备用',
  p1: 'P1',
  p2: 'P2',
  disabled: '已停用',
};

export const Scene = { REASONING: 'reasoning', DAILY: 'daily', BATCH: 'batch', SENSITIVE: 'sensitive' } as const;
export type Scene = (typeof Scene)[keyof typeof Scene];
export const SCENE_LABEL: Record<Scene, string> = {
  reasoning: '复杂推理',
  daily: '日常执行',
  batch: '高并发批处理',
  sensitive: '涉敏感数据',
};

/* ═══════════════════════ 技能 / Hub ═══════════════════════ */

export const SkillStatus = {
  DRAFT: 'draft',
  IN_REVIEW: 'in_review',
  PUBLISHED: 'published',
  OFFLINE: 'offline',
} as const;
export type SkillStatus = (typeof SkillStatus)[keyof typeof SkillStatus];
export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  draft: '草稿',
  in_review: '待审核',
  published: '已发布',
  offline: '已下线',
};

export const TrustLevel = { OFFICIAL: 'official', ORG: 'org', COMMUNITY: 'community' } as const;
export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];
export const TRUST_LEVEL_LABEL: Record<TrustLevel, string> = {
  official: '官方',
  org: '组织内',
  community: '社区',
};

export const ReviewStatus = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' } as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
};

export const SkillSource = { LOCAL: 'local', HUB: 'hub' } as const;
export type SkillSource = (typeof SkillSource)[keyof typeof SkillSource];
export const SKILL_SOURCE_LABEL: Record<SkillSource, string> = { local: '本地', hub: '技能市场' };

export const PermissionCapability = {
  FS_READ: 'fs_read',
  FS_WRITE: 'fs_write',
  NET: 'net',
  API: 'api',
  KB_READ: 'kb_read',
  TASK_READ: 'task_read',
} as const;
export type PermissionCapability = (typeof PermissionCapability)[keyof typeof PermissionCapability];
export const PERMISSION_CAPABILITY_LABEL: Record<PermissionCapability, string> = {
  fs_read: '读文件',
  fs_write: '写文件',
  net: '访问公网',
  api: '访问外部 API',
  kb_read: '读取知识库',
  task_read: '读取任务数据',
};
/** 权限声明顺序（UI 表格顺序，§4.5） */
export const PERMISSION_CAPABILITY_ORDER: PermissionCapability[] = [
  'fs_read',
  'fs_write',
  'net',
  'api',
  'kb_read',
  'task_read',
];

export const SkillExecutionStatus = { SUCCESS: 'success', BLOCKED: 'blocked', ERROR: 'error' } as const;
export type SkillExecutionStatus = (typeof SkillExecutionStatus)[keyof typeof SkillExecutionStatus];
export const SKILL_EXECUTION_STATUS_LABEL: Record<SkillExecutionStatus, string> = {
  success: '成功',
  blocked: '已阻断',
  error: '失败',
};

export const ScriptLang = { PYTHON: 'python', NODEJS: 'nodejs' } as const;
export type ScriptLang = (typeof ScriptLang)[keyof typeof ScriptLang];

export const HubRepoType = { GIT: 'git', HTTP: 'http', REGISTRY: 'registry' } as const;
export type HubRepoType = (typeof HubRepoType)[keyof typeof HubRepoType];
export const HUB_REPO_TYPE_LABEL: Record<HubRepoType, string> = {
  git: 'Git',
  http: 'HTTP',
  registry: 'Registry',
};

export const HubAuthType = { TOKEN: 'token', OAUTH: 'oauth', NONE: 'none' } as const;
export type HubAuthType = (typeof HubAuthType)[keyof typeof HubAuthType];

export const FallbackPolicy = { CACHE: 'cache', BLOCK: 'block', NOTIFY: 'notify' } as const;
export type FallbackPolicy = (typeof FallbackPolicy)[keyof typeof FallbackPolicy];
export const FALLBACK_POLICY_LABEL: Record<FallbackPolicy, string> = {
  cache: '使用缓存',
  block: '阻断',
  notify: '告警并放行',
};

export const RepoStatus = { ACTIVE: 'active', DISABLED: 'disabled' } as const;
export type RepoStatus = (typeof RepoStatus)[keyof typeof RepoStatus];

/* ═══════════════════════ 知识库 ═══════════════════════ */

export const KbDocFormat = { MARKDOWN: 'markdown', RICHTEXT: 'richtext' } as const;
export type KbDocFormat = (typeof KbDocFormat)[keyof typeof KbDocFormat];

export const SyncSourceType = {
  CONFLUENCE: 'confluence',
  NOTION: 'notion',
  FILE: 'file',
  URL: 'url',
} as const;
export type SyncSourceType = (typeof SyncSourceType)[keyof typeof SyncSourceType];
export const SYNC_SOURCE_TYPE_LABEL: Record<SyncSourceType, string> = {
  confluence: 'Confluence',
  notion: 'Notion',
  file: '本地文件',
  url: '网页 URL',
};

export const SyncStatus = { SUCCESS: 'success', FAILED: 'failed' } as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];
export const SYNC_STATUS_LABEL: Record<SyncStatus, string> = { success: '成功', failed: '失败' };

export const Feedback = { ADOPT: 'adopt', REJECT: 'reject', INSUFFICIENT: 'insufficient' } as const;
export type Feedback = (typeof Feedback)[keyof typeof Feedback];
export const FEEDBACK_LABEL: Record<Feedback, string> = {
  adopt: '采纳',
  reject: '点踩',
  insufficient: '依据不足',
};

export const PolishAction = {
  POLISH: 'polish',
  EXPAND: 'expand',
  SHORTEN: 'shorten',
  PROOFREAD: 'proofread',
  TRANSLATE: 'translate',
  REWRITE: 'rewrite',
  SUMMARIZE: 'summarize',
} as const;
export type PolishAction = (typeof PolishAction)[keyof typeof PolishAction];
export const POLISH_ACTION_LABEL: Record<PolishAction, string> = {
  polish: '润色',
  expand: '扩写',
  shorten: '精简',
  proofread: '校对',
  translate: '翻译',
  rewrite: '改写',
  summarize: '总结',
};

export const PolishScope = { SELECTION: 'selection', PARAGRAPH: 'paragraph', FULL: 'full' } as const;
export type PolishScope = (typeof PolishScope)[keyof typeof PolishScope];

export const KbQueryScopeKind = { ALL: 'all', SPACE: 'space', DOCUMENT: 'document' } as const;
export type KbQueryScopeKind = (typeof KbQueryScopeKind)[keyof typeof KbQueryScopeKind];

/* ═══════════════════════ 治理 ═══════════════════════ */

export const AuditResult = { SUCCESS: 'success', FAILED: 'failed', BLOCKED: 'blocked' } as const;
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];
export const AUDIT_RESULT_LABEL: Record<AuditResult, string> = {
  success: '成功',
  failed: '失败',
  blocked: '已阻断',
};
export const AUDIT_RESULT_COLOR: Record<AuditResult, string> = {
  success: 'var(--ok)',
  failed: 'var(--err)',
  blocked: 'var(--warn)',
};

export const ApiKeyStatus = { ACTIVE: 'active', REVOKED: 'revoked' } as const;
export type ApiKeyStatus = (typeof ApiKeyStatus)[keyof typeof ApiKeyStatus];
export const API_KEY_STATUS_LABEL: Record<ApiKeyStatus, string> = { active: '有效', revoked: '已吊销' };

/** 对外 Key 可授予的 scope（§4.9 / FR-API） */
export const ApiScope = {
  WORKFLOW_RUN: 'workflow:run',
  AGENT_INVOKE: 'agent:invoke',
  SKILL_EXECUTE: 'skill:execute',
  KB_QUERY: 'kb:query',
} as const;
export type ApiScope = (typeof ApiScope)[keyof typeof ApiScope];
export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  'workflow:run': '运行工作流',
  'agent:invoke': '调用 Agent',
  'skill:execute': '执行技能',
  'kb:query': '知识库检索',
};

export const UsageCategory = {
  MODEL: 'model',
  TASK: 'task',
  SEAT: 'seat',
  STORAGE: 'storage',
  SANDBOX: 'sandbox',
} as const;
export type UsageCategory = (typeof UsageCategory)[keyof typeof UsageCategory];
export const USAGE_CATEGORY_LABEL: Record<UsageCategory, string> = {
  model: '模型调用',
  task: '任务执行',
  seat: '席位',
  storage: '存储',
  sandbox: '沙箱',
};

/** 安全事件统计分类（§4.8 /audit/security-events） */
export const SecurityEventType = {
  SKILL_REJECTED: 'skill_rejected',
  SCOPE_DENIED: 'scope_denied',
  SIGNATURE_INVALID: 'signature_invalid',
  TRUST_PENDING: 'trust_pending',
  DOMAIN_NOT_ALLOWED: 'domain_not_allowed',
  RATE_LIMITED: 'rate_limited',
  BUDGET_EXCEEDED: 'budget_exceeded',
  DELEGATION_DEPTH_EXCEEDED: 'delegation_depth_exceeded',
} as const;
export type SecurityEventType = (typeof SecurityEventType)[keyof typeof SecurityEventType];
export const SECURITY_EVENT_LABEL: Record<SecurityEventType, string> = {
  skill_rejected: '技能越权拦截',
  scope_denied: '数据域越权',
  signature_invalid: '签名校验失败',
  trust_pending: '社区技能待审拦截',
  domain_not_allowed: '出网域名拦截',
  rate_limited: '限流触发',
  budget_exceeded: '预算熔断',
  delegation_depth_exceeded: '委派层级超限',
};

/* ═══════════════════════ 埋点事件（PRD §9.2） ═══════════════════════ */

export const MetricEvent = {
  TASK_CREATED: 'task_created',
  TASK_ASSIGNED: 'task_assigned',
  TASK_TRANSITIONED: 'task_transitioned',
  TASK_ACCEPTED: 'task_accepted',
  TASK_REJECTED: 'task_rejected',
  AGENT_RUN_START: 'agent_run_start',
  AGENT_RUN_FINISH: 'agent_run_finish',
  SKILL_EXECUTED: 'skill_executed',
  SKILL_REJECTED: 'skill_rejected',
  SKILL_PUBLISHED: 'skill_published',
  HUB_SYNCED: 'hub_synced',
  KB_QUERY: 'kb_query',
  KB_FEEDBACK: 'kb_feedback',
  DOC_SAVED: 'doc_saved',
  DOC_POLISHED: 'doc_polished',
  MODEL_DEGRADED: 'model_degraded',
  API_KEY_ISSUED: 'api_key_issued',
  API_KEY_REVOKED: 'api_key_revoked',
  OPENAPI_INVOKED: 'openapi_invoked',
  SESSION_CREATED: 'session_created',
  MESSAGE_SENT: 'message_sent',
} as const;
export type MetricEvent = (typeof MetricEvent)[keyof typeof MetricEvent];

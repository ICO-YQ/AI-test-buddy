/**
 * 契约常量（对应 architecture.md §7.1 状态转移表 / §4 契约 / §7.6 路由表）
 * 这些常量被服务端强制约束与前端展示共同引用，必须保持唯一来源。
 */

import {
  ApiScope,
  MemberRole,
  PermissionCapability,
  TaskStatus,
  type Priority,
  type RejectReason,
  type SkillStatus,
} from './enums';

/* ═══════════════════ 任务状态转移表（仅前向，不可回退） ═══════════════════ */

/**
 * backlog     → todo | cancelled
 * todo        → in_progress | cancelled
 * in_progress → in_review | suspended
 * in_review   → done | in_progress(驳回，前向跳转) | suspended
 * suspended   → in_progress | cancelled
 * done        → (终态)
 * cancelled   → (终态)
 */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['todo', 'cancelled'],
  todo: ['in_progress', 'cancelled'],
  in_progress: ['in_review', 'suspended'],
  in_review: ['done', 'in_progress', 'suspended'],
  suspended: ['in_progress', 'cancelled'],
  done: [],
  cancelled: [],
};

/** 终态（不可再做任何流转） */
export const TERMINAL_STATUSES: TaskStatus[] = ['done', 'cancelled'];

/** 不允许 PATCH 的状态（已验收不可修改，§4.2） */
export const IMMUTABLE_STATUSES: TaskStatus[] = ['done'];

/** 「驳回」语义标识：in_review → in_progress 为前向跳转，非回退 */
export const REJECT_TRANSITION = { from: 'in_review' as TaskStatus, to: 'in_progress' as TaskStatus };

/** 看板列顺序（§7.6 / board_column） */
export const BOARD_COLUMN_ORDER: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

/** 优先级排序（数字越小越靠前） */
export const PRIORITY_WEIGHT: Record<Priority, number> = { p1: 0, p2: 1, p3: 2 };

/** 全部驳回原因（用于服务端校验） */
export const REJECT_REASONS: RejectReason[] = [
  'info_insufficient',
  'wrong_direction',
  'quality_fail',
  'other',
];

/* ═══════════════════ 权限矩阵 ═══════════════════ */

/** 角色可执行的动作集合 */
export const PERMISSION_MATRIX: Record<MemberRole, string[]> = {
  admin: [
    'task:*',
    'member:*',
    'skill:*',
    'hub:*',
    'kb:*',
    'session:*',
    'model:*',
    'audit:read',
    'apikey:*',
    'usage:read',
  ],
  space_admin: [
    'task:*',
    'member:read',
    'member:write_ai',
    'skill:*',
    'hub:read',
    'hub:load',
    'kb:*',
    'session:*',
    'model:read',
    'audit:read',
    'apikey:*',
    'usage:read',
  ],
  member: [
    'task:read',
    'task:create',
    'task:comment',
    'task:accept',
    'member:read',
    'skill:read',
    'skill:execute',
    'hub:read',
    'hub:load',
    'kb:read',
    'kb:write',
    'kb:query',
    'session:*',
    'model:read',
    'usage:read:self',
  ],
  external: ['task:read', 'kb:read', 'kb:query', 'session:read'],
};

/** 需要写审计的敏感动作（审计失败即阻断，EX-19） */
export const AUDIT_CRITICAL_ACTIONS: string[] = [
  'task_created',
  'task_assigned',
  'task_transitioned',
  'task_accepted',
  'task_rejected',
  'skill_published',
  'skill_offline',
  'skill_executed',
  'skill_rejected',
  'hub_repo_registered',
  'hub_repo_synced',
  'hub_skill_loaded',
  'hub_skill_disabled',
  'model_called',
  'model_degraded',
  'agent_config_updated',
  'api_key_issued',
  'api_key_revoked',
  'openapi_invoked',
  'doc_deleted',
  'kb_space_deleted',
];

/* ═══════════════════ 技能契约 ═══════════════════ */

/** 全部能力声明项（用于校验声明完整性） */
export const ALL_CAPABILITIES: PermissionCapability[] = [
  'fs_read',
  'fs_write',
  'net',
  'api',
  'kb_read',
  'task_read',
];

/**
 * 危险 API 扫描规则（§4.5 静态检查）
 * 命中即 pass=false；`capability` 表示该 API 归属的权限能力，
 * 用于「权限声明 vs 实际调用」一致性判断。
 */
/**
 * 技能脚本的静态检查规则表。
 *
 * ⚠️ **局限声明（请勿高估这道防线）**
 * 这是**子串黑名单**，不是完备的静态分析 —— 它挡不住字符串拼接、编码混淆、
 * 动态 getattr、以及本表未列出的系统调用入口。它的定位是「低成本的第一道闸门 +
 * 给作者清晰的行为约束」，真正兜底的必须是**服务端沙箱的运行时隔离**。
 * 接真实沙箱（REPLACE_POINT: Sandbox）前，请按目标语言的逃逸面重新评估本表。
 *
 * 规则语义：
 *  - `capability === null` → **禁止类**：无权限可声明，命中即判定不通过；
 *  - `capability !== null`  → **可声明类**：仅推导「需要哪个能力」，由
 *    「推导能力 ⊆ 已声明能力」决定是否放行。
 */
export const DANGEROUS_APIS: { pattern: string; msg: string; capability: PermissionCapability | null }[] = [
  /* ── 进程创建 / 逃逸（禁止类：无权限可声明）── */
  { pattern: 'child_process', msg: '禁止调用 child_process（进程逃逸风险）', capability: null },
  { pattern: 'subprocess', msg: '禁止调用 subprocess（进程逃逸风险）', capability: null },
  { pattern: 'spawn(', msg: '禁止创建子进程（进程逃逸风险）', capability: null },
  { pattern: 'spawnSync', msg: '禁止创建子进程（进程逃逸风险）', capability: null },
  { pattern: 'popen', msg: '禁止调用 popen（进程逃逸风险）', capability: null },
  { pattern: 'fork(', msg: '禁止 fork 进程', capability: null },
  // pty 可分配伪终端，是绕过「仅拦截 subprocess」的经典路径
  // （例：`import pty; pty.spawn("/bin/sh")`）
  { pattern: 'pty.spawn', msg: '禁止调用 pty.spawn（伪终端可逃逸沙箱）', capability: null },
  { pattern: 'import pty', msg: '禁止导入 pty 模块（伪终端可逃逸沙箱）', capability: null },
  { pattern: 'os.system', msg: '禁止调用 os.system（进程逃逸风险）', capability: null },
  { pattern: 'os.exec', msg: '禁止调用 os.exec*（进程替换）', capability: null },
  { pattern: 'os.spawn', msg: '禁止调用 os.spawn*（进程创建）', capability: null },
  { pattern: 'os.fork', msg: '禁止调用 os.fork', capability: null },
  { pattern: 'os.popen', msg: '禁止调用 os.popen', capability: null },
  // 同样覆盖裸导入与调用两种写法
  { pattern: 'commands.', msg: '禁止调用 commands（进程执行，Python 2 遗留）', capability: null },
  { pattern: 'import commands', msg: '禁止导入 commands 模块（进程执行）', capability: null },

  /* ── 动态代码执行 ── */
  { pattern: 'eval(', msg: '禁止使用 eval（动态代码执行）', capability: null },
  { pattern: 'exec(', msg: '禁止使用 exec（动态代码执行）', capability: null },
  { pattern: 'Function(', msg: '禁止动态构造 Function', capability: null },
  { pattern: '__import__', msg: '禁止动态 import', capability: null },
  // 注意：必须同时覆盖「裸导入」与「点号调用」两种写法 ——
  // 只写 `ctypes.` 的话，`import ctypes` 就能绕过（这正是 DEF-07 的同类漏洞）。
  { pattern: 'ctypes', msg: '禁止使用 ctypes（可绕过语言层限制直接调系统 API）', capability: null },

  /* ── 不安全反序列化 ── */
  { pattern: 'pickle.loads', msg: '禁止反序列化不可信数据（pickle）', capability: null },
  { pattern: 'marshal.loads', msg: '禁止反序列化不可信数据（marshal）', capability: null },
  { pattern: 'yaml.load(', msg: '禁止 yaml.load（不安全反序列化，应使用 safe_load）', capability: null },

  /* ── 底层网络 / 内存（禁止类：绕过能力声明）── */
  { pattern: 'socket.', msg: '禁止直接使用 socket（绕过 net 能力声明）', capability: null },
  { pattern: 'mmap.', msg: '禁止使用 mmap（绕过文件层控制）', capability: null },

  /* ── 可声明类：需要对应能力授权才能执行 ── */
  { pattern: 'open(', msg: '文件读写需声明 fs_read/fs_write', capability: 'fs_read' },
  { pattern: 'readFile', msg: '文件读取需声明 fs_read', capability: 'fs_read' },
  { pattern: 'writeFile', msg: '文件写入需声明 fs_write', capability: 'fs_write' },
  { pattern: 'requests.', msg: '公网访问需声明 net', capability: 'net' },
  { pattern: 'fetch(', msg: '公网访问需声明 net', capability: 'net' },
  { pattern: 'urlopen', msg: '公网访问需声明 net', capability: 'net' },
  { pattern: 'axios.', msg: '访问外部 API 需声明 api', capability: 'api' },
  { pattern: 'http.request', msg: '访问外部 API 需声明 api', capability: 'api' },
  { pattern: 'kb.search', msg: '读取知识库需声明 kb_read', capability: 'kb_read' },
  { pattern: 'task.load', msg: '读取任务数据需声明 task_read', capability: 'task_read' },
];

/** 技能脚本白名单语言 */
export const ALLOWED_SCRIPT_LANGS = ['python', 'nodejs'] as const;

/**
 * 技能状态机（草稿 → 待审核 → 已发布 → 已下线，可回滚回已发布）
 *
 * 说明：`publish` 允许从 `draft` 直接发布（审核环节可选，`in_review` 为显式送审路径），
 * 以匹配 §4.5 的端点集合（只有 publish / offline，没有独立的「送审」端点）。
 */
export const SKILL_STATUS_TRANSITIONS: Record<SkillStatus, SkillStatus[]> = {
  draft: ['in_review', 'published'],
  in_review: ['published', 'draft'],
  published: ['offline', 'in_review'],
  offline: ['published'],
};

/** 沙箱资源限制（MockSandbox 使用） */
export const SANDBOX_LIMITS = {
  maxCpuMs: 5_000,
  maxMemoryMb: 256,
  maxNetworkCalls: 20,
  /** 本地落盘上限，必须为 0 */
  maxLocalFiles: 0,
  timeoutMs: 10_000,
};

/** 沙箱出网域名白名单 */
export const DOMAIN_ALLOWLIST: string[] = [
  'api.huan.tv',
  'nexus.huan.tv',
  'platform.huan.tv',
  'kb.huan.tv',
];

/* ═══════════════════ 开放接口（/v1）契约 ═══════════════════ */

/** 签名与时间戳窗口：5 分钟（§4.8） */
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/** 三级限流默认值（Key / 租户 / 模型，每分） */
export const RATE_LIMITS = {
  perKey: 60,
  perTenant: 600,
  perModel: 120,
} as const;

/** 对外能力 scope 白名单 */
export const API_SCOPES: string[] = [
  ApiScope.WORKFLOW_RUN,
  ApiScope.AGENT_INVOKE,
  ApiScope.SKILL_EXECUTE,
  ApiScope.KB_QUERY,
];

/** 委派层级上限（FR-AG，超出 1022） */
export const MAX_DELEGATION_DEPTH = 3;

/* ═══════════════════ 通用契约 ═══════════════════ */

export const API_PREFIX = '/api';
export const OPENAPI_PREFIX = '/v1';

/** 分页默认与上限 */
export const PAGINATION = { defaultPage: 1, defaultSize: 20, maxSize: 200 } as const;

/** 业务编号前缀 */
export const CODE_PREFIX = {
  task: 'TSK',
  artifact: 'ART',
  execution: 'EXE',
  trace: 'tr',
} as const;

/** 默认工作空间 ID（种子数据固定值，便于演示） */
export const DEFAULT_WORKSPACE_ID = 'ws-huan-0001';

/**
 * 系统动作主体标识（审计双主体留痕约定）。
 *
 * 语义约束：审计的 `actor_id` 为 `null` **只表示「数据缺失」**，
 * 不表示「没有发起人」。系统自动行为（如模型降级、定时任务）
 * 必须显式写 `SYSTEM_ACTOR_ID`，以便界面区分：
 *   - `actor_id === SYSTEM_ACTOR_ID` → 系统自动动作（正常业务状态）
 *   - `actor_id === null`            → 数据缺失（缺陷）
 * 后端 `AuditService.write()` 会拒绝 actorId 为空的写入。
 */
export const SYSTEM_ACTOR_ID = 'system';

/** 系统主体的显示名（界面渲染用） */
export const SYSTEM_ACTOR_LABEL = '系统';

/** 前端路由表（§7.6） */
export const ROUTES = {
  home: '/',
  board: '/board',
  chat: '/chat',
  chatSession: (id: string) => `/chat/${id}`,
  members: '/members',
  skills: '/skills',
  skill: (id: string) => `/skills/${id}`,
  hub: '/hub',
  knowledge: '/knowledge',
  docs: '/docs',
  doc: (id: string) => `/docs/${id}`,
  models: '/models',
  apiKeys: '/api-keys',
  audit: '/audit',
} as const;

/** 导航分组（左侧导航 4 分组，§7.6） */
export const NAV_GROUPS: { key: string; label: string; items: { path: string; label: string }[] }[] = [
  {
    key: 'work',
    label: '工作',
    items: [
      { path: ROUTES.board, label: '任务看板' },
      { path: ROUTES.chat, label: '会话' },
    ],
  },
  {
    key: 'team',
    label: '团队',
    items: [
      { path: ROUTES.members, label: '成员' },
      { path: ROUTES.skills, label: '技能库' },
      { path: ROUTES.hub, label: '技能市场' },
    ],
  },
  {
    key: 'knowledge',
    label: '知识',
    items: [
      { path: ROUTES.knowledge, label: '知识库' },
      { path: ROUTES.docs, label: '文档' },
    ],
  },
  {
    key: 'settings',
    label: '设置',
    items: [
      { path: ROUTES.models, label: '模型' },
      { path: ROUTES.apiKeys, label: 'API 与配额' },
      { path: ROUTES.audit, label: '审计日志' },
    ],
  },
];

/** 设计令牌（§7.2，供前端 tokens.css 与图表复用） */
export const DESIGN_TOKENS: Record<string, string> = {
  '--bg': '#F7F7F5',
  '--panel': '#FFFFFF',
  '--panel-2': '#FBFBFA',
  '--line': '#E8E8E4',
  '--line-2': '#DFDFDA',
  '--line-3': '#D4D4CE',
  '--tx': '#1A1A18',
  '--tx-2': '#6B6B66',
  '--tx-3': '#9A9A94',
  '--tx-4': '#B8B8B2',
  '--ac': '#5E6AD2',
  '--ac-w': '#F0F0FC',
  '--ac-b': '#C5C5F0',
  '--st-1': '#B8B8B2',
  '--st-2': '#8A8A84',
  '--st-3': '#E5A13A',
  '--st-4': '#5E6AD2',
  '--st-5': '#3FA97A',
  '--ok': '#3FA97A',
  '--warn': '#D99A2B',
  '--err': '#D0574B',
  '--info': '#5E6AD2',
  '--r': '5px',
  '--r-2': '6px',
  '--r-3': '8px',
};

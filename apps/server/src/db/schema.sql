-- ════════════════════════════════════════════════════════════════════════════
-- huanbuddy SQLite Schema（对应 architecture.md §3.1）
-- 约定：
--   · 主键 TEXT（nanoid / 业务固定 ID）
--   · 时间统一 ISO 8601 UTC 字符串
--   · 布尔用 INTEGER(0/1)
--   · 结构化字段用 TEXT 存 JSON
--   · 全部 CREATE TABLE IF NOT EXISTS —— 保证 migrate 幂等可重复执行
-- ════════════════════════════════════════════════════════════════════════════

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ═══ 工作空间 ═══
CREATE TABLE IF NOT EXISTS workspace (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

-- ═══ 看板列 ═══
CREATE TABLE IF NOT EXISTS board_column (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  key          TEXT NOT NULL,          -- backlog/todo/in_progress/in_review/done
  label        TEXT NOT NULL,          -- 待排期/待办/进行中/审核中/已完成
  color_var    TEXT NOT NULL,          -- --st-1 ... --st-5
  sort_order   INTEGER NOT NULL,
  wip_limit    INTEGER,
  UNIQUE(workspace_id, key)
);

-- ═══ 成员（人类 + AI 统一） ═══
CREATE TABLE IF NOT EXISTS member (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  type            TEXT NOT NULL CHECK(type IN ('human','ai')),
  name            TEXT NOT NULL,
  handle          TEXT,
  avatar_text     TEXT NOT NULL,
  avatar_color    TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'member',
  capability_tags TEXT NOT NULL DEFAULT '[]',
  data_scope      TEXT NOT NULL DEFAULT '[]',
  creator_id      TEXT REFERENCES member(id),
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_ws ON member(workspace_id, type);

-- ═══ AI 成员配置（仅 type='ai' 有值） ═══
CREATE TABLE IF NOT EXISTS agent_config (
  member_id            TEXT PRIMARY KEY REFERENCES member(id) ON DELETE CASCADE,
  role_prompt          TEXT NOT NULL,
  primary_model_id     TEXT REFERENCES model_config(id),
  fallback_model_ids   TEXT NOT NULL DEFAULT '[]',
  skill_ids            TEXT NOT NULL DEFAULT '[]',
  tool_ids             TEXT NOT NULL DEFAULT '[]',
  kb_space_ids         TEXT NOT NULL DEFAULT '[]',
  declared_scope       TEXT NOT NULL DEFAULT '[]',
  context_budget       INTEGER NOT NULL DEFAULT 8192,
  context_priority     TEXT NOT NULL DEFAULT '["system","task","kb","history"]',
  quota_monthly        REAL NOT NULL DEFAULT 0,
  quota_used           REAL NOT NULL DEFAULT 0,
  version              TEXT NOT NULL DEFAULT 'v1.0',
  gray_ratio           INTEGER NOT NULL DEFAULT 100
);

-- ═══ 任务 ═══
CREATE TABLE IF NOT EXISTS task (
  id                 TEXT PRIMARY KEY,
  code               TEXT NOT NULL UNIQUE,
  workspace_id       TEXT NOT NULL REFERENCES workspace(id),
  title              TEXT NOT NULL,
  description        TEXT,
  status             TEXT NOT NULL DEFAULT 'backlog'
                     CHECK(status IN ('backlog','todo','in_progress','in_review','done','suspended','cancelled')),
  priority           TEXT NOT NULL DEFAULT 'p3' CHECK(priority IN ('p1','p2','p3')),
  tags               TEXT NOT NULL DEFAULT '[]',
  creator_id         TEXT NOT NULL REFERENCES member(id),
  assignee_id        TEXT REFERENCES member(id),
  assignee_type      TEXT CHECK(assignee_type IN ('human','ai')),
  sla_due_at         TEXT,
  sla_policy         TEXT DEFAULT 'notify',
  accept_criteria    TEXT,
  reject_reason_code TEXT,
  trace_id           TEXT,
  cost               REAL NOT NULL DEFAULT 0,
  token_used         INTEGER NOT NULL DEFAULT 0,
  lock_version       INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  completed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_task_board ON task(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_task_assignee ON task(assignee_id);

-- ═══ 任务活动记录（执行轨迹 / 评论 / 状态变更） ═══
CREATE TABLE IF NOT EXISTS task_activity (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  actor_id     TEXT NOT NULL REFERENCES member(id),
  actor_type   TEXT NOT NULL,
  initiator_id TEXT REFERENCES member(id),
  content      TEXT,
  payload      TEXT NOT NULL DEFAULT '{}',
  reason_code  TEXT,
  trace_id     TEXT,
  duration_ms  INTEGER,
  token_used   INTEGER,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_task ON task_activity(task_id, created_at);

-- ═══ 交付物 ═══
CREATE TABLE IF NOT EXISTS artifact (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  task_id      TEXT REFERENCES task(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  uri          TEXT,
  content      TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  submitted_by TEXT REFERENCES member(id),
  trace_id     TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifact_task ON artifact(task_id);

-- ═══ 收件箱 / 通知 ═══
CREATE TABLE IF NOT EXISTS notification (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  recipient_id TEXT NOT NULL REFERENCES member(id),
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  ref_type     TEXT,
  ref_id       TEXT,
  priority     TEXT NOT NULL DEFAULT 'normal',
  read         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notification(recipient_id, read);

-- ═══ 会话 ═══
CREATE TABLE IF NOT EXISTS session (
  id               TEXT PRIMARY KEY,
  workspace_id     TEXT NOT NULL REFERENCES workspace(id),
  title            TEXT NOT NULL,
  owner_id         TEXT NOT NULL REFERENCES member(id),
  agent_id         TEXT REFERENCES member(id),
  model_id         TEXT REFERENCES model_config(id),
  kb_space_id      TEXT REFERENCES kb_space(id),
  skill_ids        TEXT NOT NULL DEFAULT '[]',
  perm_scope       TEXT,
  related_task_ids TEXT NOT NULL DEFAULT '[]',
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_ws ON session(workspace_id, updated_at);

-- ═══ 消息 ═══
CREATE TABLE IF NOT EXISTS message (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
  author_id   TEXT REFERENCES member(id),
  content     TEXT,
  blocks      TEXT NOT NULL DEFAULT '[]',
  citations   TEXT NOT NULL DEFAULT '[]',
  model_id    TEXT REFERENCES model_config(id),
  token_in    INTEGER DEFAULT 0,
  token_out   INTEGER DEFAULT 0,
  cost        REAL DEFAULT 0,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id, created_at);

-- ═══ 模型配置 ═══
CREATE TABLE IF NOT EXISTS model_config (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  vendor         TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  purpose        TEXT,
  priority       TEXT NOT NULL DEFAULT 'p2',
  health         TEXT NOT NULL DEFAULT 'healthy',
  base_url       TEXT,
  api_key_ref    TEXT,
  input_price    REAL NOT NULL DEFAULT 0,
  output_price   REAL NOT NULL DEFAULT 0,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL
);

-- ═══ 场景路由 ═══
CREATE TABLE IF NOT EXISTS scene_route (
  id                TEXT PRIMARY KEY,
  scene             TEXT NOT NULL UNIQUE,
  label             TEXT NOT NULL,
  primary_model_id  TEXT NOT NULL REFERENCES model_config(id),
  fallback_model_id TEXT REFERENCES model_config(id)
);

-- ═══ 模型降级记录 ═══
CREATE TABLE IF NOT EXISTS model_degradation_log (
  id            TEXT PRIMARY KEY,
  occurred_at   TEXT NOT NULL,
  event         TEXT NOT NULL,
  action        TEXT NOT NULL,
  from_model_id TEXT REFERENCES model_config(id),
  to_model_id   TEXT REFERENCES model_config(id),
  trace_id      TEXT
);

-- ═══ 技能 ═══
CREATE TABLE IF NOT EXISTS skill (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  slug            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  source          TEXT NOT NULL DEFAULT 'local',
  hub_skill_id    TEXT REFERENCES hub_skill(id),
  trust_level     TEXT NOT NULL DEFAULT 'org',
  status          TEXT NOT NULL DEFAULT 'draft',
  current_version TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL REFERENCES member(id),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(workspace_id, slug)
);

-- ═══ 技能版本 ═══
CREATE TABLE IF NOT EXISTS skill_version (
  id            TEXT PRIMARY KEY,
  skill_id      TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
  version       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  input_schema  TEXT NOT NULL DEFAULT '{}',
  output_schema TEXT NOT NULL DEFAULT '{}',
  prompt        TEXT,
  script        TEXT,
  script_lang   TEXT,
  static_check  TEXT NOT NULL DEFAULT '{}',
  change_note   TEXT,
  rollback_from TEXT,
  created_by    TEXT NOT NULL REFERENCES member(id),
  created_at    TEXT NOT NULL,
  published_at  TEXT,
  UNIQUE(skill_id, version)
);

-- ═══ 技能权限声明 ═══
CREATE TABLE IF NOT EXISTS skill_permission (
  id               TEXT PRIMARY KEY,
  skill_version_id TEXT NOT NULL REFERENCES skill_version(id) ON DELETE CASCADE,
  capability       TEXT NOT NULL,
  granted          INTEGER NOT NULL DEFAULT 0,
  detail           TEXT
);
CREATE INDEX IF NOT EXISTS idx_skill_perm_ver ON skill_permission(skill_version_id);

-- ═══ 技能执行记录（沙箱运行 / 工具调用） ═══
CREATE TABLE IF NOT EXISTS skill_execution (
  id            TEXT PRIMARY KEY,
  skill_id      TEXT REFERENCES skill(id),
  skill_version TEXT,
  source        TEXT,
  trust_level   TEXT,
  sandbox_id    TEXT,
  task_id       TEXT REFERENCES task(id),
  session_id    TEXT REFERENCES session(id),
  input         TEXT,
  output        TEXT,
  status        TEXT NOT NULL,
  block_reason  TEXT,
  duration_ms   INTEGER,
  local_files   INTEGER NOT NULL DEFAULT 0,
  trace_id      TEXT,
  created_at    TEXT NOT NULL
);

-- ═══ Hub 仓库 ═══
CREATE TABLE IF NOT EXISTS hub_repo (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  url                TEXT NOT NULL,
  type               TEXT NOT NULL,
  auth_type          TEXT,
  trust_level        TEXT NOT NULL,
  signature_required INTEGER NOT NULL DEFAULT 1,
  skill_count        INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'active',
  fallback_policy    TEXT NOT NULL DEFAULT 'cache',
  last_sync_at       TEXT,
  created_at         TEXT NOT NULL
);

-- ═══ Hub 技能索引 ═══
CREATE TABLE IF NOT EXISTS hub_skill (
  id             TEXT PRIMARY KEY,
  repo_id        TEXT NOT NULL REFERENCES hub_repo(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  description    TEXT,
  version        TEXT NOT NULL,
  tags           TEXT NOT NULL DEFAULT '[]',
  permissions    TEXT NOT NULL DEFAULT '[]',
  install_count  INTEGER NOT NULL DEFAULT 0,
  success_rate   REAL,
  report_count   INTEGER NOT NULL DEFAULT 0,
  review_status  TEXT NOT NULL DEFAULT 'pending',
  signature_ok   INTEGER,
  cached_meta    TEXT NOT NULL DEFAULT '{}',
  cache_expire_at TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_skill_repo ON hub_skill(repo_id);

-- ═══ 知识空间 ═══
CREATE TABLE IF NOT EXISTS kb_space (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  name         TEXT NOT NULL,
  description  TEXT,
  acl          TEXT NOT NULL DEFAULT '[]',
  doc_count    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- ═══ 文档 ═══
CREATE TABLE IF NOT EXISTS kb_document (
  id              TEXT PRIMARY KEY,
  space_id        TEXT NOT NULL REFERENCES kb_space(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  format          TEXT NOT NULL DEFAULT 'markdown',
  tags            TEXT NOT NULL DEFAULT '[]',
  source          TEXT NOT NULL DEFAULT 'local',
  remote_id       TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  acl             TEXT NOT NULL DEFAULT '[]',
  deleted         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_space ON kb_document(space_id, deleted);

-- ═══ 文档版本 ═══
CREATE TABLE IF NOT EXISTS kb_doc_version (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES kb_document(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  diff        TEXT,
  polish_meta TEXT NOT NULL DEFAULT '{}',
  edited_by   TEXT REFERENCES member(id),
  note        TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE(doc_id, version)
);

-- ═══ 同步源 ═══
CREATE TABLE IF NOT EXISTS kb_sync_source (
  id           TEXT PRIMARY KEY,
  space_id     TEXT NOT NULL REFERENCES kb_space(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL,
  target       TEXT NOT NULL,
  acl_map      TEXT NOT NULL DEFAULT '{}',
  interval_min INTEGER NOT NULL DEFAULT 15,
  last_sync_at TEXT,
  last_status  TEXT,
  failed_count INTEGER NOT NULL DEFAULT 0,
  mirror_only  INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

-- ═══ 知识块（检索单元） ═══
CREATE TABLE IF NOT EXISTS kb_chunk (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES kb_document(id) ON DELETE CASCADE,
  space_id    TEXT NOT NULL REFERENCES kb_space(id),
  version     INTEGER NOT NULL,
  heading     TEXT,
  content     TEXT NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_doc ON kb_chunk(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunk_space ON kb_chunk(space_id);

-- ═══ 知识问答日志（含反馈） ═══
CREATE TABLE IF NOT EXISTS kb_query_log (
  id              TEXT PRIMARY KEY,
  workspace_id    TEXT NOT NULL REFERENCES workspace(id),
  asker_id        TEXT NOT NULL REFERENCES member(id),
  query           TEXT NOT NULL,
  scope           TEXT,
  top_k           INTEGER NOT NULL DEFAULT 5,
  citation_count  INTEGER NOT NULL DEFAULT 0,
  answer          TEXT,
  insufficient    INTEGER NOT NULL DEFAULT 0,
  feedback        TEXT,
  feedback_by     TEXT REFERENCES member(id),
  trace_id        TEXT,
  created_at      TEXT NOT NULL
);

-- ═══ 审计日志（双主体 + TraceID，不可篡改语义） ═══
CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT PRIMARY KEY,
  trace_id       TEXT NOT NULL,
  occurred_at    TEXT NOT NULL,
  actor_id       TEXT,
  actor_type     TEXT,
  actor_name     TEXT,
  initiator_id   TEXT,
  initiator_name TEXT,
  action         TEXT NOT NULL,
  resource_type  TEXT,
  resource_id    TEXT,
  resource_name  TEXT,
  duration_ms    INTEGER,
  token_used     INTEGER,
  result         TEXT NOT NULL DEFAULT 'success',
  detail         TEXT NOT NULL DEFAULT '{}',
  workspace_id   TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_log(trace_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, occurred_at);

-- ═══ API Key ═══
CREATE TABLE IF NOT EXISTS api_key (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL REFERENCES workspace(id),
  name               TEXT NOT NULL,
  key_hash           TEXT NOT NULL,
  key_prefix         TEXT NOT NULL,
  scopes             TEXT NOT NULL DEFAULT '[]',
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  owner_id           TEXT NOT NULL REFERENCES member(id),
  last_used_at       TEXT,
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         TEXT NOT NULL
);

-- ═══ 用量记录（可归因） ═══
CREATE TABLE IF NOT EXISTS usage_record (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspace(id),
  occurred_at  TEXT NOT NULL,
  category     TEXT NOT NULL,
  model_id     TEXT REFERENCES model_config(id),
  agent_id     TEXT REFERENCES member(id),
  api_key_id   TEXT REFERENCES api_key(id),
  task_id      TEXT REFERENCES task(id),
  project      TEXT,
  token_in     INTEGER NOT NULL DEFAULT 0,
  token_out    INTEGER NOT NULL DEFAULT 0,
  cost         REAL NOT NULL DEFAULT 0,
  trace_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_usage_time ON usage_record(occurred_at);
CREATE INDEX IF NOT EXISTS idx_usage_apikey ON usage_record(api_key_id);

-- 说明：幂等键、三级限流计数、埋点事件（PRD §9.2）为进程内实现的运行时状态
--      （见 core/metrics.ts 与 services/apikey.service.ts），不落表。
--      因此本 schema 严格对应 architecture.md §3.1 的 28 张业务表。

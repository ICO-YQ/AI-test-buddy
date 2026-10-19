# huanbuddy

> 以 **AI 成员**为一等公民的团队协作工作台 —— 任务看板 / 会话 / 成员 / 技能库 / 技能市场 / 知识库 / 模型 / API 与配额 / 审计
>
> 依据：`docs/architecture.md`（系统架构设计 v1.0）、`docs/PRD-v1.0.md`

**交互原型**：新增 [欢网橘黄 · WorkBuddy 风格版](docs/prototype-workbuddy-huan.html)，可直接用浏览器打开。它以任务发起与对话为中心，展示工作模式、模型切换、附件、任务结果、项目、AI 成员、技能与连接器、定时任务和资料库等交互。原有 [参考原型](docs/prototype-reference.html) 保留；新版为独立静态演示，不连接后端或 AI 服务。

---

## 1. 快速开始

```bash
# 1) 安装依赖（使用内网源，见 .npmrc）
pnpm install

# 2) 初始化数据库（迁移 + 种子，二者均幂等）
pnpm migrate
pnpm seed

# 3) 启动（并行起后端与前端）
pnpm dev
```

- 后端：<http://localhost:3001>（健康检查 `GET /health`）
- 前端：<http://localhost:5173>（Vite dev server，`/api` 与 `/v1` 代理到 3001）

只想起后端：

```bash
pnpm dev:server          # tsx watch src/index.ts
# 或
cd apps/server && pnpm start
```

---

## 2. 环境要求

| 项 | 版本 | 说明 |
|---|---|---|
| Node | **≥ 22.0.0**（本机验证 22.22.2） | 默认数据库驱动使用 Node 内置 `node:sqlite` |
| pnpm | ≥ 8（本机验证 8.15.4） | workspace monorepo |
| OS | macOS arm64（其他平台同样可用） | 无原生编译依赖 |

`node:sqlite` 会打印一次 `ExperimentalWarning: SQLite is an experimental feature`，**属正常现象**，无需 `--experimental-sqlite` flag。

---

## 3. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3001` | 后端监听端口 |
| `HOST` | `0.0.0.0` | 后端监听地址 |
| `DB_DRIVER` | `node` | `node` = Node 内置 `node:sqlite`；`better` = better-sqlite3（缺失时自动回退到 `node` 并告警） |
| `DB_PATH` | `data/huanbuddy.db` | SQLite 文件路径（相对 `apps/server`）；`:memory:` 为内存库 |
| `AUTO_MIGRATE` | `1` | 启动时自动迁移（幂等） |
| `AUTO_SEED` | `1` | 库为空时自动灌入种子数据 |
| `LOG_REQUESTS` | `1` | 请求日志开关 |
| `LOG_PRETTY` | **`0`** | 控制台美化日志。**默认关闭**：内网镜像的 `fast-copy` 内容不完整会导致 `pino-pretty` 崩溃并**直接终止进程**（详见「§12 故障排查」）。设为 `1` 时服务会先**主线程探测** `pino-pretty` 是否真正可加载，不可加载则打印 warning 并回退 JSON 日志 |
| `LOG_LEVEL` | `info` | 日志级别 |

演示身份通过请求头 **`x-actor-id`** 切换（等价于 PRD 中「前端顶栏身份切换器」）。

- **该头是可选的**：缺省回退为 `m-human-zhangwei`（张伟），也支持 `?actorId=` 查询参数。
- 服务端在 `onRequest` 阶段把该身份登记进**请求级上下文**（与 TraceID 同机制），
  因此**所有**审计记录（含 service 内部未显式传 actor 的路径）都能带上双主体归属。
- 需要表达「系统自动行为」时使用 `SYSTEM_ACTOR_ID = 'system'`（见 §7「审计双主体」）。

---

## 4. 演示数据（种子）

| 实体 | 数量 | 说明 |
|---|---|---|
| 工作空间 | 1 | `ws-huan-0001` 欢网 · 平台产品组 |
| 看板列 | 5 | 待排期 / 待办 / 进行中 / 审核中 / 已完成 |
| 成员 | **6** | 3 人类（张伟=admin、陈静=space_admin、刘洋=member）+ 3 AI（AI·数据分析师 / AI·投放文案 / AI·质量巡检） |
| 模型 | **3** | Claude Opus 4.5、Claude Sonnet 4.5、Qwen3-235B（**已停用**，`enabled=0`） |
| 场景路由 | 4 | reasoning / daily / batch / sensitive |
| 技能 | **4** | 素材文案生成 v1.2.0、渠道 ROI 报表生成 v2.0.1、素材合规风险扫描 v1.0.3、周报摘要助手 v0.9.0（草稿，含高危调用） |
| Hub 仓库 | **2** | platform-official（official）、community-skills（**含 1 个待审核社区技能**） |
| 知识空间 | **3** | 投放运营规范 / 增长方法论 / 平台产品文档；6 篇文档 + 版本 + 知识块 + 2 个同步源 |
| 任务 | **5** | 分布：backlog 1、todo 1、in_progress 1、in_review 1、done 1 |
| 会话 | 2 | 各含消息、工具调用块与引用块 |
| 交付物 | 2 | `ART-1191`、`ART-1192` |
| 审计 | 14 | 含双主体（actor / initiator）、被阻断事件 |
| 用量 | 10 | 按模型 / 成员 / API Key 可归因 |
| API Key | 2 | `ci-pipeline`（active）、`bi-report`（revoked） |

**幂等性**：种子使用固定 ID + `INSERT OR IGNORE`，重复执行不产生重复数据。
需要重建时执行 `pnpm reset:db`（删表 → 迁移 → 种子）。

### 演示身份与权限（双主体铁律）

AI 成员有效权限 = **`min(自身声明, 创建者权限)`**：

| AI 成员 | 声明数据域 | 创建者 | 有效数据域 |
|---|---|---|---|
| AI·数据分析师 | ops, growth | 张伟（ops/growth/platform） | **ops, growth** |
| AI·投放文案 | ops, growth, platform | 陈静（ops/growth） | **ops, growth** |
| AI·质量巡检 | ops, platform | 刘洋（ops） | **ops** |

> 任务 `TSK-8401` 声明了 `proj:proj-platform`。把它指派给 **AI·质量巡检** 会返回 `403 SCOPE_DENIED`，用于演示服务端强制约束。

---

## 5. 常用脚本

| 命令 | 位置 | 作用 |
|---|---|---|
| `pnpm dev` | 根 | 并行启动 `apps/*` 的 dev |
| `pnpm build` | 根 | 各包类型检查（`tsc --noEmit`） |
| `pnpm test` | 根 | 各包测试 |
| `pnpm migrate` / `pnpm seed` | 根 | 迁移 / 种子（转发到 server） |
| `pnpm reset:db` | 根 | 重建数据库并重新种子 |
| `pnpm typecheck` | 根 | 全仓类型检查 |
| `pnpm -w build` | 根 | 同 `pnpm build` |
| `pnpm test` | `apps/server` | Vitest 运行全部单测/接口测试 |

### 5.1 验证状态（实测）

| 检查项 | 命令 | 结果 |
|---|---|---|
| 全仓类型检查 | `pnpm typecheck` | ✅ 3/3 项目通过（shared / server / web） |
| 后端测试 | `cd apps/server && pnpm test` | ✅ **4 个测试文件全部通过**（写作时为 137 passed；该数字随测试补充而增长，以实际输出为准） |
| 迁移 | `pnpm migrate` | ✅ `driver=node tables=28/28`，`journal_mode=wal`，`foreign_keys=1` |
| 种子 | `pnpm seed`（连跑 2 次） | ✅ 幂等：task 5 · member 6（3 AI + 3 人类）· skill 4 · model 3（1 停用）· hub_repo 2 · kb_space 3 |
| 健康检查 | `GET http://localhost:3001/health` | ✅ 200 |

测试文件与覆盖面（用例数随迭代增长，下表为写作时快照）：

| 文件 | 覆盖 |
|---|---|
| `state-machine.test.ts` | 合法/非法流转、终态、跳步、驳回语义、与 `TRANSITIONS` 表一致性 |
| `permission.test.ts` | `min()`/intersect、通配、越界 `1011`、委派层级 `1022`、知识空间 ACL、角色矩阵 |
| `skill-validate.test.ts` | 静态检查、声明一致性、沙箱越权 `1010`、**禁止类 API 纵深拦截**、语言白名单、`TRUST_PENDING`、`SKILL_IN_USE`、**审计 actorId 必填回归** |
| `task-flow.test.ts` | Fastify `inject` 端到端：全链路、5 类错误码边界、trace 回放、`/v1` 签名/幂等/时间戳窗口/限流/白名单、治理与用量、28 表完整性 |

---

## 6. 目录结构

```
huanbuddy/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json / .npmrc
├── packages/shared/          # 前后端共享：枚举 / 类型 / DTO / 错误码 / 契约常量（零运行时依赖）
├── apps/server/              # Fastify + SQLite
│   └── src/
│       ├── index.ts          # 入口：env → 迁移 → 种子 → listen
│       ├── app.ts            # Fastify 装配（日志/CORS/TraceID/错误处理/路由）
│       ├── db/               # client（驱动适配器）/ schema.sql / migrate / seed / reset
│       ├── core/             # response / errors / audit / permission / state-machine / metrics / trace
│       ├── ai/               # executor / mock-executor / sandbox / static-check / model-gateway / retriever / hub-client
│       ├── services/         # task / member / notification / skill / hub / kb / chat / model / audit / apikey
│       ├── routes/           # 各模块路由 + openapi(/v1)
│       └── __tests__/        # state-machine / permission / skill-validate / task-flow(E2E)
└── apps/web/                 # 前端（React 18 + Vite）
```

---

## 7. 服务端强制约束速查

| 约束 | 表现 |
|---|---|
| 任务状态不可回退 | 非法流转 `409 STATE_ILLEGAL (1006)`；驳回是 `in_review → in_progress` **前向跳转** |
| 并发分配乐观锁 | `lockVersion` 不匹配 `409 CONFLICT_LOCK (1005)` |
| 已验收不可改 | 对 `done` 任务 PATCH `409 TASK_IMMUTABLE (1007)` |
| 驳回必选原因 | 缺 `rejectReasonCode` `422 REJECT_REASON_REQUIRED (1009)` |
| 技能越权调用 | 未声明能力被调用 `403 PERMISSION_UNDECLARED (1010)` + 审计 `skill_rejected` |
| 技能禁止类 API | 沙箱**无条件拦截** `child_process/subprocess/eval/os.system…`（与权限声明无关，任何声明都不放行），审计 `detail.reason = FORBIDDEN_API` |
| 技能脚本语言 | 未声明或不在白名单（`python`/`nodejs`）→ 阻断执行 |
| 技能被引用不可下线 | `409 SKILL_IN_USE (1008)` 并返回引用方 |
| 社区技能待审不可加载 | `403 TRUST_PENDING (1012)` |
| 数据域越权 | `403 SCOPE_DENIED (1011)` |
| 审计不可用阻断业务 | `503 AUDIT_UNAVAILABLE (1018)`（审计与业务同事务） |
| **审计 actorId 必填** | 审计写入缺 `actorId` → `503 AUDIT_UNAVAILABLE (1018)`，**业务整体回滚**（见下方「审计双主体」） |
| 沙箱本地落盘 | 恒为 0（`skill_execution.local_files = 0`） |
| 知识检索先 ACL 再召回 | 无权限内容不进入候选集；无命中 `insufficient: true` |

### 7.1 审计双主体（actor / initiator）与 actorId 必填

所有敏感动作的审计记录都带**双主体**：`actor`（执行主体）+ `initiator`（发起人），
用于区分「AI 干了什么」与「谁让 AI 干的」，并支持按 `traceId` 全链路回放
（`GET /api/audit/trace/:traceId`）。

**`actorId` 的三种来源（按优先级）**

| 优先级 | 来源 | 说明 |
|---|---|---|
| 1 | 调用方显式传入 `audit.write({ actorId })` | 编译器**强制**要求传 `actor: string` 的服务方法：`HubService.registerRepo / updateRepo / removeRepo / sync / load`、`ApiKeyService.revoke`（少传即编译失败） |
| 2 | **请求级上下文**（`x-actor-id` 头，`onRequest` 自动登记） | 与 TraceID 同一机制（AsyncLocalStorage），service 层不必逐层透传 actor。绝大多数写路径靠这一层兜底（含 `HubService.disable` 等未强制传参的方法） |
| 3 | 显式传 `SYSTEM_ACTOR_ID = 'system'` | **系统自动行为**，见下表（如 `ModelService.recordDegradation` 内部固定用它） |

**三者都没有 → 抛 `1018` 并回滚整个事务**。设计意图：`null` 只能表示「数据缺失（缺陷）」，
不能表示「没有发起人」。缺少这道校验时，「写审计忘了传 actor」会**静默成功**，
而多数单测只断言「审计行存在」、不断言字段完整，无法发现
（历史上 `hub_skill_*` / `api_key_revoked` 等 **21 类动作**缺 actor；
另有 **26 处审计**缺 initiator，如 `kb_space_created` / `skill_version_created` / `task_deleted`）。

**写入时的自动推导（调用方不必传）**

| 字段 | 推导规则 |
|---|---|
| `actor_name` | 以 `member` 表为准（**覆盖**调用方传的值，避免名字与实际 id 不符）；`actor_id='system'` 时取调用方显式提供的值，未提供则为 `null` |
| `actor_type` | 以 `member` 表为准（**覆盖**调用方传的值）—— 根治「`actor_id` 是人类成员、`actor_type` 却写 `ai`」这类自相矛盾的行 |
| `initiator_id` | 未传时**默认等于 `actor_id`**（绝大多数动作是「人自己操作」）；`actor_id = 'system'` 时保持 `null` |
| `initiator_name` | 若 `initiator_id === actor_id` 复用 actorName，否则查 `member` 表 |
| `detail.*` | 脱敏：`apiKey / api_key / plaintext / keyHash / key_hash / password / token / secret` → `***redacted***`（递归） |

**未知 `actorId`（不在 `member` 表）的返回，取决于是否先经过业务层校验** —— 两者都已实测：

| 路径 | 表现 |
|---|---|
| 业务层先做存在性校验（如 `POST /api/tasks`、`assign` 等） | `404 NOT_FOUND (1004)`「发起人不存在：＜id＞」 |
| 直接落到 `audit.write()`（无前置校验的路径） | `400 BAD_REQUEST (1001)`「未知操作者」，`details.hint` 会列出演示可用身份清单 |

> 只有「AI 代替人执行」才需要区分双主体（`actor`=AI、`initiator`=发起人），
> 这类路径（task / skill 的 AI 执行链）都会显式传两个值，不走兜底。

**`SYSTEM_ACTOR_ID` 语义**

| `actor_id` | 含义 | `initiator_id` | 界面渲染建议 |
|---|---|---|---|
| 成员 id | 正常业务动作 | 自动推导（默认 = actor） | 头像 + 姓名 |
| `'system'` | **系统自动行为**（如模型超时降级 `model_degraded`） | `null`（无人类发起人） | 显示「系统」 |
| `null` | **数据缺失（缺陷）** | — | 视为缺陷并提示（后端已拒绝该情况） |

**实测语义抽样**（直接取自 `:3001` 的 `GET /api/audit`）

| action | actorId | actorType | actorName | initiatorId | initiatorName |
|---|---|---|---|---|---|
| `skill_executed` | `m-ai-writer` | `ai` | AI·投放文案 | `m-human-chenjing` | 陈静（AI 代陈静执行） |
| `api_key_issued` | `m-human-zhangwei` | `human` | 张伟 | `m-human-zhangwei` | 张伟（兜底生效） |
| `model_degraded` | `system` | — | `system`（seed 显式写的展示名） | `null` | `null` |

种子库实测：14 条审计中 **`actor_id` 为空 0 条**，`initiator_id` 为空 2 条（正是那两条 `model_degraded` 系统行为）。

**回归测试**：`skill-validate.test.ts` 的 `AuditService · actorId 必填校验` 块覆盖
「缺 actor 抛 1018 且不落库」「显式传 actor 正常写入且双主体落库」「系统动作传 `SYSTEM_ACTOR_ID` 允许写入」，
用于防止这道校验被改回去。

### 7.2 收件箱通知的生命周期（approval 通知是任务状态的派生物）

- 任务被 AI 交付（落到 `in_review`）时，向发起人投递一条 `kind='approval'` 的「待你验收」通知。
- 任务**离开 `in_review`** 时，该通知会被**直接解除（删除）**，而不是置 `read=1`。
  原因：`GET /api/inbox` 返回全部通知（含已读、排序靠后），只标已读的话条目仍挂在收件箱，
  会产生「已验证的任务还显示待验收」的错觉。历史可追溯性由 `audit_log` 的
  `task_accepted` / `task_rejected` 保证，不会丢失。
- **解除条件只与状态有关，与走哪个接口无关**：`accept` 与 `transition` 两条路径**都会解除** ——
  代码里统一为「`from === in_review` 时解除」。即：
  - `accept {decision:'accept'}`（`in_review → done`）→ 解除
  - `accept {decision:'reject'}`（`in_review → in_progress`）→ 解除
  - `transition {to:'done' | 'in_progress' | 'suspended'}`（只要 `from` 是 `in_review`）→ 解除
  - 从其它状态出发的 `transition`：本来就不存在待验收通知，无需解除

  > 之所以强调这一点：早期版本只有 `accept` 会解除，导致同一个业务状态变化（离开 `in_review`）
  > 走不同接口产生不同副作用 —— `transition {to:'done'}` 后通知仍挂在收件箱。现已对齐。
  > 因此**通知不消失不再是「用错接口」的症状**；若仍堆积，请看 §12.6。
- 未读红点用 `notification.read = 0` 计数（`GET /api/inbox` 内含 `read` 字段）。

---

## 8. 对外能力 `/v1` 调用示例（签名 + 幂等 + 时间戳窗口 5 分钟）

演示用明文 Key（仅存在于种子脚本，库内只存 sha256 哈希）：

```
ci-pipeline : hb_live_ci_demo_key_0001   scopes: skill:execute, agent:invoke (120/min)
bi-report   : hb_live_bi_demo_key_0001   scopes: kb:query (已吊销)
```

**签名算法**

```
signature = HMAC-SHA256(
  key   = 明文 API Key,
  msg   = `${x-timestamp}.${METHOD}.${路径(不含 query)}.${sha256(原始请求体)}`
) 的 hex
```

**一键实测（Node 生成签名并 curl）**

```bash
node -e '
const c=require("node:crypto");
const key="hb_live_ci_demo_key_0001";
const path="/v1/skills/skl-material-gen/execute";
const body=JSON.stringify({versionId:"skv-material-120",input:{channel:"douyin"}});
const ts=String(Date.now());
const bh=c.createHash("sha256").update(body).digest("hex");
const sig=c.createHmac("sha256",key).update(`${ts}.POST.${path}.${bh}`).digest("hex");
console.log(JSON.stringify({path,body,ts,sig,idem:"idem-"+Date.now()}));
' > /tmp/hb.json

PATH_=$(node -e 'console.log(require("/tmp/hb.json").path)')
BODY=$(node -e 'console.log(require("/tmp/hb.json").body)')
TS=$(node -e 'console.log(require("/tmp/hb.json").ts)')
SIG=$(node -e 'console.log(require("/tmp/hb.json").sig)')
IDEM=$(node -e 'console.log(require("/tmp/hb.json").idem)')

curl -s -X POST "http://localhost:3001$PATH_" \
  -H 'content-type: application/json' \
  -H "x-api-key: hb_live_ci_demo_key_0001" \
  -H "x-idempotency-key: $IDEM" \
  -H "x-timestamp: $TS" \
  -H "x-signature: $SIG" \
  -d "$BODY"
# 再次执行同一 IDEM → 响应头带 x-idempotent-replay: true，返回首次结果
```

**自检端点**

```bash
curl -s http://localhost:3001/v1/me -H "x-api-key: hb_live_ci_demo_key_0001"
```

---

## 9. 可替换的模拟实现（REPLACE_POINT）

| 能力 | 接口 | 本实现 | 替换点 | 位置 |
|---|---|---|---|---|
| AI 执行 | `AiExecutor` | `MockExecutor`（脚本化轨迹） | 真实 Agent Runtime | `ai/executor.ts`、`ai/mock-executor.ts` |
| 技能沙箱 | `Sandbox` | `MockSandbox`（声明白名单校验 + 禁止 API 无条件拦截 + 假执行） | gVisor / Firecracker | `ai/sandbox.ts` |
| 模型调用 | `ModelGateway` | `MockModelGateway`（场景路由 + 降级 + 假 Token/成本） | 真实厂商 API | `ai/model-gateway.ts` |
| 知识检索 | `Retriever` | `MockRetriever`（关键词打分 + ACL 预过滤） | 向量库 + rerank | `ai/retriever.ts` |
| Hub 拉取 | `HubClient` | `MockHubClient`（预置元数据 + 模拟签名） | 真实 Git/HTTP 源 | `ai/hub-client.ts` |
| AI 润色 | `KbService.polish` | 确定性文本变换 + 数字保真 | 真实模型 + 术语白名单 | `services/kb.service.ts` |

全部接口签名稳定，替换实现不影响调用方。

---

## 10. 环境注意事项（内网源）

内网 npm 源（`nexus.huan.tv`）上部分包存在**「目录在、内容缺失」**的镜像不完整问题，本仓库已做如下处理：

| 包 | 缺失内容 | 症状 | 本仓库的处理 |
|---|---|---|---|
| `@types/node@22.20.5` | `async_hooks.d.ts` 等 | TS 编译报 `Cannot find module 'node:async_hooks'` | `core/trace.ts` 改用 `createRequire` 加载并自声明最小类型，**不再依赖该类型声明** |
| `@vitest/runner@2.1.9` | `dist/chunk-tasks.js` | `vitest` 启动即崩（`ERR_MODULE_NOT_FOUND`） | `apps/server/package.json` **锁定 `"vitest": "2.1.2"`**（该版本 runner 完整）。**请勿改回 `^` 浮动版本** |
| `fast-copy@4.1.2` | `dist/cjs/index.cjs`、`dist/es/index.mjs` | `pino-pretty` 不可加载；若被 pino 当 transport 使用，**worker 线程抛未捕获异常直接终止进程** | `LOG_PRETTY` 默认改为 `0`；显式开启时先**主线程探测**再决定是否启用（见 §12） |

其他环境相关：

4. **数据库驱动**：默认使用 Node 内置 `node:sqlite`，不依赖 better-sqlite3 的 GitHub 预编译二进制下载；`DB_DRIVER=better` 为可选分支（加载失败自动回退 `node`）。
5. **批量删除被拦截**：本机 WorkBuddy 的 `safe-delete` shim 会拦截单次超过 50 个文件的删除，表现为 `pnpm install` 或 `vite build` 清空 `dist/` 时报 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`。**这不是代码问题**（`vite build` 的 transform 阶段已成功，只在空目录阶段被拦）。

---

## 11. 前端对接要点

- 统一响应包装：成功 `{ code: 0, data, message: 'ok' }`；失败 `{ code, data: null, message, traceId?, details? }`。
- 分页：`data = { items, total, page, size }`。
- 共享包：`import { ... } from '@huanbuddy/shared'`（含全部枚举 + 中文映射、实体类型、请求 DTO、`ErrCode` 错误码表、`EP` 端点常量、`ROUTES`/`NAV_GROUPS` 路由与导航、`DESIGN_TOKENS` 设计令牌）。也支持子路径按需引入：`@huanbuddy/shared/{enums,types,api,errors,constants}`。
- **React 必须显式锁定 18.3.1**（内网源 `react` 的 latest 为 19）。
- CORS 已开启（`origin: true`），并暴露 `x-trace-id`、`retry-after` 响应头。
- 每个响应都带 `x-trace-id`，可直接用于审计页的 Trace 回放。
- **演示身份切换**：请求头 `x-actor-id`（缺省 `m-human-zhangwei` 张伟），无需登录。
- **`GET /health` 不在 `/api` 前缀下**（注册在 `app.ts`）。Vite 代理只覆盖 `/api/` 与 `/v1/`，因此前端做「后端可达性探测」时需直接请求完整地址 `http://localhost:3001/health`，或把 `/health` 也加入 `server.proxy`。
- **AI 自动执行约定**：`POST /api/tasks`（带 AI `assigneeId`）、`POST /api/tasks/:id/assign`（AI 成员）、`transition` 到 `in_progress`（被指派人=AI）三者都会自动跑完整 Mock 执行链并落到 `in_review`（含执行轨迹、交付物、审计、用量、收件箱通知）。前端一个「指派」按钮即可演示全链路。
- **驳回必选原因**：`/accept` 的 `decision=reject` 与 `transition` 到 `in_progress`（即驳回）都要求 `reasonCode`，缺则 `422`。
- **看板一次性拉取**：`GET /api/tasks/board` 返回按 5 列分组好的全量任务，前端无需按列多次请求。
- **`/v1/workflows/:id/run` 需要 `workflow:run` scope**（种子中的 `ci-pipeline` Key 未授予，会返回 `403`，属「最小权限」演示点）。
- **收件箱通知的解除与接口无关**：`accept` 与 `transition` 都会解除（统一按「离开 `in_review`」判定），见 §7.2。区分点在于**审计动作名**与**前置校验强度**（`accept` 更严：必须处于 `in_review`）；通知堆积问题见 §12.6。

---

## 12. 故障排查（Troubleshooting）

### 12.1 服务启动即退出 / 打印 `fast-copy` 相关错误

**症状**：启动后立刻退出，日志里出现 `fast-copy` 或 `pino-pretty` 的 `ERR_MODULE_NOT_FOUND`，
且**看不到** `[boot] huanbuddy server v1.0.0 已启动`。

**原因**：`LOG_PRETTY=1` 时 pino 会把 `pino-pretty` 作为 **transport（worker 线程）** 加载，
而内网镜像的 `fast-copy@4.1.2` 缺 `dist/cjs/index.cjs` 与 `dist/es/index.mjs`。
这个异常发生在**子线程**，既不会被 `try/catch` 捕获，也不会自动回退 —— 直接终止进程。

**处理**：

1. 只需**不要设 `LOG_PRETTY=1`**（默认即为 `0`，JSON 日志），服务正常启动。
2. 想确认 `pino-pretty` 到底能不能加载：
   ```bash
   cd apps/server && node -e "require('pino-pretty')" && echo OK || echo "无法加载（依赖不完整）"
   ```
3. 若确实需要美化日志，先让 `fast-copy` 可用（重装该包/换源），再设 `LOG_PRETTY=1`。
   服务会先**主线程探测**：不可加载时打印
   `LOG_PRETTY=1 但 pino-pretty 无法加载（依赖包内容不完整），已回退为 JSON 日志。`
   并继续以 JSON 运行 —— 不会再崩。

### 12.2 `ERR_MODULE_NOT_FOUND ... chunk-tasks.js`（vitest 起不来）

`@vitest/runner` 被解析到了 `2.1.9`。请确认 `apps/server/package.json` 仍是 **`"vitest": "2.1.2"`**（精确版本，
不要写 `^2.1.2`，否则会浮动到 2.1.9 而镜像不完整）。

### 12.3 `Cannot find module 'node:async_hooks'`（TS 编译）

`@types/node` 的镜像不完整。本仓库的 `core/trace.ts` 已不依赖该类型声明；
若你新写了 `import ... from 'node:async_hooks'`，请改用同样的 `createRequire` 方式或换装完整版 `@types/node`。

### 12.4 `EADDRINUSE: address already in use 0.0.0.0:3001`

已有进程占用 3001。查看并处理：

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN        # 看是谁
curl -s http://localhost:3001/health    # 确认是不是本项目后端
```

**注意区分**：本项目后端的 `/health` 返回会带 `version` / `driver` / `dbFile` 字段；
若只返回 `{"code":0,"data":{"status":"ok"}}`，说明是**另一个进程**（历史遗留的 mock/stub），需要停掉它。

### 12.5 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`

本机 WorkBuddy 的 `safe-delete` shim 拦截单次 >50 文件的删除。出现在 `pnpm install` 或 `vite build` 时，
**不是代码问题**：`vite build` 的 transform 阶段已成功，仅在清空 `dist/` 阶段被拦。
`pnpm typecheck`、`pnpm test`、`pnpm --filter @huanbuddy/server build` 均不受影响。

### 12.6 收件箱里堆着一堆「待验收」通知

`accept` 与 `transition` **都会**在任务离开 `in_review` 时解除通知（见 §7.2），
所以正常情况下不应堆积。若确实堆积，按顺序排查：

1. 这些通知对应的任务**是否仍处于 `in_review`** —— 是的话就是正常的待办，不是缺陷；
2. 是否来自**旧版本数据**（早期只有 `accept` 会解除）—— 用 `GET /api/audit` 对照时间即可判断；
3. 需要清空历史数据重新演示：`pnpm reset:db`。

### 12.7 演示数据被联调过程写脏（任务数量变多）

`pnpm reset:db`（删表 → 迁移 → 重新种子）可恢复到严格 5 任务分布 5 列的初始状态。
⚠️ 会**清空期间通过接口创建的所有数据**，联调进行中请勿执行。

### 12.8 改了一个源文件，正在跑的接口突然失败 / 服务「自己」重启了

`pnpm dev` 与 `pnpm dev:server` 使用 **`tsx watch src/index.ts`**，**任何** `apps/server/src/**` 下的文件改动
（含只改注释）都会触发进程重启；重启的 1~2 秒内正在进行的请求会失败。

- 只想稳定压测 / 联调时，请用**非 watch** 模式启动：`cd apps/server && pnpm start`（= `tsx src/index.ts`）。
- 判断当前实例是否 watch：`curl -s localhost:3001/health` 看 `uptimeSec`，若在你未重启的情况下归零，即为 watch 重载。
  ⚠️ **注意这个判据的边界**：`uptimeSec` 归零只能说明「进程重启过」，**无法区分**是 watch 自动重载还是有人手动重启。
  若你在多人协作中观察到此现象，先确认是否有人改了代码后重启 —— 否则很容易把「他人重启」误判成「watch 重载」。
  要确定启动方式，看启动命令本身（`pnpm dev` 含 `watch`，`pnpm start` 不含）。
- 反直觉的一点：`apps/server/src/db/seed.ts` 也被 `src/index.ts` 引用（启动时按需灌种子），
  所以**改它同样会触发重载**。

---

## 13. 常见问题（FAQ）

**Q1：`GET /health` 需要带 `x-actor-id` 吗？**
**不需要。** `x-actor-id` 在**全站都是可选的**：`onRequest` 阶段若未提供，会自动回退为演示默认身份
`m-human-zhangwei`（张伟），因此 `trace.currentActor()` 恒为非空，HTTP 路径**不会**触发
`1018 actorId 缺失`。该守卫生效的场景是**无请求上下文的调用**（离线脚本、定时任务、直接调用 service、单测），
此时必须显式传 `actorId` 或 `SYSTEM_ACTOR_ID`。
另外 `/health` 本身不写审计，所以即使未来把默认身份去掉也不影响它的可用性。

**Q2：走 `accept` 和走 `transition {to:'done'}` 进入 `done`，是否都写审计？**
**都写审计，动作名不同；收件箱解除行为一致。**

| 路径 | 前置状态校验 | 审计 action | 双主体 | 解除收件箱通知 | 置 `completed_at` |
|---|---|---|---|---|---|
| `POST /api/tasks/:id/accept {decision:'accept'}` | **必须为 `in_review`**，否则 `409 (1006)` | `task_accepted` | ✅ actor=验收人 / initiator=验收人 | ✅ 解除（`from = in_review`） | ✅ |
| `POST /api/tasks/:id/transition {to:'done'}` | 只需满足 `TRANSITIONS` 前向表（`in_review → done` 合法）+ `lockVersion` | `task_transitioned` | ✅ actor=操作人 / initiator=操作人 | ✅ **解除**（`from = in_review` 时，与 `accept` 一致） | ✅（`to === 'done'` 时写入） |
| `POST /api/tasks/:id/transition {to:'in_progress'}`（从 `in_review`，即驳回） | **必须**带 `reasonCode`，否则 `422 (1009)` | `task_rejected` | ✅ | ✅ 解除（`from = in_review`） | — |
| `POST /api/tasks/:id/accept {decision:'reject'}` | 必须为 `in_review` | `task_rejected` | ✅ | ✅ 解除 | — |

**解除通知的判定只看状态，不看接口**：统一为「`from === in_review` 即解除」，因此上表四行的
通知行为一致（早期版本只有 `accept` 会解除，已修复）。

**结论：两者的差别在「前置校验强度」而非副作用** ——
`accept` **强制要求**任务处于 `in_review`，语义更明确、更安全；
`transition` 是通用流转入口（看板拖拽用），只按 `TRANSITIONS` 前向表校验。
**前端「验收」按钮仍建议调用 `accept`**（语义清晰 + 不会误从 `todo` 等状态直达 `done`），
`transition` 留给拖拽等通用场景。

**Q3：为什么 `actor_id` 有 `'system'` 这个值？**
表示**系统自动行为** —— 即没有人类发起的动作，例如模型超时降级（`model_degraded`，
由 `model.service.recordDegradation()` 写入）。此时：

- `actor_id = 'system'`、`initiator_id = null`（确实没有发起人）；
- `actor_name` 取调用方显式提供的展示名：种子数据里写的是 `'system'`，
  而 `recordDegradation()` 未提供，因此为 `null`。**前端不要依赖 `actor_name` 做判断**，
  请以 `actor_id === SYSTEM_ACTOR_ID`（shared 常量）为准，并渲染为「系统」。

`actor_id = null` 则一律视为缺陷 —— 后端已经在写入时拒绝该情况（抛 `1018`）。

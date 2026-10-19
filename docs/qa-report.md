# huanbuddy 独立验证测试报告（QA）

| 项 | 值 |
|---|---|
| 报告人 | 严过关（QA Engineer） |
| 日期 | 2026-10-10 |
| 被测对象 | huanbuddy 后端 API（Fastify 5 + node:sqlite） |
| 被测版本 | v1.0.0（工作区 HEAD） |
| 执行方式 | 黑盒 API（curl / fetch）+ 直连 SQLite 只读核查 |
| 结论 | **可交付（条件已满足）** —— 首轮 6 项缺陷已修复并经 QA 独立回归通过（见 §10） |

---

## 1. 测试范围与策略

### 1.1 与既有测试的差异（为什么不重复）

开发期已有资产：后端 unit/接口测试 124 个（vitest）、前端 E2E 19 断言（仓库外脚本）、交互冒烟 35 项。**本报告不复用、不重跑上述任何用例**，而是从「绕过 UI 直打 API」「直连数据库核查不变量」两个既有测试没有覆盖的角度独立设计。

| 维度 | 既有测试做法 | 本次做法（不同点） |
|---|---|---|
| 调用层 | service 层单测 / 经 UI 的 E2E | **直接打 HTTP，绕过前端与 service 封装**，尝试畸形/越权入参 |
| 断言层 | 断言返回码/字段 | **额外核对落库结果**（`audit_log` / 外键 / 孤儿记录），验证「写侧」是否一致 |
| 思路 | 正向路径为主 | **重点做负向与"绕过"**：换方法、缺字段、传 null/数组、伪造身份头、跨资源复用 id |
| 环境 | 交付库或内存库 | **独立临时库 + 独立端口**，交付库零污染 |

### 1.2 环境隔离（重要）

- 交付库 `apps/server/data/huanbuddy.db` **全程未被写入**；运行中的 3001 后端**未重启、未修改**。
- 所有写入型验证在**独立实例**上进行：
  ```bash
  # 建临时库
  cd apps/server && NODE_OPTIONS= DB_PATH=/tmp/qa-huanbuddy.db npx tsx src/db/reset.ts
  # 独立端口启动（不动 3001）
  cd apps/server && NODE_OPTIONS= DB_PATH=/tmp/qa-huanbuddy.db PORT=3011 npx tsx src/index.ts
  ```
- 下文命令中 `$B` = `http://localhost:3011`（隔离实例）；在交付库上复现时把 `$B` 换成 `http://localhost:3001` 即可。
- **夹具差异提示**：临时库为「纯种子库」。种子中 `tsk-8404` 状态为 `in_review`、**`tsk-8405` 才是 `done`**（交付库因联调已被改动，`tsk-8404` 变 `done`）。复现 P0-1/2 时请以 `GET /api/tasks?status=done` 动态取夹具，勿硬编码。

### 1.3 覆盖统计

| 分组 | 用例数 | 通过 | 失败/发现缺陷 |
|---|---|---|---|
| P0 服务端强制约束 | 34 | 34 | 0（约束均不可绕过） |
| P1 审计双主体留痕 | 24 | 22 | 2（+2 关联） |
| P2 数据完整性 | 39 | 38 | 1（设计约定，非缺陷）+ 2 缺陷 |
| P3 边界与异常输入 | 33 | 32 | 1 |
| 合计 | **130** | **126** | **6 项缺陷 + 3 项观察** |

---

## 2. P0 · 服务端强制约束是否不可绕过

> 结论：**7 条硬约束全部服务端强制生效，且我尝试的每一种绕过思路均被拦截。**

| 编号 | 验证点 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| P0-1 | `done` 任务回退 `transition{to:in_progress}` | 409 | `1006` 409（`allowed:[]`） | ✅ |
| P0-2 | `done` 任务 `PATCH` | 409 | `1007` 409 | ✅ |
| P0-3 | 驳回不带原因 | 422 | `1009` 422 | ✅ |
| P0-4 | AI 越权指派跨 dataScope 项目 | 403 | `1011` 403 | ✅ |
| P0-5 | 加载未审核社区技能 | 403 | `1012` 403 | ✅ |
| P0-6 | 沙箱拦截含 `subprocess` 脚本 | 403/1010 且 `reason=FORBIDDEN_API` | `1010` 403，`details.reason="FORBIDDEN_API"` | ✅ |
| P0-7 | 乐观锁 `lockVersion` 不匹配 | 409 | `1005` 409；并发竞态恰一成功 | ✅ |

### 2.1 关键复现命令与响应

**P0-1 `done` 不可回退（用正确 lockVersion 隔离状态规则，排除锁干扰）**
```bash
# 取 done 夹具（临时库为 tsk-8405）
curl -s "$B/api/tasks?status=done&size=1"
# 6 个目标状态全部被拒
for t in in_progress todo backlog done cancelled suspended; do
  curl -s -X POST "$B/api/tasks/tsk-8405/transition" -H 'content-type: application/json' \
    -d "{\"to\":\"$t\",\"lockVersion\":1}"; echo
done
# -> 全部 {"code":1006,...} HTTP 409, details.allowed=[]
```

**P0-2 已验收不可修改**
```bash
curl -s -X PATCH "$B/api/tasks/tsk-8405" -H 'content-type: application/json' -d '{"title":"篡改"}'
# -> {"code":1007,"message":"已验收任务不可修改"} HTTP 409
```

**P0-3 驳回必须带原因**
```bash
# 对 in_review 任务
curl -s -X POST "$B/api/tasks/$IR/accept" -H 'content-type: application/json' -d '{"decision":"reject"}'
# -> {"code":1009,"message":"请选择驳回原因"} HTTP 422
curl -s -X POST "$B/api/tasks/$IR/transition" -H 'content-type: application/json' \
  -d "{\"to\":\"in_progress\",\"lockVersion\":$LOCK}"
# -> {"code":1009,"message":"驳回必须选择原因"} HTTP 422
```

**P0-4 AI 越权指派**
```bash
# m-ai-inspector 有效域 = ['proj-ops']
curl -s -X POST "$B/api/tasks" -H 'content-type: application/json' \
  -d '{"title":"越权","tags":["proj:proj-platform"],"assigneeId":"m-ai-inspector"}'
# -> {"code":1011,"message":"超出授权范围：proj-platform",
#     "details":{"effectiveScope":["proj-ops"],"denied":["proj-platform"]}} HTTP 403
```

**P0-5 未审核社区技能不可加载**
```bash
curl -s -X POST "$B/api/hub/skills/hsk-web-crawl/load"
# -> {"code":1012,"message":"技能「网页抓取」尚未审核通过",
#     "details":{"reviewStatus":"pending","trustLevel":"community"}} HTTP 403
```

**P0-6 沙箱纵深防御（含 subprocess）**
```bash
curl -s -X POST "$B/api/skills/skl-weekly-digest/execute" -H 'content-type: application/json' \
  -d '{"versionId":"skv-digest-090"}'
# -> {"code":1010,"message":"脚本包含禁止调用的 API「subprocess」，已阻断执行",
#     "details":{"reason":"FORBIDDEN_API","violatedApi":"subprocess"}} HTTP 403
# 且 validate/publish 同样被拒（无法"先发布再执行"）
curl -s -X POST "$B/api/skills/skl-weekly-digest/validate" -H 'content-type: application/json' -d '{"versionId":"skv-digest-090"}'
# -> pass:false, staticIssues 命中 line1/line3
curl -s -X POST "$B/api/skills/skl-weekly-digest/versions/v0.9.0/publish"
# -> HTTP 400 禁止发布
```

**P0-7 并发锁**
```bash
curl -s -X POST "$B/api/tasks/$T/transition" -H 'content-type: application/json' -d '{"to":"todo","lockVersion":999}'
# -> {"code":1005,"details":{"expected":0,"received":999}} HTTP 409
# 省略 / 字符串 / 负数 lockVersion -> 1001 HTTP 400
# 并发：两个相同 lockVersion 的 assign 同时发出 -> 结果A HTTP 409/1005，结果B HTTP 200/0（恰一成功）
```

### 2.2 我尝试过的「绕过思路」及结果（全部失败＝好消息）

| 绕过思路 | 结果 |
|---|---|
| `done` 任务改用 `PATCH {"status":...}` 直改状态 | `updateTaskSchema` 不含 `status`，字段被 Zod 丢弃，**200 但状态不变**（无 mass-assignment） |
| `done` 任务改用 `accept {decision:reject}` 反向推 | `1006` 409（accept 要求 in_review） |
| `PATCH {}` / 未知字段 / `null` body | 均 `1007` 409（不可变检查在字段过滤之前） |
| `rejectReasonCode` 传 `null` / `""` / 非法值 | 均 `1001` 400 |
| 伪造 `x-actor-id: m-human-zhangwei` 后越权指派 | 仍 `1011` 403（越权判定用任务 creator，与调用者身份无关） |
| 先 `disable` 再 `load` 未审核技能 | 仍 `1012` 403（review_status 未被改动） |
| 用 GET 访问 `.../load`（方法绕过） | `1004` 404（路由不存在） |
| 跨技能复用 `versionId`（roi-report 用 digest 的版本号） | `1004` 404（版本必须属于该技能） |
| `assign assigneeId:"system"` | `1004` 404（system 非成员） |
| `transition {to:[...]}` / `{to:null}` | `1001` 400 |

**P0 遗留观察（非缺陷，但建议产品确认）**
- **OBS-02**：AI 越权判定**仅由任务的 `proj:*` 标签驱动**。若任务不带显式项目标签，则只校验「被指派域 ∩ 创建者域 ≠ ∅」，不校验 AI 自身声明域。实测：
  ```bash
  curl -s -X POST "$B/api/tasks" -H 'content-type: application/json' \
    -d '{"title":"无标签越权","assigneeId":"m-ai-inspector"}'   # -> 201 成功
  ```
  即 dataScope 的强制强度取决于标签是否填写。属设计取舍，建议在 PRD 明确「无项目标签任务如何归属域」。

---

## 3. P1 · 审计双主体留痕的完整性

### 3.1 判据（独立设计）

1. `actor_id IS NULL` 视为缺口；`actor_id='system'` 合法，其 `initiator_id` 可为 null。
2. 悬空引用：`actor_name` 非空但 `actor_id` 空；或 `actor_id` 非空（≠system）但 `actor_name` 空；或 `initiator_id` 非空但 `initiator_name` 空。
3. 同一次操作的多条审计应共享同一 `trace_id`。
4. `actor_id` 应能解析到 `member`（对非 system 主体）。

### 3.2 触发动作（13 类，`x-actor-id: m-human-chenjing`）

建任务、指派、流转、验收、技能执行成功、技能执行被阻断、hub 加载被拒、hub 加载成功、技能 PATCH、API Key 签发/吊销、KB 问答+反馈、模型降级。

### 3.3 结果

| 检查 | 结果 |
|---|---|
| A. 各动作计数（覆盖 19 种 action） | 19 种动作均有审计 ✅ |
| B. `actor_id IS NULL` 记录数 | **0** ✅（21 处缺口修复有效） |
| C. `actor_name` 非空但 `actor_id` 空 | **0** ✅ |
| D. `actor_id` 非空但 `actor_name` 空（排除 system） | 修复前 0；触发幽灵身份后 **>0** ❌ 见 DEF-02 |
| E. `initiator_id` 非空但 `initiator_name` 空 | **0** ✅ |
| F. 同一 trace 贯穿多主体 | ✅ 见下 |

**F. 一次 AI 执行链路（trace=`tr-kpq6WHgyUm`）的 6 条审计，双主体完整：**

| action | actor | actor_type | initiator |
|---|---|---|---|
| task_created | m-human-chenjing | human | m-human-chenjing |
| task_assigned | m-human-chenjing | human | m-human-chenjing |
| skill_executed | m-ai-analyst | ai | m-human-chenjing |
| model_called | m-ai-analyst | ai | m-human-chenjing |
| artifact_submitted | m-ai-analyst | ai | m-human-chenjing |
| task_accepted | m-human-chenjing | human | m-human-chenjing |

→ 「执行主体=AI、发起人=人类」的双主体留痕与 trace 贯穿**成立**。

### 3.4 发现的缺陷

#### 🔴 DEF-01（P1）对外 `/v1` 调用不写审计（openapi_invoked 缺失）

**现象**：`openapi_invoked` 出现在 `AUDIT_CRITICAL_ACTIONS`（`packages/shared/src/constants.ts:118-133`）与种子数据中，但**运行时 4 个 `/v1` 端点均不写该审计**，仅 `metrics.emit(OPENAPI_INVOKED)`。对外调用「谁、用哪个 Key、调了什么」在审计中无迹可循。

**复现：**
```bash
# 1) 签发 key 拿到明文
PT=$(curl -s -X POST "$B/api/apikeys" -H 'content-type: application/json' \
     -d '{"name":"qa","scopes":["kb:query"]}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['plaintext'])")
# 2) 记 openapi_invoked 计数
node dbq.mjs "SELECT COUNT(*) c FROM audit_log WHERE action='openapi_invoked'"   # = 1（仅种子）
# 3) 用合法 HMAC 签名调用 /v1
node v1.mjs "$PT" qa1      # script: HMAC-SHA256(key, `${ts}.POST./v1/knowledge/query.${sha256(body)}`)
#    -> HTTP 200 {"code":0,"data":{"queryId":"kbq-..."}}
# 4) 再数
node dbq.mjs "SELECT COUNT(*) c FROM audit_log WHERE action='openapi_invoked'"   # = 1（未增长 ❌）
```
**实际响应**：调用成功但审计表无新增；该 trace 只留下 `rag_query`（由 kbService 写），**无 `openapi_invoked`**。`/v1/skills/:id/execute` 同样只写 `skill_executed`、不写 `openapi_invoked`。

**定位**：`apps/server/src/routes/openapi.routes.ts` 全文**无 `audit.write`**；仅 4 处 `metrics.emit(MetricEvent.OPENAPI_INVOKED, ...)`（L137/168/210/245）。

#### 🔴 DEF-02（P1）`x-actor-id` 未校验存在性 → 可写悬空审计（有 id 无名字）

**现象**：`AuditService.write()` 只校验 `actorId` 非空，**不校验其是否存在于 `member`**。配合 `x-actor-id` 为纯客户端控制头（`actorOf()` 无鉴权），任何调用方都能制造指向不存在主体的审计行（`actor_name`/`actor_type` 均为 null）。

**复现：**
```bash
# 该写入未显式传 actorId，靠 trace.currentActor() 兜底
curl -s -X PATCH "$B/api/skills/skl-weekly-digest" -H 'x-actor-id: m-human-ghost' \
  -H 'content-type: application/json' -d '{"description":"ghost"}'
# -> HTTP 200（未校验操作者存在性）
curl -s -X POST "$B/api/hub/skills/hsk-chart-render/disable" -H 'x-actor-id: m-ghost-2'
# -> HTTP 200
node dbq.mjs "SELECT action,actor_id,actor_type,actor_name FROM audit_log WHERE actor_id LIKE '%ghost%'"
```
**实际响应（悬空行）：**
```json
[{"id":"aud-J--KYUAIehuh","action":"skill_updated","actor_id":"m-human-ghost","actor_type":null,"actor_name":null},
 {"id":"aud-3l1FXNYoBqDc","action":"hub_skill_disabled","actor_id":"m-ghost-2","actor_type":null,"actor_name":null}]
```
**定位**：`apps/server/src/core/audit.ts:113-125`（`write()` 的存在性校验缺失）；受影响写入依赖 trace 兜底的路径：`skill.update/remove/offline`、`hub.service.disable`。

> 关联风险：`x-actor-id` 无鉴权 + `PermissionService.assertAction`（角色权限矩阵）**从未被任何端点调用**（grep 仅命中单测）→ 任意客户端可冒用任意成员身份执行敏感动作，且角色级授权实际未接入。详见 §5 未覆盖/风险。

#### 🟡 DEF-06（P2）技能执行审计 actor_type 错误（human id + ai type）

**现象**：`skill_executed` / `skill_rejected` 审计硬编码 `actorType:'ai'`，但 `actor_id` 是发起的人类成员，形成「human id + ai type」自相矛盾。

```bash
curl -s -X POST "$B/api/skills/skl-roi-report/execute" -H 'x-actor-id: m-human-chenjing' \
  -H 'content-type: application/json' -d '{"versionId":"skv-roi-201","input":{}}'
node dbq.mjs "SELECT action,actor_id,actor_type,actor_name FROM audit_log WHERE action='skill_executed' AND actor_id LIKE 'm-human%'"
# -> {"action":"skill_executed","actor_id":"m-human-chenjing","actor_type":"ai","actor_name":"陈静"}
```
**定位**：`apps/server/src/services/skill.service.ts:763` 与 `:837`（`actorType: 'ai'` 写死）。

### 3.5 观察（非缺陷）

- **OBS-01**：`audit_log.initiator_id` 语义不统一。种子的 `openapi_invoked` 行把 **API Key id**（`apk-ci-pipeline`）写进 `initiator_id`（`db/seed.ts:2259` 有注释说明为有意设计），因此该列并不总是 member id。若下游（审计 UI / 报表）按 member 外连接会漏配。建议在字段文档中显式声明「对外调用时 initiator 为 Key 标识」。

---

## 4. P2 · 数据完整性

### 4.1 外键约束（20/20 生效 ✅）

在独立库 `PRAGMA foreign_keys=ON` 下逐个尝试违规写入，全部返回 `FOREIGN KEY constraint failed`：

| 表 | 违规引用 | 结果 |
|---|---|---|
| board_column / task / member | workspace_id → 不存在 workspace | 拦截 ✅ |
| task | creator_id / assignee_id → 不存在 member | 拦截 ✅ |
| task_activity | task_id / actor_id → 不存在 | 拦截 ✅ |
| artifact | task_id / submitted_by → 不存在 | 拦截 ✅ |
| skill_version / skill_permission | skill_id / skill_version_id → 不存在 | 拦截 ✅ |
| hub_skill | repo_id → 不存在 repo | 拦截 ✅ |
| member / notification / api_key | creator_id / workspace_id / recipient_id / owner_id → 不存在 | 拦截 ✅ |
| kb_document / kb_chunk | space_id / doc_id → 不存在 | 拦截 ✅ |
| agent_config / model_degradation_log / scene_route | primary_model_id / from_model_id → 不存在 model | 拦截 ✅ |

复现脚本：`DB_PATH=/tmp/qa-fk.db node /tmp/qa/fk.mjs`（脚本逐条 try/catch 打印）。

### 4.2 种子幂等（✅）

对同一库连续两次 `reset.ts`，28 张表计数**逐表完全一致**：
```
第一次: {"agent_config":3,"api_key":2,...,"task":5,"task_activity":14,...,"workspace":1}
第二次: {"agent_config":3,"api_key":2,...,"task":5,"task_activity":14,...,"workspace":1}
=> 幂等 ✓
```

### 4.3 孤儿记录扫描（18 项，1 项命中，属设计约定）

脚本 `node /tmp/qa/orphan.mjs`。17 项为 0；唯一命中项为 `audit_log.initiator_id → member` 的 1 行（`aud-L0014 / openapi_invoked / initiator_id=apk-ci-pipeline`），即 §3.5 的 OBS-01，**为种子有意为之，非缺陷**。其余 17 类引用（task/artifact/activity/skill/agent_config/notification/usage/session/kb…）均无孤儿。

### 4.4 发现的缺陷

#### 🟡 DEF-04（P2）未发布草稿版本的技能可直接执行

**现象**：`POST /api/skills/:id/execute` **不校验版本状态**；草稿技能 + 草稿版本可直接执行成功。而 AI 执行路径 `loadExecutableSkills()` 明确要求 `version.status === 'published'`，两者不一致。

```bash
SID=$(curl -s -X POST "$B/api/skills" -H 'content-type: application/json' \
  -d '{"slug":"qa-draft-exec","name":"QA草稿","createdBy":"m-human-zhangwei"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")
VID=$(curl -s -X POST "$B/api/skills/$SID/versions" -H 'content-type: application/json' \
  -d '{"version":"v0.0.1","script":"kb.search(\"x\")","scriptLang":"nodejs","permissions":[{"capability":"kb_read","granted":true}],"createdBy":"m-human-zhangwei"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST "$B/api/skills/$SID/execute" -H 'content-type: application/json' -d "{\"versionId\":\"$VID\"}"
# -> HTTP 200 {"status":"success", ...}   （技能 status 仍为 draft）
```
**定位**：`apps/server/src/services/skill.service.ts:710-729`（`execute()` 无版本/技能状态门）。

#### 🟡 DEF-05（P2）已验收(done)任务可被 DELETE 删除

**现象**：`PATCH` 对 `done` 有 `1007` 保护，但 `DELETE /api/tasks/:id` 无不可变保护，`done` 任务可被直接删除（连同活动轨迹；交付物 task_id 置空）。

```bash
D=$(curl -s "$B/api/tasks?status=done&size=1" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['items'][0]['id'])")
curl -s -X DELETE "$B/api/tasks/$D"
# -> HTTP 200 {"code":0,"data":{"id":"..."}}   （已验收任务被删除）
```
**定位**：`apps/server/src/services/task.service.ts:492-513`（`remove()` 未检查 `IMMUTABLE_STATUSES`）。
**说明**：PRD 只写「已验收不可**修改**」，删除属独立语义；但与「已验收=归档不可变」的意图存在张力，建议明确策略。

---

## 5. P3 · 边界与异常输入

| 检查项 | 输入 | 预期 | 实际 | 结论 |
|---|---|---|---|---|
| 分页 size 边界 | `size=0 / -5 / 99999 / abc` | 归一化 | `0→fallback 20`、`-5→20`、`99999→200`、`abc→20` | ✅ 全部 200 |
| 分页 page 边界 | `page=0 / -1 / 99999` | 归一化 | 全部 200，`page` 被夹取 | ✅ |
| title 超长 | 201 字符 | 400 | `1001` 400 | ✅ |
| title 边界 | 200 字符 | 201 | `201` | ✅ |
| title 空/仅空格/缺失/非串/null | — | 400 | `1001` 400 | ✅ |
| 特殊字符存储 | `' " ; \ <script> emoji 🎉` | 原样存取 | 回读一致（无丢失/无转义破坏） | ✅ |
| SQL 注入（查询参数） | `q=' OR '1'='1` | 不返回全量 | `total=0`（按字面匹配） | ✅ |
| SQL 注入（破坏性） | `q='; DROP TABLE task;--` | 表仍在 | 200，`total` 不变（表未删） | ✅ |
| 注入：status / hub q / audit action | 同上 | 参数化 | 均 0 条，无异常 | ✅ |
| 不存在 id | task/skill/member/hub/kb | 404 | 全部 `1004` 404 | ✅ |
| 畸形请求体 | 数组/数字/空 | 400 | `1001` 400 | ✅ |
| **畸形 JSON** | `{"title":} ` | 400 | **`1023` 500** | ❌ DEF-03 |
| 非 JSON content-type | `text/plain` + JSON 串 | 400 | `1001` 400 | ✅ |

#### 🔴 DEF-03（P1）畸形 JSON 请求体返回 500 而非 400

**现象**：语法非法的 JSON body → `HTTP 500 / code 1023 INTERNAL`，而非文档约定的 `400 / 1001`。会让客户端错误被计为服务端故障（污染错误率/告警）。

```bash
curl -s -w '\n[HTTP:%{http_code}]\n' -X POST "$B/api/tasks" -H 'content-type: application/json' -d '{"title":}'
# -> {"code":1023,"message":"服务异常，请稍后重试",
#     "details":{"name":"INTERNAL","cause":"Unexpected token '}', \"{\"title\":}\" is not valid JSON"}} [HTTP:500]
```
**定位**：`apps/server/src/app.ts:122-135` 自定义 content-type parser 中 `done(error)` 传入的 `SyntaxError` 无 `statusCode`，`core/errors.ts:141-151` 的 `statusCode` 分支不命中，落入 `1023 INTERNAL`。修复方向：parser 内把 JSON 解析错误包成 `AppError(BAD_REQUEST)`。

---

## 6. 额外发现：静态检查（沙箱纵深防御的前提）覆盖率缺口

#### 🔴 DEF-07（P1，设计纵深）`DANGEROUS_APIS` 子串白名单可被绕过

`staticCheck` 采用**行级子串匹配**（`ai/static-check.ts`），命中列表外即可放行。实测 `pty.spawn`（真实 shell 逃逸原语）**全链路放行**：

```bash
SID=$(curl -s -X POST "$B/api/skills" -H 'content-type: application/json' \
  -d '{"slug":"qa-obfusc2","name":"q","createdBy":"m-human-zhangwei"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")
VID=$(curl -s -X POST "$B/api/skills/$SID/versions" -H 'content-type: application/json' \
  -d '{"version":"v0.0.1","script":"import pty\npty.spawn(\"/bin/sh\")","scriptLang":"python","createdBy":"m-human-zhangwei"}' \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['id'])")
curl -s -X POST "$B/api/skills/$SID/validate" -H 'content-type: application/json' -d "{\"versionId\":\"$VID\"}"
# -> pass:true, permissionIssues:[]     ← 未被拦截
curl -s -X POST "$B/api/skills/$SID/versions/v0.0.1/publish"       # -> HTTP 200（可发布）
curl -s -X POST "$B/api/skills/$SID/execute" -H 'content-type: application/json' -d "{\"versionId\":\"$VID\"}"
# -> HTTP 200 {"status":"success"}        ← 可执行
```
**影响评估（诚实说明）**：当前沙箱为 `MockSandbox`，**不真实执行脚本**，因此「实际被利用」的现网风险为零；但**拦截门（静态检查）是未来接入真实沙箱（gVisor/Firecracker）后唯一的前置防线**，其基于子串的列表已被证明可绕过（`pty.spawn` / `os.exec*` / `ctypes` / `importlib` 等），建议改为 AST + 污点分析（代码注释已把 `static-check.ts` 标为 REPLACE_POINT）。

---

## 7. 缺陷汇总与路由判定

| 编号 | 级别 | 摘要 | 归属 | 关键定位 |
|---|---|---|---|---|
| DEF-01 | P1 | `/v1/*` 对外调用不写 `openapi_invoked` 审计 | **Engineer** | `routes/openapi.routes.ts`（全文无 audit.write） |
| DEF-02 | P1 | `x-actor-id` 未校验存在性 → 悬空审计（有 id 无名字）；且角色矩阵 `assertAction` 未接入 | **Engineer** | `core/audit.ts:113-125` |
| DEF-03 | P1 | 畸形 JSON → 500/1023（应 400/1001） | **Engineer** | `app.ts:122-135` + `core/errors.ts:141` |
| DEF-04 | P2 | 未发布草稿版本可直接执行（与 AI 路径不一致） | **Engineer** | `services/skill.service.ts:710` |
| DEF-05 | P2 | 已验收(done)任务可被 DELETE 删除 | **Engineer**（需产品确认策略） | `services/task.service.ts:492` |
| DEF-06 | P2 | 技能执行审计 `actor_type='ai'` 写死（human id + ai type） | **Engineer** | `services/skill.service.ts:763,837` |
| DEF-07 | P1(纵深) | 静态检查子串列表可绕过（pty.spawn 放行） | **Engineer** | `ai/static-check.ts` + `shared/constants.ts:152` |
| OBS-01 | 观察 | `initiator_id` 混入 API Key id（种子有意） | 产品/文档 | `db/seed.ts:2259` |
| OBS-02 | 观察 | AI 越权判定仅由 `proj:*` 标签驱动 | 产品/文档 | `services/task.service.ts:608-624` |
| OBS-03 | 观察 | `x-actor-id` 无鉴权（演示期设计） | 产品/架构 | `app.ts:102-112` |

**路由判定**：`Engineer`。以上 7 项均为**源码问题**（缺校验/缺写入/错误映射），**非测试缺陷**；本次运行中我自身出现过 2 次测试脚本问题（夹具状态假设错误、shell 嵌套引号损坏 body），均已自查定位并重跑，未计入缺陷。

---

## 8. 未覆盖项与风险（诚实清单）

1. **真实沙箱执行**：当前为 Mock，未验证真实容器隔离、网络策略、tmpfs 只读挂载。
2. **认证/角色授权**：`x-actor-id` 为演示身份切换器，未接入登录；`PERMISSION_MATRIX` 的角色动作授权未在任何端点强制执行（仅数据域交集强制）。若 PRD 要求「同一套权限」，此为待补项。
3. **前端/端到端**：本次为纯后端 API 与库层验证，未覆盖前端交互（已有 19 项 E2E 覆盖，按分工不复跑）。
4. **流式/异步链路**：`/v1/agents/:id/invoke` 的 stream、`/v1/workflows/:id/run` 的 async 回调未做端到端校验。
5. **限流/幂等**：仅代码走查，未做超限压测与幂等重放实测（依赖进程内 Map，重启即失效，属已知实现）。
6. **性能与并发压力**：未做负载测试；乐观锁仅验证了 2 并发竞态。
7. **模型网关降级链**：未触发真实多级降级路径。

---

## 9. 总体结论

**有条件交付（Conditional Pass）**

- **P0 硬约束（PRD 写明"必须服务端强制"）7/7 全部生效，且多种绕过思路均被拦截** —— 这是本项目最核心的质量点，表现良好。
- **数据完整性扎实**：外键 20/20 生效、种子重置幂等、18 项孤儿扫描 17 项清零（唯一命中为有意设计）。
- **审计双主体与 trace 贯穿成立**，`actor_id IS NULL` 缺口已清零。
- **但存在 6 项缺陷（含 3 项 P1）**：对外调用审计缺失（DEF-01）、审计主体存在性未校验（DEF-02）、畸形 JSON 返回 500（DEF-03）三项建议**在本版发布前修复**；DEF-04/05/06 及纵深项 DEF-07 建议纳入下一迭代。

修复 DEF-01/02/03 后即可视为**可交付**。

---

## 附录 A · 复现资产

| 文件 | 用途 |
|---|---|
| `/tmp/qa/p0.sh` / `p0b.sh` | P0 约束与绕过套件 |
| `/tmp/qa/p1.sh` | P1 审计触发与核查 |
| `/tmp/qa/p3.sh` | P3 边界与注入 |
| `/tmp/qa/fk.mjs` | 外键约束验证（20 例） |
| `/tmp/qa/orphan.mjs` | 孤儿记录扫描（18 项） |
| `/tmp/qa/dbq.mjs` | 只读 SQL 查询助手 |
| `/tmp/qa/v1.mjs` | `/v1` 合法签名调用构造器 |
| `/tmp/qa/evidence/all.txt`、`p0.out`、`p1.out`、`p3.out` | 原始响应证据 |

---

# 10. 回归验证（第二轮 · 修复后独立复核）

> 时间：2026-10-10 06:27–06:35 ｜ 执行人：QA 严过关
> 环境：**全新独立库** `/tmp/qa-reg.db`（`reset.ts` 重建，无历史脏数据）+ 端口 3011；交付库与 3001 后端未触碰。
> 原则：**不采信修复方结论，用本报告 §2–§5 的原始复现命令重跑**；并额外做「反向用例」与「误伤检查」防止过度拦截。

## 10.1 逐项复核结果

| 缺陷 | 修复声明 | QA 独立复核（我自己的命令与实测） | 判定 |
|---|---|---|---|
| **DEF-01** `/v1` 无审计 | 4 端点接入 `auditOpenApiInvoked` | `openapi_invoked` 计数：knowledge 2→3、skills 3→4、workflows 4→5、agents 5→6，**逐一 +1**；行主体 `actor=张伟(human)`、`initiator=<Key 名>`，`result=success` | ✅ 已修复 |
| **DEF-02** 悬空主体 | `lookupActor()` 校验 member 存在性 | 未知 `x-actor-id` → `400/1001「未知操作者：m-human-ghost」`；新增悬空行=0；**反向**：冒用已存在成员 `m-human-liuyang` 仍 `200`，审计记为 `actor=刘洋/human` | ✅ 已修复 |
| **DEF-03** 畸形 JSON 500 | parser 包装为 `AppError(BAD_REQUEST)` | `{"title":}` → `400/1001「请求体不是合法 JSON」`；`"hello"` → `400/1001`；合法对象仍 `201` | ✅ 已修复 |
| **DEF-05** done 可删除 | `remove()` 加终态检查 | `done` 任务 DELETE → `409/1006`，任务仍在；`backlog` 任务 DELETE → `200` 且 `task_deleted` 审计主体 = 真实调用者「刘洋」（硬编码已消除） | ✅ 已修复 |
| **DEF-06** actor_type 矛盾 | `lookupActor()` 以 member 表为准覆盖 | 人类执行技能 → `actor_type=human`（原为 ai）；AI 自动执行 → `ai`；**矛盾行=0** | ✅ 已修复 |
| **DEF-07** pty 可绕过 | 规则 18→36 条 | 12/12 危险脚本 `validate pass=false`（pty.spawn / os.popen / os.execv / os.system / ctypes / socket. / yaml.load / marshal.loads / commands. / spawnSync / child_process / mmap.）；**误伤检查 4/4 合法脚本通过并可执行**；种子已发布技能仍可执行 | ✅ 已修复 |
| DEF-04 草稿可执行 | 不修（调试台语义） | 复核现状：草稿版本 execute 仍 `200`（行为未变） | ⚠️ 按产品裁定接受 |

**回归附加检查（均通过）**
- `system` 主体路径未回归：模型降级 → `201`，审计 `actor_id='system'`。
- `actor_name` 为空（排除 system）= **0**；`actor_type='ai'` 却挂 human id 的行 = **0**。
- 孤儿扫描 18 项：16 项为 0；`audit_log.initiator_id → member` 命中 6 行，**全部是 `openapi_invoked`**（`initiator_id` = API Key 标识），即本次修复确立的对外调用双主体语义，**符合预期，非缺陷**。

## 10.2 P0 硬约束回归（修复后重跑，全部保持）

| 用例 | 预期 | 实测 |
|---|---|---|
| done 回退（正确 lock） | 409/1006 | `1006` 409 ✅ |
| done PATCH | 409/1007 | `1007` 409 ✅ |
| 驳回无原因 | 422/1009 | `1009` 422 ✅ |
| AI 越权指派 | 403/1011 | `1011` 403 ✅ |
| 未审核技能加载 | 403/1012 | `1012` 403 ✅ |
| 含 subprocess 执行 | 403/1010 | `1010` 403 ✅ |
| 错误/缺失 lockVersion | 409/1005 或 400 | `1005` 409 ✅ |

## 10.3 过程备注（诚实记录）

- 本轮我自身的验证脚本仍出现 2 次问题（`mk()` 生成 body 时 shell 嵌套引号损坏、slug 含大写字母违反命名规则），**均为脚本缺陷，修正后重跑，未计入产品缺陷**（与首轮同类问题一致）。
- **未复核项**：DEF-04 未作为缺陷复核（依裁定停在此）；静态检查的「非子串型混淆」（字符串拼接 / 动态 getattr / 编码混淆）**仍不可挡**——修复方已在规则表加「局限声明」，我在此复述以防高估：**该黑名单不是完备静态分析，接真实沙箱前须按目标语言逃逸面重新评估**。

## 10.4 结论

首轮 6 项缺陷中，**5 项修复经独立复核确认有效，1 项（DEF-04）按产品裁定接受**；且修复未引入功能回归（P0 全绿、无过度拦截、无新增悬空/矛盾审计）。

→ 本版本判定由「有条件交付」升级为 **可交付（Conditional Pass → Pass）**。
残余风险已在 §8「未覆盖项」与 OBS-01/02/03 中如实列出（角色级授权未接入、静态检查非完备、`x-actor-id` 演示期无鉴权）。

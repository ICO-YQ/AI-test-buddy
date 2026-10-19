/**
 * 端到端接口测试（T04/T05/T06 验收标准）
 * 通过 Fastify `inject` 覆盖：健康检查、任务状态机约束、并发锁、验收校验、
 * AI 执行链路、数据域越权、知识检索 ACL、Hub 信任等级、/v1 签名+幂等+限流。
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app';
import { computeSignature } from '../services/apikey.service';
import { getDb } from '../db/client';
import { closeDb } from '../db/client';

const db = getDb();

let app: FastifyInstance;

/** 种子固定 ID */
const TASK_DONE = 'tsk-8405'; // done（终态，不可 PATCH）
const TASK_REVIEW = 'tsk-8404'; // in_review，lock_version = 3
const TASK_COPY = 'tsk-8403'; // in_progress，lock_version = 2
const TASK_SPEC = 'tsk-8401'; // backlog，tags 含 proj:proj-platform
const AI_ANALYST = 'm-ai-analyst';
const AI_INSPECTOR = 'm-ai-inspector';
const ZHANGWEI = 'm-human-zhangwei';

const CI_KEY = 'hb_live_ci_demo_key_0001';

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  closeDb();
});

interface Envelope<T = unknown> {
  code: number;
  data: T;
  message: string;
  traceId?: string;
  details?: unknown;
}

function body<T = unknown>(response: { payload: string }): Envelope<T> {
  return JSON.parse(response.payload) as Envelope<T>;
}

/* ═══════════════════════════════════════════════ */

describe('GET /health', () => {
  it('返回 200 与统一包装', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const payload = body<{ status: string; driver: string }>(res);
    expect(payload.code).toBe(0);
    expect(payload.data.status).toBe('ok');
    expect(['node', 'better']).toContain(payload.data.driver);
  });
});

describe('种子数据可通过 API 读出', () => {
  it('GET /api/tasks → 5 条任务', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    expect(res.statusCode).toBe(200);
    const payload = body<{ items: { status: string }[]; total: number }>(res);
    expect(payload.data.total).toBe(5);
    const statuses = payload.data.items.map((t) => t.status).sort();
    expect(statuses).toEqual(['backlog', 'done', 'in_progress', 'in_review', 'todo']);
  });

  it('GET /api/members → 6 条成员（3 AI + 3 人类）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/members' });
    const payload = body<{ id: string; type: string }[]>(res);
    expect(payload.data).toHaveLength(6);
    expect(payload.data.filter((m) => m.type === 'ai')).toHaveLength(3);
    expect(payload.data.filter((m) => m.type === 'human')).toHaveLength(3);
  });

  it('GET /api/skills → 4 个技能', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/skills' });
    const payload = body<{ id: string }[]>(res);
    expect(payload.data).toHaveLength(4);
  });

  it('GET /api/models → 3 个模型（含 1 个已停用）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/models' });
    const payload = body<{ enabled: boolean }[]>(res);
    expect(payload.data).toHaveLength(3);
    expect(payload.data.filter((m) => !m.enabled)).toHaveLength(1);
  });

  it('GET /api/hub/repos → 2 个仓库；Hub 技能含 1 条待审核', async () => {
    const repos = body<unknown[]>(await app.inject({ method: 'GET', url: '/api/hub/repos' }));
    expect(repos.data).toHaveLength(2);
    const skills = body<{ reviewStatus: string }[]>(
      await app.inject({ method: 'GET', url: '/api/hub/skills' }),
    );
    expect(skills.data.filter((s) => s.reviewStatus === 'pending')).toHaveLength(1);
  });

  it('GET /api/kb/spaces → 3 个知识空间', async () => {
    const payload = body<unknown[]>(await app.inject({ method: 'GET', url: '/api/kb/spaces' }));
    expect(payload.data).toHaveLength(3);
  });

  it('GET /api/inbox → 收件箱非空', async () => {
    const payload = body<unknown[]>(await app.inject({ method: 'GET', url: '/api/inbox' }));
    expect(payload.data.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════ */

describe('任务状态机服务端强制约束', () => {
  it('非法流转（backlog → done 跳步）→ 409 STATE_ILLEGAL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_SPEC}/transition`,
      payload: { to: 'done', lockVersion: 0 },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe(1006);
  });

  it('回退流转（in_progress → todo）→ 409 STATE_ILLEGAL', async () => {
    const current = body<{ lockVersion: number }>(
      await app.inject({ method: 'GET', url: `/api/tasks/${TASK_COPY}` }),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_COPY}/transition`,
      payload: { to: 'todo', lockVersion: current.data.lockVersion },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe(1006);
  });

  it('lockVersion 不匹配 → 409 CONFLICT_LOCK', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_COPY}/transition`,
      payload: { to: 'in_review', lockVersion: 999 },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe(1005);
  });

  it('done 任务 PATCH → 409 TASK_IMMUTABLE', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${TASK_DONE}`,
      payload: { title: '试图修改已验收任务' },
    });
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe(1007);
  });

  it('驳回缺少原因 → 422 REJECT_REASON_REQUIRED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_REVIEW}/accept`,
      payload: { decision: 'reject' },
    });
    expect(res.statusCode).toBe(422);
    expect(body(res).code).toBe(1009);
  });

  it('驳回带原因 → 前向跳转 in_review → in_progress（合法）', async () => {
    const before = body<{ lockVersion: number; status: string }>(
      await app.inject({ method: 'GET', url: `/api/tasks/${TASK_REVIEW}` }),
    );
    expect(before.data.status).toBe('in_review');

    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_REVIEW}/accept`,
      payload: {
        decision: 'reject',
        rejectReasonCode: 'info_insufficient',
        comment: '证据链不足，请补充渠道侧变更记录',
      },
    });
    expect(res.statusCode).toBe(200);
    const task = body<{ status: string; rejectReasonCode: string }>(res);
    expect(task.data.status).toBe('in_progress');
    expect(task.data.rejectReasonCode).toBe('info_insufficient');

    // 审计留痕
    const trace = body<{ traceId?: string }>(
      await app.inject({ method: 'GET', url: `/api/audit?action=task_rejected&resourceType=task` }),
    );
    expect(trace.code).toBe(0);
  });

  it('任务不存在 → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/tsk-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(body(res).code).toBe(1004);
  });
});

/* ═══════════════════════════════════════════════ */

describe('任务创建 → 指派 AI → 执行 → 交付 → 验收（全链路）', () => {
  let taskId = '';

  it('创建任务并指派 AI 成员 → 自动执行并落到 in_review', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: '回归验证：生成月度投放小结',
        description: '基于投放运营规范输出月度小结',
        priority: 'p2',
        tags: ['回归', 'proj:proj-ops'],
        assigneeId: AI_ANALYST,
        acceptCriteria: '含结论与引用依据',
      },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(created.statusCode).toBe(201);
    const task = body<{ id: string; code: string; status: string; traceId: string }>(created);
    taskId = task.data.id;

    // 指派给 AI 后自动执行：todo → in_progress → in_review
    expect(task.data.status).toBe('in_review');
    expect(task.data.code).toMatch(/^TSK-\d{4}$/);
    expect(task.data.traceId).toMatch(/^tr-/);
  });

  it('执行轨迹与交付物已落库', async () => {
    const detail = body<{
      activities: { type: string; actorType: string }[];
      artifacts: { code: string; content: string }[];
      tokenUsed: number;
      cost: number;
    }>(await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` }));

    expect(detail.data.activities.length).toBeGreaterThan(0);
    expect(detail.data.activities.some((a) => a.type === 'agent_plan')).toBe(true);
    expect(detail.data.activities.some((a) => a.type === 'tool_call')).toBe(true);
    expect(detail.data.artifacts).toHaveLength(1);
    expect(detail.data.artifacts[0]?.code).toMatch(/^ART-\d{4}$/);
    expect(detail.data.artifacts[0]?.content).toContain('#');
    expect(detail.data.tokenUsed).toBeGreaterThan(0);
    expect(detail.data.cost).toBeGreaterThan(0);
  });

  it('收件箱产生「待验收」通知', async () => {
    const inbox = body<{ kind: string; refId: string }[]>(
      await app.inject({ method: 'GET', url: `/api/inbox?recipientId=${ZHANGWEI}` }),
    );
    expect(inbox.data.some((n) => n.refId === taskId && n.kind === 'approval')).toBe(true);
  });

  it('验收通过 → done，完成时间被记录', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/accept`,
      payload: { decision: 'accept', comment: '通过' },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(200);
    const task = body<{ status: string; completedAt?: string }>(res);
    expect(task.data.status).toBe('done');
    expect(task.data.completedAt).toBeTruthy();
  });

  /**
   * 同一业务状态变化（离开 in_review）走不同接口，副作用必须一致。
   *
   * 历史缺陷：只有 `accept` 会解除收件箱通知，`transition {to:'done'}` 不会 ——
   * 于是用 transition 完成的任务，其「待你验收」通知会永远挂在收件箱。
   */
  it('transition 到 done 同样解除收件箱通知（与 accept 同一副作用）', async () => {
    // 新建任务（不复用上面的 taskId —— 它已被 accept 置为 done）
    const created = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        title: '回归：transition 路径的通知解除',
        tags: ['回归', 'proj:proj-ops'],
        assigneeId: AI_ANALYST,
      },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(created.statusCode).toBe(201);
    const t = body<{ id: string; status: string; lockVersion: number }>(created);
    expect(t.data.status).toBe('in_review'); // AI 自动执行后落到审核中
    const id = t.data.id;

    const inboxBefore = body<{ kind: string; refId: string }[]>(
      await app.inject({ method: 'GET', url: `/api/inbox?recipientId=${ZHANGWEI}` }),
    );
    expect(inboxBefore.data.some((n) => n.refId === id && n.kind === 'approval')).toBe(true);

    // 关键：走 transition 而不是 accept
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/transition`,
      payload: { to: 'done', lockVersion: t.data.lockVersion },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(200);

    const inboxAfter = body<{ kind: string; refId: string }[]>(
      await app.inject({ method: 'GET', url: `/api/inbox?recipientId=${ZHANGWEI}` }),
    );
    expect(inboxAfter.data.some((n) => n.refId === id)).toBe(false);
  });

  it('全链路审计可按 traceId 回放（含双主体）', async () => {
    const detail = body<{ traceId: string }>(
      await app.inject({ method: 'GET', url: `/api/tasks/${taskId}` }),
    );
    const trace = body<
      { action: string; actorType?: string; initiatorId?: string; traceId: string }[]
    >(await app.inject({ method: 'GET', url: `/api/audit/trace/${detail.data.traceId}` }));

    expect(trace.code).toBe(0);
    expect(trace.data.length).toBeGreaterThan(2);
    const actions = trace.data.map((row) => row.action);
    expect(actions).toContain('task_created');
    expect(actions).toContain('artifact_submitted');
    expect(trace.data.some((row) => row.actorType === 'ai' && row.initiatorId === ZHANGWEI)).toBe(true);
  });

  it('任务度量可读', async () => {
    const metrics = body<{ throughput: number; rejectRate: number }>(
      await app.inject({ method: 'GET', url: '/api/tasks/metrics' }),
    );
    expect(metrics.code).toBe(0);
    expect(metrics.data.throughput).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════ */

describe('数据域越权（min 有效权限）', () => {
  it('给无 proj-platform 权限的 AI 指派声明了 proj:proj-platform 的任务 → 403 SCOPE_DENIED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/tasks/${TASK_SPEC}/assign`,
      payload: { assigneeId: AI_INSPECTOR, lockVersion: 0 },
      headers: { 'x-actor-id': ZHANGWEI },
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1011);
  });

  it('有效权限接口返回 min() 结果', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/members/${AI_INSPECTOR}/effective-permissions`,
    });
    const payload = body<{ scope: string[]; note: string }>(res);
    expect(payload.data.scope).toEqual(['proj-ops']);
    expect(payload.data.note).toContain('min(');
  });

  it('创建 AI 成员缺少 creatorId → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/members',
      payload: { type: 'ai', name: 'AI·无创建者' },
    });
    expect(res.statusCode).toBe(400);
    expect(body(res).code).toBe(1001);
  });
});

/* ═══════════════════════════════════════════════ */

describe('知识库检索（先 ACL 过滤再召回）', () => {
  it('命中 → 返回引用；写 kb_query_log', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/kb/query',
      payload: { query: '禁用词有哪些', scope: 'all', topK: 5, askerId: ZHANGWEI },
    });
    expect(res.statusCode).toBe(200);
    const payload = body<{ answer: string; insufficient: boolean; citations: unknown[]; queryId: string }>(res);
    expect(payload.data.insufficient).toBe(false);
    expect(payload.data.citations.length).toBeGreaterThan(0);
    expect(payload.data.answer).toContain('引用依据');
    expect(payload.data.queryId).toMatch(/^kbq-/);
  });

  it('无命中 → insufficient = true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/kb/query',
      payload: { query: 'zzz不存在的关键词qqq', scope: 'all', askerId: ZHANGWEI },
    });
    const payload = body<{ insufficient: boolean; citations: unknown[] }>(res);
    expect(payload.data.insufficient).toBe(true);
    expect(payload.data.citations).toHaveLength(0);
  });

  it('检索无权限空间 → 403 SCOPE_DENIED（ACL 前置）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/kb/query',
      payload: { query: '归因窗口', scope: 'space:kbs-growth', askerId: 'm-ai-writer' },
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1011);
  });

  it('文档保存生成新版本；软删后检索不再返回', async () => {
    const created = body<{ id: string; currentVersion: number }>(
      await app.inject({
        method: 'POST',
        url: '/api/kb/documents',
        payload: {
          spaceId: 'kbs-ops-spec',
          title: '临时回归文档：投放频次规范',
          content: '# 投放频次规范\n\n单设备每日曝光不超过 3 次。',
        },
      }),
    );
    expect(created.data.currentVersion).toBe(1);

    const saved = body<{ currentVersion: number }>(
      await app.inject({
        method: 'PATCH',
        url: `/api/kb/documents/${created.data.id}`,
        payload: { content: '# 投放频次规范\n\n单设备每日曝光不超过 5 次。', note: '放宽频次' },
      }),
    );
    expect(saved.data.currentVersion).toBe(2);

    // 删除（软删 + 索引失效）
    await app.inject({ method: 'DELETE', url: `/api/kb/documents/${created.data.id}` });
    const after = await app.inject({
      method: 'POST',
      url: '/api/kb/query',
      payload: { query: '投放频次规范曝光', scope: 'space:kbs-ops-spec', askerId: ZHANGWEI },
    });
    const payload = body<{ citations: { docId: string }[] }>(after);
    expect(payload.data.citations.some((c) => c.docId === created.data.id)).toBe(false);
  });

  it('AI 润色保留数字并返回可还原标记', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/kb/documents/kbd-ops-002/polish',
      payload: { scope: 'full', action: 'polish' },
    });
    expect(res.statusCode).toBe(200);
    const payload = body<{ candidates: string[]; polishMeta: { originalIndexes: number[]; preserved?: string[] } }>(res);
    expect(payload.data.candidates.length).toBeGreaterThan(0);
    // 数字保真：原文中的「7 天」等数字必须保留
    for (const candidate of payload.data.candidates) {
      for (const number of payload.data.polishMeta.preserved ?? []) {
        expect(candidate).toContain(number);
      }
    }
  });
});

/* ═══════════════════════════════════════════════ */

describe('Hub 信任等级与签名', () => {
  it('社区待审技能 load → 403 TRUST_PENDING 并写审计告警', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/hub/skills/hsk-web-crawl/load' });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1012);

    const audit = body<{ items: { action: string; result: string }[] }>(
      await app.inject({ method: 'GET', url: '/api/audit?resourceType=hub_skill&size=20' }),
    );
    expect(audit.data.items.some((row) => row.result === 'blocked')).toBe(true);
  });

  it('官方已审技能 load → loaded + sandboxRequired', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/hub/skills/hsk-clean-text/load' });
    expect(res.statusCode).toBe(200);
    const payload = body<{ loaded: boolean; sandboxRequired: boolean }>(res);
    expect(payload.data.loaded).toBe(true);
    expect(payload.data.sandboxRequired).toBe(true);
  });

  it('仓库同步返回 synced/failed', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/hub/repos/repo-platform-official/sync' });
    expect(res.statusCode).toBe(200);
    const payload = body<{ synced: number; failed: number; lastSyncAt: string }>(res);
    expect(payload.data.synced).toBeGreaterThan(0);
    expect(payload.data.lastSyncAt).toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════ */

describe('/v1 对外能力：签名 + 幂等 + 时间戳窗口 + 限流', () => {
  const path = '/v1/skills/skl-material-gen/execute';
  const rawBody = JSON.stringify({ versionId: 'skv-material-120', input: { channel: 'douyin' } });

  function signedHeaders(idempotencyKey: string, timestamp = Date.now()): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': CI_KEY,
      'x-idempotency-key': idempotencyKey,
      'x-timestamp': String(timestamp),
      'x-signature': computeSignature({
        plaintextKey: CI_KEY,
        method: 'POST',
        path,
        timestamp: String(timestamp),
        rawBody,
      }),
    };
  }

  it('合法签名 → 执行成功；重复幂等键 → 原样返回首次结果', async () => {
    const key = `idem-${Date.now()}`;
    const first = await app.inject({
      method: 'POST',
      url: path,
      payload: rawBody,
      headers: signedHeaders(key),
    });
    expect(first.statusCode).toBe(200);
    const firstBody = body<{ executionId: string; status: string; localFiles: number }>(first);
    expect(firstBody.data.status).toBe('success');
    expect(firstBody.data.localFiles).toBe(0);

    const replay = await app.inject({
      method: 'POST',
      url: path,
      payload: rawBody,
      headers: signedHeaders(key),
    });
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    const replayBody = body<{ executionId: string }>(replay);
    expect(replayBody.data.executionId).toBe(firstBody.data.executionId);
  });

  it('签名错误 → 403 SIGNATURE_INVALID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: path,
      payload: rawBody,
      headers: { ...signedHeaders(`idem-bad-${Date.now()}`), 'x-signature': 'deadbeef' },
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1013);
  });

  it('时间戳超窗（> 5 分钟）→ 401 TIMESTAMP_EXPIRED', async () => {
    const old = Date.now() - 6 * 60 * 1000;
    const res = await app.inject({
      method: 'POST',
      url: path,
      payload: rawBody,
      headers: signedHeaders(`idem-exp-${Date.now()}`, old),
    });
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe(1015);
  });

  it('缺少幂等键 → 400', async () => {
    const headers = signedHeaders(`idem-x-${Date.now()}`);
    delete headers['x-idempotency-key'];
    const res = await app.inject({ method: 'POST', url: path, payload: rawBody, headers });
    expect(res.statusCode).toBe(400);
    expect(body(res).code).toBe(1001);
  });

  it('Key 无效 → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: path,
      payload: rawBody,
      headers: { ...signedHeaders(`idem-401-${Date.now()}`), 'x-api-key': 'hb_live_wrong_key' },
    });
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe(1002);
  });

  it('超出 scope（workflow:run 不在 ci key 的 scopes 内）→ 403', async () => {
    const workflowPath = '/v1/workflows/wf-demo/run';
    const workflowBody = JSON.stringify({ mode: 'sync', input: { title: '对外触发任务' } });
    const timestamp = String(Date.now());
    const res = await app.inject({
      method: 'POST',
      url: workflowPath,
      payload: workflowBody,
      headers: {
        'content-type': 'application/json',
        'x-api-key': CI_KEY,
        'x-idempotency-key': `idem-scope-${Date.now()}`,
        'x-timestamp': timestamp,
        'x-signature': computeSignature({
          plaintextKey: CI_KEY,
          method: 'POST',
          path: workflowPath,
          timestamp,
          rawBody: workflowBody,
        }),
      },
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1003);
  });

  it('/v1/me 返回能力与签名窗口', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-api-key': CI_KEY },
    });
    const payload = body<{ scopes: string[]; signatureWindowMs: number }>(res);
    expect(payload.data.scopes).toContain('skill:execute');
    expect(payload.data.signatureWindowMs).toBe(300000);
  });

  it('出网域名白名单：未白名单 → 403 DOMAIN_NOT_ALLOWED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/domains/check',
      payload: { domain: 'evil.example.com' },
      headers: { 'x-api-key': CI_KEY, 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(403);
    expect(body(res).code).toBe(1014);
  });
});

/* ═══════════════════════════════════════════════ */

describe('治理：API Key / 用量 / 安全事件', () => {
  it('创建 Key 仅返回一次明文，且查询不返回 hash', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/apikeys',
      payload: { name: 'regression-key', scopes: ['kb:query'], ownerId: ZHANGWEI },
    });
    expect(created.statusCode).toBe(201);
    const payload = body<{ key: Record<string, unknown>; plaintext: string }>(created);
    expect(payload.data.plaintext).toMatch(/^hb_live_/);
    expect(payload.data.key).not.toHaveProperty('keyHash');

    const list = body<Record<string, unknown>[]>(await app.inject({ method: 'GET', url: '/api/apikeys' }));
    expect(list.data.every((key) => !('keyHash' in key))).toBe(true);
  });

  it('吊销 Key 后状态为 revoked', async () => {
    const list = body<{ id: string; name: string }[]>(
      await app.inject({ method: 'GET', url: '/api/apikeys' }),
    );
    const target = list.data.find((key) => key.name === 'regression-key');
    expect(target).toBeTruthy();
    const res = await app.inject({ method: 'POST', url: `/api/apikeys/${target?.id}/revoke` });
    const payload = body<{ status: string }>(res);
    expect(payload.data.status).toBe('revoked');
  });

  it('用量汇总按模型/调用方归因，并给出对账差异', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/usage/summary' });
    const payload = body<{ byModel: unknown[]; byCaller: unknown[]; totalCost: number; reconcileDiffPct: number }>(res);
    expect(payload.data.byModel.length).toBeGreaterThan(0);
    expect(payload.data.byCaller.length).toBeGreaterThan(0);
    expect(payload.data.totalCost).toBeGreaterThan(0);
    expect(typeof payload.data.reconcileDiffPct).toBe('number');
  });

  it('安全事件统计包含 8 类且存在拦截计数', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit/security-events' });
    const payload = body<{ type: string; today: number; month: number }[]>(res);
    expect(payload.data).toHaveLength(8);
    const skillRejected = payload.data.find((row) => row.type === 'skill_rejected');
    expect(skillRejected?.month).toBeGreaterThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════ */

describe('会话与模型', () => {
  it('会话列表可读；切换模型生效', async () => {
    const sessions = body<{ id: string }[]>(await app.inject({ method: 'GET', url: '/api/sessions' }));
    expect(sessions.data.length).toBeGreaterThanOrEqual(2);

    const target = sessions.data[0]?.id as string;
    const switched = body<{ modelId: string }>(
      await app.inject({
        method: 'POST',
        url: `/api/sessions/${target}/model`,
        payload: { modelId: 'mdl-opus-45' },
      }),
    );
    expect(switched.data.modelId).toBe('mdl-opus-45');
  });

  it('停用模型不可切换 → 502 MODEL_UNAVAILABLE', async () => {
    const sessions = body<{ id: string }[]>(await app.inject({ method: 'GET', url: '/api/sessions' }));
    const res = await app.inject({
      method: 'POST',
      url: `/api/sessions/${sessions.data[0]?.id}/model`,
      payload: { modelId: 'mdl-qwen3-self' },
    });
    expect(res.statusCode).toBe(502);
    expect(body(res).code).toBe(1020);
  });

  it('发送消息 → 返回用户消息与助手消息（含引用块）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/ses-copy-live/messages',
      payload: { content: '禁用词有哪些？' },
    });
    expect(res.statusCode).toBe(201);
    const payload = body<{
      userMessage: { role: string };
      assistantMessage: { role: string; tokens?: number; blocks: unknown[] };
    }>(res);
    expect(payload.data.userMessage.role).toBe('user');
    expect(payload.data.assistantMessage.role).toBe('assistant');
    expect(payload.data.assistantMessage.blocks.length).toBeGreaterThan(0);
  });
});

/* ═══════════════════════════════════════════════ */

describe('数据库完整性', () => {
  it('28 张业务表全部存在', () => {
    const tables = db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .map((row) => row.name);
    expect(tables).toHaveLength(28);
  });

  it('外键约束已开启', () => {
    const row = db.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(Number(row?.foreign_keys)).toBe(1);
  });
});

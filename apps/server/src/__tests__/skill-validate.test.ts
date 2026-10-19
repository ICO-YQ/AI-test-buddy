/**
 * 技能校验单测（T03/T05 验收标准）
 * 覆盖：权限声明 vs 实际调用一致性、危险 API 静态检查、沙箱越权拦截（403 PERMISSION_UNDECLARED）、
 *       发布前阻断、被引用版本不可下线（409 SKILL_IN_USE）。
 */

import { describe, expect, it } from 'vitest';

import { ALL_CAPABILITIES, SYSTEM_ACTOR_ID } from '@huanbuddy/shared';

import { AppError } from '../core/errors';
import { AuditService } from '../core/audit';
import { MockSandbox } from '../ai/sandbox';
import { StaticCheck } from '../ai/static-check';
import { SkillService } from '../services/skill.service';
import { getDb } from '../db/client';

const db = getDb();
const checker = new StaticCheck();
const sandbox = new MockSandbox();
const service = new SkillService(db, { checker, sandbox });

const SKILL_MATERIAL = 'skl-material-gen';
const VER_MATERIAL = 'skv-material-120';
const SKILL_DIGEST = 'skl-weekly-digest';
const VER_DIGEST = 'skv-digest-090';

function expectCode(fn: () => unknown, code: number): AppError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  }
  throw new Error(`预期抛出 AppError(${code})，但未抛出`);
}

describe('StaticCheck · 危险 API 扫描', () => {
  it('child_process 命中 → pass=false', () => {
    const result = checker.scan('const cp = require("child_process");', 'nodejs');
    expect(result.pass).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.forbidden).toContain('child_process');
  });

  it('同一禁止 API 出现在多行 → forbidden 去重', () => {
    const result = checker.scan('import subprocess\nsubprocess.run(["date"])', 'python');
    expect(result.forbidden).toEqual(['subprocess']);
    // 但 issues 保留逐行定位（两行各一条）
    expect(result.issues.length).toBe(2);
    expect(result.issues.map((issue) => issue.line)).toEqual([1, 2]);
  });

  it('subprocess 命中 → pass=false', () => {
    const result = checker.scan('import subprocess\nsubprocess.run(["ls"])', 'python');
    expect(result.pass).toBe(false);
    expect(result.forbidden).toContain('subprocess');
  });

  it('eval( 命中 → pass=false', () => {
    expect(checker.scan('const x = eval("1+1")', 'nodejs').pass).toBe(false);
  });

  it('requests. 命中 → 推导出 net 能力（可声明解决）', () => {
    const result = checker.scan('import requests\nr = requests.get("https://x")', 'python');
    expect(result.capabilities).toContain('net');
    expect(result.forbidden).toHaveLength(0);
  });

  it('kb.search 命中 → 推导出 kb_read 能力', () => {
    expect(checker.scan('hits = kb.search("x")', 'python').capabilities).toContain('kb_read');
  });

  it('注释中的危险调用被忽略（行尾注释剥离）', () => {
    expect(checker.scan('x = 1  # 禁止 child_process', 'python').pass).toBe(true);
  });

  it('空脚本视为通过', () => {
    expect(checker.scan(null).pass).toBe(true);
    expect(checker.scan('').pass).toBe(true);
  });

  it('非白名单语言 → 报 issue', () => {
    const result = checker.scan('print(1)', 'ruby');
    expect(result.pass).toBe(false);
    expect(result.issues[0]?.msg).toContain('白名单');
  });
});

describe('StaticCheck · 行号定位', () => {
  it('issue 携带正确行号（1-based）', () => {
    const script = ['x = 1', 'import subprocess', 'y = 2'].join('\n');
    const result = checker.scan(script, 'python');
    expect(result.issues.some((issue) => issue.line === 2)).toBe(true);
  });
});

describe('MockSandbox · 权限声明白名单', () => {
  it('未声明能力被调用 → blocked + 越权原因', () => {
    const result = sandbox.run({
      script: 'import requests\nr = requests.get("https://news.huan.tv")',
      scriptLang: 'python',
      permissions: [
        { capability: 'net', granted: false },
        { capability: 'kb_read', granted: true },
      ],
    });
    expect(result.status).toBe('blocked');
    expect(result.violatedCapability).toBe('net');
    expect(result.blockReason).toContain('越权调用');
    expect(result.localFiles).toBe(0);
  });

  it('禁止类 API（subprocess）无条件阻断，任何声明都不放行', () => {
    const result = sandbox.run({
      script: 'import subprocess\nsubprocess.run(["date"])',
      scriptLang: 'python',
      // 即使把六个能力全部声明为 true 也必须拦截
      permissions: ALL_CAPABILITIES.map((capability) => ({ capability, granted: true })),
    });
    expect(result.status).toBe('blocked');
    expect(result.blockReason).toContain('禁止调用的 API');
    expect(result.blockReason).toContain('subprocess');
    expect(result.localFiles).toBe(0);
  });

  it('禁止类 API（child_process）在 nodejs 脚本中同样阻断', () => {
    const result = sandbox.run({
      script: 'const cp = require("child_process"); cp.exec("ls")',
      scriptLang: 'nodejs',
      permissions: ALL_CAPABILITIES.map((capability) => ({ capability, granted: true })),
    });
    expect(result.status).toBe('blocked');
    expect(result.blockReason).toContain('child_process');
  });

  it('脚本语言未声明或不在白名单 → 阻断', () => {
    const noLang = sandbox.run({ script: 'print(1)', permissions: [] });
    expect(noLang.status).toBe('blocked');
    expect(noLang.blockReason).toContain('不在白名单');

    const badLang = sandbox.run({ script: 'puts 1', scriptLang: 'ruby', permissions: [] });
    expect(badLang.status).toBe('blocked');
    expect(badLang.blockReason).toContain('ruby');
  });

  it('声明覆盖后执行成功且本地落盘为 0', () => {
    const result = sandbox.run({
      script: 'import requests\nr = requests.get("https://api.huan.tv")',
      scriptLang: 'python',
      permissions: [{ capability: 'net', granted: true }],
      input: { a: 1 },
    });
    expect(result.status).toBe('success');
    expect(result.localFiles).toBe(0);
    expect(result.output).toMatchObject({ ok: true });
  });

  it('无脚本（纯提示词技能）可直接执行', () => {
    const result = sandbox.run({ permissions: [] });
    expect(result.status).toBe('success');
    expect(result.localFiles).toBe(0);
  });

  it('沙箱不可用 → 抛 1019 SANDBOX_UNAVAILABLE', () => {
    expectCode(
      () => sandbox.run({ permissions: [], available: false }),
      1019,
    );
  });

  it('每条执行都返回唯一 sandboxId', () => {
    const a = sandbox.run({ permissions: [] });
    const b = sandbox.run({ permissions: [] });
    expect(a.sandboxId).not.toBe(b.sandboxId);
  });
});

describe('SkillService.validate · 权限声明与实际调用一致性', () => {
  it('已发布技能「素材文案生成 v1.2.0」通过（kb_read 已声明）', () => {
    const result = service.validate(SKILL_MATERIAL, VER_MATERIAL);
    expect(result.pass).toBe(true);
    expect(result.permissionIssues).toHaveLength(0);
    expect(result.staticIssues).toHaveLength(0);
  });

  it('草稿「周报摘要助手 v0.9.0」不通过（subprocess 禁止调用）', () => {
    const result = service.validate(SKILL_DIGEST, VER_DIGEST);
    expect(result.pass).toBe(false);
    expect(result.staticIssues.some((issue) => issue.msg.includes('subprocess'))).toBe(true);
    expect(result.permissionIssues.some((msg) => msg.includes('禁止调用'))).toBe(true);
  });

  it('脚本调用未声明能力 → permissionIssues 阻断', () => {
    const skill = service.create({
      slug: `needs-net-${Date.now()}`,
      name: '需要出网的技能',
      createdBy: 'm-human-zhangwei',
    });
    const version = service.createVersion(skill.id, {
      version: 'v1.0.0',
      script: 'import requests\nr = requests.get("https://news.huan.tv")',
      scriptLang: 'python',
      // 故意不声明 net
      permissions: [{ capability: 'kb_read', granted: true }],
      createdBy: 'm-human-zhangwei',
    });

    const result = service.validate(skill.id, version.id);
    expect(result.pass).toBe(false);
    expect(result.permissionIssues.some((msg) => msg.includes('net'))).toBe(true);

    // 发布被阻断
    expectCode(() => service.publish(skill.id, 'v1.0.0'), 1001);

    // 补上声明后可发布
    const fixed = service.createVersion(skill.id, {
      version: 'v1.0.1',
      script: 'import requests\nr = requests.get("https://news.huan.tv")',
      scriptLang: 'python',
      permissions: [{ capability: 'net', granted: true, detail: 'news.huan.tv' }],
      createdBy: 'm-human-zhangwei',
    });
    expect(service.validate(skill.id, fixed.id).pass).toBe(true);
    const published = service.publish(skill.id, 'v1.0.1');
    expect(published.status).toBe('published');
    expect(service.get(skill.id).currentVersion).toBe('v1.0.1');
  });

  it('validate 不存在的版本 → 404', () => {
    expectCode(() => service.validate(SKILL_MATERIAL, 'skv-not-exist'), 1004);
  });
});

describe('SkillService.execute · 越权拦截 + 审计', () => {
  it('未声明能力被调用 → 403 PERMISSION_UNDECLARED 且写 skill_rejected 审计', () => {
    const skill = service.create({
      slug: `exec-block-${Date.now()}`,
      name: '执行拦截测试技能',
      createdBy: 'm-human-zhangwei',
    });
    const version = service.createVersion(skill.id, {
      version: 'v1.0.0',
      script: 'import requests\nr = requests.get("https://news.huan.tv")',
      scriptLang: 'python',
      permissions: [],
      createdBy: 'm-human-zhangwei',
    });

    const before = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'skill_rejected'",
    );

    expectCode(
      () => service.execute(skill.id, { versionId: version.id, input: {} }, 'm-ai-inspector', 'm-zhangwei'),
      1010,
    );

    const after = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'skill_rejected'",
    );
    expect(Number(after?.c)).toBeGreaterThan(Number(before?.c ?? 0));

    const execution = db.get<{ status: string; block_reason: string; local_files: number }>(
      'SELECT status, block_reason, local_files FROM skill_execution WHERE skill_id = ? ORDER BY created_at DESC LIMIT 1',
      [skill.id],
    );
    expect(execution?.status).toBe('blocked');
    expect(execution?.block_reason).toContain('越权调用');
    expect(Number(execution?.local_files)).toBe(0);
  });

  it('权限声明覆盖 → 执行成功，local_files = 0，写 skill_executed 审计', () => {
    const skill = service.create({
      slug: `exec-ok-${Date.now()}`,
      name: '执行成功测试技能',
      createdBy: 'm-human-zhangwei',
    });
    const version = service.createVersion(skill.id, {
      version: 'v1.0.0',
      script: 'hits = kb.search("合规")',
      scriptLang: 'python',
      permissions: [{ capability: 'kb_read', granted: true, detail: 'space:ops-spec' }],
      createdBy: 'm-human-zhangwei',
    });

    // 直接调用 service（绕过 HTTP）时必须显式给出双主体 —— 没有请求上下文可供兜底。
    // actor = 执行技能的 AI 成员；initiator = 发起该动作的人类成员。
    const result = service.execute(
      skill.id,
      { versionId: version.id, input: { q: 'x' } },
      'm-ai-analyst',
      'm-human-zhangwei',
    );
    expect(result.status).toBe('success');
    expect(result.localFiles).toBe(0);
    expect(result.sandboxId).toMatch(/^sbx-/);
    expect(result.cost).toBeGreaterThan(0);

    const audit = db.get<{ c: number; actor_id: string; initiator_id: string }>(
      `SELECT COUNT(*) AS c, MIN(actor_id) AS actor_id, MIN(initiator_id) AS initiator_id
         FROM audit_log WHERE action = 'skill_executed' AND resource_id = ?`,
      [skill.id],
    );
    expect(Number(audit?.c)).toBeGreaterThan(0);
    // 双主体留痕：AI 执行、人类发起，两者都必须落库且不相同
    expect(audit?.actor_id).toBe('m-ai-analyst');
    expect(audit?.initiator_id).toBe('m-human-zhangwei');
  });

  it('执行含禁止类 API 的未发布版本 → 403（沙箱纵深防御，无需经过 validate）', () => {
    const before = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'skill_rejected'",
    );

    expectCode(
      () =>
        service.execute(
          SKILL_DIGEST,
          { versionId: VER_DIGEST, input: {} },
          'm-ai-inspector',
          'm-human-zhangwei',
        ),
      1010,
    );

    const after = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'skill_rejected'",
    );
    expect(Number(after?.c)).toBeGreaterThan(Number(before?.c ?? 0));

    const execution = db.get<{ status: string; block_reason: string }>(
      'SELECT status, block_reason FROM skill_execution WHERE skill_id = ? ORDER BY created_at DESC LIMIT 1',
      [SKILL_DIGEST],
    );
    expect(execution?.status).toBe('blocked');
    expect(execution?.block_reason).toContain('禁止调用');
  });

  it('Hub 社区技能未审核通过 → 403 TRUST_PENDING', () => {
    // 种子里 hsk-web-crawl 为 community + pending
    const hubSkill = db.get<{ id: string }>(
      "SELECT id FROM hub_skill WHERE review_status = 'pending' LIMIT 1",
    );
    expect(hubSkill?.id).toBeTruthy();

    // 建立本地映射（source=hub + hub_skill_id），用于校验信任等级前置拦截
    const skill = service.create({
      slug: `hub-pending-${Date.now()}`,
      name: '社区抓取技能（待审）',
      createdBy: 'm-human-zhangwei',
      source: 'hub',
      trustLevel: 'community',
      hubSkillId: hubSkill?.id,
    });
    const version = service.createVersion(skill.id, {
      version: 'v0.0.1',
      script: 'x = 1',
      scriptLang: 'python',
      permissions: [],
      createdBy: 'm-human-zhangwei',
    });

    expectCode(() => service.execute(skill.id, { versionId: version.id, input: {} }), 1012);
  });
});

describe('SkillService · 影响面与下线', () => {
  it('被 AI 成员引用的版本 → impact.blocked = true', () => {
    const impact = service.impact(SKILL_MATERIAL, 'v1.2.0');
    expect(impact.blocked).toBe(true);
    expect(impact.referencedByAgents.length).toBeGreaterThan(0);
  });

  it('下线被引用版本 → 409 SKILL_IN_USE 且返回引用方', () => {
    const error = expectCode(() => service.offline(SKILL_MATERIAL, 'v1.2.0'), 1008);
    expect(error.http).toBe(409);
    expect(error.details).toHaveProperty('referencedByAgents');
  });
});

/**
 * 审计双主体留痕的**根因防御**。
 *
 * 历史上 hub_skill_loaded / api_key_revoked / session_model_switched 等 21 类动作
 * 都漏写了 actorId 而静默成功 —— 因为 write() 允许空值，且单元测试只断言
 * 「审计行存在」不断言「字段完整」。这里保证校验本身不会被改回去。
 */
describe('AuditService · actorId 必填校验（双主体留痕根因防御）', () => {
  const audit = new AuditService(db);

  it('缺 actorId 且无请求上下文 → 抛 1018，拒绝写入', () => {
    const error = expectCode(
      () =>
        audit.write({
          action: 'unit_test_missing_actor',
          resourceType: 'test',
          resourceId: 'x',
        }),
      1018,
    );
    expect(error.message).toContain('缺少 actorId');
    // 关键：不能落库（否则就是静默成功）
    const row = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE action = 'unit_test_missing_actor'",
    );
    expect(Number(row?.c)).toBe(0);
  });

  it('显式传 actorId → 正常写入，且双主体落库', () => {
    const id = audit.write({
      action: 'unit_test_with_actor',
      actorId: 'm-ai-analyst',
      initiatorId: 'm-human-zhangwei',
      resourceType: 'test',
    });
    expect(id).toMatch(/^aud-/);
    const row = db.get<{ actor_id: string; initiator_id: string; actor_name: string }>(
      'SELECT actor_id, initiator_id, actor_name FROM audit_log WHERE id = ?',
      [id],
    );
    expect(row?.actor_id).toBe('m-ai-analyst');
    expect(row?.initiator_id).toBe('m-human-zhangwei');
    // 姓名由 member 表补齐，不应为空
    expect(row?.actor_name).toBeTruthy();
  });

  it('系统动作显式传 SYSTEM_ACTOR_ID → 允许写入，initiator 可为空', () => {
    const id = audit.write({
      action: 'unit_test_system_action',
      actorId: SYSTEM_ACTOR_ID,
      actorType: null,
      initiatorId: null,
      resourceType: 'test',
    });
    const row = db.get<{ actor_id: string; initiator_id: string | null }>(
      'SELECT actor_id, initiator_id FROM audit_log WHERE id = ?',
      [id],
    );
    // 系统动作：actor 显式标记为 system（而非 null），initiator 保持 null 是合法的
    expect(row?.actor_id).toBe(SYSTEM_ACTOR_ID);
    expect(row?.initiator_id).toBeNull();
  });

  /* ── DEF-02：悬空主体必须拒绝 ── */
  it('actorId 指向不存在的成员 → 抛 400，拒绝写入（防止悬空审计）', () => {
    const error = expectCode(
      () =>
        audit.write({
          action: 'unit_test_ghost_actor',
          actorId: 'm-human-ghost',
          resourceType: 'test',
        }),
      1001,
    );
    expect(error.message).toContain('未知操作者');
    // 关键：不能落库 —— 否则会产出「有 id 无名字」的坏行
    const row = db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM audit_log WHERE actor_id LIKE '%ghost%'",
    );
    expect(Number(row?.c)).toBe(0);
  });

  /* ── DEF-06：actorType 由 member 表推导，调用方传错也被纠正 ── */
  it('调用方传错 actorType → 以 member 表为准而非采信传入值', () => {
    // 故意传 'ai'，但 m-human-zhangwei 实际是人类。
    // 过去 skill.service 硬编码 actorType:'ai' 就产出了「human id + ai type」的矛盾行。
    const id = audit.write({
      action: 'unit_test_actor_type_mismatch',
      actorId: 'm-human-zhangwei',
      actorType: 'ai',
      resourceType: 'test',
    });
    const row = db.get<{ actor_id: string; actor_type: string; actor_name: string }>(
      'SELECT actor_id, actor_type, actor_name FROM audit_log WHERE id = ?',
      [id],
    );
    expect(row?.actor_id).toBe('m-human-zhangwei');
    expect(row?.actor_type).toBe('human'); // ← 被纠正为真实类型
    expect(row?.actor_name).toBe('张伟');
  });
});

/**
 * initiator 兜底 —— 双主体留痕的另一半。
 *
 * 历史缺陷：早先只兜底了 actorId，`initiatorId` 未显式提供时就写 null。
 * 于是 `kb_space_created` / `skill_version_created` / `task_deleted` 等 26 处
 * 长期只有「执行主体」没有「发起人」—— 而这些动作**在演示界面上是可见的**
 * （技能页「保存声明」按钮就会触发 skill_version_created）。
 *
 * 该缺陷由**数据驱动**的检查发现（查库看哪条缺 initiator），
 * 而纯代码扫描没发现 —— 因为扫描条件只查「无 actorId」与「actorId ?? null」，
 * 漏掉了「有 actorId 但缺 initiatorId」这一形态。两种方法各有盲区，都要用。
 */
describe('AuditService · initiator 兜底（双主体留痕的另一半）', () => {
  const audit = new AuditService(db);

  it('只传 actorId → initiator 自动等于执行主体（人自己操作）', () => {
    const id = audit.write({
      action: 'unit_test_initiator_fallback',
      actorId: 'm-human-chenjing',
      resourceType: 'test',
    });
    const row = db.get<{ actor_id: string; actor_name: string; initiator_id: string; initiator_name: string }>(
      'SELECT actor_id, actor_name, initiator_id, initiator_name FROM audit_log WHERE id = ?',
      [id],
    );
    expect(row?.initiator_id).toBe('m-human-chenjing');
    expect(row?.initiator_name).toBe('陈静'); // 姓名也要补齐，不能只有 id
  });

  it('显式传不同的 initiator → 不被兜底覆盖（AI 执行、人发起）', () => {
    const id = audit.write({
      action: 'unit_test_initiator_explicit',
      actorId: 'm-ai-analyst',
      initiatorId: 'm-human-liuyang',
      resourceType: 'test',
    });
    const row = db.get<{ actor_id: string; initiator_id: string; initiator_name: string }>(
      'SELECT actor_id, initiator_id, initiator_name FROM audit_log WHERE id = ?',
      [id],
    );
    // 关键：AI 作为执行主体时，发起人必须仍是人类，不能被兜底成 AI 自己
    expect(row?.actor_id).toBe('m-ai-analyst');
    expect(row?.initiator_id).toBe('m-human-liuyang');
    expect(row?.initiator_name).toBe('刘洋');
  });

  it('系统动作的 initiator 保持 null（合法的无发起人）', () => {
    const id = audit.write({
      action: 'unit_test_initiator_system',
      actorId: SYSTEM_ACTOR_ID,
      resourceType: 'test',
    });
    const row = db.get<{ actor_id: string; initiator_id: string | null }>(
      'SELECT actor_id, initiator_id FROM audit_log WHERE id = ?',
      [id],
    );
    expect(row?.actor_id).toBe(SYSTEM_ACTOR_ID);
    expect(row?.initiator_id).toBeNull();
  });
});

/* ── DEF-07：静态检查需覆盖 pty 等进程创建入口 ── */
describe('StaticCheck · 进程逃逸入口覆盖（DEF-07）', () => {
  it('pty.spawn 被识别为禁止调用（原先可绕过）', () => {
    const r = checker.scan('import pty\npty.spawn("/bin/sh")', 'python');
    expect(r.pass).toBe(false);
    expect(r.forbidden.length).toBeGreaterThan(0);
  });

  it.each([
    ['python', 'os.popen("id")'],
    ['python', 'import ctypes'],
    ['python', 'yaml.load(x)'],
    ['python', 'import commands'],
    ['nodejs', 'require("child_process").spawn("sh")'],
  ])('%s 脚本中的危险调用被阻断: %s', (lang, script) => {
    const r = checker.scan(script, lang);
    expect(r.pass).toBe(false);
  });

  it('正常脚本不被误伤（回归保护）', () => {
    const r = checker.scan('result = kb.search("合规")\nreturn result', 'python');
    expect(r.pass).toBe(true);
  });
});

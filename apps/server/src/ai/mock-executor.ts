/**
 * MockExecutor —— AI 成员执行轨迹的**模拟实现**
 *
 * REPLACE_POINT: 本文件是「AI 执行」能力的替换点。当前产出脚本化轨迹：
 *   计划(plan) → 知识检索(retrieve) → 技能沙箱执行(skill) → 模型调用(model) → 交付(artifact)
 * 未来替换点：真实 Agent Runtime（规划循环、真实工具调用、失败重试、人工介入）。
 *
 * 依赖注入：Retriever / Sandbox / ModelGateway 均以接口注入，替换任一实现不影响本文件。
 */

import {
  ArtifactType,
  SKILL_STATUS_LABEL,
  type Citation,
  type ExecutionStep,
  type ExecutionTrace,
  type Scene,
} from '@huanbuddy/shared';

import { newTraceId } from '../core/trace';
import type { AgentExecutionInput, AiExecutor, ExecutableSkill } from './executor';
import { toCitation } from './executor';
import { mockModelGateway, type ModelGateway } from './model-gateway';
import { mockRetriever, type Retriever } from './retriever';
import { mockSandbox, type Sandbox } from './sandbox';

export interface MockExecutorDeps {
  retriever?: Retriever;
  sandbox?: Sandbox;
  gateway?: ModelGateway;
}

export class MockExecutor implements AiExecutor {
  private readonly retriever: Retriever;
  private readonly sandbox: Sandbox;
  private readonly gateway: ModelGateway;

  constructor(deps: MockExecutorDeps = {}) {
    this.retriever = deps.retriever ?? mockRetriever;
    this.sandbox = deps.sandbox ?? mockSandbox;
    this.gateway = deps.gateway ?? mockModelGateway;
  }

  /** 场景路由：P1 任务走复杂推理，其余走日常执行 */
  private sceneOf(priority: string, skills: ExecutableSkill[]): Scene {
    if (priority === 'p1') return 'reasoning';
    if (skills.length === 0) return 'daily';
    return 'daily';
  }

  execute(input: AgentExecutionInput): ExecutionTrace {
    const traceId = input.traceId ?? newTraceId();
    const startedAt = Date.now();
    const steps: ExecutionStep[] = [];

    const { task, agent, skills } = input;
    const query = input.query ?? `${task.title}${task.description ? ` ${task.description}` : ''}`;

    // ── 步骤 1：执行计划 ──
    steps.push({
      kind: 'plan',
      title: '制定执行计划',
      detail: [
        `目标：${task.title}`,
        task.acceptCriteria ? `验收标准：${task.acceptCriteria}` : '验收标准：未指定',
        `可用技能：${skills.length > 0 ? skills.map((s) => `${s.skill.name} ${s.version.version}`).join('、') : '无'}`,
      ].join('\n'),
      durationMs: 40,
      tokenUsed: 0,
      cost: 0,
      payload: { taskCode: task.code, agentId: agent.id, skillIds: skills.map((s) => s.skill.id) },
    });

    // ── 步骤 2：知识检索（先 ACL 过滤再召回） ──
    const chunks = this.retriever.search({
      query,
      allowedSpaceIds: input.allowedSpaceIds,
      topK: 5,
    });
    const citations: Citation[] = chunks.map(toCitation);
    steps.push({
      kind: 'retrieve',
      title: '检索知识库',
      detail:
        chunks.length > 0
          ? `命中 ${chunks.length} 条依据：${chunks.map((c) => `${c.spaceName} / ${c.heading ?? c.docTitle}`).join('；')}`
          : '未在可读知识空间中命中依据（依据不足）',
      durationMs: 120,
      tokenUsed: 0,
      cost: 0,
      payload: {
        allowedSpaceIds: input.allowedSpaceIds,
        hits: citations.map((c) => ({ docId: c.docId, heading: c.heading, version: c.version })),
      },
    });

    // ── 步骤 3：逐个技能进沙箱执行 ──
    let skillTokenUsed = 0;
    let skillCost = 0;
    let skillDuration = 0;
    const executedSkills: string[] = [];
    const blockedSkills: { skillId: string; reason: string }[] = [];

    for (const item of skills) {
      const result = this.sandbox.run({
        script: item.version.script,
        scriptLang: item.version.scriptLang,
        permissions: item.permissions,
        input: {
          taskId: task.id,
          taskCode: task.code,
          query,
          citationCount: citations.length,
        },
      });

      skillDuration += result.durationMs;
      const tokenUsed = Math.round(180 + Object.keys(item.version.inputSchema ?? {}).length * 40);
      const cost = 0.002;

      if (result.status === 'success') {
        executedSkills.push(item.skill.name);
        skillTokenUsed += tokenUsed;
        skillCost += cost;
      } else {
        blockedSkills.push({ skillId: item.skill.id, reason: result.blockReason ?? '未知原因' });
      }

      steps.push({
        kind: 'skill',
        title: `执行技能「${item.skill.name}」`,
        detail:
          result.status === 'success'
            ? `沙箱 ${result.sandboxId} 执行成功（本地落盘 ${result.localFiles} 个文件）`
            : `已阻断：${result.blockReason}`,
        durationMs: result.durationMs,
        tokenUsed: result.status === 'success' ? tokenUsed : 0,
        cost: result.status === 'success' ? cost : 0,
        payload: {
          skillId: item.skill.id,
          skillName: item.skill.name,
          version: item.version.version,
          versionStatus: SKILL_STATUS_LABEL[item.version.status],
          sandboxId: result.sandboxId,
          status: result.status,
          declared: item.permissions.filter((p) => p.granted).map((p) => p.capability),
          localFiles: result.localFiles,
          blockReason: result.blockReason ?? null,
        },
      });
    }

    // ── 步骤 4：模型调用（场景路由 + 降级） ──
    const scene = this.sceneOf(task.priority, skills);
    const context = chunks.map((c) => `[${c.spaceName}/${c.heading ?? c.docTitle}] ${c.content}`).join('\n');
    const modelResult = this.gateway.complete({
      prompt: `任务：${task.title}\n描述：${task.description ?? '无'}\n请基于引用依据产出交付物。`,
      scene,
      context,
      agentId: agent.id,
      preferredModelId: input.agentConfig?.primaryModelId,
    });

    steps.push({
      kind: 'model',
      title: `调用模型「${modelResult.modelName}」`,
      detail: modelResult.fallbackUsed
        ? `场景 ${modelResult.scene} 主力模型不可用，已降级到 ${modelResult.modelName}`
        : `场景 ${modelResult.scene}，正常返回`,
      durationMs: modelResult.durationMs,
      tokenUsed: modelResult.tokenIn + modelResult.tokenOut,
      cost: modelResult.cost,
      payload: {
        modelId: modelResult.modelId,
        scene: modelResult.scene,
        tokenIn: modelResult.tokenIn,
        tokenOut: modelResult.tokenOut,
        fallbackUsed: modelResult.fallbackUsed,
        degradedFrom: modelResult.degradedFrom ?? null,
      },
    });

    // ── 步骤 5：产出交付物 ──
    const citationLines =
      citations.length > 0
        ? citations
            .map((c, i) => `${i + 1}. 《${c.spaceName}》${c.heading ? ` · ${c.heading}` : ''}（v${c.version}）`)
            .join('\n')
        : '（未检索到可引用依据，结论为初步判断）';

    const artifactContent = [
      `# ${task.title}`,
      '',
      `> 执行主体：${agent.name} ｜ 任务：${task.code} ｜ TraceID：${traceId}`,
      '',
      '## 执行摘要',
      modelResult.text,
      '',
      '## 已执行技能',
      executedSkills.length > 0 ? executedSkills.map((s) => `- ${s}`).join('\n') : '- 无',
      '',
      '## 引用依据',
      citationLines,
      '',
      '## 需要人工确认的点',
      blockedSkills.length > 0
        ? blockedSkills.map((b) => `- 技能 ${b.skillId} 被沙箱阻断：${b.reason}`).join('\n')
        : '- 无',
    ].join('\n');

    steps.push({
      kind: 'artifact',
      title: '提交交付物',
      detail: `生成交付物（${artifactContent.length} 字符）`,
      durationMs: 30,
      tokenUsed: 0,
      cost: 0,
      payload: { citationCount: citations.length, blockedSkills },
    });

    const totalTokenUsed = skillTokenUsed + modelResult.tokenIn + modelResult.tokenOut;
    const totalCost = Math.round((skillCost + modelResult.cost) * 10000) / 10000;

    return {
      traceId,
      taskId: task.id,
      agentId: agent.id,
      steps,
      artifact: {
        type: task.priority === 'p1' ? ArtifactType.REPORT : ArtifactType.DOC,
        title: `${task.title}（交付物）`,
        content: artifactContent,
        uri: `artifact://${task.code.toLowerCase()}/${traceId}`,
        sizeBytes: Buffer.byteLength(artifactContent, 'utf8'),
      },
      citations,
      tokenUsed: totalTokenUsed,
      cost: totalCost,
      durationMs: Date.now() - startedAt + skillDuration,
    };
  }
}

export const mockExecutor = new MockExecutor();

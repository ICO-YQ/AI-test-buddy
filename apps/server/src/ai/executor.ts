/**
 * AiExecutor —— 「任务认领 → 交付」的执行器契约
 *
 * REPLACE_POINT: 当前实现为 `MockExecutor`（`./mock-executor.ts`），产出脚本化执行轨迹。
 * 未来替换点：接入真实 Agent Runtime（具备真实工具调用、多轮规划、真实沙箱与模型）。
 *
 * 接口签名稳定：`execute(input) → ExecutionTrace`
 */

import type {
  AgentConfig,
  Citation,
  ExecutionStep,
  ExecutionTrace,
  Member,
  PermissionDecl,
  Skill,
  SkillVersion,
  Task,
} from '@huanbuddy/shared';

export type { ExecutionStep, ExecutionTrace };

/** 一次执行中可用的技能（含该版本的权限声明） */
export interface ExecutableSkill {
  skill: Skill;
  version: SkillVersion;
  permissions: PermissionDecl[];
}

/** 执行输入：任务 + 执行主体（AI）+ 发起人 + 可用上下文 */
export interface AgentExecutionInput {
  task: Task;
  /** 执行主体（AI 成员） */
  agent: Member;
  agentConfig?: AgentConfig;
  /** 发起人（双主体留痕） */
  initiatorId?: string | null;
  /** 该 Agent 可读的知识空间（已按 ACL 解析） */
  allowedSpaceIds: string[];
  /** 该 Agent 绑定的技能 */
  skills: ExecutableSkill[];
  /** 检索查询（默认取任务标题 + 描述） */
  query?: string;
  /** 外部指定 traceId（与请求链路对齐） */
  traceId?: string;
}

export interface AiExecutor {
  execute(input: AgentExecutionInput): ExecutionTrace;
}

/** 引用 → 前端展示的 Citation（保留 heading / version / snippet） */
export function toCitation(chunk: {
  docId: string;
  spaceName: string;
  heading?: string;
  version: number;
  content: string;
}): Citation {
  return {
    docId: chunk.docId,
    spaceName: chunk.spaceName,
    heading: chunk.heading,
    version: chunk.version,
    snippet: chunk.content.slice(0, 120),
  };
}

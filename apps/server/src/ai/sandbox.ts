/**
 * 技能沙箱（Sandbox）
 *
 * REPLACE_POINT: 当前为 `MockSandbox` —— 不做真实代码执行，只做**权限声明白名单校验**
 * 与资源限额记账，保证「未声明能力被调用即阻断」的服务端语义可验证。
 * 未来替换点：接入 gVisor / Firecracker 容器，实现真实隔离执行、网络策略与文件系统只读挂载。
 *
 * 接口签名稳定：`run(input) → SandboxResult`（同步签名，替换为容器后可在内部 await）
 */

import {
  ALLOWED_SCRIPT_LANGS,
  ErrCode,
  PERMISSION_CAPABILITY_LABEL,
  SANDBOX_LIMITS,
  SkillExecutionStatus,
  type PermissionCapability,
  type PermissionDecl,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { AppError } from '../core/errors';
import { staticCheck } from './static-check';

export interface SandboxLimits {
  maxCpuMs: number;
  maxMemoryMb: number;
  maxNetworkCalls: number;
  /** 本地落盘上限，必须为 0 */
  maxLocalFiles: number;
  timeoutMs: number;
}

export interface SandboxRunInput {
  script?: string | null;
  scriptLang?: string | null;
  /** 该技能版本声明的权限白名单 */
  permissions: PermissionDecl[];
  /** 运行期实际调用的能力（无工具调用轨迹时由静态检查推导） */
  calledCapabilities?: PermissionCapability[];
  input?: Record<string, unknown>;
  limits?: Partial<SandboxLimits>;
  /** 沙箱是否可用（false 时抛 1019 SANDBOX_UNAVAILABLE） */
  available?: boolean;
}

/** 阻断原因分类（用于审计 detail.reason 与前端提示） */
export type SandboxViolationKind =
  | 'PERMISSION_UNDECLARED'
  | 'FORBIDDEN_API'
  | 'SCRIPT_LANG_NOT_ALLOWED'
  | 'LIMIT_EXCEEDED';

export interface SandboxResult {
  sandboxId: string;
  status: SkillExecutionStatus;
  output: Record<string, unknown> | null;
  blockReason?: string;
  /** 阻断原因分类（仅 blocked 时有值） */
  violationKind?: SandboxViolationKind;
  /** 被阻断时越界的能力 */
  violatedCapability?: PermissionCapability;
  /** 被阻断时命中的禁止 API */
  violatedApi?: string;
  durationMs: number;
  cpuMs: number;
  memoryMb: number;
  networkCalls: number;
  /** 本地落盘文件数（应恒为 0） */
  localFiles: number;
}

export interface Sandbox {
  run(input: SandboxRunInput): SandboxResult;
}

function newSandboxId(): string {
  return `sbx-${nanoid(6)}`;
}

export class MockSandbox implements Sandbox {
  run(input: SandboxRunInput): SandboxResult {
    const limits: SandboxLimits = { ...SANDBOX_LIMITS, ...(input.limits ?? {}) };
    const startedAt = Date.now();

    if (input.available === false) {
      throw new AppError(ErrCode.SANDBOX_UNAVAILABLE, '沙箱资源不足，任务已挂起');
    }

    const sandboxId = newSandboxId();

    // 1) 静态扫描：推导能力 + 检出禁止调用（child_process / eval / subprocess …）
    //    禁止类 API 无法通过任何权限声明合法化，沙箱必须**无条件拦截**（纵深防御：
    //    即使调用方绕过 validate 直接 execute 一个未发布版本，也绝不放行）。
    const scan = staticCheck.scan(input.script, input.scriptLang);
    if (scan.forbidden.length > 0) {
      return {
        sandboxId,
        status: SkillExecutionStatus.BLOCKED,
        output: null,
        blockReason: `脚本包含禁止调用的 API「${scan.forbidden.join(', ')}」，已阻断执行`,
        violationKind: 'FORBIDDEN_API',
        violatedApi: scan.forbidden[0],
        durationMs: Date.now() - startedAt,
        cpuMs: 0,
        memoryMb: 0,
        networkCalls: 0,
        localFiles: 0,
      };
    }

    // 脚本存在但语言未声明/不在白名单 → 无法安全隔离执行，一律拒绝
    if (input.script && input.script.trim().length > 0) {
      const lang = input.scriptLang;
      if (!lang || !(ALLOWED_SCRIPT_LANGS as readonly string[]).includes(lang)) {
        return {
          sandboxId,
          status: SkillExecutionStatus.BLOCKED,
          output: null,
          blockReason: `脚本语言「${lang ?? '未声明'}」不在白名单（允许：${ALLOWED_SCRIPT_LANGS.join('/')}），已阻断执行`,
          violationKind: 'SCRIPT_LANG_NOT_ALLOWED',
          durationMs: Date.now() - startedAt,
          cpuMs: 0,
          memoryMb: 0,
          networkCalls: 0,
          localFiles: 0,
        };
      }
    }

    // 2) 能力来源：显式工具调用轨迹 ∪ 静态检查推导
    const called = Array.from(new Set([...(input.calledCapabilities ?? []), ...scan.capabilities]));

    // 3) 声明白名单
    const granted = new Set(
      input.permissions.filter((p) => p.granted).map((p) => p.capability as PermissionCapability),
    );

    // 4) 越权判定：未声明即阻断（FR-SK 铁律）
    const violated = called.find((cap) => !granted.has(cap));
    if (violated) {
      return {
        sandboxId,
        status: SkillExecutionStatus.BLOCKED,
        output: null,
        blockReason: `越权调用：未声明 ${PERMISSION_CAPABILITY_LABEL[violated]}（${violated}）能力`,
        violationKind: 'PERMISSION_UNDECLARED',
        violatedCapability: violated,
        durationMs: Date.now() - startedAt,
        cpuMs: 0,
        memoryMb: 0,
        networkCalls: 0,
        localFiles: 0,
      };
    }

    // 4) 限额记账（Mock：不真实执行，仅模拟资源消耗与限额校验）
    const networkCalls = granted.has('net') ? Math.min(called.length, limits.maxNetworkCalls) : 0;
    const cpuMs = Math.min(120 + called.length * 40, limits.maxCpuMs);
    const memoryMb = Math.min(64 + called.length * 8, limits.maxMemoryMb);

    if (networkCalls > limits.maxNetworkCalls) {
      return {
        sandboxId,
        status: SkillExecutionStatus.BLOCKED,
        output: null,
        blockReason: `出网调用次数超限（${networkCalls} > ${limits.maxNetworkCalls}）`,
        violationKind: 'LIMIT_EXCEEDED',
        durationMs: Date.now() - startedAt,
        cpuMs,
        memoryMb,
        networkCalls,
        localFiles: 0,
      };
    }

    // 5) 本地落盘必须为 0：即便声明了 fs_write，容器内也只挂载 tmpfs，
    //    宿主机落盘数（local_files）恒为 0，用于演示「免下载 ≠ 免执行」。
    const localFiles = 0;
    if (localFiles > limits.maxLocalFiles) {
      return {
        sandboxId,
        status: SkillExecutionStatus.BLOCKED,
        output: null,
        blockReason: `本地落盘文件数超限（${localFiles} > ${limits.maxLocalFiles}）`,
        violationKind: 'LIMIT_EXCEEDED',
        durationMs: Date.now() - startedAt,
        cpuMs,
        memoryMb,
        networkCalls,
        localFiles,
      };
    }

    const inputKeys = Object.keys(input.input ?? {});
    return {
      sandboxId,
      status: SkillExecutionStatus.SUCCESS,
      output: {
        ok: true,
        sandboxId,
        declaredCapabilities: Array.from(granted).sort(),
        calledCapabilities: called.sort(),
        inputKeys,
        // Mock 输出占位：真实沙箱返回脚本真实返回值
        result: { executed: true, echo: input.input ?? {} },
      },
      durationMs: Date.now() - startedAt,
      cpuMs,
      memoryMb,
      networkCalls,
      localFiles,
    };
  }
}

export const mockSandbox = new MockSandbox();

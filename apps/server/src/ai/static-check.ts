/**
 * 技能静态检查（危险 API 扫描 + 能力推导）
 *
 * REPLACE_POINT: 当前实现为**行级关键字符扫描**（正则），足够演示「发布前拦截」语义。
 * 未来替换点：接入 AST 解析（tree-sitter / Python ast）+ 数据流污点分析，
 * 实现精确的「权限声明 vs 实际调用」一致性判定。
 *
 * 接口签名稳定：`scan(script, lang) → CheckResult`
 */

import {
  ALLOWED_SCRIPT_LANGS,
  DANGEROUS_APIS,
  type PermissionCapability,
} from '@huanbuddy/shared';

export interface CheckIssue {
  line: number;
  msg: string;
}

export interface CheckResult {
  pass: boolean;
  issues: CheckIssue[];
  /** 从脚本中推导出的、需要声明的能力集合 */
  capabilities: PermissionCapability[];
  /** 命中的禁止调用（无对应能力，直接不通过） */
  forbidden: string[];
}

export class StaticCheck {
  /**
   * 扫描脚本。
   *
   * 语义（与 `SkillService.validate` 配合）：
   *  - `forbidden`（`capability === null` 的规则，如 child_process / eval / os.system）：
   *    无对应权限可声明，**直接判定不通过** → 计入 `issues`；
   *  - `capabilities`（归属某个可声明能力的规则，如 open()→fs_read、requests.→net）：
   *    仅**推导出需要声明的能力**，不直接判定不通过 —— 是否通过由
   *    「推导能力 ⊆ 已声明能力」的比对决定（未声明即阻断）。
   *
   * 因此 `pass` 仅代表「无禁止调用 + 语言在白名单内」；
   * 权限声明一致性由上层 `validate()` 负责。
   *
   * @param script 技能脚本内容（可为空 —— 纯提示词技能）
   * @param lang 脚本语言，须为白名单内（python/nodejs）
   */
  scan(script?: string | null, lang?: string | null): CheckResult {
    const issues: CheckIssue[] = [];
    const capabilities = new Set<PermissionCapability>();
    const forbidden = new Set<string>();

    if (!script || script.trim().length === 0) {
      return { pass: true, issues, capabilities: [], forbidden: [] };
    }

    if (lang && !(ALLOWED_SCRIPT_LANGS as readonly string[]).includes(lang)) {
      issues.push({ line: 0, msg: `脚本语言「${lang}」不在白名单（允许：${ALLOWED_SCRIPT_LANGS.join('/')}）` });
    }

    const lines = script.split('\n');
    lines.forEach((rawLine, index) => {
      const line = index + 1;
      // 去掉行尾注释，降低误报（不支持字符串内 `#` 的精确处理，AST 版可解决）
      const code = rawLine.replace(/#.*$/, '').replace(/\/\/.*$/, '');
      for (const rule of DANGEROUS_APIS) {
        if (!code.includes(rule.pattern)) continue;
        if (rule.capability) {
          capabilities.add(rule.capability);
        } else {
          issues.push({ line, msg: rule.msg });
          forbidden.add(rule.pattern);
        }
      }
    });

    return {
      pass: issues.length === 0,
      issues,
      capabilities: Array.from(capabilities),
      forbidden: Array.from(forbidden),
    };
  }

  /** 仅推导需要声明的能力（用于沙箱越权判定） */
  capabilitiesOf(script?: string | null): PermissionCapability[] {
    return this.scan(script).capabilities;
  }

  /** 仅判断是否通过 */
  isPass(script?: string | null): boolean {
    return this.scan(script).pass;
  }
}

export const staticCheck = new StaticCheck();

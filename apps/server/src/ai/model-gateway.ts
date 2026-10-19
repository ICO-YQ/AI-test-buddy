/**
 * 模型网关（ModelGateway）
 *
 * REPLACE_POINT: 当前为 `MockModelGateway` —— 按场景路由返回**预置文本与假 Token/成本**，
 * 完整实现「主力 → 备用 → 全部不可用抛 1020」的降级链路。
 * 未来替换点：接入真实厂商 API（Anthropic / DeepSeek / 自托管 vLLM），
 * 只需实现 `ModelGateway` 接口并保持 `ModelCatalog` 注入不变。
 *
 * 接口签名稳定：`complete(input) → ModelCallResult`
 */

import {
  ErrCode,
  SCENE_LABEL,
  Scene,
  type ModelConfig,
  type SceneRoute,
} from '@huanbuddy/shared';

import { getDb, type Db } from '../db/client';
import { AppError } from '../core/errors';

/* ═══════════════ 契约 ═══════════════ */

export interface ModelCallInput {
  prompt: string;
  /** 场景路由键，默认 daily（日常执行） */
  scene?: Scene;
  /** 检索到的上下文（RAG） */
  context?: string;
  agentId?: string;
  /** 指定优先模型（会话/成员配置） */
  preferredModelId?: string;
  maxTokens?: number;
}

export interface ModelCallResult {
  text: string;
  modelId: string;
  modelName: string;
  scene: Scene;
  tokenIn: number;
  tokenOut: number;
  /** 人民币元 */
  cost: number;
  durationMs: number;
  /** 若发生降级，记录原始模型 */
  degradedFrom?: string;
  fallbackUsed: boolean;
}

/** 模型目录（路由 + 可用模型），供网关做可用性判定 */
export interface ModelCatalog {
  routes(): SceneRoute[];
  models(): ModelConfig[];
  routeOf(scene: Scene): SceneRoute | undefined;
  modelOf(modelId: string): ModelConfig | undefined;
}

/** 基于 SQLite 的目录实现 */
export class DbModelCatalog implements ModelCatalog {
  private readonly db: Db;

  constructor(db: Db = getDb()) {
    this.db = db;
  }

  private static toModel(row: Record<string, unknown>): ModelConfig {
    return {
      id: String(row.id),
      name: String(row.name),
      vendor: String(row.vendor),
      contextWindow: Number(row.context_window),
      purpose: row.purpose === null || row.purpose === undefined ? undefined : String(row.purpose),
      priority: String(row.priority) as ModelConfig['priority'],
      health: String(row.health) as ModelConfig['health'],
      baseUrl: row.base_url ? String(row.base_url) : undefined,
      apiKeyRef: row.api_key_ref ? String(row.api_key_ref) : undefined,
      inputPrice: Number(row.input_price),
      outputPrice: Number(row.output_price),
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
    };
  }

  private static toRoute(row: Record<string, unknown>): SceneRoute {
    return {
      id: String(row.id),
      scene: String(row.scene) as SceneRoute['scene'],
      label: String(row.label),
      primaryModelId: String(row.primary_model_id),
      fallbackModelId: row.fallback_model_id ? String(row.fallback_model_id) : undefined,
    };
  }

  routes(): SceneRoute[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM scene_route ORDER BY scene ASC')
      .map((r) => DbModelCatalog.toRoute(r));
  }

  models(): ModelConfig[] {
    return this.db
      .all<Record<string, unknown>>('SELECT * FROM model_config ORDER BY name ASC')
      .map((r) => DbModelCatalog.toModel(r));
  }

  routeOf(scene: Scene): SceneRoute | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM scene_route WHERE scene = ?', [scene]);
    return row ? DbModelCatalog.toRoute(row) : undefined;
  }

  modelOf(modelId: string): ModelConfig | undefined {
    const row = this.db.get<Record<string, unknown>>('SELECT * FROM model_config WHERE id = ?', [modelId]);
    return row ? DbModelCatalog.toModel(row) : undefined;
  }
}

export interface ModelGateway {
  complete(input: ModelCallInput): ModelCallResult;
}

/* ═══════════════ Mock 实现 ═══════════════ */

/** 各场景预置返回文本 */
const PRESET_TEXT: Record<Scene, string> = {
  reasoning:
    '【分析结论】\n1. 主要归因：落地页改版（v2.4）导致转化漏斗第二步流失率上升 23.1%；\n2. 次要归因：渠道人群包重叠度 41%，存在预算内耗；\n3. 建议：回滚落地页并做 A/B 对照，同时收敛重叠人群包。\n\n依据：渠道消耗/转化明细、落地页版本变更记录。',
  daily:
    '已完成该步骤。输出的候选结果已按渠道规格与合规要求整理，可直接进入人工复核环节。',
  batch:
    '批处理完成：共处理 128 条记录，成功 126 条，失败 2 条（数据缺失），失败明细已记录。',
  sensitive:
    '【脱敏模式】已在本地推理环境中处理涉敏感数据，未向外部服务发送原始字段；输出仅保留聚合结论。',
};

const PRESET_OUTPUT_TOKENS: Record<Scene, number> = {
  reasoning: 1420,
  daily: 640,
  batch: 320,
  sensitive: 480,
};

/** 粗略 Token 估算：中文约 1 token/字，英文约 1 token/4 字符 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.max(1, Math.round(cjk + rest / 4));
}

export class MockModelGateway implements ModelGateway {
  private readonly catalog: ModelCatalog;

  constructor(catalog: ModelCatalog = new DbModelCatalog()) {
    this.catalog = catalog;
  }

  /** 候选链：优先模型 → 场景主力 → 场景备用 → 任一可用模型 */
  private candidates(scene: Scene, preferredModelId?: string): string[] {
    const route = this.catalog.routeOf(scene);
    const chain: (string | undefined)[] = [
      preferredModelId,
      route?.primaryModelId,
      route?.fallbackModelId,
      ...this.catalog.models().map((m) => m.id),
    ];
    return Array.from(new Set(chain.filter((id): id is string => Boolean(id))));
  }

  private usable(modelId: string): ModelConfig | undefined {
    const model = this.catalog.modelOf(modelId);
    if (!model) return undefined;
    if (!model.enabled) return undefined;
    if (model.health === 'unavailable') return undefined;
    return model;
  }

  complete(input: ModelCallInput): ModelCallResult {
    const scene: Scene = input.scene ?? Scene.DAILY;
    const chain = this.candidates(scene, input.preferredModelId);

    let selected: ModelConfig | undefined;
    let degradedFrom: string | undefined;

    for (const id of chain) {
      const model = this.usable(id);
      if (!model) {
        if (!degradedFrom && id === chain[0]) degradedFrom = id;
        continue;
      }
      if (!selected) {
        selected = model;
        if (id !== chain[0]) degradedFrom = chain[0];
      }
    }

    if (!selected) {
      throw new AppError(
        ErrCode.MODEL_UNAVAILABLE,
        `场景「${SCENE_LABEL[scene]}」的模型全部不可用，任务已挂起`,
        { scene, tried: chain },
      );
    }

    const fullPrompt = `${input.prompt}\n${input.context ?? ''}`;
    const tokenIn = estimateTokens(fullPrompt);
    const tokenOut = Math.min(PRESET_OUTPUT_TOKENS[scene], input.maxTokens ?? Number.MAX_SAFE_INTEGER);

    const cost =
      (tokenIn / 1000) * selected.inputPrice + (tokenOut / 1000) * selected.outputPrice;

    return {
      text: PRESET_TEXT[scene],
      modelId: selected.id,
      modelName: selected.name,
      scene,
      tokenIn,
      tokenOut,
      cost: Math.round(cost * 10000) / 10000,
      durationMs: 320 + Math.round(tokenOut / 8),
      degradedFrom: degradedFrom && degradedFrom !== selected.id ? degradedFrom : undefined,
      fallbackUsed: Boolean(degradedFrom && degradedFrom !== selected.id),
    };
  }
}

export const mockModelGateway = new MockModelGateway();

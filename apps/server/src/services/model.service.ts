/**
 * ModelService —— 模型配置 / 场景路由 / 降级记录（FR-GOV-06~09）
 */

import {
  ErrCode,
  Scene,
  type CreateModelReq,
  type ModelConfig,
  type ModelDegradationLog,
  type SceneRoute,
  type UpdateModelReq,
} from '@huanbuddy/shared';
import { nanoid } from 'nanoid';

import { AuditService } from '../core/audit';
import { AppError } from '../core/errors';
import { metrics } from '../core/metrics';
import { MetricEvent, SYSTEM_ACTOR_ID } from '@huanbuddy/shared';
import { getDb, isoNow, toBool, type Db } from '../db/client';

const DEFAULT_WORKSPACE = 'ws-huan-0001';

interface ModelRow {
  id: string;
  name: string;
  vendor: string;
  context_window: number;
  purpose: string | null;
  priority: string;
  health: string;
  base_url: string | null;
  api_key_ref: string | null;
  input_price: number;
  output_price: number;
  enabled: number;
  created_at: string;
}

interface RouteRow {
  id: string;
  scene: string;
  label: string;
  primary_model_id: string;
  fallback_model_id: string | null;
}

interface DegradationRow {
  id: string;
  occurred_at: string;
  event: string;
  action: string;
  from_model_id: string | null;
  to_model_id: string | null;
  trace_id: string | null;
}

export class ModelService {
  private readonly db: Db;
  private readonly audit: AuditService;

  constructor(db: Db = getDb()) {
    this.db = db;
    this.audit = new AuditService(db);
  }

  private toModel(row: ModelRow): ModelConfig {
    return {
      id: row.id,
      name: row.name,
      vendor: row.vendor,
      contextWindow: Number(row.context_window),
      purpose: row.purpose ?? undefined,
      priority: row.priority as ModelConfig['priority'],
      health: row.health as ModelConfig['health'],
      baseUrl: row.base_url ?? undefined,
      apiKeyRef: row.api_key_ref ?? undefined,
      inputPrice: Number(row.input_price),
      outputPrice: Number(row.output_price),
      enabled: toBool(row.enabled),
      createdAt: row.created_at,
    };
  }

  private toRoute(row: RouteRow): SceneRoute {
    return {
      id: row.id,
      scene: row.scene as Scene,
      label: row.label,
      primaryModelId: row.primary_model_id,
      fallbackModelId: row.fallback_model_id ?? undefined,
    };
  }

  private toDegradation(row: DegradationRow): ModelDegradationLog {
    return {
      id: row.id,
      occurredAt: row.occurred_at,
      event: row.event,
      action: row.action,
      fromModelId: row.from_model_id ?? undefined,
      toModelId: row.to_model_id ?? undefined,
      traceId: row.trace_id ?? undefined,
    };
  }

  private modelOrThrow(id: string): ModelRow {
    const row = this.db.get<ModelRow>('SELECT * FROM model_config WHERE id = ?', [id]);
    if (!row) throw new AppError(ErrCode.NOT_FOUND, `模型不存在：${id}`);
    return row;
  }

  /* ═══════ 模型 ═══════ */

  listModels(): ModelConfig[] {
    return this.db
      .all<ModelRow>('SELECT * FROM model_config ORDER BY enabled DESC, name ASC')
      .map((row) => this.toModel(row));
  }

  createModel(req: CreateModelReq): ModelConfig {
    if (!req.name || !req.vendor) {
      throw new AppError(ErrCode.BAD_REQUEST, '模型 name 与 vendor 为必填');
    }
    const dup = this.db.get<{ id: string }>('SELECT id FROM model_config WHERE name = ? AND vendor = ?', [
      req.name,
      req.vendor,
    ]);
    if (dup) throw new AppError(ErrCode.CONFLICT, `模型已存在：${req.vendor} / ${req.name}`);

    const id = `mdl-${nanoid(10)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO model_config (
           id, name, vendor, context_window, purpose, priority, health, base_url, api_key_ref,
           input_price, output_price, enabled, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          req.name,
          req.vendor,
          req.contextWindow,
          req.purpose ?? null,
          req.priority ?? 'p2',
          req.health ?? 'healthy',
          req.baseUrl ?? null,
          req.apiKeyRef ?? null,
          req.inputPrice ?? 0,
          req.outputPrice ?? 0,
          req.enabled === false ? 0 : 1,
          now,
        ],
      );
      this.audit.write({
        action: 'model_created',
        resourceType: 'model',
        resourceId: id,
        resourceName: `${req.vendor} ${req.name}`,
        detail: { priority: req.priority ?? 'p2', contextWindow: req.contextWindow },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toModel(this.modelOrThrow(id));
  }

  updateModel(id: string, req: UpdateModelReq): ModelConfig {
    const row = this.modelOrThrow(id);
    const fields: string[] = [];
    const params: unknown[] = [];

    if (req.name !== undefined) {
      fields.push('name = ?');
      params.push(req.name);
    }
    if (req.vendor !== undefined) {
      fields.push('vendor = ?');
      params.push(req.vendor);
    }
    if (req.contextWindow !== undefined) {
      fields.push('context_window = ?');
      params.push(req.contextWindow);
    }
    if (req.purpose !== undefined) {
      fields.push('purpose = ?');
      params.push(req.purpose);
    }
    if (req.priority !== undefined) {
      fields.push('priority = ?');
      params.push(req.priority);
    }
    if (req.health !== undefined) {
      fields.push('health = ?');
      params.push(req.health);
    }
    if (req.baseUrl !== undefined) {
      fields.push('base_url = ?');
      params.push(req.baseUrl);
    }
    if (req.apiKeyRef !== undefined) {
      fields.push('api_key_ref = ?');
      params.push(req.apiKeyRef);
    }
    if (req.inputPrice !== undefined) {
      fields.push('input_price = ?');
      params.push(req.inputPrice);
    }
    if (req.outputPrice !== undefined) {
      fields.push('output_price = ?');
      params.push(req.outputPrice);
    }
    if (req.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(req.enabled ? 1 : 0);
    }

    if (fields.length === 0) return this.toModel(row);

    this.db.tx(() => {
      this.db.run(`UPDATE model_config SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
      this.audit.write({
        action: 'model_updated',
        resourceType: 'model',
        resourceId: id,
        resourceName: `${row.vendor} ${row.name}`,
        detail: req as unknown as Record<string, unknown>,
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.toModel(this.modelOrThrow(id));
  }

  /* ═══════ 场景路由 ═══════ */

  routes(): SceneRoute[] {
    const order = ['reasoning', 'daily', 'batch', 'sensitive'];
    return this.db
      .all<RouteRow>('SELECT * FROM scene_route')
      .map((row) => this.toRoute(row))
      .sort((a, b) => order.indexOf(a.scene) - order.indexOf(b.scene));
  }

  /** 全量替换场景路由（引用不存在的模型 → 400） */
  setRoutes(routes: SceneRoute[]): SceneRoute[] {
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new AppError(ErrCode.BAD_REQUEST, 'routes 不能为空');
    }

    for (const route of routes) {
      if (!route.scene) throw new AppError(ErrCode.BAD_REQUEST, '路由缺少 scene');
      this.modelOrThrow(route.primaryModelId);
      if (route.fallbackModelId) this.modelOrThrow(route.fallbackModelId);
    }

    this.db.tx(() => {
      for (const route of routes) {
        const existing = this.db.get<{ id: string }>('SELECT id FROM scene_route WHERE scene = ?', [
          route.scene,
        ]);
        if (existing) {
          this.db.run('UPDATE scene_route SET label = ?, primary_model_id = ?, fallback_model_id = ? WHERE id = ?', [
            route.label,
            route.primaryModelId,
            route.fallbackModelId ?? null,
            existing.id,
          ]);
        } else {
          this.db.run(
            'INSERT INTO scene_route (id, scene, label, primary_model_id, fallback_model_id) VALUES (?, ?, ?, ?, ?)',
            [`sr-${nanoid(8)}`, route.scene, route.label, route.primaryModelId, route.fallbackModelId ?? null],
          );
        }
      }

      this.audit.write({
        action: 'scene_routes_updated',
        resourceType: 'model',
        resourceId: 'scene_route',
        resourceName: '场景路由',
        detail: { count: routes.length },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    return this.routes();
  }

  /* ═══════ 降级记录 ═══════ */

  degradations(limit = 50): ModelDegradationLog[] {
    return this.db
      .all<DegradationRow>(
        'SELECT * FROM model_degradation_log ORDER BY occurred_at DESC LIMIT ?',
        [limit],
      )
      .map((row) => this.toDegradation(row));
  }

  /** 记录一次降级（供网关/巡检使用） */
  recordDegradation(input: {
    event: string;
    action: string;
    fromModelId?: string;
    toModelId?: string;
    traceId?: string;
  }): ModelDegradationLog {
    const id = `mdg-${nanoid(8)}`;
    const now = isoNow();

    this.db.tx(() => {
      this.db.run(
        `INSERT INTO model_degradation_log (id, occurred_at, event, action, from_model_id, to_model_id, trace_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          now,
          input.event,
          input.action,
          input.fromModelId ?? null,
          input.toModelId ?? null,
          input.traceId ?? null,
        ],
      );
      this.audit.write({
        action: 'model_degraded',
        // 系统自动动作：模型降级由网关自动触发，无人类发起人。
        // 必须显式写 SYSTEM_ACTOR_ID —— `null` 只表示「数据缺失」，
        // 用它表示「无发起人」会让界面无法区分正常业务状态与数据丢失。
        actorId: SYSTEM_ACTOR_ID,
        actorType: null,
        initiatorId: null,
        resourceType: 'model',
        resourceId: input.fromModelId ?? null,
        resourceName: input.event,
        detail: { action: input.action, toModelId: input.toModelId ?? null },
        workspaceId: DEFAULT_WORKSPACE,
      });
    });

    metrics.emit(MetricEvent.MODEL_DEGRADED, { ...input });

    const row = this.db.get<DegradationRow>('SELECT * FROM model_degradation_log WHERE id = ?', [id]);
    return this.toDegradation(row as DegradationRow);
  }

  /** 本月用量汇总（模型页展示） */
  monthlyUsage(): { modelId: string; name: string; tokens: number; cost: number }[] {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT m.id AS model_id, m.name AS name,
              COALESCE(SUM(u.token_in + u.token_out), 0) AS tokens,
              COALESCE(SUM(u.cost), 0) AS cost
       FROM model_config m
       LEFT JOIN usage_record u ON u.model_id = m.id AND u.occurred_at >= ?
       GROUP BY m.id, m.name
       ORDER BY cost DESC`,
      [monthStart.toISOString().replace(/\.\d{3}Z$/, 'Z')],
    );
    return rows.map((row) => ({
      modelId: String(row.model_id),
      name: String(row.name),
      tokens: Number(row.tokens),
      cost: Math.round(Number(row.cost) * 10000) / 10000,
    }));
  }

  /** 模型可用性概览（供前端挑选器置灰不可用项） */
  availability(): { modelId: string; available: boolean; reason?: string }[] {
    return this.db.all<ModelRow>('SELECT * FROM model_config').map((row) => {
      if (!toBool(row.enabled)) {
        return { modelId: row.id, available: false, reason: '已停用' };
      }
      if (row.health === 'unavailable') {
        return { modelId: row.id, available: false, reason: '服务不可用' };
      }
      if (row.health === 'overloaded') {
        return { modelId: row.id, available: true, reason: '负载高' };
      }
      return { modelId: row.id, available: true };
    });
  }

  /** 解析某场景的候选链（供 UI 展示降级顺序） */
  resolveChain(scene: Scene): string[] {
    const route = this.db.get<RouteRow>('SELECT * FROM scene_route WHERE scene = ?', [scene]);
    const chain = [route?.primary_model_id ?? undefined, route?.fallback_model_id ?? undefined].filter(
      (id): id is string => Boolean(id),
    );
    return chain;
  }

  /** 便捷：模型 id → 名称 */
  nameOf(modelId: string): string {
    return this.modelOrThrow(modelId).name;
  }

  /** 引用关系（用于模型下线影响面提示） */
  referencedBy(modelId: string): { agents: string[]; sessions: number } {
    const agents = this.db.all<{ name: string }>(
      `SELECT m.name AS name FROM agent_config ac JOIN member m ON m.id = ac.member_id
       WHERE ac.primary_model_id = ? OR ac.fallback_model_ids LIKE ?`,
      [modelId, `%${modelId}%`],
    );
    const sessions = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM session WHERE model_id = ?', [
      modelId,
    ]);
    return {
      agents: agents.map((a) => a.name),
      sessions: sessions ? Number(sessions.c) : 0,
    };
  }
}

export const modelService = new ModelService();

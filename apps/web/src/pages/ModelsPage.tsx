import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { StatusDot } from '@/components/StatusDot';
import { Modal } from '@/components/Modal';
import { errorText } from '@/api/client';
import { govApi } from '@/api/gov.api';
import { useDegradations, useModels, useSceneRoutes, useUsageSummary } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { dateTime, money, tokens } from '@/lib/format';
import { modelHealthColor, modelHealthLabel, modelPriorityLabel } from '@/lib/labels';
import type { ModelConfig, ModelDegradationLog, SceneRoute, UsageSummary } from '@/lib/shared';

/** 用量「按模型」行类型 */
type ModelUsageRow = UsageSummary['byModel'][number];

function AddModelModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState('');
  const [vendor, setVendor] = useState('Anthropic');
  const [ctx, setCtx] = useState(200000);
  const [purpose, setPurpose] = useState('复杂推理');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      notify('请填写模型名称', 'err');
      return;
    }
    setBusy(true);
    try {
      await govApi.createModel({ name: name.trim(), vendor, contextWindow: ctx, purpose, enabled: true, health: 'healthy', priority: 'p2' });
      qc.invalidateQueries({ queryKey: ['models'] });
      notify(`已接入模型「${name.trim()}」`, 'ok');
      onClose();
    } catch (e) {
      notify(`接入失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="接入模型"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" disabled={busy} onClick={submit}>
            接入
          </button>
        </>
      }
    >
      <div className="fld">
        <label>模型名称</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Claude Opus 4.5" />
      </div>
      <div className="fld">
        <label>厂商</label>
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
      </div>
      <div className="fld">
        <label>上下文窗口</label>
        <input type="number" value={ctx} onChange={(e) => setCtx(Number(e.target.value))} />
      </div>
      <div className="fld">
        <label>用途</label>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
      </div>
      <div className="note">密钥仅以引用保存，不落明文；接入后可在场景路由中指定主力 / 备用。</div>
    </Modal>
  );
}

export function ModelsPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const modelsQuery = useModels();
  const routesQuery = useSceneRoutes();
  const degQuery = useDegradations();
  const usageQuery = useUsageSummary();

  const models = modelsQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  const [routeDraft, setRouteDraft] = useState<SceneRoute[] | null>(null);
  const effectiveRoutes = routeDraft ?? routes;

  const modelName = (id?: string) => models.find((m) => m.id === id)?.name ?? id ?? '—';

  const saveRoutes = async () => {
    if (!routeDraft) {
      notify('没有需要保存的改动', 'warn');
      return;
    }
    try {
      await govApi.saveRoutes(routeDraft);
      qc.invalidateQueries({ queryKey: ['scene-routes'] });
      notify('场景路由已保存', 'ok');
      setRouteDraft(null);
    } catch (e) {
      notify(`保存失败：${errorText(e)}`, 'err');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          设置 / <b>模型</b>
        </div>
        <div className="tr">
          <button
            className="tb"
            title="重新拉取模型健康状态 / 路由 / 降级记录"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['models'] });
              qc.invalidateQueries({ queryKey: ['scene-routes'] });
              qc.invalidateQueries({ queryKey: ['degradations'] });
              notify('已刷新模型状态', 'ok');
            }}
          >
            刷新
          </button>
          <button className="tb pri" onClick={() => openOverlay('add-model')}>
            接入模型
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">模型</div>
        <div className="ps">多厂商接入 · 场景路由 · 故障降级 · 用量留痕</div>
        <div className="note">
          <b>可用性：</b>主力模型故障自动降级，不中断任务；全部不可用时任务挂起并通知，不静默失败。
        </div>

        <div className="card">
          <div className="ch">
            <h3>已接入</h3>
            <button className="tb" onClick={() => openOverlay('add-model')}>
              接入模型
            </button>
          </div>
          <DataTable
            columns={[
              { key: 'name', title: '模型', render: (m: ModelConfig) => m.name },
              { key: 'vendor', title: '厂商', render: (m: ModelConfig) => m.vendor },
              { key: 'contextWindow', title: '上下文', render: (m: ModelConfig) => `${Math.round(m.contextWindow / 1000)}K` },
              {
                key: 'health',
                title: '健康',
                render: (m: ModelConfig) => (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot color={modelHealthColor[m.health]} />
                    <span style={{ color: modelHealthColor[m.health] }}>{modelHealthLabel[m.health]}</span>
                  </span>
                ),
              },
              { key: 'purpose', title: '用途', render: (m: ModelConfig) => m.purpose ?? '—' },
              { key: 'priority', title: '优先级', render: (m: ModelConfig) => modelPriorityLabel[m.priority] ?? m.priority },
              {
                key: 'act',
                title: '',
                render: (m: ModelConfig) => (
                  <button
                    className="tb sm"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await govApi.updateModel(m.id, { enabled: !m.enabled, priority: m.enabled ? 'disabled' : 'p2' });
                        qc.invalidateQueries({ queryKey: ['models'] });
                        notify(m.enabled ? `已停用 ${m.name}` : `已启用 ${m.name}`, 'warn');
                      } catch (err) {
                        notify(`操作失败：${errorText(err)}`, 'err');
                      }
                    }}
                  >
                    {m.enabled ? '停用' : '启用'}
                  </button>
                ),
              },
            ]}
            rows={models}
            rowKey={(m) => m.id}
            loading={modelsQuery.isLoading}
            error={modelsQuery.isError ? errorText(modelsQuery.error) : null}
            empty="尚未接入任何模型"
          />
        </div>

        <div className="row">
          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>场景路由</h3>
                <button className="tb sm" onClick={saveRoutes}>
                  保存
                </button>
              </div>
              {routesQuery.isLoading && <div className="empty"><span className="spin" /> 加载中…</div>}
              {routesQuery.isError && <div className="empty">⚠ {errorText(routesQuery.error)}</div>}
              {!routesQuery.isLoading && !routesQuery.isError && effectiveRoutes.length === 0 && (
                <div className="empty">暂无场景路由配置</div>
              )}
              {effectiveRoutes.map((r, idx) => (
                <div className="fr" key={r.id}>
                  <label className="lbl">{r.label}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      value={r.primaryModelId}
                      onChange={(e) =>
                        setRouteDraft(
                          effectiveRoutes.map((x, i) => (i === idx ? { ...x, primaryModelId: e.target.value } : x)),
                        )
                      }
                      style={{ flex: 1, height: 30, border: '1px solid var(--line-2)', borderRadius: 'var(--r)', fontSize: 12.5, background: 'var(--panel)' }}
                    >
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <span style={{ lineHeight: '30px', color: 'var(--tx-3)' }}>→</span>
                    <select
                      value={r.fallbackModelId ?? ''}
                      onChange={(e) =>
                        setRouteDraft(
                          effectiveRoutes.map((x, i) => (i === idx ? { ...x, fallbackModelId: e.target.value || undefined } : x)),
                        )
                      }
                      style={{ flex: 1, height: 30, border: '1px solid var(--line-2)', borderRadius: 'var(--r)', fontSize: 12.5, background: 'var(--panel)' }}
                    >
                      <option value="">无备用</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>降级记录</h3>
              </div>
              <DataTable
                columns={[
                  { key: 'occurredAt', title: '时间', render: (d: ModelDegradationLog) => dateTime(d.occurredAt) },
                  { key: 'event', title: '事件', render: (d: ModelDegradationLog) => d.event },
                  {
                    key: 'action',
                    title: '处理',
                    render: (d: ModelDegradationLog) =>
                      `${d.action}${d.toModelId ? `（${modelName(d.toModelId)}）` : ''}`,
                  },
                ]}
                rows={degQuery.data ?? []}
                rowKey={(d) => d.id}
                loading={degQuery.isLoading}
                error={degQuery.isError ? errorText(degQuery.error) : null}
                empty="暂无降级记录"
              />
            </div>

            <div className="card">
              <div className="ch">
                <h3>本月用量</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>合计 {money(usageQuery.data?.totalCost ?? 0)}</span>
              </div>
              <DataTable
                columns={[
                  { key: 'name', title: '模型', render: (r: ModelUsageRow) => r.name },
                  { key: 'tokens', title: 'Token', render: (r: ModelUsageRow) => tokens(r.tokens) },
                  { key: 'cost', title: '成本', render: (r: ModelUsageRow) => money(r.cost) },
                ]}
                rows={usageQuery.data?.byModel ?? []}
                rowKey={(r) => r.modelId}
                loading={usageQuery.isLoading}
                error={usageQuery.isError ? errorText(usageQuery.error) : null}
                empty="暂无用量数据"
              />
            </div>
          </div>
        </div>
      </div>

      {overlay?.name === 'add-model' && <AddModelModal onClose={closeOverlay} />}
    </>
  );
}

export default ModelsPage;

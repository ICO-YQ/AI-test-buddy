import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { errorText, getActorId } from '@/api/client';
import { govApi } from '@/api/gov.api';
import { useApiKeys, useUsageSummary } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { dateTime, money, num, tokens } from '@/lib/format';
import { DEMO_WORKSPACE, type ApiKey, type UsageSummary } from '@/lib/shared';

/** 用量「按调用方」行类型 */
type CallerRow = UsageSummary['byCaller'][number];

const ABILITIES = [
  { ep: 'POST /v1/workflows/{id}/run', desc: '触发流程', note: '同步 / 异步' },
  { ep: 'POST /v1/agents/{id}/invoke', desc: '调用成员', note: '支持流式' },
  { ep: 'POST /v1/skills/{id}/execute', desc: '调用技能', note: '沙箱内执行' },
  { ep: 'POST /v1/knowledge/query', desc: '知识问答', note: '返回来源' },
];

const SAFETY = [
  '写操作必带幂等键',
  '写操作需签名 + 时间戳（5 分钟窗口）',
  '三级限流：Key / 租户 / 模型',
  '出网域名白名单',
];

const SCOPE_OPTIONS = ['workflow:run', 'agent:invoke', 'skill:execute', 'kb:query'];

function CreateKeyModal({ onClose, onCreated }: { onClose: () => void; onCreated: (plaintext: string) => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['kb:query']);
  const [limit, setLimit] = useState(60);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      notify('请填写名称', 'err');
      return;
    }
    if (scopes.length === 0) {
      notify('请至少选择一个作用域', 'err');
      return;
    }
    setBusy(true);
    try {
      const r = await govApi.createKey({
        workspaceId: DEMO_WORKSPACE.id,
        ownerId: getActorId(),
        name: name.trim(),
        scopes,
        rateLimitPerMin: limit,
      });
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      notify('已创建 API Key', 'ok');
      onCreated(r.plaintext);
    } catch (e) {
      notify(`创建失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="创建 API Key"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" disabled={busy} onClick={submit}>
            创建
          </button>
        </>
      }
    >
      <div className="fld">
        <label>名称</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：ci-pipeline" />
      </div>
      <div className="fld">
        <label>作用域</label>
        <div className="chips">
          {SCOPE_OPTIONS.map((s) => (
            <span
              key={s}
              className={`chip${scopes.includes(s) ? ' on' : ''}`}
              onClick={() => setScopes((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="fld">
        <label>限流（次 / 分钟）</label>
        <input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
      </div>
      <div className="note">密钥明文仅创建时显示一次，平台仅存哈希。</div>
    </Modal>
  );
}

export function ApiPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);

  const keysQuery = useApiKeys();
  const usageQuery = useUsageSummary();
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const revoke = async (k: ApiKey) => {
    try {
      await govApi.revokeKey(k.id);
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      notify(`已吊销「${k.name}」`, 'warn');
    } catch (e) {
      notify(`吊销失败：${errorText(e)}`, 'err');
    }
  };

  const diff = usageQuery.data?.reconcileDiffPct ?? 0;

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          设置 / <b>API 与配额</b>
        </div>
        <div className="tr">
          <button className="tb" disabled title="OpenAPI 文档本期未实现（下方「可调用能力」已列出端点）">
            OpenAPI
          </button>
          <button className="tb pri" onClick={() => openOverlay('create-key')}>
            创建 Key
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">API 与配额</div>
        <div className="ps">开放能力 · 幂等 · 限流 · 用量归因</div>
        <div className="note">
          <b>计量要求：</b>写操作必须幂等，每日与模型厂商对账，用量超预算熔断并告警。三项均为必做项。
        </div>

        {plaintext && (
          <div className="card" style={{ borderColor: 'var(--ac-b)', background: 'var(--ac-w)' }}>
            <div className="ch">
              <h3>新密钥（仅显示一次，请立即保存）</h3>
              <button className="tb sm gh" onClick={() => setPlaintext(null)}>
                收起
              </button>
            </div>
            <div className="kbox">{plaintext}</div>
          </div>
        )}

        <div className="row">
          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>API Key</h3>
                <button className="tb" onClick={() => openOverlay('create-key')}>
                  创建
                </button>
              </div>
              <DataTable
                columns={[
                  { key: 'name', title: '名称', render: (k: ApiKey) => k.name },
                  { key: 'scopes', title: '作用域', render: (k: ApiKey) => (k.scopes ?? []).join(' · ') || '—' },
                  { key: 'rateLimitPerMin', title: '限流', render: (k: ApiKey) => `${k.rateLimitPerMin}/min` },
                  { key: 'keyPrefix', title: '前缀', render: (k: ApiKey) => <span className="mono">{k.keyPrefix}…</span> },
                  { key: 'createdAt', title: '创建时间', render: (k: ApiKey) => dateTime(k.createdAt) },
                  {
                    key: 'act',
                    title: '',
                    render: (k: ApiKey) =>
                      k.status === 'active' ? (
                        <button className="tb sm" onClick={() => void revoke(k)}>
                          吊销
                        </button>
                      ) : (
                        <span style={{ color: 'var(--tx-3)', fontSize: 11.5 }}>已吊销</span>
                      ),
                  },
                ]}
                rows={keysQuery.data ?? []}
                rowKey={(k) => k.id}
                loading={keysQuery.isLoading}
                error={keysQuery.isError ? errorText(keysQuery.error) : null}
                empty="暂无 API Key"
              />
              <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 8 }}>密钥仅创建时显示一次，平台仅存哈希。</div>
            </div>

            <div className="card">
              <div className="ch">
                <h3>可调用能力</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>OpenAPI 3.1</span>
              </div>
              <table>
                <tbody>
                  {ABILITIES.map((a) => (
                    <tr key={a.ep}>
                      <td className="mono" style={{ fontSize: 11.5 }}>{a.ep}</td>
                      <td>{a.desc}</td>
                      <td style={{ color: 'var(--tx-3)' }}>{a.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>安全约束</h3>
              </div>
              {SAFETY.map((s) => (
                <div className="step" key={s}>
                  <span className="sdot on">✓</span>
                  {s}
                </div>
              ))}
            </div>

            <div className="card">
              <div className="ch">
                <h3>用量与对账</h3>
              </div>
              <DataTable
                columns={[
                  { key: 'name', title: '调用方', render: (r: CallerRow) => r.name },
                  { key: 'tokens', title: 'Token', render: (r: CallerRow) => tokens(r.tokens) },
                  { key: 'cost', title: '成本', render: (r: CallerRow) => money(r.cost) },
                  { key: 'attribution', title: '归属', render: (r: CallerRow) => r.attribution },
                ]}
                rows={usageQuery.data?.byCaller ?? []}
                rowKey={(r) => r.apiKeyId ?? r.name}
                loading={usageQuery.isLoading}
                error={usageQuery.isError ? errorText(usageQuery.error) : null}
                empty="暂无用量数据"
              />
              <div className={`al ${diff <= 1 ? 'ok' : 'warn'}`} style={{ marginTop: 10 }}>
                <span className="i">{diff <= 1 ? '✓' : '!'}</span>
                <span>
                  今日对账差异 {diff.toFixed(2)}%，{diff <= 1 ? '在阈值内。' : '超出阈值，请核查。'}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 6 }}>
                本月总成本 {money(usageQuery.data?.totalCost ?? 0)} · 调用 {num(usageQuery.data?.byCaller?.length ?? 0)} 个调用方
              </div>
            </div>
          </div>
        </div>
      </div>

      {overlay?.name === 'create-key' && (
        <CreateKeyModal
          onClose={closeOverlay}
          onCreated={(p) => {
            setPlaintext(p);
            closeOverlay();
          }}
        />
      )}
    </>
  );
}

export default ApiPage;

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { Avatar } from '@/components/Avatar';
import { errorText } from '@/api/client';
import { kbApi } from '@/api/kb.api';
import { useKbSources, useKbSpaces } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { FEEDBACK, type FeedbackValue, type QueryResult, type SyncSource } from '@/lib/shared';
import { feedbackLabel } from '@/lib/labels';

export function KnowledgePage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();

  const spacesQuery = useKbSpaces();
  const spaces = spacesQuery.data ?? [];
  const [scope, setScope] = useState('');
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackValue | null>(null);

  const activeScope = scope || spaces[0]?.name || '';
  const sourcesQuery = useKbSources();

  const ask = async () => {
    const q = question.trim();
    if (!q) {
      notify('请输入问题', 'err');
      return;
    }
    setBusy(true);
    setResult(null);
    setFeedback(null);
    try {
      const r = await kbApi.query({ query: q, scope: activeScope, topK: 5 });
      setResult(r);
      setAsked(q);
      notify(
        r.insufficient ? '未在知识库中找到依据' : `命中 ${r.citations?.length ?? 0} 条来源`,
        r.insufficient ? 'warn' : 'ok',
      );
    } catch (e) {
      notify(`检索失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const sendFeedback = async (fb: FeedbackValue) => {
    if (!result) return;
    setFeedback(fb);
    try {
      await kbApi.feedback({ queryId: result.queryId, feedback: fb });
      qc.invalidateQueries({ queryKey: ['kb-feedback'] });
      notify(`已反馈：${feedbackLabel[fb]}`, fb === 'adopt' ? 'ok' : 'warn');
    } catch (e) {
      notify(`反馈失败：${errorText(e)}`, 'err');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          知识 / <b>知识库</b>
        </div>
        <div className="tr">
          <button className="tb" disabled title="全局唤起本期未实现（⌘K 快捷键可直达会话）">
            ⌘K
          </button>
          <button className="tb" disabled title="新建知识空间本期未实现（空间随同步源创建）">
            新建空间
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">知识库</div>
        <div className="ps">多源入库 · 混合检索 · 在线调用 · 来源可溯</div>
        <div className="note">
          <b>权限规则：</b>检索时先按访问权限过滤再召回，不在生成后过滤。
        </div>

        <div className="row">
          <div className="cl2" style={{ flex: 1.35 }}>
            <div className="card">
              <div className="ch">
                <h3>在线问答</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>范围</span>
                  <select
                    value={activeScope}
                    onChange={(e) => setScope(e.target.value)}
                    style={{ height: 26, border: '1px solid var(--line-2)', borderRadius: 'var(--r)', fontSize: 12.5, background: 'var(--panel)' }}
                  >
                    {spaces.length === 0 && <option value="">（无可用空间）</option>}
                    {spaces.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="fld">
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="向知识库提问，例如：CPM 与 CPM 混用会怎样？"
                  style={{
                    width: '100%',
                    minHeight: 62,
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r)',
                    padding: '8px 10px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    resize: 'vertical',
                    lineHeight: 1.6,
                  }}
                />
              </div>
              <button className="tb pri" disabled={busy} onClick={ask}>
                {busy ? '检索中…' : '提问'}
              </button>

              {asked && (
                <div className="ms" style={{ padding: 0, margin: '14px 0 0' }}>
                  <div className="mh">
                    <Avatar text="张" type="human" />
                    <span className="mhn">张伟</span>
                  </div>
                  <div className="qs mb2">{asked}</div>
                </div>
              )}

              {result && (
                <div className="ms" style={{ padding: 0, margin: '14px 0 0' }}>
                  <div className="mh">
                    <Avatar text="AI" type="ai" />
                    <span className="mhn">知识助手</span>
                  </div>
                  <div className="mb2">
                    {result.insufficient ? (
                      <p style={{ color: 'var(--tx-3)' }}>未在知识库中找到依据，建议补充文档或扩大检索范围。</p>
                    ) : (
                      <p>{result.answer}</p>
                    )}
                    {(result.citations ?? []).map((c, i) => (
                      <div
                        className="cite"
                        key={i}
                        title={`打开来源文档：${c.spaceName} · ${c.heading ?? c.docId}`}
                        onClick={() => navigate(`/docs/${c.docId}`)}
                      >
                        {c.spaceName} · {c.heading ?? c.docId}
                        <div className="vt">v{c.version}</div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      {([FEEDBACK.ADOPT, FEEDBACK.REJECT, FEEDBACK.INSUFFICIENT] as FeedbackValue[]).map((f) => (
                        <button
                          key={f}
                          className={`tb sm fb${feedback === f ? ' on' : ''}`}
                          onClick={() => void sendFeedback(f)}
                        >
                          {feedbackLabel[f]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="cl2">
            <div className="card">
              <div className="ch">
                <h3>同步源</h3>
                <button
                  className="tb sm"
                  onClick={async () => {
                    if (!spaces[0]) {
                      notify('请先创建知识空间', 'warn');
                      return;
                    }
                    try {
                      await kbApi.syncSource(spaces[0].id);
                      qc.invalidateQueries({ queryKey: ['kb-sources'] });
                      notify('已触发同步', 'ok');
                    } catch (e) {
                      notify(`同步失败：${errorText(e)}`, 'err');
                    }
                  }}
                >
                  同步全部
                </button>
              </div>
              <DataTable
                columns={[
                  { key: 'space', title: '空间', render: (s: SyncSource) => spaces.find((x) => x.id === s.spaceId)?.name ?? s.spaceId },
                  { key: 'sourceType', title: '源', render: (s: SyncSource) => s.sourceType },
                  { key: 'acl', title: '权限', render: () => '继承' },
                  { key: 'intervalMin', title: '周期', render: (s: SyncSource) => `${s.intervalMin} 分钟` },
                  {
                    key: 'act',
                    title: '',
                    render: (s: SyncSource) => (
                      <button
                        className="tb sm"
                        onClick={async () => {
                          try {
                            const r = await kbApi.syncSource(s.id);
                            qc.invalidateQueries({ queryKey: ['kb-sources'] });
                            notify(`同步完成：${r.docCount} 篇，失败 ${r.failedCount}`, 'ok');
                          } catch (e) {
                            notify(`同步失败：${errorText(e)}`, 'err');
                          }
                        }}
                      >
                        立即同步
                      </button>
                    ),
                  },
                ]}
                rows={sourcesQuery.data ?? []}
                rowKey={(s) => s.id}
                loading={sourcesQuery.isLoading}
                error={sourcesQuery.isError ? errorText(sourcesQuery.error) : null}
                empty="暂无同步源"
              />
            </div>

            <div className="card">
              <div className="ch">
                <h3>检索反馈</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>点踩进入待优化队列</span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>问题</th>
                    <th>命中</th>
                    <th>反馈</th>
                  </tr>
                </thead>
                <tbody>
                  {feedback && asked ? (
                    <tr>
                      <td>{asked}</td>
                      <td>{result?.citations?.length ?? 0}</td>
                      <td>
                        <span style={{ color: feedback === 'adopt' ? 'var(--ok)' : feedback === 'reject' ? 'var(--warn)' : 'var(--tx-3)' }}>
                          {feedbackLabel[feedback]}
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={3} style={{ color: 'var(--tx-3)' }}>
                        暂无反馈记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default KnowledgePage;

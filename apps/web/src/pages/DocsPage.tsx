import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable } from '@/components/DataTable';
import { errorText } from '@/api/client';
import { kbApi } from '@/api/kb.api';
import { useKbDocument, useKbDocuments, useKbSpaces } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { dateTime } from '@/lib/format';
import type { KbDocVersion, PolishAction } from '@/lib/shared';

const POLISH_ACTIONS: { key: PolishAction; label: string }[] = [
  { key: 'polish', label: '润色' },
  { key: 'expand', label: '扩写' },
  { key: 'shorten', label: '更简洁' },
  { key: 'proofread', label: '纠错' },
  { key: 'summarize', label: '摘要' },
];

export function DocsPage() {
  const { docId } = useParams<{ docId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);

  const docsQuery = useKbDocuments();
  const spacesQuery = useKbSpaces();
  const docs = docsQuery.data ?? [];
  const activeId = docId ?? docs[0]?.id ?? null;
  const docQuery = useKbDocument(activeId);
  const doc = docQuery.data;

  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [polish, setPolish] = useState<{ original: string; candidate: string } | null>(null);
  const [polishBusy, setPolishBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 版本历史卡片：顶部「版本」按钮滚动定位到它 */
  const versionsRef = useRef<HTMLDivElement>(null);
  const scrollToVersions = () => versionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useEffect(() => {
    if (doc) {
      setDraft(doc.content ?? '');
      setOriginal(doc.content ?? '');
      setPolish(null);
    }
  }, [doc?.id, doc?.currentVersion]);

  const versions: KbDocVersion[] = doc?.versions ?? [];
  const spaceName = useMemo(
    () => spacesQuery.data?.find((s) => s.id === doc?.spaceId)?.name ?? '—',
    [spacesQuery.data, doc?.spaceId],
  );

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      await kbApi.updateDocument(doc.id, { content: draft });
      qc.invalidateQueries({ queryKey: ['kb-doc', doc.id] });
      qc.invalidateQueries({ queryKey: ['kb-docs'] });
      setOriginal(draft);
      notify('已保存，生成新版本', 'ok');
    } catch (e) {
      notify(`保存失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const runPolish = async (action: PolishAction) => {
    if (!doc) return;
    setPolishBusy(true);
    try {
      const r = await kbApi.polish(doc.id, { scope: 'paragraph', action });
      const candidate = r.candidates[0] ?? draft;
      setPolish({ original: draft, candidate });
      notify(`已生成${POLISH_ACTIONS.find((a) => a.key === action)?.label ?? ''}候选，可对比采纳`, 'ok');
    } catch (e) {
      notify(`AI 润色失败：${errorText(e)}`, 'err');
    } finally {
      setPolishBusy(false);
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          知识 / <b>文档</b>
        </div>
        <div className="tr">
          <button className="tb" onClick={scrollToVersions} title="滚动到版本历史">
            版本
          </button>
          <button className="tb pri" disabled={busy} onClick={save}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      <div className="pg on">
        <div className="pt">文档</div>
        <div className="ps">在线编辑 · AI 辅助 · 版本管理</div>

        <div className="card">
          <div className="ch">
            <h3>文档列表</h3>
            <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{docs.length} 篇</span>
          </div>
          <DataTable
            columns={[
              { key: 'title', title: '标题', render: (d) => d.title },
              { key: 'src', title: '来源', render: (d) => d.source },
              { key: 'v', title: '版本', render: (d) => `v${d.currentVersion}` },
              { key: 'updatedAt', title: '更新时间', render: (d) => dateTime(d.updatedAt) },
            ]}
            rows={docs}
            rowKey={(d) => d.id}
            loading={docsQuery.isLoading}
            error={docsQuery.isError ? errorText(docsQuery.error) : null}
            empty="暂无文档"
            onRowClick={(d) => navigate(`/docs/${d.id}`)}
          />
        </div>

        <div className="row">
          <div className="cl2" style={{ flex: 1.35 }}>
            <div className="card">
              <div className="ch">
                <h3>{doc?.title ?? '文档编辑'}</h3>
                <div>
                  <span style={{ fontSize: 12, color: 'var(--tx-3)', marginRight: 8 }}>
                    空间 {spaceName} · v{doc?.currentVersion ?? 1}
                  </span>
                  <button className="tb sm" onClick={scrollToVersions} title="滚动到版本历史">
                    版本
                  </button>{' '}
                  <button className="tb sm" disabled={polishBusy} onClick={() => void runPolish('polish')}>
                    AI 润色
                  </button>
                </div>
              </div>

              {docQuery.isLoading && <div className="empty"><span className="spin" /> 加载文档…</div>}
              {docQuery.isError && <div className="empty">⚠ {errorText(docQuery.error)}</div>}
              {doc && (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={{
                    width: '100%',
                    minHeight: 180,
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-2)',
                    padding: '14px 16px',
                    fontFamily: 'inherit',
                    fontSize: 13,
                    lineHeight: 1.7,
                    resize: 'vertical',
                  }}
                />
              )}

              {polish && (
                <div className="card" style={{ background: 'var(--panel-2)', margin: '12px 0 0' }}>
                  <div className="ch">
                    <h3>AI 润色对比</h3>
                    <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>段落级</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginBottom: 4 }}>原文</div>
                  <div style={{ padding: '8px 10px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r)', marginBottom: 9 }}>
                    <span className="do">{polish.original}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginBottom: 4 }}>润色后</div>
                  <div style={{ padding: '8px 10px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--r)' }}>
                    <span className="dn">{polish.candidate}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 11, flexWrap: 'wrap' }}>
                    <button
                      className="tb sm pri"
                      onClick={() => {
                        setDraft(polish.candidate);
                        setPolish(null);
                        notify('已采纳润色结果，记得保存', 'ok');
                      }}
                    >
                      采纳
                    </button>
                    {POLISH_ACTIONS.map((a) => (
                      <button key={a.key} className="tb sm" disabled={polishBusy} onClick={() => void runPolish(a.key)}>
                        {a.label}
                      </button>
                    ))}
                    <button
                      className="tb sm gh"
                      onClick={() => {
                        setDraft(polish.original);
                        setPolish(null);
                        notify('已还原原文', 'warn');
                      }}
                    >
                      一键还原
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 9 }}>
                    可一键还原原文；不改动事实性数据与数字；术语词库强制保留。
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="cl2">
            <div className="card" ref={versionsRef}>
              <div className="ch">
                <h3>版本历史</h3>
                <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{versions.length} 个版本</span>
              </div>
              <DataTable
                columns={[
                  { key: 'version', title: '版本', render: (v: KbDocVersion) => `v${v.version}` },
                  { key: 'createdAt', title: '时间', render: (v: KbDocVersion) => dateTime(v.createdAt) },
                  { key: 'note', title: '说明', render: (v: KbDocVersion) => v.note ?? '—' },
                  {
                    key: 'act',
                    title: '',
                    render: (v: KbDocVersion) => (
                      <button
                        className="tb sm"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!doc) return;
                          try {
                            await kbApi.rollback(doc.id, v.version);
                            qc.invalidateQueries({ queryKey: ['kb-doc', doc.id] });
                            notify(`已回滚到 v${v.version}`, 'ok');
                          } catch (err) {
                            notify(`回滚失败：${errorText(err)}`, 'err');
                          }
                        }}
                      >
                        回滚
                      </button>
                    ),
                  },
                ]}
                rows={versions}
                rowKey={(v) => v.id}
                empty="暂无版本记录"
              />
              <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 8 }}>
                本期同步为单向镜像，双向同步列入后续版本。
              </div>
            </div>

            <div className="card">
              <div className="ch">
                <h3>权限一致性</h3>
                <span style={{ fontSize: 12, color: 'var(--ok)' }}>无越权</span>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--tx-2)', lineHeight: 1.6 }}>
                抽样校验同步页面权限与源端一致；无权限用户在检索结果中看不到受限内容。
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default DocsPage;

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from '@/components/Avatar';
import { StatusDot } from '@/components/StatusDot';
import { ToolCall } from '@/components/ToolCall';
import { Modal } from '@/components/Modal';
import { ModelPicker } from '@/components/ModelPicker';
import { errorText, getActorId } from '@/api/client';
import { chatApi } from '@/api/chat.api';
import { taskApi } from '@/api/task.api';
import { useKbSpaces, useMembers, useModels, useSession, useSessions, useTasks } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { DEMO_USER, type Message, type Session } from '@/lib/shared';
import { duration, money, tokens } from '@/lib/format';

/** 轻量段落渲染：按空行切段，避免使用 innerHTML。 */
function Paragraphs({ text }: { text: string }) {
  const parts = text.split(/\n{2,}/).filter(Boolean);
  return (
    <div className="mb2">
      {parts.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

function MessageView({
  m,
  authorName,
  onAction,
}: {
  m: Message;
  authorName?: string;
  onAction: (action: 'create-task' | 'copy', m: Message) => void;
}) {
  const isUser = m.role === 'user';
  const isAI = m.role === 'assistant';
  const name = isUser ? authorName ?? DEMO_USER.name : isAI ? authorName ?? 'AI 成员' : '系统';
  const avatarText = isUser ? (authorName ?? DEMO_USER.name).slice(0, 1) : isAI ? 'AI' : '⌘';
  const navigate = useNavigate();

  const toolBlocks = (m.blocks ?? []).filter((b) => b.kind === 'tool_call');
  const citations = m.citations ?? [];

  return (
    <div className="ms">
      <div className="mh">
        <Avatar text={avatarText} type={isAI ? 'ai' : 'human'} />
        <span className="mhn">{name}</span>
        <span>{new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {isUser ? (
        <div className="qs mb2">{m.content}</div>
      ) : (
        <>
          {toolBlocks.map((b, i) => {
            const d = b.data as Record<string, unknown>;
            const label = String(d.label ?? d.name ?? '工具调用');
            const meta = [d.duration, d.cost].filter(Boolean).join(' · ');
            const detail = typeof d.detail === 'string' ? d.detail : JSON.stringify(d, null, 2);
            return <ToolCall key={i} label={label} meta={meta || undefined} detail={detail} />;
          })}

          {m.content && <Paragraphs text={m.content} />}

          {citations.map((c, i) => (
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

          {(toolBlocks.length > 0 || m.cost > 0 || m.tokenIn + m.tokenOut > 0) && (
            <div className="tm" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tx-3)' }}>
              {toolBlocks.length > 0 && <span>{toolBlocks.length} 次工具调用</span>}
              {m.durationMs != null && <span>· {duration(m.durationMs)}</span>}
              {m.tokenIn + m.tokenOut > 0 && <span>· {tokens(m.tokenIn + m.tokenOut)} Token</span>}
              {m.cost > 0 && <span>· {money(m.cost)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <button className="tb sm" onClick={() => onAction('create-task', m)} title="把该回答转为任务">
              创建任务
            </button>
            <button className="tb sm" disabled title="「存为知识」本期未实现（可在知识库页新建文档）">
              存为知识
            </button>
            <button className="tb sm gh" onClick={() => onAction('copy', m)} title="复制回答全文">
              复制
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NewSessionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (s: Session) => void }) {
  const notify = useUiStore((s) => s.notify);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      notify('请填写会话标题', 'err');
      return;
    }
    setBusy(true);
    try {
      const s = await chatApi.create({ title: title.trim(), ownerId: getActorId() });
      notify('已创建会话', 'ok');
      onCreated(s);
    } catch (e) {
      notify(`创建失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新建会话"
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
        <label>会话标题</label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：冷启动 CPM 出价规范" />
      </div>
    </Modal>
  );
}

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const currentModelId = useUiStore((s) => s.currentModelId);
  const setCurrentModel = useUiStore((s) => s.setCurrentModel);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessionsQuery = useSessions();
  const modelsQuery = useModels();
  const membersQuery = useMembers();
  const spacesQuery = useKbSpaces();
  const tasksQuery = useTasks({ size: 200 });

  const sessions = sessionsQuery.data ?? [];
  const activeId = sessionId ?? sessions[0]?.id ?? null;
  const sessionQuery = useSession(activeId);
  const session = sessionQuery.data;

  const models = modelsQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const memberById = (id?: string) => members.find((m) => m.id === id);
  const spaceName = spacesQuery.data?.find((s) => s.id === session?.kbSpaceId)?.name;
  const taskLabel = (id: string) => {
    const t = tasksQuery.data?.items?.find((x) => x.id === id);
    return t ? `${t.code} ${t.title}` : id;
  };

  // 默认进入最近会话
  useEffect(() => {
    if (!sessionId && sessions[0]) navigate(`/chat/${sessions[0].id}`, { replace: true });
  }, [sessionId, sessions, navigate]);

  const messages: Message[] = session?.messages ?? [];

  const usage = useMemo(() => {
    let tIn = 0;
    let tOut = 0;
    let cost = 0;
    let ms = 0;
    for (const m of messages) {
      tIn += m.tokenIn ?? 0;
      tOut += m.tokenOut ?? 0;
      cost += m.cost ?? 0;
      ms += m.durationMs ?? 0;
    }
    return { token: tIn + tOut, cost, ms };
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || !activeId || sending) return;
    setSending(true);
    try {
      await chatApi.send(activeId, { content });
      setDraft('');
      qc.invalidateQueries({ queryKey: ['session', activeId] });
      qc.invalidateQueries({ queryKey: ['sessions'] });
    } catch (e) {
      notify(`发送失败：${errorText(e)}`, 'err');
    } finally {
      setSending(false);
    }
  };

  const changeModel = async (modelId: string) => {
    setCurrentModel(modelId);
    if (!activeId) return;
    try {
      await chatApi.setModel(activeId, modelId);
      qc.invalidateQueries({ queryKey: ['session', activeId] });
      const m = models.find((x) => x.id === modelId);
      notify(`已切换模型：${m?.name ?? modelId}`, 'ok');
    } catch (e) {
      notify(`切换模型失败：${errorText(e)}`, 'err');
    }
  };

  const removeSession = async (s: Session, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await chatApi.remove(s.id);
      qc.invalidateQueries({ queryKey: ['sessions'] });
      notify(`已删除会话「${s.title}」`, 'warn');
      if (s.id === activeId) {
        const next = sessions.find((x) => x.id !== s.id);
        navigate(next ? `/chat/${next.id}` : '/chat');
      }
    } catch (err) {
      notify(`删除失败：${errorText(err)}`, 'err');
    }
  };

  const agent = memberById(session?.agentId);

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          工作 / <b>会话</b>
        </div>
        <div className="tr">
          <button className="tb" disabled title="全局检索本期未实现（可用 ⌘K 直达会话）">
            ⌕ 检索
          </button>
          <button className="tb" disabled title="会话设置本期未实现（配置见右侧上下文栏）">
            会话设置
          </button>
        </div>
      </div>

      <div className="pg on plain">
        <div className="chat">
          {/* 会话列表 */}
          <div className="clist">
            <div className="clh">
              会话
              <span style={{ marginLeft: 'auto' }}>
                <button className="tb sm gh" title="新建会话" onClick={() => openOverlay('new-session')}>
                  ＋
                </button>
              </span>
            </div>
            <div className="clb">
              {sessionsQuery.isLoading && <div className="empty"><span className="spin" /> 加载中…</div>}
              {sessionsQuery.isError && <div className="empty">⚠ {errorText(sessionsQuery.error)}</div>}
              {!sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0 && (
                <div className="empty">暂无会话</div>
              )}
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`cse${s.id === activeId ? ' on' : ''}`}
                  onClick={() => navigate(`/chat/${s.id}`)}
                >
                  <span className="cset">{s.title}</span>
                  <span className="x" title="删除会话" onClick={(e) => void removeSession(s, e)}>
                    ✕
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 对话主体 */}
          <div className="cmain">
            <div className="cmh">
              <span style={{ fontSize: 13, fontWeight: 500 }}>{session?.title ?? '未选择会话'}</span>
              {agent && <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{agent.name}</span>}
              <div className="tr">
                <ModelPicker
                  models={models}
                  value={currentModelId ?? session?.modelId}
                  onChange={changeModel}
                  disabled={!activeId}
                />
              </div>
            </div>

            <div className="chatb">
              {sessionQuery.isLoading && <div className="empty"><span className="spin" /> 加载对话…</div>}
              {sessionQuery.isError && <div className="empty">⚠ {errorText(sessionQuery.error)}</div>}
              {!sessionQuery.isLoading && !sessionQuery.isError && messages.length === 0 && (
                <div className="empty">还没有消息，先向 AI 成员提问吧。</div>
              )}
              {messages.map((m) => (
                <MessageView
                  key={m.id}
                  m={m}
                  authorName={memberById(m.authorId)?.name ?? (m.role === 'user' ? DEMO_USER.name : undefined)}
                  onAction={(action, msg) => {
                    if (action === 'create-task') {
                      openOverlay('new-task');
                      return;
                    }
                    const text = msg.content ?? '';
                    navigator.clipboard?.writeText(text).then(
                      () => notify('已复制该回答全文', 'ok'),
                      () => notify('复制失败，请手动选择复制', 'err'),
                    );
                  }}
                />
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="cmf">
              <div className="cbox">
                <textarea
                  className="cinp"
                  value={draft}
                  placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
                <div className="cbar">
                  <button className="cbi" disabled title="「＠成员」本期未实现">
                    ＠ 成员
                  </button>
                  <button className="cbi" disabled title="「关联知识库」本期未实现（会话已绑定知识范围）">
                    ▤ 知识库
                  </button>
                  <button className="cbi" disabled title="「选择技能」本期未实现（技能在成员配置中装配）">
                    ◉ 技能
                  </button>
                  <button className="cbi" disabled title="「上传文件」本期未实现">
                    ◱ 文件
                  </button>
                  <button className="cbi" onClick={() => openOverlay('new-task')} disabled={!activeId} title="把当前会话转为任务">
                    ⌁ 转为任务
                  </button>
                  <button className="cbi" style={{ marginLeft: 'auto' }} onClick={() => void send()} disabled={sending}>
                    {sending ? '发送中…' : '发送 ⏎'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 上下文栏 */}
          <aside className="cxt">
            <div className="xs">
              <div className="xst">会话配置</div>
              <div className="xrow">
                <span className="k">执行成员</span>
                <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Avatar text={agent?.avatarText ?? 'AI'} type={agent?.type ?? 'ai'} />
                  {agent?.name ?? '未配置'}
                </span>
              </div>
              <div className="xrow">
                <span className="k">模型</span>
                <span style={{ flex: 1 }}>
                  {models.find((m) => m.id === (currentModelId ?? session?.modelId))?.name ?? '未选择'}
                </span>
              </div>
              <div className="xrow">
                <span className="k">知识库</span>
                <span style={{ flex: 1 }}>{spaceName ?? (session?.kbSpaceId ? session.kbSpaceId : '未挂载')}</span>
              </div>
              <div className="xrow">
                <span className="k">技能</span>
                <span style={{ flex: 1 }}>{session?.skillIds?.length ? `${session.skillIds.length} 个已启用` : '无'}</span>
              </div>
              <div className="xrow">
                <span className="k">权限</span>
                <span style={{ flex: 1 }}>{session?.permScope ?? '默认'}</span>
              </div>
            </div>

            <div className="xs">
              <div className="xst">本次用量</div>
              <div className="kv2">
                <span className="k">Token</span>
                <span className="v">{tokens(usage.token)}</span>
              </div>
              <div className="kv2">
                <span className="k">费用</span>
                <span className="v">{money(usage.cost)}</span>
              </div>
              <div className="kv2">
                <span className="k">耗时</span>
                <span className="v">{duration(usage.ms)}</span>
              </div>
            </div>

            <div className="xs">
              <div className="xst">关联</div>
              {(session?.relatedTaskIds ?? []).length === 0 && <div className="empty">暂无关联任务</div>}
              {(session?.relatedTaskIds ?? []).map((id) => (
                <div
                  className="tl2"
                  key={id}
                  style={{ cursor: 'pointer' }}
                  title={`在任务看板打开 ${taskLabel(id)}`}
                  onClick={() => {
                    openOverlay('task', { taskId: id });
                    navigate('/board');
                  }}
                >
                  <StatusDot color="var(--st-3)" size={6} style={{ marginTop: 6 }} />
                  <span style={{ flex: 1 }}>{taskLabel(id)}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      {overlay?.name === 'new-session' && (
        <NewSessionModal
          onClose={closeOverlay}
          onCreated={(s) => {
            qc.invalidateQueries({ queryKey: ['sessions'] });
            closeOverlay();
            navigate(`/chat/${s.id}`);
          }}
        />
      )}
      {overlay?.name === 'new-task' && (
        <NewTaskFromChat onClose={closeOverlay} />
      )}
    </>
  );
}

/** 会话内「转为任务」：走任务契约创建，创建成功后关闭。 */
function NewTaskFromChat({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      notify('请填写任务标题', 'err');
      return;
    }
    setBusy(true);
    try {
      await taskApi.create({ title: title.trim() });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      notify('已创建任务并关联当前会话', 'ok');
      onClose();
    } catch (e) {
      notify(`创建失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="转为任务"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" disabled={busy} onClick={submit}>
            创建任务
          </button>
        </>
      }
    >
      <div className="fld">
        <label>任务标题</label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="把本次对话转为任务" />
      </div>
    </Modal>
  );
}

export default ChatPage;

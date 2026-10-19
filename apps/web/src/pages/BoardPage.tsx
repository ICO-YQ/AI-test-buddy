import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TaskCard } from '@/components/TaskCard';
import { Inbox } from '@/components/Inbox';
import { Drawer } from '@/components/Drawer';
import { Modal } from '@/components/Modal';
import { Avatar } from '@/components/Avatar';
import { StatusDot } from '@/components/StatusDot';
import { ToolCall } from '@/components/ToolCall';
import { errorText } from '@/api/client';
import { taskApi } from '@/api/task.api';
import { useInbox, useMembers, useTaskDetail, useTasks } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import {
  BOARD_COLUMNS,
  PRIORITY,
  TASK_STATUS,
  canTransition,
  type Member,
  type Priority,
  type RejectReason,
  type Task,
  type TaskStatus,
} from '@/lib/shared';
import { priorityLabel, rejectReasonLabel, taskStatusColor, taskStatusLabel } from '@/lib/labels';
import { money, dateTime, duration, slaText, tokens } from '@/lib/format';

const TAG_OPTIONS = ['报表', '数据分析', '文档', '代码审查', '数据同步'];
const SLA_OPTIONS: { label: string; hours: number }[] = [
  { label: '2 小时', hours: 2 },
  { label: '4 小时', hours: 4 },
  { label: '1 天', hours: 24 },
  { label: '3 天', hours: 72 },
];

/** 轻量弹出菜单（固定定位），用于筛选 / 分组 / 视图。 */
function PopMenu({
  anchor,
  title,
  items,
  disabledItems = [],
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  title: string;
  items: string[];
  disabledItems?: string[];
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const width = 174;
  const left = Math.min(anchor.left, window.innerWidth - width - 10);
  const top = anchor.bottom + 5;

  // Esc 关闭（与全局 Esc 语义一致，避免透明遮罩残留拦截后续点击）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 455 }} onClick={onClose} />
      <div className="ddm" style={{ top, left, zIndex: 460, display: 'block' }}>
        <div className="ddlbl">{title}</div>
        {items.map((it) => {
          const dis = disabledItems.includes(it);
          return (
            <div
              key={it}
              className={`ddi${dis ? ' dis' : ''}`}
              title={dis ? `「${it}」本期未实现` : undefined}
              onClick={() => {
                if (dis) return;
                onPick(it);
                onClose();
              }}
            >
              {it}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** 任务详情抽屉（查看轨迹 / 交付物 / 验收）。 */
function TaskDrawer({ taskId, onClose, memberById }: { taskId: string; onClose: () => void; memberById: (id?: string) => Member | undefined }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const navigate = useNavigate();
  const { data, isLoading, error } = useTaskDetail(taskId);
  const [reason, setReason] = useState<RejectReason | ''>('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const task = data;
  const assignee = memberById(task?.assigneeId);
  const creator = memberById(task?.creatorId);

  const doAccept = async (decision: 'accept' | 'reject') => {
    if (!task) return;
    if (decision === 'reject' && !reason) {
      notify('请选择驳回原因', 'err');
      return;
    }
    setBusy(true);
    try {
      await taskApi.accept(task.id, {
        decision,
        rejectReasonCode: decision === 'reject' ? (reason as RejectReason) : undefined,
        comment: comment || undefined,
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['task', task.id] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      notify(decision === 'accept' ? '验收通过，任务已完成' : '已打回重做（原因将进入 AI 上下文）', decision === 'accept' ? 'ok' : 'warn');
    } catch (e) {
      notify(`操作失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const steps: { label: string; state: 'done' | 'on' | '' }[] = (() => {
    const order: TaskStatus[] = [TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS, TASK_STATUS.IN_REVIEW, TASK_STATUS.DONE];
    const cur = order.indexOf(task?.status ?? TASK_STATUS.TODO);
    return [
      { label: '已分派', state: cur === 0 ? 'on' : cur > 0 ? 'done' : '' },
      { label: '执行中', state: cur === 1 ? 'on' : cur > 1 ? 'done' : '' },
      { label: '待验收', state: cur === 2 ? 'on' : cur > 2 ? 'done' : '' },
      { label: '已完成', state: cur >= 3 ? 'on' : '' },
    ];
  })();

  return (
    <Drawer
      code={task?.code ?? '—'}
      title={task?.title ?? '任务详情'}
      status={
        task ? (
          <span style={{ fontSize: 12, color: taskStatusColor[task.status] }}>{taskStatusLabel[task.status]}</span>
        ) : null
      }
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 7 }}>
          <button
            className="tb"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => {
              onClose();
              navigate('/chat');
            }}
            title="跳转到会话页继续讨论该任务"
          >
            继续对话
          </button>
          <button className="tb" style={{ flex: 1, justifyContent: 'center' }} disabled title="「重新指派」本期未实现">
            重新指派
          </button>
        </div>
      }
    >
      {isLoading && <div className="empty"><span className="spin" /> 加载任务…</div>}
      {!isLoading && error && <div className="empty">⚠ {errorText(error)}</div>}
      {task && (
        <>
          <div className="sc">
            <div className="kv2">
              <span className="k">负责人</span>
              <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Avatar text={assignee?.avatarText ?? '?'} type={assignee?.type ?? 'human'} />
                {assignee?.name ?? '未指派'}
              </span>
            </div>
            <div className="kv2">
              <span className="k">发起人</span>
              <span className="v">{creator?.name ?? '—'}</span>
            </div>
            <div className="kv2">
              <span className="k">优先级</span>
              <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusDot color={task.priority === PRIORITY.P1 ? 'var(--err)' : task.priority === PRIORITY.P2 ? 'var(--warn)' : 'var(--st-1)'} />
                {priorityLabel[task.priority]}
              </span>
            </div>
            <div className="kv2">
              <span className="k">SLA</span>
              <span className="v">{task.slaDueAt ? `${dateTime(task.slaDueAt)} · ${slaText(task.slaDueAt)}` : '未设置'}</span>
            </div>
            <div className="kv2">
              <span className="k">成本</span>
              <span className="v">{money(task.cost)} · {tokens(task.tokenUsed)} Token</span>
            </div>
            <div className="kv2">
              <span className="k">追踪 ID</span>
              <span className="v mono" style={{ fontSize: 11.5 }}>{task.traceId ?? '—'}</span>
            </div>
          </div>

          <div className="sc">
            <div className="sct">状态流转（单向，不可回退）</div>
            <div className="steps" style={{ marginBottom: 0 }}>
              {steps.map((s) => (
                <div key={s.label} className={`stp ${s.state}`}>
                  {s.label}
                </div>
              ))}
            </div>
          </div>

          <div className="sc">
            <div className="sct">执行记录</div>
            {(data?.activities ?? []).length === 0 && <div className="empty">暂无执行记录</div>}
            {(data?.activities ?? []).map((a) =>
              a.type === 'tool_call' ? (
                <ToolCall
                  key={a.id}
                  label={a.content ?? '工具调用'}
                  meta={a.durationMs != null ? duration(a.durationMs) : undefined}
                  detail={`actor: ${a.actorType}${a.traceId ? `\ntrace: ${a.traceId}` : ''}\n${JSON.stringify(a.payload ?? {}, null, 2)}`}
                />
              ) : (
                <div className="tl2" key={a.id}>
                  <StatusDot color={a.actorType === 'ai' ? 'var(--ac)' : 'var(--ok)'} size={6} style={{ marginTop: 6 }} />
                  <span style={{ flex: 1 }}>
                    {a.content ?? a.type}
                    {a.durationMs != null && (
                      <span style={{ color: 'var(--tx-3)', fontSize: 11.5, marginLeft: 6 }}>{duration(a.durationMs)}</span>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>

          <div className="sc">
            <div className="sct">交付物</div>
            {(data?.artifacts ?? []).length === 0 && <div className="empty">暂无交付物</div>}
            {(data?.artifacts ?? []).map((art) => (
              <div className="card" key={art.id} style={{ margin: '0 0 6px', padding: '9px 10px' }}>
                <div style={{ fontSize: 12.5 }}>{art.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--tx-3)', marginTop: 3 }}>
                  {art.code} · v{art.version}
                </div>
              </div>
            ))}
          </div>

          <div className="sc">
            <div className="sct">验收</div>
            <div className="fr">
              <label className="lbl">驳回原因（必填）</label>
              <select
                className=""
                value={reason}
                onChange={(e) => setReason(e.target.value as RejectReason)}
                style={{
                  width: '100%',
                  height: 30,
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  padding: '0 10px',
                  fontSize: 12.5,
                  background: 'var(--panel)',
                  color: reason ? 'var(--tx)' : 'var(--tx-4)',
                }}
              >
                <option value="">请选择</option>
                {Object.entries(rejectReasonLabel).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="fr">
              <label className="lbl">意见</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="补充说明（可选）"
                style={{
                  width: '100%',
                  minHeight: 54,
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r)',
                  padding: '8px 10px',
                  fontFamily: 'inherit',
                  fontSize: 12.5,
                  resize: 'none',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 7 }}>
              <button
                className="tb pri"
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={busy}
                onClick={() => doAccept('accept')}
              >
                验收通过
              </button>
              <button
                className="tb"
                style={{ flex: 1, justifyContent: 'center', color: 'var(--err)', borderColor: '#F0D2CF' }}
                disabled={busy}
                onClick={() => doAccept('reject')}
              >
                打回重做
              </button>
            </div>
          </div>
        </>
      )}
    </Drawer>
  );
}

/** 新建任务弹窗（标题 / 负责人 / 标签 / SLA / 验收标准）。 */
function NewTaskModal({ members, onClose }: { members: Member[]; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(members[0]?.id ?? '');
  const [tags, setTags] = useState<string[]>(['报表']);
  const [slaHours, setSlaHours] = useState(4);
  const [criteria, setCriteria] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!title.trim()) {
      notify('请填写任务标题', 'err');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await taskApi.create({
        title: title.trim(),
        priority: PRIORITY.P3,
        tags,
        assigneeId: assigneeId || undefined,
        slaDueAt: new Date(Date.now() + slaHours * 3600_000).toISOString(),
        acceptCriteria: criteria || undefined,
      });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      const who = members.find((m) => m.id === assigneeId);
      notify(`已创建任务「${title.trim()}」，指派给 ${who?.name ?? '未指派'}（SLA ${slaHours} 小时）`, 'ok');
      onClose();
    } catch (e) {
      notify(`创建失败：${errorText(e)}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="新建任务"
      onClose={onClose}
      footer={
        <>
          <button className="tb sp" onClick={onClose}>
            取消
          </button>
          <button className="tb pri" onClick={submit} disabled={busy}>
            创建任务
          </button>
        </>
      }
    >
      <div className="fld">
        <label>任务标题</label>
        <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="简要描述要做什么" />
      </div>
      <div className="fld">
        <label>负责人</label>
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          {members.length === 0 && <option value="">（无可用成员）</option>}
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.type === 'ai' ? '（AI 成员）' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label>标签</label>
        <div className="chips">
          {TAG_OPTIONS.map((t) => (
            <span
              key={t}
              className={`chip${tags.includes(t) ? ' on' : ''}`}
              onClick={() => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="fld">
        <label>SLA</label>
        <select value={slaHours} onChange={(e) => setSlaHours(Number(e.target.value))}>
          {SLA_OPTIONS.map((o) => (
            <option key={o.hours} value={o.hours}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="fld">
        <label>验收标准</label>
        <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="写明交付物与通过条件" />
      </div>
    </Modal>
  );
}

export function BoardPage() {
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const overlay = useUiStore((s) => s.overlay);
  const openOverlay = useUiStore((s) => s.openOverlay);
  const closeOverlay = useUiStore((s) => s.closeOverlay);
  const filters = useUiStore((s) => s.boardFilters);
  const setBoardFilters = useUiStore((s) => s.setBoardFilters);
  const resetBoardFilters = useUiStore((s) => s.resetBoardFilters);
  const currentUserId = useUiStore((s) => s.currentUserId);
  const navigate = useNavigate();

  const [viewTab, setViewTab] = useState('看板');
  const [menu, setMenu] = useState<{ key: string; rect: DOMRect } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [quickCol, setQuickCol] = useState<TaskStatus | null>(null);
  const [quickText, setQuickText] = useState('');

  const tasksQuery = useTasks({ size: 200 });
  const membersQuery = useMembers();
  const inboxQuery = useInbox();

  const members = membersQuery.data ?? [];
  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const tasks = tasksQuery.data?.items ?? [];
  const memberById = (id?: string) => membersById.get(id ?? '');

  /** 筛选（FR-TK-07：可按负责人 / 负责人类型 / 是否完成筛选） */
  const filterActive = Boolean(filters.assigneeId || filters.assigneeType || filters.hideDone);
  const visibleTasks = useMemo(() => {
    let list = tasks;
    if (filters.assigneeId) list = list.filter((t) => t.assigneeId === filters.assigneeId);
    if (filters.assigneeType) list = list.filter((t) => membersById.get(t.assigneeId ?? '')?.type === filters.assigneeType);
    if (filters.hideDone) list = list.filter((t) => t.status !== 'done');
    return list;
  }, [tasks, filters, membersById]);

  const byStatus = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const col of BOARD_COLUMNS) map[col.key] = [];
    for (const t of visibleTasks) if (map[t.status]) map[t.status].push(t);
    return map;
  }, [visibleTasks]);

  const total = tasksQuery.data?.total ?? tasks.length;

  const moveTask = async (task: Task, to: TaskStatus) => {
    if (task.status === to) return;
    if (!canTransition(task.status, to)) {
      notify(`当前状态不支持流转到「${taskStatusLabel[to]}」（不可回退）`, 'warn');
      return;
    }
    try {
      await taskApi.transition(task.id, { to, lockVersion: task.lockVersion });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      notify(`「${task.title}」已移至 ${taskStatusLabel[to]}`, 'ok');
    } catch (e) {
      notify(`移动失败：${errorText(e)}`, 'err');
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, to: TaskStatus) => {
    e.preventDefault();
    setOverCol(null);
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    const task = tasks.find((t) => t.id === id);
    if (task) void moveTask(task, to);
  };

  const quickAdd = async (status: TaskStatus, text: string) => {
    const title = text.trim();
    if (!title) {
      setQuickCol(null);
      setQuickText('');
      return;
    }
    try {
      const created = await taskApi.create({ title, priority: PRIORITY.P3 });
      if (status !== TASK_STATUS.BACKLOG && canTransition(TASK_STATUS.BACKLOG, status)) {
        await taskApi.transition(created.id, { to: status, lockVersion: created.lockVersion });
      } else if (status !== TASK_STATUS.BACKLOG) {
        notify('已创建（默认待排期）：目标列需经合法流转进入', 'warn');
      } else {
        notify(`已添加：${title}`, 'ok');
      }
      qc.invalidateQueries({ queryKey: ['tasks'] });
      setQuickText('');
    } catch (e) {
      notify(`添加失败：${errorText(e)}`, 'err');
    }
  };

  return (
    <>
      <div className="topbar">
        <div className="crumb">
          工作 / <b>任务</b>
        </div>
        <div className="vt">
          {['全部', '成员', '看板'].map((t) => {
            const dis = t !== '看板';
            return (
              <div
                key={t}
                className={`vti${viewTab === t ? ' on' : ''}${dis ? ' dis' : ''}`}
                title={dis ? `「${t}」视图本期未实现（仅提供看板视图）` : '看板视图'}
                onClick={() => !dis && setViewTab(t)}
              >
                {t}
              </div>
            );
          })}
        </div>
        <div className="tr">
          <span style={{ fontSize: 12.5, color: 'var(--tx-3)' }}>
            {visibleTasks.length} / {total} 个任务
            {filterActive && <span style={{ color: 'var(--ac)', marginLeft: 6 }}>· 已筛选</span>}
          </span>
          <button
            className={`tb${filterActive ? ' on' : ''}`}
            onClick={(e) => setMenu({ key: 'filter', rect: e.currentTarget.getBoundingClientRect() })}
            title="按状态 / 负责人筛选"
          >
            筛选
          </button>
          <button className="tb" disabled title="「分组」本期未实现（仅支持按状态分列）">
            分组
          </button>
          <button className="tb" disabled title="「视图」本期未实现（仅提供看板视图）">
            视图 ▾
          </button>
          <button className="tb pri" onClick={() => openOverlay('new-task')}>
            新建任务
          </button>
        </div>
      </div>

      <div className="pg on plain">
        <div className="kw">
          <div className="bd">
            {BOARD_COLUMNS.map((col) => {
              const list = byStatus[col.key] ?? [];
              return (
                <div className="cl" key={col.key}>
                  <div className="clh">
                    <StatusDot color={col.colorVar} />
                    <span className="clt">{col.label}</span>
                    <span className="cln">{list.length}</span>
                    <span className="cla">
                      <span
                        title="快速添加"
                        onClick={() => {
                          setQuickCol(col.key);
                          setQuickText('');
                        }}
                      >
                        ＋
                      </span>
                      <span className="dis" title="列操作（重命名 / 上限 / 排序 / 清空）本期未实现">
                        ⋯
                      </span>
                    </span>
                  </div>

                  <div
                    className={`cb${overCol === col.key ? ' over' : ''}`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverCol(col.key);
                    }}
                    onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
                    onDrop={(e) => onDrop(e, col.key)}
                  >
                    {quickCol === col.key && (
                      <div className="qa">
                        <input
                          autoFocus
                          value={quickText}
                          placeholder="输入标题，回车创建"
                          onChange={(e) => setQuickText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void quickAdd(col.key, quickText);
                            if (e.key === 'Escape') {
                              setQuickCol(null);
                              setQuickText('');
                            }
                          }}
                          onBlur={() => setTimeout(() => setQuickCol(null), 150)}
                        />
                      </div>
                    )}

                    {tasksQuery.isLoading && <div className="empty"><span className="spin" /> 加载中…</div>}
                    {!tasksQuery.isLoading && tasksQuery.isError && (
                      <div className="empty">⚠ {errorText(tasksQuery.error)}</div>
                    )}

                    {list.map((t) => (
                      <TaskCard
                        key={t.id}
                        task={t}
                        assignee={memberById(t.assigneeId)}
                        showSla
                        dragging={dragId === t.id}
                        onClick={(task) => openOverlay('task', { taskId: task.id })}
                        onDragStart={(e, task) => {
                          setDragId(task.id);
                          e.dataTransfer.setData('text/plain', task.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverCol(null);
                        }}
                      />
                    ))}
                  </div>

                  <div className="cadd">
                    <button
                      className="cadb"
                      onClick={() => {
                        setQuickCol(col.key);
                        setQuickText('');
                      }}
                    >
                      添加任务
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <Inbox
            items={inboxQuery.data ?? []}
            members={members}
            loading={inboxQuery.isLoading}
            error={inboxQuery.isError ? errorText(inboxQuery.error) : null}
            isActionable={(n) => (n.refType === 'task' && !!n.refId) || n.kind === 'kb_feedback'}
            onSelect={(n) => {
              if (n.refType === 'task' && n.refId) {
                openOverlay('task', { taskId: n.refId });
                return;
              }
              if (n.kind === 'kb_feedback') navigate('/knowledge');
            }}
          />
        </div>
      </div>

      {overlay?.name === 'task' && typeof overlay.payload?.taskId === 'string' && (
        <TaskDrawer taskId={overlay.payload.taskId} onClose={closeOverlay} memberById={memberById} />
      )}
      {overlay?.name === 'new-task' && <NewTaskModal members={members} onClose={closeOverlay} />}

      {menu?.key === 'filter' && (
        <PopMenu
          anchor={menu.rect}
          title="筛选"
          items={
            filterActive
              ? ['清除筛选', '全部', '未完成', '仅我的', 'AI 成员', '人类成员']
              : ['全部', '未完成', '仅我的', 'AI 成员', '人类成员']
          }
          onPick={(v) => {
            switch (v) {
              case '清除筛选':
              case '全部':
                resetBoardFilters();
                notify('已清除筛选', 'ok');
                break;
              case '未完成':
                resetBoardFilters();
                setBoardFilters({ hideDone: true });
                notify('已筛选：仅未完成', 'ok');
                break;
              case '仅我的':
                resetBoardFilters();
                setBoardFilters({ assigneeId: currentUserId });
                notify('已筛选：仅我的任务', 'ok');
                break;
              case 'AI 成员':
                resetBoardFilters();
                setBoardFilters({ assigneeType: 'ai' });
                notify('已筛选：AI 成员的任务', 'ok');
                break;
              case '人类成员':
                resetBoardFilters();
                setBoardFilters({ assigneeType: 'human' });
                notify('已筛选：人类成员的任务', 'ok');
                break;
              default:
                break;
            }
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

export default BoardPage;

import type { Member, Notification } from '@/lib/shared';
import { DEMO_USER } from '@/lib/shared';
import { Avatar } from './Avatar';
import { relTime } from '@/lib/format';

export interface InboxProps {
  items: Notification[];
  members: Member[];
  loading?: boolean;
  error?: string | null;
  /** 判定该通知是否可跳转；不可跳转的不显示可点态，避免「点了没反应」 */
  isActionable?: (n: Notification) => boolean;
  onSelect?: (n: Notification) => void;
}

/**
 * 右侧收件箱：聚合审批 / 提及 / 问答反馈 / SLA / 安全。
 * 紧急项用原型的暖色底（非醒目横幅）。
 */
export function Inbox({ items, members, loading, error, isActionable, onSelect }: InboxProps) {
  const memberById = (id?: string) => members.find((m) => m.id === id);

  return (
    <aside className="rc">
      <div className="rch">
        收件箱
        <span style={{ marginLeft: 'auto', color: 'var(--tx-3)', fontWeight: 400 }}>
          {loading ? '…' : items.length}
        </span>
      </div>
      <div className="rlist">
        {loading && <div className="empty"><span className="spin" /> 加载中…</div>}
        {!loading && error && <div className="empty">⚠ {error}</div>}
        {!loading && !error && items.length === 0 && <div className="empty">暂无通知</div>}
        {items.map((n) => {
          // refId 可能是成员/任务/知识库 id：能命中成员就用它，否则按类型退化到 AI 成员 / 当前用户
          const who =
            memberById(n.refId) ??
            (n.kind === 'kb_feedback' ? memberById(DEMO_USER.id) : members.find((m) => m.type === 'ai'));
          const urgent = n.priority === 'urgent';
          const clickable = isActionable ? isActionable(n) : true;
          return (
            <div
              key={n.id}
              className={`ri${urgent ? ' od' : ''}`}
              onClick={clickable ? () => onSelect?.(n) : undefined}
              style={clickable ? undefined : { cursor: 'default' }}
              title={clickable ? n.title : `${n.title}（该通知无可跳转目标）`}
            >
              <div className="rit">{n.title}</div>
              <div className="tm">
                {n.refType && <span className="tid">{n.refType.toUpperCase()}</span>}
                <span className="tmeta" style={urgent ? { color: 'var(--err)' } : undefined}>
                  {urgent ? '紧急' : relTime(n.createdAt)}
                </span>
                <Avatar
                  text={who?.avatarText ?? '·'}
                  type={who?.type ?? 'human'}
                  title={who?.name}
                />
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default Inbox;

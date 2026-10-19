import type { DragEvent } from 'react';
import type { Member, Task } from '@/lib/shared';
import { Avatar } from './Avatar';
import { StatusDot } from './StatusDot';
import { money, shortDate, slaText } from '@/lib/format';
import { priorityLabel, taskStatusColor, taskStatusLabel } from '@/lib/labels';

export interface TaskCardProps {
  task: Task;
  assignee?: Member;
  /** SLA 剩余（显示在副行） */
  showSla?: boolean;
  dragging?: boolean;
  onClick?: (task: Task) => void;
  onDragStart?: (e: DragEvent<HTMLDivElement>, task: Task) => void;
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}

/**
 * 看板任务卡：紧凑密度，左侧 2px 优先级竖条，无彩色徽章。
 */
export function TaskCard({
  task,
  assignee,
  showSla = false,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const ai = assignee?.type === 'ai';
  return (
    <div
      className={`tc ${task.priority}`}
      draggable
      onDragStart={(e) => onDragStart?.(e, task)}
      onDragEnd={(e) => onDragEnd?.(e)}
      onClick={() => onClick?.(task)}
      style={{
        opacity: dragging ? 0.35 : task.status === 'done' ? 0.72 : 1,
        marginBottom: 6,
      }}
      title={`${task.title} · ${priorityLabel[task.priority]}`}
    >
      <div className="tt">{task.title}</div>

      {showSla && task.status === 'in_progress' && (
        <div className="sub">
          <StatusDot color={taskStatusColor[task.status]} size={6} />
          {assignee ? `${assignee.name} · ` : ''}
          {task.slaDueAt ? slaText(task.slaDueAt) : '进行中'}
        </div>
      )}

      <div className="tm" style={showSla && task.status === 'in_progress' ? { marginTop: 7 } : undefined}>
        <span className="tid">{task.code}</span>
        <span className="tmeta">
          {showSla && task.slaDueAt && task.status === 'in_review'
            ? `${shortDate(task.slaDueAt)} · 到期`
            : task.cost > 0
              ? money(task.cost, 1)
              : shortDate(task.createdAt)}
        </span>
        {assignee ? (
          <Avatar text={assignee.avatarText || assignee.name.slice(0, 1)} type={assignee.type} />
        ) : (
          <Avatar text="?" type="human" />
        )}
      </div>

      {task.status === 'in_review' && (
        <div className="sub">
          <span className="tmeta">▤</span>
          {taskStatusLabel[task.status]}
        </div>
      )}
    </div>
  );
}

export default TaskCard;

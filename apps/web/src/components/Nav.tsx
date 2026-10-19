import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar } from './Avatar';
import { useInbox, useKbSpaces, useMembers, useSessions, useSkills, useTasks } from '@/lib/useQueryHooks';
import { useUiStore } from '@/store/ui.store';
import { DEMO_USER, DEMO_WORKSPACE } from '@/lib/shared';

interface NavItem {
  key: string;
  label: string;
  icon: string;
  path?: string;
  count?: number;
  /** 本期未实现的功能入口：置灰不可点，title 说明原因（不做「点了只弹提示」的假响应） */
  disabled?: boolean;
  hint?: string;
  /** 是否参与高亮（多个入口指向同一页面时只高亮主入口） */
  highlight?: boolean;
  /** 自定义行为（如带筛选跳转） */
  onSelect?: () => void;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const ICONS = {
  chat: '◉',
  myTasks: '☑',
  inbox: '◷',
  allTasks: '▦',
  board: '▤',
  todo: '◫',
  automation: '⌁',
  reports: '◱',
  members: '◈',
  skills: '◉',
  hub: '◰',
  kb: '◇',
  docs: '▤',
  models: '◎',
  api: '⌘',
  audit: '☰',
};

/** 左侧分组导航 + 操作身份切换器（身份决定 `x-actor-id` 请求头）。 */
export function Nav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const notify = useUiStore((s) => s.notify);
  const currentUserId = useUiStore((s) => s.currentUserId);
  const currentUserName = useUiStore((s) => s.currentUserName);
  const setCurrentUser = useUiStore((s) => s.setCurrentUser);
  const setBoardFilters = useUiStore((s) => s.setBoardFilters);
  const resetBoardFilters = useUiStore((s) => s.resetBoardFilters);

  const sessions = useSessions();
  const tasks = useTasks({ size: 200 });
  const inbox = useInbox();
  const members = useMembers();
  const skills = useSkills();
  const spaces = useKbSpaces();

  // 防御：后端异常/空响应时 items 可能缺失，避免读取 .length 抛错
  const total = tasks.data?.total ?? tasks.data?.items?.length ?? 0;
  const memberList = members.data ?? [];
  const currentMember = memberList.find((m) => m.id === currentUserId);

  /* 身份切换器 */
  const anchorRef = useRef<HTMLDivElement>(null);
  const [idOpen, setIdOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!idOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIdOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idOpen]);

  const toggleIdentity = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      setMenuPos({
        top: r.bottom + 5,
        left: Math.min(r.left, Math.max(8, window.innerWidth - 248)),
      });
    }
    setIdOpen((v) => !v);
  };

  const switchIdentity = (id: string, name: string) => {
    setCurrentUser(id, name);
    setIdOpen(false);
    // 身份变化会改变权限与审计归属，全部服务端状态需要重取
    qc.invalidateQueries();
    notify(`已切换操作身份：${name}（x-actor-id: ${id}）`, 'ok');
  };

  /* 身份自愈：若本地持久化的身份不在当前成员表里（例如重跑 seed 换了 id），
     自动回落到默认身份，避免 stale id 让所有请求 4xx。只纠正一次。
     注意：纠正后必须重取数据 —— 首屏那批请求是用失效身份发出的，
     不重取的话页面会一直停留在「用错误身份取回的数据」上。 */
  const healedRef = useRef(false);
  useEffect(() => {
    if (healedRef.current) return;
    if (memberList.length === 0) return;
    if (memberList.some((m) => m.id === currentUserId)) {
      healedRef.current = true;
      return;
    }
    healedRef.current = true;
    setCurrentUser(DEMO_USER.id, DEMO_USER.name);
    qc.invalidateQueries();
    notify(`本地身份已失效，已回落为默认身份「${DEMO_USER.name}」并重新加载数据`, 'warn');
  }, [memberList, currentUserId, setCurrentUser, notify, qc]);

  const groups: NavGroup[] = [
    {
      items: [
        { key: 'chat', label: '会话', icon: ICONS.chat, path: '/chat', count: sessions.data?.length },
        {
          key: 'myTasks',
          label: '我的任务',
          icon: ICONS.myTasks,
          count: total || undefined,
          highlight: false,
          onSelect: () => {
            resetBoardFilters();
            setBoardFilters({ assigneeId: currentUserId });
            navigate('/board');
          },
        },
        {
          key: 'inbox',
          label: '收件箱',
          icon: ICONS.inbox,
          count: inbox.data?.length,
          highlight: false,
          onSelect: () => {
            resetBoardFilters();
            navigate('/board');
          },
        },
        {
          key: 'allTasks',
          label: '全部任务',
          icon: ICONS.allTasks,
          count: total || undefined,
          highlight: false,
          onSelect: () => {
            resetBoardFilters();
            navigate('/board');
          },
        },
      ],
    },
    {
      title: '工作',
      items: [
        { key: 'board', label: '任务', icon: ICONS.board, path: '/board' },
        { key: 'todo', label: '待办', icon: ICONS.todo, disabled: true, hint: '「待办」视图本期未实现（任务页已含全部状态列）' },
        { key: 'automation', label: '自动化', icon: ICONS.automation, disabled: true, hint: '「自动化」本期未实现（不在 PRD 范围）' },
        { key: 'reports', label: '报表', icon: ICONS.reports, disabled: true, hint: '「报表」本期未实现（不在 PRD 范围）' },
      ],
    },
    {
      title: '团队',
      items: [
        { key: 'members', label: '成员', icon: ICONS.members, path: '/members', count: memberList.length },
        { key: 'skills', label: '技能库', icon: ICONS.skills, path: '/skills', count: skills.data?.length },
        { key: 'hub', label: '技能市场', icon: ICONS.hub, path: '/hub' },
      ],
    },
    {
      title: '知识',
      items: [
        { key: 'kb', label: '知识库', icon: ICONS.kb, path: '/knowledge', count: spaces.data?.length },
        { key: 'docs', label: '文档', icon: ICONS.docs, path: '/docs' },
      ],
    },
    {
      title: '设置',
      items: [
        { key: 'models', label: '模型', icon: ICONS.models, path: '/models' },
        { key: 'api', label: 'API 与配额', icon: ICONS.api, path: '/api-keys' },
        { key: 'audit', label: '审计日志', icon: ICONS.audit, path: '/audit' },
      ],
    },
  ];

  const isActive = (item: NavItem) => {
    if (item.disabled || item.highlight === false) return false;
    if (!item.path) return false;
    return pathname === item.path || pathname.startsWith(`${item.path}/`);
  };

  const onClick = (item: NavItem) => {
    if (item.disabled) return;
    if (item.onSelect) {
      item.onSelect();
      return;
    }
    if (item.path) navigate(item.path);
  };

  const itemTitle = (item: NavItem) => {
    if (item.disabled) return item.hint ?? `${item.label}（本期未实现）`;
    if (item.path || item.onSelect) return item.label;
    return `${item.label}（本期未实现）`;
  };

  return (
    <nav className="nav">
      <div className="ws">
        <div className="wsav">欢</div>
        <div className="wsbtn dis" title="演示环境仅单工作区，不支持切换" aria-disabled>
          {DEMO_WORKSPACE.name} <span className="cv">▾</span>
        </div>
      </div>

      <div className="sbox">
        <div className="sbi" onClick={() => navigate('/chat')} title="快捷键 ⌘K">
          <span>⌕</span>
          <span>搜索</span>
          <span style={{ marginLeft: 'auto', fontSize: 10.5 }}>⌘K</span>
        </div>
      </div>

      {/* 操作身份：决定所有请求的 x-actor-id（后端权限判定 + 审计双主体留痕的发起人） */}
      <div className="sbox" style={{ paddingBottom: 8 }}>
        <div
          className="sbi"
          ref={anchorRef}
          onClick={toggleIdentity}
          title="切换操作身份（请求头 x-actor-id）"
          style={{ cursor: 'pointer' }}
        >
          <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>身份</span>
          <Avatar
            text={currentMember?.avatarText ?? currentUserName.slice(0, 1)}
            type={currentMember?.type ?? 'human'}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'var(--tx-2)',
            }}
          >
            {currentMember?.name ?? currentUserName}
          </span>
          <span style={{ color: 'var(--tx-3)', fontSize: 9 }}>▾</span>
        </div>
      </div>

      {idOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 455 }} onClick={() => setIdOpen(false)} />
          <div className="ddm" style={{ display: 'block', top: menuPos.top, left: menuPos.left, minWidth: 232, zIndex: 460 }}>
            <div className="ddlbl">以该身份操作 · x-actor-id</div>
            {memberList.length === 0 && <div className="ddlbl">暂无成员（后端未连接）</div>}
            {memberList.map((m) => (
              <div
                key={m.id}
                className={`ddi${m.id === currentUserId ? ' sel' : ''}`}
                onClick={() => switchIdentity(m.id, m.name)}
              >
                <Avatar text={m.avatarText || m.name.slice(0, 1)} type={m.type} />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span style={{ color: 'var(--tx-3)', fontSize: 11 }}>{m.type === 'ai' ? 'AI' : '人类'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="nb">
        {groups.map((g, gi) => (
          <div className="ng" key={g.title ?? `g${gi}`}>
            {g.title && <div className="ngt">{g.title}</div>}
            {g.items.map((item) => (
              <div
                key={item.key}
                className={`ni${isActive(item) ? ' on' : ''}${item.disabled ? ' dis' : ''}`}
                onClick={() => onClick(item)}
                title={itemTitle(item)}
                aria-disabled={item.disabled || undefined}
              >
                <span className="nic">{item.icon}</span>
                <span className="nlabel">{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span className="nct">{item.count}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

export default Nav;

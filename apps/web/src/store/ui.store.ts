/**
 * UI 状态（zustand）：Toast、浮层（抽屉/弹窗）、当前模型、看板筛选、演示身份（§8）。
 */
import { create } from 'zustand';
import { DEMO_USER } from '@/lib/shared';

export type ToastType = 'info' | 'ok' | 'warn' | 'err';

export interface ToastState {
  id: number;
  msg: string;
  type: ToastType;
}

export interface BoardFilters {
  priority?: string;
  assigneeId?: string;
  /** 按负责人类型筛选（AI 成员 / 人类成员） */
  assigneeType?: 'human' | 'ai';
  tag?: string;
  q?: string;
  /** 仅未完成（隐藏已完成列卡片） */
  hideDone?: boolean;
}

export interface OverlayState {
  name: string;
  payload?: Record<string, unknown>;
}

interface UiState {
  /* Toast */
  toast: ToastState | null;
  notify: (msg: string, type?: ToastType) => void;
  clearToast: () => void;

  /* 浮层（同时最多一个，Esc / 点击遮罩可关闭） */
  overlay: OverlayState | null;
  openOverlay: (name: string, payload?: Record<string, unknown>) => void;
  closeOverlay: () => void;

  /* 当前模型（会话 / 成员共用） */
  currentModelId: string | null;
  setCurrentModel: (id: string | null) => void;

  /* 演示身份（默认「张伟」，用于双主体留痕演示） */
  currentUserId: string;
  currentUserName: string;
  setCurrentUser: (id: string, name: string) => void;

  /* 看板筛选 */
  boardFilters: BoardFilters;
  setBoardFilters: (patch: BoardFilters) => void;
  resetBoardFilters: () => void;

  /* 全局关闭 */
  closeAll: () => void;
}

let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/* ── 操作身份持久化：刷新后仍以同一身份操作（决定 x-actor-id 请求头） ── */
const ACTOR_KEY = 'huanbuddy.actor';

function loadActor(): { id: string; name: string } {
  try {
    const raw = localStorage.getItem(ACTOR_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const p = parsed as { id?: unknown; name?: unknown };
        if (typeof p.id === 'string' && p.id) {
          return { id: p.id, name: typeof p.name === 'string' && p.name ? p.name : p.id };
        }
      }
    }
  } catch {
    /* 忽略：读不到就用默认身份 */
  }
  return { id: DEMO_USER.id, name: DEMO_USER.name };
}

const initialActor = loadActor();

export const useUiStore = create<UiState>((set) => ({
  toast: null,
  notify: (msg, type = 'info') => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, msg, type } });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },
  clearToast: () => set({ toast: null }),

  overlay: null,
  openOverlay: (name, payload) => set({ overlay: { name, payload } }),
  closeOverlay: () => set({ overlay: null }),

  currentModelId: null,
  setCurrentModel: (id) => set({ currentModelId: id }),

  currentUserId: initialActor.id,
  currentUserName: initialActor.name,
  setCurrentUser: (id, name) => {
    try {
      localStorage.setItem(ACTOR_KEY, JSON.stringify({ id, name }));
    } catch {
      /* 忽略：持久化失败不影响本次会话 */
    }
    set({ currentUserId: id, currentUserName: name });
  },

  boardFilters: {},
  setBoardFilters: (patch) => set((s) => ({ boardFilters: { ...s.boardFilters, ...patch } })),
  resetBoardFilters: () => set({ boardFilters: {} }),

  closeAll: () => set({ overlay: null }),
}));

/** 便捷函数：在非组件上下文也可触发 toast */
export const notify = (msg: string, type: ToastType = 'info') => useUiStore.getState().notify(msg, type);

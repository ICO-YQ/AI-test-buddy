import { useUiStore } from '@/store/ui.store';

/**
 * 底部 Toast。订阅 ui.store，全局任意位置调用 notify(msg, type) 即可触发。
 */
export function Toast() {
  const toast = useUiStore((s) => s.toast);
  // 始终渲染容器（保持与原型一致的过渡效果），用 on 类控制显隐
  const cls = `toast${toast ? ' on' : ''}${toast && toast.type !== 'info' && toast.type !== 'ok' ? ` ${toast.type}` : ''}`;
  return (
    <div className={cls} role="status" aria-live="polite">
      <span className="tk" />
      <span>{toast?.msg ?? ''}</span>
    </div>
  );
}

export default Toast;

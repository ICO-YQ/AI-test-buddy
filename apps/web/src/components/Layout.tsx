import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Nav } from './Nav';
import { Toast } from './Toast';
import { useUiStore } from '@/store/ui.store';

/**
 * 全局布局壳：左侧导航 + 主区（页面自带 topbar）+ Toast。
 * 全局键盘：
 *  · Esc —— 关闭所有浮层（抽屉 / 弹窗）
 *  · Cmd/Ctrl+K —— 跳转到会话
 */
export function Layout() {
  const navigate = useNavigate();
  const closeAll = useUiStore((s) => s.closeAll);
  const notify = useUiStore((s) => s.notify);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAll();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navigate('/chat');
        notify('已打开会话（⌘K）');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAll, navigate, notify]);

  return (
    <div className="shell">
      <Nav />
      <div className="main">
        <div className="body">
          <Outlet />
        </div>
      </div>
      <Toast />
    </div>
  );
}

export default Layout;

import type { ReactNode } from 'react';
import { useEffect } from 'react';

export interface DrawerProps {
  /** 顶部左侧标识（如 TSK-8402） */
  code?: ReactNode;
  title: ReactNode;
  /** 顶部右侧状态文字 */
  status?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  onClose: () => void;
}

/**
 * 右侧抽屉（浮层允许阴影）。点击遮罩或 ✕ 关闭；Esc 由 Layout 全局兜底。
 */
export function Drawer({ code, title, status, children, footer, width = 544, onClose }: DrawerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="mask on" onClick={onClose} />
      <aside className="dw on" style={{ width, maxWidth: '92vw' }}>
        <div className="dwh">
          {code && <span style={{ fontSize: 12, color: 'var(--tx-3)' }}>{code}</span>}
          <span style={{ fontWeight: 500 }}>{title}</span>
          <div className="tr">
            {status}
            <button className="tb sm gh" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        </div>
        <div className="dwb">{children}</div>
        {footer && <div className="dwf">{footer}</div>}
      </aside>
    </>
  );
}

export default Drawer;

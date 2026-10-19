import type { ReactNode } from 'react';
import { useEffect } from 'react';

export interface ModalProps {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  onClose: () => void;
}

/**
 * 居中模态（浮层允许阴影）。点击遮罩或 ✕ 关闭；Esc 由 Layout 全局兜底。
 */
export function Modal({ title, children, footer, width = 520, onClose }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="mask2 on" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mdl" style={{ width }}>
        <div className="mdlh">
          <h3>{title}</h3>
          <button className="tb sm gh" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="mdlb">{children}</div>
        {footer && <div className="mdlf">{footer}</div>}
      </div>
    </div>
  );
}

export default Modal;

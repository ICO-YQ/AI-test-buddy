import type { CSSProperties } from 'react';

export interface StatusDotProps {
  /** CSS 颜色（通常传令牌变量，如 var(--st-3)） */
  color?: string;
  size?: number;
  style?: CSSProperties;
  title?: string;
}

/**
 * 状态圆点（默认 7px 实心）。状态与优先级统一用它表达，不使用彩色徽章。
 */
export function StatusDot({ color = 'var(--st-1)', size = 7, style, title }: StatusDotProps) {
  return (
    <span
      className="sd"
      title={title}
      style={{ background: color, width: size, height: size, flex: 'none', ...style }}
    />
  );
}

export default StatusDot;

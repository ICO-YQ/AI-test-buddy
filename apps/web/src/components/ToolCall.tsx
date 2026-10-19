import { useState, type CSSProperties } from 'react';

export interface ToolCallProps {
  /** 单行摘要，如「执行技能 · 图表渲染 v0.9.2」 */
  label: string;
  /** 右侧元信息，如「2.1s · ¥0.4」 */
  meta?: string;
  /** 展开后的详情（多行文本） */
  detail?: string;
  defaultOpen?: boolean;
  style?: CSSProperties;
}

/**
 * 工具调用记录：默认折叠为单行 `▸ ...`，点击展开明细。
 * 刻意不做成大卡片，避免「满屏聊天气泡」。
 */
export function ToolCall({ label, meta, detail, defaultOpen = false, style }: ToolCallProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasDetail = !!detail;
  return (
    <div style={style}>
      <div
        className="tl"
        onClick={() => hasDetail && setOpen((v) => !v)}
        role={hasDetail ? 'button' : undefined}
        title={hasDetail ? (open ? '收起' : '展开') : undefined}
      >
        <span style={{ width: 10, display: 'inline-block' }}>{hasDetail ? (open ? '▾' : '▸') : '·'}</span>
        <span style={{ color: 'inherit' }}>{label}</span>
        {meta && <span style={{ marginLeft: 'auto' }}>{meta}</span>}
      </div>
      {open && hasDetail && <div className="tlc on">{detail}</div>}
    </div>
  );
}

export default ToolCall;

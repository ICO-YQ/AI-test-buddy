import { useEffect, useRef, useState } from 'react';
import type { ModelConfig } from '@/lib/shared';
import { StatusDot } from './StatusDot';
import { modelHealthColor } from '@/lib/labels';

export interface ModelPickerProps {
  models: ModelConfig[];
  value?: string | null;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  title?: string;
}

/**
 * 模型下拉（会话 / 成员共用）。健康状态用 7px 圆点表达。
 */
export function ModelPicker({ models, value, onChange, disabled, title = '切换模型' }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLButtonElement>(null);

  const current = models.find((m) => m.id === value) ?? models[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      const w = 264;
      setPos({
        top: r.bottom + 5,
        left: Math.min(r.left, window.innerWidth - w - 10),
      });
    }
    setOpen((v) => !v);
  };

  return (
    <>
      <button className="mdp" ref={anchorRef} onClick={toggle} disabled={disabled} title={title}>
        <StatusDot color={current ? modelHealthColor[current.health] : 'var(--ac)'} size={6} />
        <span>{current?.name ?? '未选择模型'}</span>
        <span style={{ color: 'var(--tx-3)' }}>▾</span>
      </button>

      {open && (
        <div className="mnu" style={{ top: pos.top, left: pos.left }}>
          {models.length === 0 && <div className="ddlbl">暂无可用模型（后端未连接）</div>}
          {models.map((m) => (
            <div
              key={m.id}
              className={`mi${m.id === (current?.id ?? '') ? ' on' : ''}`}
              onClick={() => {
                onChange(m.id);
                setOpen(false);
              }}
            >
              <div className="n">
                <StatusDot color={modelHealthColor[m.health]} size={6} />
                {m.name}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tx-3)' }}>{m.vendor}</span>
              </div>
              <div className="d">{m.purpose ?? '—'}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default ModelPicker;

/**
 * 展示格式化工具（§7.4）：时间、金额、Token、时长。
 */

/** 相对时间：3 小时前 / 2 天前 */
export function relTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < min) return diff >= 0 ? '刚刚' : '即将';
  if (abs < hour) return `${Math.round(abs / min)} 分钟${diff >= 0 ? '前' : '后'}`;
  if (abs < day) return `${Math.round(abs / hour)} 小时${diff >= 0 ? '前' : '后'}`;
  if (abs < 30 * day) return `${Math.round(abs / day)} 天${diff >= 0 ? '前' : '后'}`;
  return dateTime(iso).slice(0, 10);
}

/** 看板卡片：M/D */
export function shortDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 详情：YYYY-MM-DD HH:mm */
export function dateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 仅时间：HH:mm:ss */
export function timeOnly(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 金额：¥3.60 / ¥1,820 */
export function money(v?: number, decimals = 2): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const opts: Intl.NumberFormatOptions =
    decimals > 0
      ? { minimumFractionDigits: decimals, maximumFractionDigits: decimals }
      : { maximumFractionDigits: 0 };
  return `¥${n.toLocaleString('zh-CN', opts)}`;
}

/** Token：4,820 / 2.4M */
export function tokens(v?: number): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString('zh-CN');
}

/** 时长（ms）：0.8s / 31s / 2h14m */
export function duration(ms?: number): string {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : 0;
  if (n < 1000) return `${(n / 1000).toFixed(1)}s`;
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h${rm}m` : `${h}h`;
}

/** 距今剩余时间：剩余 2h14m / 到期 2 分钟 */
export function slaText(dueAt?: string): string {
  if (!dueAt) return '—';
  const t = Date.parse(dueAt);
  if (Number.isNaN(t)) return '—';
  const diff = t - Date.now();
  if (diff <= 0) {
    const overdue = -diff;
    return overdue < 60_000 ? '到期' : `已超 ${duration(overdue)}`;
  }
  return `剩余 ${duration(diff)}`;
}

/** 大写首字母/首字，用于头像 */
export function initials(name?: string): string {
  if (!name) return '?';
  return name.slice(0, 1).toUpperCase();
}

/** 千分位整数 */
export function num(v?: number): string {
  return (typeof v === 'number' && Number.isFinite(v) ? v : 0).toLocaleString('zh-CN');
}

/** 百分比 */
export function pct(v?: number, digits = 0): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return `${(n * 100).toFixed(digits)}%`;
}

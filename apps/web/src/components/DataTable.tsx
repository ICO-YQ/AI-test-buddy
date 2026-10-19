import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  title: ReactNode;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  render?: (row: T, index: number) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
}

/**
 * 通用表格。自带 loading / error / empty 三态，后端不可用时渲染空态而非白屏。
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty,
  onRowClick,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="empty">
        <span className="spin" /> 加载中…
      </div>
    );
  }
  if (error) {
    return <div className="empty">⚠ {error}</div>;
  }
  if (!rows.length) {
    return <div className="empty">{empty ?? '暂无数据'}</div>;
  }
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={rowKey(row, i)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={onRowClick ? { cursor: 'pointer' } : undefined}
          >
            {columns.map((c) => (
              <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                {c.render ? c.render(row, i) : String((row as Record<string, unknown>)[c.key] ?? '—')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default DataTable;

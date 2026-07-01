import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'start' | 'end';
  render?: (row: T) => ReactNode;
}

export interface TableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  /** Rendered in place of the body when rows is empty (states-first). */
  empty?: ReactNode;
  className?: string;
}

export function Table<T>({
  caption,
  columns,
  rows,
  getRowId,
  empty,
  className,
}: TableProps<T>): React.JSX.Element {
  if (rows.length === 0 && empty !== undefined) {
    return (
      <div role="status" className="p-4 text-center text-[12px] text-muted">
        {empty}
      </div>
    );
  }
  return (
    <table className={cx('w-full border-collapse text-[13px]', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cx(
                'border-b border-hairline px-2 py-1 font-medium text-faint',
                c.align === 'end' ? 'text-right' : 'text-left',
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={getRowId(row)}>
            {columns.map((c) => {
              const raw = c.render ? c.render(row) : (row as Record<string, ReactNode>)[c.key];
              return (
                <td
                  key={c.key}
                  className={cx(
                    'border-b border-hairline px-2 py-1 text-fg',
                    c.align === 'end' ? 'text-right tabular-nums' : 'text-left',
                  )}
                >
                  {raw}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

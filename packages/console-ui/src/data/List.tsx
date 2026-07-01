import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface ListProps<T> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  label?: string;
  className?: string;
}

export function List<T>({
  items,
  renderItem,
  getKey,
  label,
  className,
}: ListProps<T>): React.JSX.Element {
  return (
    <ul
      {...(label !== undefined ? { 'aria-label': label } : {})}
      className={cx('flex flex-col', className)}
    >
      {items.map((item) => (
        <li key={getKey(item)} className="px-2 py-1 text-[13px] text-fg">
          {renderItem(item)}
        </li>
      ))}
    </ul>
  );
}

import type { ReactNode } from 'react';
import { Toolbar as RxToolbar } from 'radix-ui';
import { cx } from '../lib/cx.js';

export interface ToolbarProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function Toolbar({ label, children, className }: ToolbarProps): React.JSX.Element {
  return (
    <RxToolbar.Root
      aria-label={label}
      className={cx('flex items-center gap-1 rounded-control bg-subtle px-1 py-1', className)}
    >
      {children}
    </RxToolbar.Root>
  );
}

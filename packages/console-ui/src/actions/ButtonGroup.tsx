import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface ButtonGroupProps {
  label: string;
  children: ReactNode;
  className?: string;
}

export function ButtonGroup({ label, children, className }: ButtonGroupProps): React.JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('inline-flex items-center gap-1', className)}
    >
      {children}
    </div>
  );
}

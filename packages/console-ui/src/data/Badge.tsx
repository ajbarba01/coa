import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import type { Status } from '../feedback/Banner.js';

export type BadgeTone = 'neutral' | Status;

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

const byTone: Record<BadgeTone, string> = {
  neutral: 'bg-element text-muted border-border-default',
  info: 'bg-info-tint text-info-text border-transparent',
  success: 'bg-success-tint text-success-text border-transparent',
  warning: 'bg-warning-tint text-warning-text border-transparent',
  danger: 'bg-danger-tint text-danger-text border-transparent',
};

export function Badge({ tone = 'neutral', children, className }: BadgeProps): React.JSX.Element {
  return (
    <span
      data-tone={tone}
      className={cx(
        'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none',
        byTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

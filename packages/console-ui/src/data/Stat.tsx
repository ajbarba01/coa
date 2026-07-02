import { useId } from 'react';
import { cx } from '../lib/cx.js';
import type { Status } from '../feedback/Banner.js';

export interface StatProps {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | Status;
  className?: string;
}

const valueTone: Record<'default' | Status, string> = {
  default: 'text-fg',
  info: 'text-info-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
};

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
  className,
}: StatProps): React.JSX.Element {
  const labelId = useId();
  return (
    <div className={cx('flex flex-col gap-0.5', className)}>
      <span
        id={labelId}
        className="text-eyebrow font-medium uppercase tracking-[0.06em] text-faint"
      >
        {label}
      </span>
      <span
        aria-labelledby={labelId}
        className={cx('text-metric font-semibold tabular-nums', valueTone[tone])}
      >
        {value}
      </span>
      {sub !== undefined && <span className="text-caption text-muted">{sub}</span>}
    </div>
  );
}

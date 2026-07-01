import { cx } from '../lib/cx.js';

export interface ProgressProps {
  value: number;
  max?: number;
  label: string;
  className?: string;
}

export function Progress({ value, max = 100, label, className }: ProgressProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cx('h-1.5 w-full overflow-hidden rounded-full bg-element', className)}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-normal"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

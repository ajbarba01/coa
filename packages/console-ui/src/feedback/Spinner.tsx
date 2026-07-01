import { Loader2 } from 'lucide-react';
import { cx } from '../lib/cx.js';

export interface SpinnerProps {
  label?: string;
  size?: number;
  className?: string;
}

export function Spinner({
  label = 'Loading',
  size = 16,
  className,
}: SpinnerProps): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cx('inline-flex text-muted', className)}
    >
      <Loader2
        size={size}
        strokeWidth={2}
        aria-hidden
        className="animate-spin motion-reduce:animate-none"
      />
    </span>
  );
}

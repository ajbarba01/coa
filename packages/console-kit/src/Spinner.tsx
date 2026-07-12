import { cx } from './cx.js';

export interface SpinnerProps {
  /** What is loading — the status's accessible name. */
  label: string;
  className?: string | undefined;
}

/** The loading circle: a quiet s-scale ring for content that is genuinely not
 *  there yet (a cold transcript, a deferred canvas). Continuous rotation is
 *  sanctioned for loading states only — and it reveals 120ms late
 *  (`.spinner-reveal`, tokens.css) so a fast transition never flashes it.
 *  Reduced-motion swaps the spin for a pulse. */
export function Spinner({ label, className }: SpinnerProps): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label={label}
      className={cx('spinner-reveal inline-flex', className)}
    >
      <span className="block h-4 w-4 rounded-full border-2 border-s4 border-t-s8 motion-safe:animate-spin motion-reduce:animate-pulse" />
    </span>
  );
}

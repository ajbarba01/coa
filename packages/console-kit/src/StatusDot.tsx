import { cx } from './cx.js';

/** The indicator law's state vocabulary: state is a dot, never a word.
 *  blue = running · amber = needs-you · red = critical · green = done/clean ·
 *  ground = idle. */
export type SessionStatus = 'running' | 'needs-you' | 'critical' | 'done' | 'idle';

const COLOR: Record<SessionStatus, string> = {
  running: 'bg-run',
  'needs-you': 'bg-warn',
  critical: 'bg-crit',
  done: 'bg-ok',
  idle: 'bg-s5',
};

export function StatusDot({
  status,
  size = 6,
}: {
  status: SessionStatus;
  size?: number;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cx('inline-block shrink-0 rounded-full', COLOR[status])}
      style={{ width: size, height: size }}
    />
  );
}

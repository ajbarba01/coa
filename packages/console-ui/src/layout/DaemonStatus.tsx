import { ChevronDown, Play, RotateCw, Square } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Menu } from '../actions/Menu.js';
import { Spinner } from '../feedback/Spinner.js';

/**
 * The title-bar daemon control: a status dot + label that opens a
 * Start / Stop / Restart menu. Daemon status is a transport fact the host app
 * owns (the daemon serves every other read), so this is a pure presentational
 * control — state in, intent callbacks out.
 */

export type DaemonStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface DaemonStatusProps {
  status: DaemonStatus;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  className?: string;
}

/** The dot color carries the state at a glance; `bg-current` inherits the span's text color. */
const dotColor: Record<DaemonStatus, string> = {
  running: 'text-success-text',
  starting: 'text-warning-text',
  stopped: 'text-muted',
  error: 'text-danger-text',
};

const label: Record<DaemonStatus, string> = {
  running: 'Running',
  starting: 'Starting…',
  stopped: 'Stopped',
  error: 'Error',
};

export function DaemonStatus({
  status,
  onStart,
  onStop,
  onRestart,
  className,
}: DaemonStatusProps): React.JSX.Element {
  const busy = status === 'starting';
  const running = status === 'running';
  const items = [
    { id: 'start', label: 'Start', icon: Play, disabled: running || busy, onSelect: onStart },
    { id: 'restart', label: 'Restart', icon: RotateCw, disabled: !running, onSelect: onRestart },
    { id: 'stop', label: 'Stop', icon: Square, disabled: !running, onSelect: onStop },
  ];
  return (
    <Menu
      items={items}
      trigger={
        <button
          type="button"
          aria-label={`Daemon: ${label[status]}`}
          data-status={status}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-label text-muted',
            'outline-none hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-focus',
            className,
          )}
        >
          {busy ? (
            <Spinner size={12} label="Daemon starting" />
          ) : (
            <span
              aria-hidden
              className={cx('h-2 w-2 shrink-0 rounded-full bg-current', dotColor[status])}
            />
          )}
          <span>{label[status]}</span>
          <ChevronDown aria-hidden size={12} className="text-faint" />
        </button>
      }
    />
  );
}

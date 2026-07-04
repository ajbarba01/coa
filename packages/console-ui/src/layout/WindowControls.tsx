import { Copy, Minus, Square, X } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

/**
 * The custom min/max/close controls drawn in the AppShell title bar when the native
 * frame is hidden (Windows). Being DOM, the whole strip scales with the Ctrl+/- content
 * zoom — which native caption controls cannot. Presentational: maximized state in,
 * intent callbacks out; the host wires them to the window over IPC.
 */
export interface WindowControlsProps {
  /** Drives the middle glyph: `Square` (maximize) ⇄ `Copy` (restore). */
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
  className?: string;
}

/** A caption button: full bar height, fixed width, opts out of the drag region. */
const buttonBase =
  'inline-flex h-full w-[46px] shrink-0 items-center justify-center text-muted ' +
  'outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus';

/** `-webkit-app-region` is not in the CSSProperties type, so it is asserted once. */
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function WindowControls({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
  className,
}: WindowControlsProps): React.JSX.Element {
  return (
    <div className={cx('flex h-full items-stretch', className)} style={noDrag}>
      <button
        type="button"
        aria-label="Minimize"
        onClick={onMinimize}
        className={cx(buttonBase, 'hover:bg-element-hover hover:text-fg')}
      >
        <Icon name={Minus} size={16} />
      </button>
      <button
        type="button"
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        onClick={onToggleMaximize}
        className={cx(buttonBase, 'hover:bg-element-hover hover:text-fg')}
      >
        <Icon name={isMaximized ? Copy : Square} size={isMaximized ? 13 : 14} />
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={cx(buttonBase, 'hover:bg-danger hover:text-on-accent')}
      >
        <Icon name={X} size={16} />
      </button>
    </div>
  );
}

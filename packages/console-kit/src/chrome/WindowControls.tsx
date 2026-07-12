import { cx } from '../cx.js';
import { Tooltip } from '../overlay/Tooltip.js';

export interface WindowControlsProps {
  /** Drives the middle glyph (maximize ⇄ restore) — feed it the REAL window
   *  state (main pushes it), never a local guess. */
  isMaximized: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

const FACE = 'slip w-10 cursor-pointer text-body';

/** The DOM min/max/close cluster for a hidden-frame window. DOM (not a native
 *  overlay) so the controls scale with the app's zoom like the rest of the
 *  chrome. Stretches to its title-bar segment's height; close is the one
 *  hover that may go red (destructive, OS convention). */
export function WindowControls({
  isMaximized,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowControlsProps): React.JSX.Element {
  return (
    <div
      className="flex items-stretch"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Tooltip label="minimize">
        <button
          type="button"
          aria-label="minimize"
          onClick={onMinimize}
          className={cx(FACE, 'text-s8 hover:bg-s3 hover:text-s10')}
        >
          ─
        </button>
      </Tooltip>
      <Tooltip label={isMaximized ? 'restore' : 'maximize'}>
        <button
          type="button"
          aria-label={isMaximized ? 'restore' : 'maximize'}
          onClick={onToggleMaximize}
          className={cx(FACE, 'text-s8 hover:bg-s3 hover:text-s10')}
        >
          {isMaximized ? '❐' : '▢'}
        </button>
      </Tooltip>
      <Tooltip label="close">
        <button
          type="button"
          aria-label="close"
          onClick={onClose}
          className={cx(FACE, 'text-s8 hover:bg-crit hover:text-s12')}
        >
          ✕
        </button>
      </Tooltip>
    </div>
  );
}

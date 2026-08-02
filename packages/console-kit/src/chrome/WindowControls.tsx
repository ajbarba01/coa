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
 *  hover that may go red (destructive, OS convention).
 *
 *  The documented carve-out is the GLYPH vocabulary — `─ ▢/❐ ✕` stay as typed
 *  characters where the kit would otherwise draw a lucide mark. The names are
 *  cased like every other command, which is also how the platform writes them. */
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
      <Tooltip label="Minimize">
        <button
          type="button"
          aria-label="Minimize"
          onClick={onMinimize}
          className={cx(FACE, 'text-s8 hover:bg-s3 hover:text-s10')}
        >
          ─
        </button>
      </Tooltip>
      <Tooltip label={isMaximized ? 'Restore' : 'Maximize'}>
        <button
          type="button"
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={onToggleMaximize}
          className={cx(FACE, 'text-s8 hover:bg-s3 hover:text-s10')}
        >
          {isMaximized ? '❐' : '▢'}
        </button>
      </Tooltip>
      <Tooltip label="Close">
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={cx(FACE, 'text-s8 hover:bg-crit hover:text-s12')}
        >
          ✕
        </button>
      </Tooltip>
    </div>
  );
}

import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { IconButton } from '../actions/IconButton.js';
import { Icon } from '../icon/Icon.js';
import { cx, focusRing } from '../lib/cx.js';

export interface FindBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  /** 1-based index of the active match, or 0 when there are none. */
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** A small overlay find control (Ctrl/Cmd+F) hosted by `Transcript`: a query input,
 *  a `current/total` count, prev/next, and close. Internal to `Transcript` — not part
 *  of the package's public surface. */
export function FindBar({
  query,
  onQueryChange,
  current,
  total,
  onPrev,
  onNext,
  onClose,
}: FindBarProps): React.JSX.Element {
  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className="pointer-events-auto flex items-center gap-1 rounded-surface border border-border-default bg-raised px-2 py-1 shadow-sm"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <Icon name={Search} size={14} className="shrink-0 text-faint" />
      <input
        // Opening the find bar should focus its input immediately (Ctrl/Cmd+F intent).
        autoFocus
        type="text"
        aria-label="Find in conversation"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Find…"
        className={cx('w-40 bg-transparent text-label text-fg placeholder:text-faint', focusRing)}
      />
      <span className="shrink-0 text-caption text-muted tabular-nums">
        {total === 0 ? '0/0' : `${current}/${total}`}
      </span>
      <IconButton
        icon={ChevronUp}
        label="Previous match"
        variant="tertiary"
        size="sm"
        disabled={total === 0}
        onClick={onPrev}
      />
      <IconButton
        icon={ChevronDown}
        label="Next match"
        variant="tertiary"
        size="sm"
        disabled={total === 0}
        onClick={onNext}
      />
      <IconButton icon={X} label="Close find" variant="tertiary" size="sm" onClick={onClose} />
    </div>
  );
}

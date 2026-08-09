import { useEffect, useRef } from 'react';
import { Button, cx } from '@coa/console-kit';

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

/** Find-in-transcript (Ctrl/Cmd+F): a floating bar at the transcript's top-right, hosted by
 *  `Transcript`. Row-level matches — the count reads `current/total`, ⏎/⇧⏎ (or ‹ ›) walk
 *  them, the active row wears the amber wash and scrolls into view, Esc closes. The desktop
 *  needs this because an Electron window has no browser find chrome. Internal to `Transcript`
 *  — not part of the package's public surface. Matches the design reference (chat/FindBar). */
export function FindBar({
  query,
  onQueryChange,
  current,
  total,
  onPrev,
  onNext,
  onClose,
}: FindBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div
      role="search"
      aria-label="Find in conversation"
      className="slip-enter pointer-events-auto flex items-center gap-1.5 rounded-r2 border border-s5 bg-s3 px-2 py-1 shadow-[var(--shadow-float)]"
    >
      <span aria-hidden className="text-[13px] text-s7">
        ⌕
      </span>
      <input
        ref={inputRef}
        type="text"
        aria-label="Find in conversation"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="Find in conversation…"
        className="w-44 bg-transparent font-mono text-sec text-s11 outline-none placeholder:text-s6"
      />
      <span
        className={cx(
          'font-mono text-meta whitespace-nowrap tabular-nums',
          total === 0 && query !== '' ? 'text-s6' : 'text-s7',
        )}
      >
        {query === '' ? '' : `${current}/${total}`}
      </span>
      <Button
        variant="ghost"
        icon
        aria-label="Previous match"
        onClick={onPrev}
        disabled={total === 0}
      >
        ‹
      </Button>
      <Button variant="ghost" icon aria-label="Next match" onClick={onNext} disabled={total === 0}>
        ›
      </Button>
      <Button variant="ghost" icon aria-label="Close Find" onClick={onClose}>
        ✕
      </Button>
    </div>
  );
}

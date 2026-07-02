import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface InlineEditProps {
  value: string;
  /** Called with the trimmed new value only when it actually changed. */
  onCommit: (next: string) => void;
  /** Accessible name of the value being edited (e.g. 'Agent name'). */
  label: string;
  /** Type styling for both the display text and the editor (kept identical so
   *  entering edit mode does not shift layout). */
  textClassName?: string;
  disabled?: boolean;
  className?: string;
}

/** Click-to-edit text (the Linear/Notion title pattern): a quiet display button
 *  with a hover pencil; click swaps in an input. Enter commits, Escape cancels,
 *  blur commits; an empty or unchanged draft reverts silently. */
export function InlineEdit({
  value,
  onCommit,
  label,
  textClassName,
  disabled,
  className,
}: InlineEditProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = (): void => {
    const next = draft.trim();
    if (next !== '' && next !== value) onCommit(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className={cx(
          '-mx-1.5 rounded-control border border-accent bg-element px-1.5 py-0.5 text-fg',
          textClassName,
          focusRing,
          className,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      aria-label={`Rename ${label}: ${value}`}
      disabled={disabled ?? false}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cx(
        'group -mx-1.5 inline-flex min-w-0 items-center gap-2 rounded-control border border-transparent px-1.5 py-0.5 text-left',
        'enabled:hover:bg-element-hover enabled:active:bg-element-active disabled:opacity-50',
        focusRing,
        className,
      )}
    >
      <span className={cx('truncate text-fg', textClassName)}>{value}</span>
      <Icon
        name={Pencil}
        size={13}
        className="shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}

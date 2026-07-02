import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx, focusRing } from '../lib/cx.js';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  label: string;
  options: ComboboxOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** A single-select with type-ahead. Closed, it shows the selected label. Focus clears
 *  the box to a blank filter (the selected label lingers as the placeholder) and opens
 *  the full list; typing narrows it; arrows move the active row, Enter commits, Escape
 *  cancels. Blurring without a pick restores the prior selection — the box never holds
 *  an uncommitted value. */
export function Combobox({
  label,
  options,
  value,
  onValueChange,
  placeholder,
  className,
}: ComboboxProps): React.JSX.Element {
  const labelId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // The label shown when the field is idle (not being edited). Seeded from `value` and
  // kept in sync, but also updated on pick so an uncontrolled parent still displays it.
  const [committed, setCommitted] = useState(
    () => options.find((o) => o.value === value)?.label ?? '',
  );
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const selected = options.find((o) => o.value === value);
    if (selected) setCommitted(selected.label);
  }, [value, options]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? options : options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Keep the active row in range as the filter narrows.
  const active = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);
  const open = focused && filtered.length > 0;

  function choose(opt: ComboboxOption): void {
    setCommitted(opt.label);
    setQuery('');
    setFocused(false);
    onValueChange?.(opt.value);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, (i < 0 ? -1 : i) + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      const opt = filtered[active];
      if (opt) {
        e.preventDefault();
        choose(opt);
      }
    } else if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  }

  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <span id={labelId} className="text-label font-medium text-fg">
        {label}
      </span>
      <div className="relative">
        <input
          ref={inputRef}
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-opt-${active}` : undefined}
          // Idle → the committed label; focused → the live (initially blank) filter.
          value={focused ? query : committed}
          placeholder={focused ? committed || placeholder || '' : (placeholder ?? '')}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setFocused(true);
            setQuery('');
            setActiveIndex(0);
          }}
          onKeyDown={onKeyDown}
          // Delay so an option's onMouseDown (which commits) runs before the close.
          onBlur={() =>
            window.setTimeout(() => {
              setFocused(false);
              setQuery('');
            }, 120)
          }
          className={cx(
            'h-control-md w-full rounded-control border border-border-default bg-element px-2.5 text-body text-fg placeholder:text-faint enabled:hover:border-accent',
            focusRing,
          )}
        />
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label={label}
            className="absolute z-[200] mt-1 max-h-56 w-full overflow-auto rounded-surface border border-border-default bg-raised p-1 text-body text-fg shadow-lg"
          >
            {filtered.map((opt, i) => (
              <li
                key={opt.value}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActiveIndex(i)}
                // onMouseDown (not onClick) so it fires before the input blur closes the list
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(opt);
                }}
                className={cx(
                  'cursor-default rounded-control px-2 py-1',
                  i === active ? 'bg-element-active' : 'hover:bg-element-hover',
                )}
              >
                {opt.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from '../cx.js';
import { PopoverCard } from '../overlay/PopoverCard.js';

/** The group header's caps STYLE (size, tracking, colour) — deliberately without
 *  `CapsLabel`'s `uppercase` transform. A group here is a literal value (e.g. the
 *  harness label "coa scaffold", which is deliberately lowercase), so it must render
 *  verbatim; `CapsLabel` itself stays untouched since other surfaces rely on its
 *  shouted-caps idiom. */
const GROUP_HEADER = 'px-3 pt-2 pb-0.5 text-caps tracking-[0.07em] text-s6';

/** An option carries the group it files under (renders a header when it changes
 *  from its neighbour) and an optional leading glyph (a provider mark, an icon). */
export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
  leading?: React.ReactNode;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  'aria-label': string;
  disabled?: boolean;
  /** Rendered inside the popup beneath the option list, on its own hairline. A second
   *  axis belonging to the same choice rides here (the model picker's reasoning ladder);
   *  the popup belongs to this component, so the slot has to as well. Absent ⇒ no region
   *  and no stray hairline. */
  footer?: React.ReactNode;
  /** Override the trigger's text. Defaults to the selected option's label — pass this
   *  only when the trigger must report more than the option name (the compact model
   *  picker appends its reasoning stop, having no room for a visible ladder). */
  triggerLabel?: string;
  /** `bordered` (default) is the Select chip skin. `chip` is the composer shelf's
   *  borderless chip, for a trigger sitting in a dense control row. */
  variant?: 'bordered' | 'chip';
  /** Fill the container instead of hugging the label — a combobox acting as a FIELD
   *  inside a panel should span it, the way any other field would. Off by default: a
   *  trigger sitting in a control row hugs. */
  fullWidth?: boolean;
}

/** Pure: the options a query names. Matches the label OR the group, case-insensitively,
 *  so typing a harness name ("scaffold") finds every model filed under it. Blank query
 *  (including whitespace-only) is "no filter" — everything comes back. */
export function filterOptions(options: readonly ComboboxOption[], query: string): ComboboxOption[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...options];
  return options.filter(
    (o) => o.label.toLowerCase().includes(q) || (o.group?.toLowerCase().includes(q) ?? false),
  );
}

/** The kit's filter field: a trigger chip (same skin family as `Select`) that grows a
 *  `PopoverCard` holding a search input over the option list. Where `Select` is a flat
 *  list short enough to scan, this is for a set too long to scan — the model picker's
 *  reason for existing. Escape, exclusivity and positioning all ride `PopoverCard`; this
 *  component owns only the filter text, the keyboard cursor and the grouped rows. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  footer,
  triggerLabel,
  variant = 'bordered',
  fullWidth = false,
  ...aria
}: ComboboxProps): React.JSX.Element {
  const ariaLabel = aria['aria-label'];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const current = options.find((o) => o.value === value)?.label ?? value;
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  // The cursor tracks the filtered list, not the raw options — retyping always
  // re-lands on the first hit rather than an index into a list that shrank.
  useEffect(() => {
    setCursor(0);
  }, [query]);

  // Opening asks to be typed into immediately — filtering IS the interaction.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function openPopover(): void {
    setQuery('');
    setOpen(true);
  }

  function select(option: ComboboxOption): void {
    onChange(option.value);
    setOpen(false);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = filtered[cursor];
      if (picked !== undefined) select(picked);
    }
    // Escape is left alone: it bubbles past this handler to the kit dismiss-layer
    // stack (registered below), the one Escape authority.
  }

  return (
    <PopoverCard
      open={open}
      onOpenChange={(next) => (next ? openPopover() : setOpen(false))}
      side="bottom"
      align="start"
      className="w-64 p-0"
      trigger={
        <button
          type="button"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-label={ariaLabel}
          className={cx(
            'font-mono',
            fullWidth ? 'flex w-full items-center justify-between gap-2' : 'flex-none',
            variant === 'chip'
              ? 'rounded-r2 px-2 py-1 text-meta'
              : 'rounded-r1 border px-2 py-[3px] text-code',
            disabled
              ? variant === 'chip'
                ? 'cursor-default text-s6'
                : 'cursor-default border-s4 text-s6'
              : cx(
                  'slip slip-press cursor-pointer active:scale-[0.97]',
                  variant === 'chip'
                    ? open
                      ? 'bg-s4 text-s11'
                      : 'text-s9 hover:bg-s4 hover:text-s11'
                    : open
                      ? 'border-s5 text-s11'
                      : 'border-s4 text-s9 hover:border-s5 hover:text-s11',
                ),
          )}
        >
          {triggerLabel ?? current} ▾
        </button>
      }
    >
      <div className="flex flex-col">
        <div className="border-b border-s4 px-2 py-1.5">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-controls={listId}
            className="slip w-full min-w-0 rounded-r2 border border-s5 bg-s1 px-2.5 py-1 font-mono text-code text-s11 outline-none placeholder:text-s7 focus:border-s7"
          />
        </div>
        <div role="listbox" id={listId} aria-label={ariaLabel} className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sec text-s7">No match</div>
          ) : (
            filtered.map((o, i) => {
              const previousGroup = i > 0 ? filtered[i - 1]?.group : undefined;
              const showGroup = o.group !== undefined && o.group !== previousGroup;
              return (
                // `presentation`: `listbox`'s ARIA contract expects `option` (and
                // `group`) children directly — this wrapper exists only to pair a
                // group header with its row, so it must not itself show up as an
                // unlabelled node between the listbox and its options.
                <div key={o.value} role="presentation">
                  {showGroup && <div className={GROUP_HEADER}>{o.group}</div>}
                  <div
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => select(o)}
                    className={cx(
                      'slip slip-press flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left font-mono text-code whitespace-nowrap active:scale-[0.97]',
                      o.value === value
                        ? 'bg-s4 text-s12'
                        : i === cursor
                          ? 'bg-s4 text-s11'
                          : 'text-s9',
                    )}
                  >
                    {o.leading}
                    {o.label}
                    {o.value === value && (
                      <span className="ml-auto pl-4 font-mono text-caps tracking-normal text-s7">
                        Current
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        {footer !== undefined && (
          <div data-combobox-footer className="border-t border-s4">
            {footer}
          </div>
        )}
      </div>
    </PopoverCard>
  );
}

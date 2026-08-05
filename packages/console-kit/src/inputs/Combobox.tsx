import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cx } from '../cx.js';
import { PopoverCard } from '../overlay/PopoverCard.js';
import { Tooltip, type TooltipSpec } from '../overlay/Tooltip.js';

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

/** One scope on the rail: a glyph that stands for a whole slice of the option set. */
export interface ComboboxRailItem {
  id: string;
  /** The scope's name — its accessible name and its tooltip, since the rail is glyphs only. */
  label: string;
  leading: React.ReactNode;
}

/** A left rail of scopes over the option list. The rail REPORTS a scope; it never filters —
 *  what a scope means is the caller's knowledge, so the caller narrows `options` itself. */
export interface ComboboxRail {
  items: readonly ComboboxRailItem[];
  value: string;
  onChange: (id: string) => void;
  /** Names the rail as a whole (e.g. "Backend"). */
  label: string;
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
  /** A rail of scopes down the popup's left edge, spanning filter, list and footer. For a
   *  set whose natural slices are worth one click (the model picker's backends), where
   *  typing the slice's name would be the only other way in. Absent ⇒ no rail, and the
   *  popup keeps its narrow width. */
  rail?: ComboboxRail;
  /** A glyph before the trigger's text — the selected option's own mark, so the trigger
   *  identifies what is chosen the same way the row did. */
  triggerLeading?: React.ReactNode;
  /** Hover/focus detail on the trigger, through the kit's own tooltip. A native `title`
   *  is drawn by the OS outside the page — there is no CSS for it, so it can never wear
   *  the console's skin, delay or placement, and it cannot carry a keybind chip. */
  tooltip?: TooltipSpec;
  /** Which trigger edge the popup hangs from. `start` (default) is right for a trigger
   *  whose left edge is fixed; a trigger in a right-packed row moves its LEFT edge as its
   *  own label changes width, so that one anchors to `end` and holds still. */
  align?: 'start' | 'end';
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
  rail,
  triggerLeading,
  tooltip,
  align = 'start',
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
      align={align}
      // The rail runs edge to edge, so under one the surface keeps no vertical padding of
      // its own — the filter row, the list and the footer each carry their own.
      className={cx('p-0', rail === undefined ? 'w-64' : 'w-[19rem]')}
      flush={rail !== undefined}
      initialFocus={inputRef}
      {...(tooltip !== undefined ? { tooltip } : {})}
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
            fullWidth
              ? 'flex w-full items-center justify-between gap-2'
              : 'inline-flex flex-none items-center gap-1.5',
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
          {/* Glyph and label travel together so a full-width trigger spreads THEM against
              the caret, not the glyph against the label. */}
          <span className="flex min-w-0 items-center gap-1.5">
            {triggerLeading}
            <span className="truncate">{triggerLabel ?? current}</span>
          </span>
          <span aria-hidden>▾</span>
        </button>
      }
    >
      <div className="flex items-stretch">
        {rail !== undefined && (
          // Spans the whole card — filter, list and footer — because a scope governs all
          // three. `mousedown` is swallowed so the filter input keeps the caret: scoping
          // and typing are one continuous narrowing, not two modes.
          <div
            role="group"
            aria-label={rail.label}
            // A step below the surface it sits on: the rail is chrome the list rests
            // against, and recessing it is how every other rail in the console reads.
            className="flex w-12 flex-none flex-col gap-1 border-r border-s4 bg-s2 p-1.5"
          >
            {rail.items.map((item) => (
              // Glyph-only, so the name has to arrive on hover — through the kit's
              // tooltip, never a native `title` the OS would draw in its own skin.
              <Tooltip key={item.id} label={item.label} side="right">
                <button
                  type="button"
                  aria-label={item.label}
                  aria-pressed={item.id === rail.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => rail.onChange(item.id)}
                  className={cx(
                    'slip slip-press flex h-9 w-9 cursor-pointer items-center justify-center rounded-r2 active:scale-[0.95]',
                    item.id === rail.value
                      ? 'bg-s4 text-s12'
                      : 'text-s9 opacity-60 hover:bg-s4 hover:text-s11 hover:opacity-100',
                  )}
                >
                  {item.leading}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
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
          <div
            role="listbox"
            id={listId}
            aria-label={ariaLabel}
            // Under a rail the list is a FIXED box, not a box that fits its rows: scoping
            // is a lateral move between slices of one set, and a popup that resized on
            // every click would throw the rail out from under the cursor that was using it.
            className={cx('overflow-y-auto', rail === undefined ? 'max-h-64' : 'h-64')}
          >
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
      </div>
    </PopoverCard>
  );
}

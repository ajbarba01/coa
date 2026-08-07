import { useEffect, useMemo, useState } from 'react';
import { PopoverCard, cx } from '@coa/console-kit';
import { TextInput } from './fields.js';
import { SetRow, type Membership } from './resolvedSet.js';

export interface AddPickerItem {
  id: string;
  name: string;
  description?: string;
  membership: Membership;
}

export interface AddPickerProps {
  /** The trigger's visible text, e.g. 'Add Context'. Also the popup's accessible name. */
  label: string;
  items: AddPickerItem[];
  onToggle: (id: string) => void;
  /** The filter field's placeholder. */
  placeholder: string;
}

/** Pure: the items a query names — matches the name, case-insensitively. A blank
 *  (including whitespace-only) query is "no filter", so opening shows everything. */
export function filterAddPickerItems(
  items: readonly AddPickerItem[],
  query: string,
): AddPickerItem[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...items];
  return items.filter((i) => i.name.toLowerCase().includes(q));
}

/**
 * The registry-search overlay this redesign moves "everything available" into: an
 * anchored `PopoverCard`, never a modal, so the agent form it hangs off of stays
 * visible behind it. Every row is a `SetRow`, so an item already in the agent wears
 * its real membership here too — the overlay never lies that the registry has yet
 * to see something the agent already carries.
 *
 * STICKY by design: toggling a row does not close the popover. Adding five
 * packages is one visit and five clicks, not five round trips through the trigger —
 * the entire reason this is faster than a flat checkbox list.
 */
export function AddPicker({
  label,
  items,
  onToggle,
  placeholder,
}: AddPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const filtered = useMemo(() => filterAddPickerItems(items, query), [items, query]);

  // The cursor tracks the filtered list, not the raw items — retyping always
  // re-lands on the first hit rather than an index into a list that shrank.
  useEffect(() => {
    setCursor(0);
  }, [query]);

  function openPopover(): void {
    setQuery('');
    setOpen(true);
  }

  function toggleCursor(): void {
    const picked = filtered[cursor];
    if (picked !== undefined) onToggle(picked.id);
  }

  return (
    <PopoverCard
      open={open}
      onOpenChange={(next) => (next ? openPopover() : setOpen(false))}
      side="bottom"
      align="start"
      className="w-72 p-0"
      trigger={
        // The composer's chip vocabulary (border + ground + press), not a bare text
        // button: adding to a set is an affordance, and the unbordered version read as
        // a link sitting loose among the rows.
        <button
          type="button"
          className="slip slip-press w-fit cursor-pointer rounded-r2 border border-s5 bg-s4 px-2 py-1 font-mono text-code text-s9 hover:bg-s5 hover:text-s12 active:scale-[0.97]"
        >
          {label}
        </button>
      }
    >
      <div
        className="flex flex-col"
        // ArrowUp/ArrowDown move the cursor; Enter toggles the row under it WITHOUT
        // closing (the sticky contract above). Escape is left alone: neither this
        // handler nor `TextInput` (no `onCancel` passed) stops it, so it bubbles to
        // the kit's dismiss-layer stack that `PopoverCard` already registers — the
        // one Escape authority.
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(c + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(c - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            toggleCursor();
          }
        }}
      >
        <div className="border-b border-s4 px-2 py-1.5">
          <TextInput autoFocus value={query} onChange={setQuery} placeholder={placeholder} />
        </div>
        {/* `group`, not `listbox`: a listbox's ARIA contract expects `option` children,
            but each row here is a real `checkbox` (SetRow's own role) — `group`
            is the container role that stays valid over arbitrary widget children while
            still giving the row list one announced name, matching what Combobox's
            listbox does for its own (option-shaped) rows. */}
        <div role="group" aria-label={label} className="max-h-64 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-sec text-s7">No match</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                onMouseEnter={() => setCursor(i)}
                // `SetRow` renders a real, Tab-reachable button — DOM focus can land
                // here independently of the mouse, so the cursor follows focus too.
                // Without this, Enter (routed through the cursor below) and Space
                // (the button's own native activation) could disagree about which
                // row they act on.
                onFocus={() => setCursor(i)}
                className={cx('rounded-r2', i === cursor && 'bg-s3')}
              >
                <SetRow
                  name={item.name}
                  {...(item.description !== undefined ? { description: item.description } : {})}
                  membership={item.membership}
                  onToggle={() => onToggle(item.id)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </PopoverCard>
  );
}

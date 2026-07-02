import type { ReactNode } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { DropdownMenu } from 'radix-ui';
import { Check, Pin, Search, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface SwitcherOption {
  id: string;
  label: string;
  /** Quiet right-aligned metadata (a relative time, a count). */
  meta?: string | undefined;
  /** Leading visual (an AgentChip, an Icon). */
  leading?: ReactNode | undefined;
  selected?: boolean | undefined;
  /** Drives the pin toggle (shown only when `onTogglePin` is provided). */
  pinned?: boolean | undefined;
}

export interface SwitcherAction {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface SwitcherGroup {
  id: string;
  /** Eyebrow group label; omit for an unlabelled group. */
  label?: string | undefined;
  /** Rich leading content beside the group label (e.g. the agent's chip). */
  labelLeading?: ReactNode | undefined;
  options: SwitcherOption[];
  /** Action rows rendered after the group's options (e.g. "+ New session"). */
  actions?: SwitcherAction[] | undefined;
}

export interface SwitcherMenuProps {
  /** The closed control (compose a Button/IconButton). */
  trigger: ReactNode;
  groups: SwitcherGroup[];
  onSelect: (optionId: string) => void;
  onAction?: (actionId: string) => void;
  /** Accessible name for the menu. */
  label: string;
  /** Adds a filter input at the top that narrows options across all groups by label
   *  (case-insensitive). Emptied groups drop out; action rows always stay. */
  searchable?: boolean;
  /** Opens on pointer-enter of the trigger (closes when the pointer leaves both the
   *  trigger and the menu). Click still toggles; keyboard is unaffected. */
  openOnHover?: boolean;
  /** When set, each option carries a pin toggle (brass when `option.pinned`). Toggling
   *  it neither selects the row nor closes the menu. */
  onTogglePin?: (optionId: string) => void;
  /** When set, each option carries a hover-revealed delete button. Deleting neither
   *  selects the row nor closes the menu. */
  onDelete?: (optionId: string) => void;
}

// Full-bleed rows: the hover/highlight/selected tint spans the whole menu width (the
// content drops its horizontal padding; rows carry their own inset + no rounding).
const itemClass =
  'flex cursor-default items-center gap-2 px-2.5 py-1.5 outline-none hover:bg-element-hover data-[highlighted]:bg-element-hover data-[disabled]:opacity-50';

/** Case-insensitive label filter; groups with no surviving options are dropped, but a
 *  group kept only for its action rows (e.g. "New session") stays. */
function filterGroups(groups: SwitcherGroup[], query: string): SwitcherGroup[] {
  const q = query.trim().toLowerCase();
  const matched = groups.map((g) => ({
    ...g,
    options: q === '' ? g.options : g.options.filter((o) => o.label.toLowerCase().includes(q)),
  }));
  return matched.filter((g) => g.options.length > 0 || (g.actions?.length ?? 0) > 0);
}

/** A grouped switcher dropdown with rich rows — the picker pattern shared by the
 *  agent picker and the session switcher. Selecting only switches; editing an
 *  entity happens on its surface, never inside the menu. Optionally filterable
 *  (`searchable`) and hover-opening (`openOnHover`). */
export function SwitcherMenu({
  trigger,
  groups,
  onSelect,
  onAction,
  label,
  searchable = false,
  openOnHover = false,
  onTogglePin,
  onDelete,
}: SwitcherMenuProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Grace timer so a diagonal slide from trigger to menu doesn't flicker it closed.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A hover-opened menu that the user has clicked into becomes "pinned": it no longer
  // closes on pointer-leave, only on an outside-click / Escape / select.
  const pinned = useRef(false);

  // Focus the filter on open, EXCEPT for a hover-opened menu (stealing focus on a
  // passing hover is jarring). DropdownMenu.Content has no onOpenAutoFocus, so claim
  // focus a frame later, after Radix settles the first item.
  useEffect(() => {
    if (!open || !searchable || openOnHover) return;
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, searchable, openOnHover]);

  const visible = useMemo(
    () =>
      searchable
        ? filterGroups(groups, query)
        : groups.filter((g) => g.options.length > 0 || (g.actions?.length ?? 0) > 0),
    [groups, query, searchable],
  );

  const setOpenState = (next: boolean): void => {
    clearTimeout(closeTimer.current);
    setOpen(next);
    if (!next) {
      setQuery('');
      pinned.current = false;
    }
  };
  const hoverOpen = (): void => {
    if (openOnHover) setOpenState(true);
  };
  const hoverClose = (): void => {
    if (!openOnHover || pinned.current) return;
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  // A click on a hover-opened trigger pins it open (and must not let Radix toggle it
  // shut on that same click). A pointer-down anywhere inside the menu pins it too.
  const pin = (): void => {
    pinned.current = true;
  };
  const onTriggerPointerDown = (e: React.PointerEvent): void => {
    if (!openOnHover) return;
    pinned.current = true;
    if (open) e.preventDefault();
  };
  // In a searchable menu the filter box owns focus. Radix otherwise (a) focuses the
  // item under the pointer on enter and (b) refocuses the menu container when the
  // pointer leaves an item — both yank focus off the input mid-type. preventDefault on
  // the item's pointer-move AND pointer-leave suppresses both (composeEventHandlers
  // skips Radix's handler once defaultPrevented). Hover feedback rides CSS `:hover`.
  const keepSearchFocus = searchable
    ? (e: React.PointerEvent): void => e.preventDefault()
    : undefined;

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={setOpenState}
      // Non-modal when hover-opening so moving to the menu (and the rest of the app)
      // stays interactive; outside-click / Escape still close via onOpenChange.
      modal={!openOnHover}
    >
      <DropdownMenu.Trigger
        asChild
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
        onPointerDown={onTriggerPointerDown}
      >
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          aria-label={label}
          sideOffset={4}
          align="start"
          onPointerDown={pin}
          onPointerEnter={() => clearTimeout(closeTimer.current)}
          onPointerLeave={hoverClose}
          className="overlay-content z-[200] max-h-96 min-w-56 overflow-y-auto rounded-surface border border-border-default bg-raised py-1 text-body text-fg shadow-lg"
        >
          {searchable && (
            <div className="flex items-center gap-2 border-b border-hairline px-2.5 pb-1.5 pt-0.5">
              <Icon name={Search} size={13} className="shrink-0 text-faint" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                aria-label={`Filter ${label}`}
                placeholder="Search…"
                onKeyDown={(e) => {
                  // Arrows move into the list (then Radix's roving takes over), so the
                  // keyboard still drives the options while typing to filter.
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    const menu = e.currentTarget.closest('[role="menu"]');
                    const rows = menu
                      ? [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
                      : [];
                    if (rows.length > 0) {
                      e.preventDefault();
                      e.stopPropagation();
                      (e.key === 'ArrowDown' ? rows[0] : rows[rows.length - 1])?.focus();
                    }
                    return;
                  }
                  // Enter commits the first match; otherwise keep letter keys local so
                  // they type here instead of triggering Radix's menu typeahead.
                  if (e.key === 'Enter') {
                    const first = visible.flatMap((g) => g.options)[0];
                    if (first) {
                      e.preventDefault();
                      onSelect(first.id);
                      setOpenState(false);
                    }
                    return;
                  }
                  e.stopPropagation();
                }}
                onChange={(e) => setQuery(e.target.value)}
                className={cx(
                  'h-control-sm w-full rounded-control bg-transparent text-body text-fg placeholder:text-faint',
                  focusRing,
                )}
              />
            </div>
          )}
          {visible.length === 0 && (
            <div className="px-2.5 py-2 text-caption text-faint">No matches</div>
          )}
          {visible.map((group, gi) => (
            <Fragment key={group.id}>
              {gi > 0 && <DropdownMenu.Separator className="my-1 h-px bg-hairline" />}
              {(group.label !== undefined || group.labelLeading !== undefined) && (
                <DropdownMenu.Label className="flex items-center gap-2 px-2.5 pb-1 pt-1.5 text-eyebrow font-semibold uppercase tracking-[0.06em] text-faint">
                  {group.labelLeading}
                  {group.label}
                </DropdownMenu.Label>
              )}
              {group.options.map((opt) => (
                <DropdownMenu.Item
                  key={opt.id}
                  onSelect={() => onSelect(opt.id)}
                  onPointerMove={keepSearchFocus}
                  onPointerLeave={keepSearchFocus}
                  className={cx(
                    itemClass,
                    'group/opt',
                    opt.selected === true && 'bg-element-active',
                  )}
                >
                  {opt.leading}
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {onTogglePin !== undefined && (
                    <button
                      type="button"
                      aria-label={opt.pinned === true ? `Unpin ${opt.label}` : `Pin ${opt.label}`}
                      aria-pressed={opt.pinned === true}
                      // Stop the click from bubbling to the row (Radix selects + closes
                      // on the item's click); let pointer-down through so Radix doesn't
                      // synthesize a select on pointer-up.
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onTogglePin(opt.id);
                      }}
                      className={cx(
                        'flex w-6 shrink-0 items-center justify-center self-stretch rounded-control hover:bg-element-hover',
                        opt.pinned === true
                          ? 'text-accent'
                          : 'text-faint opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/opt:opacity-100',
                        focusRing,
                      )}
                    >
                      <Icon name={Pin} size={14} />
                    </button>
                  )}
                  <span className={cx('w-3.5 shrink-0', opt.selected !== true && 'invisible')}>
                    <Icon name={Check} size={13} className="text-accent" />
                  </span>
                  {/* Far-right meta (e.g. a session's time). When the row also carries a
                      delete, the trash overlays the same slot on hover and the meta fades
                      out, so the time gives way to the trash in place. */}
                  {(opt.meta !== undefined || onDelete !== undefined) && (
                    <span className="relative flex shrink-0 items-center justify-end self-stretch">
                      {opt.meta !== undefined && (
                        <span
                          className={cx(
                            'text-caption text-faint',
                            onDelete !== undefined && 'group-hover/opt:opacity-0',
                          )}
                        >
                          {opt.meta}
                        </span>
                      )}
                      {onDelete !== undefined && (
                        <button
                          type="button"
                          aria-label={`Delete ${opt.label}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onDelete(opt.id);
                          }}
                          className={cx(
                            'absolute inset-y-0 right-0 flex w-6 items-center justify-center rounded-control text-faint opacity-0 hover:bg-element-hover hover:text-danger focus-visible:opacity-100 group-hover/opt:opacity-100',
                            focusRing,
                          )}
                        >
                          <Icon name={Trash2} size={14} />
                        </button>
                      )}
                    </span>
                  )}
                </DropdownMenu.Item>
              ))}
              {(group.actions ?? []).map((action) => (
                <DropdownMenu.Item
                  key={action.id}
                  onSelect={() => onAction?.(action.id)}
                  onPointerMove={keepSearchFocus}
                  onPointerLeave={keepSearchFocus}
                  className={cx(itemClass, 'text-muted data-[highlighted]:text-fg')}
                >
                  {action.icon !== undefined && <Icon name={action.icon} size={14} />}
                  {action.label}
                </DropdownMenu.Item>
              ))}
            </Fragment>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

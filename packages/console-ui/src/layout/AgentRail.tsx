import { useRef, useState } from 'react';
import { ContextMenu } from 'radix-ui';
import {
  ChevronsLeft,
  ChevronsRight,
  MessageSquarePlus,
  Pin,
  PinOff,
  Settings2,
} from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import {
  AGENT_SOLID_CLASSES,
  AgentChip,
  type AgentColorName,
  type AgentIconName,
} from '../data/AgentChip.js';

export interface AgentRailItem {
  id: string;
  name: string;
  icon: AgentIconName;
  color: AgentColorName;
  pinned?: boolean | undefined;
}

export interface AgentRailProps {
  /** In display order — pinned first is the caller's contract. */
  items: AgentRailItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNewSession?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onConfigure?: (id: string) => void;
  label?: string;
  /** Which edge the icon column pins to; the names reveal toward the interior. The
   *  chat pane anchors it right so icons sit at the window edge and text slides
   *  inward. Default 'right'. */
  side?: 'left' | 'right';
}

const menuItemClass =
  'flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none data-[highlighted]:bg-element-hover';

/** The per-agent context menu (right-click), carrying every non-select action —
 *  new session, pin/unpin, configure — so the row itself is a single select target. */
function RailItemMenu({
  item,
  children,
  onNewSession,
  onTogglePin,
  onConfigure,
}: {
  item: AgentRailItem;
  children: React.ReactNode;
  onNewSession?: ((id: string) => void) | undefined;
  onTogglePin?: ((id: string) => void) | undefined;
  onConfigure?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="overlay-content z-[200] min-w-44 rounded-surface border border-border-default bg-raised p-1 text-body text-fg shadow-lg">
          {onNewSession !== undefined && (
            <ContextMenu.Item className={menuItemClass} onSelect={() => onNewSession(item.id)}>
              <Icon name={MessageSquarePlus} size={14} />
              New session
            </ContextMenu.Item>
          )}
          {onTogglePin !== undefined && (
            <ContextMenu.Item className={menuItemClass} onSelect={() => onTogglePin(item.id)}>
              <Icon name={item.pinned === true ? PinOff : Pin} size={14} />
              {item.pinned === true ? 'Unpin' : 'Pin'}
            </ContextMenu.Item>
          )}
          {onConfigure !== undefined && (
            <ContextMenu.Item className={menuItemClass} onSelect={() => onConfigure(item.id)}>
              <Icon name={Settings2} size={14} />
              Configure
            </ContextMenu.Item>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The chat pane's agent drawer: one contiguous panel that shows only agent icons
 *  collapsed and grows along its interior edge on hover/focus to reveal each agent's
 *  name — icons stay pinned to the window edge, the transcript never reflows (the
 *  panel is absolutely positioned and clips), and each row is a single button so its
 *  icon and name highlight together. Selecting collapses the drawer and keeps it
 *  collapsed until the pointer leaves and re-enters the column. Pin/new-session/
 *  configure live in the right-click menu; a pinned agent shows a brass pin. */
export function AgentRail({
  items,
  activeId,
  onSelect,
  onNewSession,
  onTogglePin,
  onConfigure,
  label = 'Agents',
  side = 'right',
}: AgentRailProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  // After a select the drawer stays collapsed until the pointer actually leaves the
  // column and comes back (a fresh pointer-enter), so it doesn't spring back open
  // under the cursor.
  const suppressed = useRef(false);
  const collapse = (): void => setExpanded(false);

  /** Roving arrows across the agent rows. */
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      collapse();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLButtonElement)) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-rail-item]')];
    const at = buttons.indexOf(focused);
    if (at === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    buttons[(next + buttons.length) % buttons.length]?.focus();
  };

  const select = (id: string): void => {
    onSelect(id);
    suppressed.current = true;
    setExpanded(false);
  };

  const right = side === 'right';

  return (
    <div
      role="group"
      aria-label={label}
      className="relative h-full w-14 shrink-0"
      onPointerEnter={() => {
        if (!suppressed.current) setExpanded(true);
      }}
      onPointerLeave={() => {
        suppressed.current = false;
        setExpanded(false);
      }}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) collapse();
      }}
      onKeyDown={onKeyDown}
    >
      {/* One panel: collapsed it is the 44px icon column; expanded it grows along its
          interior edge over the transcript (transform-free width tween, so the icons
          on the pinned edge never move). */}
      <div
        data-expanded={expanded ? 'true' : 'false'}
        className={cx(
          'absolute inset-y-0 z-30 flex flex-col gap-0.5 overflow-hidden bg-subtle py-1.5 transition-[width] duration-fast',
          right ? 'right-0 border-l border-hairline' : 'left-0 border-r border-hairline',
          expanded ? 'w-56 shadow-lg' : 'w-14',
          expanded && (right ? 'rounded-l-surface' : 'rounded-r-surface'),
        )}
      >
        {/* Slide-out affordance: a faint double-chevron pointing the way the drawer
            opens (toward the interior); it flips to point back once expanded. Held in a
            column-width box so it sits above the icons at either anchor edge. */}
        <div
          className={cx('flex h-6 w-14 shrink-0 items-center justify-center', right && 'self-end')}
        >
          <Icon
            name={right ? ChevronsLeft : ChevronsRight}
            size={14}
            aria-hidden
            className={cx(
              'text-faint transition-transform duration-fast',
              expanded && 'rotate-180',
            )}
          />
        </div>
        {items.map((item) => {
          const active = item.id === activeId;
          const chip = (
            <span className="grid h-9 w-9 shrink-0 place-items-center">
              <AgentChip icon={item.icon} color={item.color} size="md" />
            </span>
          );
          const pinnable = onTogglePin !== undefined && expanded;
          return (
            // The row highlights as one full-width band (like the dropdown rows); the pin
            // overlays the interior end on top of the button so a pin click never selects.
            <div key={item.id} className="group/row relative flex items-center">
              <RailItemMenu
                item={item}
                onNewSession={onNewSession}
                onTogglePin={onTogglePin}
                onConfigure={onConfigure}
              >
                <button
                  type="button"
                  data-rail-item
                  aria-label={item.name}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => select(item.id)}
                  className={cx(
                    'relative flex h-10 w-full min-w-0 shrink-0 items-center gap-2 rounded-control px-2.5',
                    pinnable && (right ? 'pl-9' : 'pr-9'),
                    active
                      ? 'bg-element-active text-fg'
                      : 'text-muted hover:bg-element-hover hover:text-fg',
                    focusRing,
                  )}
                >
                  {active && (
                    <span
                      aria-hidden
                      className={cx(
                        'absolute inset-y-1.5 w-0.75 rounded-full',
                        right ? 'right-0' : 'left-0',
                        AGENT_SOLID_CLASSES[item.color],
                      )}
                    />
                  )}
                  {!right && chip}
                  <span className="min-w-0 flex-1 truncate text-left text-label">{item.name}</span>
                  {right && chip}
                </button>
              </RailItemMenu>
              {/* Pin toggle — brass when pinned, otherwise revealed on row hover/focus.
                  Absolutely overlaid on the interior end so the row still reads (and
                  highlights) as one unit; a pin click lands on the pin, never the row. */}
              {pinnable && (
                <button
                  type="button"
                  aria-label={item.pinned === true ? `Unpin ${item.name}` : `Pin ${item.name}`}
                  aria-pressed={item.pinned === true}
                  onClick={() => onTogglePin(item.id)}
                  className={cx(
                    // Full row-height hitbox (inset-y-0 = the h-10 row), same as the agent
                    // button beside it, so the two targets sit flush in one 40px band.
                    'absolute inset-y-0 flex w-10 items-center justify-center rounded-control hover:bg-element-active',
                    right ? 'left-0.5' : 'right-0.5',
                    item.pinned === true
                      ? 'text-accent'
                      : 'text-faint opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/row:opacity-100',
                    focusRing,
                  )}
                >
                  <Icon name={Pin} size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

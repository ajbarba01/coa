import { Popover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { useRef } from 'react';
import { cx } from '../cx.js';
import { menuSurface, menuSurfaceFlush } from './MenuCard.js';
import { TooltipSurface, type TooltipSpec } from './Tooltip.js';
import { useDismissLayer, useExclusivePopover } from './layers.js';

export interface PopoverCardProps {
  /** The anchor element (a chip/button); Base UI merges its trigger props onto it. */
  trigger: React.ReactElement<Record<string, unknown>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Anchor at a POINT instead of the trigger — the context-menu opening (a right-click
   *  menu belongs under the cursor, not wherever its button happens to sit). The trigger
   *  still owns the open state; only the positioning moves. */
  anchorPoint?: { x: number; y: number } | undefined;
  className?: string;
  /** Drop the surface's own vertical padding — for a popup whose children run edge to edge
   *  and have to reach its rounded ends. Each region then carries its own padding. */
  flush?: boolean;
  /** What the popup should focus when it opens. Base UI's default is the first TABBABLE
   *  element, which is a positional accident — a popup whose real entry point sits behind
   *  some chrome (a filter input beside a rail of buttons) has to name it. */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Hover/focus detail on the trigger (icon-only chips) — the tooltip closes
   *  itself when the popover opens (Base UI's trigger-press reason). */
  tooltip?: TooltipSpec;
  children?: React.ReactNode;
}

/** A Base UI popover wearing the kit's menu-surface skin. Controlled, and
 *  registered on the kit's Escape layer stack so app-mode ordering holds
 *  (see the overlay contract). Base UI owns positioning + outside-press. */
export function PopoverCard({
  trigger,
  open,
  onOpenChange,
  side = 'top',
  align = 'end',
  sideOffset = 6,
  anchorPoint,
  className,
  flush = false,
  initialFocus,
  tooltip,
  children,
}: PopoverCardProps): React.JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null);
  useDismissLayer(open, () => onOpenChange(false));
  // One open menu app-wide: opening this popover closes whichever was open before it.
  // The popup ref lets a sub-layer (the edit menu on a field in here) spare this one.
  useExclusivePopover(open, () => onOpenChange(false), { rootRef: popupRef });
  // Base UI takes a virtual element: a zero-size rect at the point.
  const anchor =
    anchorPoint === undefined
      ? undefined
      : { getBoundingClientRect: () => new DOMRect(anchorPoint.x, anchorPoint.y, 0, 0) };
  const core = (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // The kit's layer stack is the ONE Escape authority. Base UI's own
        // document-level Escape close would bypass it and double-close when a
        // bespoke layer stacks above — so swallow that close (the stack issues
        // it when this popover is topmost) and let the keydown keep bubbling to
        // the stack's window listener, which Base UI would otherwise stop.
        if (!next && details.reason === 'escape-key') {
          details.allowPropagation();
          return;
        }
        onOpenChange(next);
      }}
    >
      {/* With a tooltip, both triggers stack render props so one element
          carries the popover AND tooltip wiring (Base UI's documented
          composition). */}
      <Popover.Trigger
        render={tooltip === undefined ? trigger : <BaseTooltip.Trigger render={trigger} />}
      />
      <Popover.Portal>
        <Popover.Positioner
          side={side}
          align={align}
          sideOffset={sideOffset}
          {...(anchor === undefined ? {} : { anchor })}
          className="z-(--z-dropdown)"
        >
          <Popover.Popup
            ref={popupRef}
            className={cx('slip-enter', flush ? menuSurfaceFlush : menuSurface, className)}
            {...(initialFocus === undefined ? {} : { initialFocus })}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
  if (tooltip === undefined) return core;
  return (
    <BaseTooltip.Root>
      {core}
      <TooltipSurface {...tooltip} />
    </BaseTooltip.Root>
  );
}

import { Popover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cx } from '../cx.js';
import { menuSurface } from './MenuCard.js';
import { TooltipSurface, type TooltipSpec } from './Tooltip.js';
import { useDismissLayer } from './layers.js';

export interface PopoverCardProps {
  /** The anchor element (a chip/button); Base UI merges its trigger props onto it. */
  trigger: React.ReactElement<Record<string, unknown>>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  className?: string;
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
  className,
  tooltip,
  children,
}: PopoverCardProps): React.JSX.Element {
  useDismissLayer(open, () => onOpenChange(false));
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
          className="z-(--z-dropdown)"
        >
          <Popover.Popup className={cx('slip-enter', menuSurface, className)}>
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

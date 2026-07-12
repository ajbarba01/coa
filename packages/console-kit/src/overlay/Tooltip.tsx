import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import { cx } from '../cx.js';
import { Kbd } from '../keys/Kbd.js';

/** What a tooltip says — shared by `Tooltip` and `PopoverCard`'s `tooltip` prop. */
export interface TooltipSpec {
  /** What the control does — names the icon, never restates visible text. */
  label: string;
  /** The control's registry keybind, rendered as kbd chips after the label. */
  keys?: string[] | undefined;
  side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
}

export interface TooltipProps extends TooltipSpec {
  /** The trigger element; Base UI merges hover/focus/aria wiring onto it. */
  children: React.ReactElement<Record<string, unknown>>;
}

/** The floating popup itself (portal + positioner + skin). Internal seam:
 *  must render inside a BaseTooltip.Root — `Tooltip` and `PopoverCard` are
 *  the two hosts. */
export function TooltipSurface({
  label,
  keys,
  side = 'bottom',
  align = 'center',
}: TooltipSpec): React.JSX.Element {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} align={align} sideOffset={6} className="z-(--z-tooltip)">
        <BaseTooltip.Popup
          // Base UI leans on aria-describedby alone; the explicit ARIA role is
          // still correct and keeps the popup queryable.
          role="tooltip"
          className={cx(
            'slip-enter flex items-center gap-1.5 rounded-r2 border border-s5 bg-s3',
            'px-2 py-1 text-meta whitespace-nowrap text-s10 shadow-float',
          )}
        >
          {label}
          {keys !== undefined && keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  );
}

/** Hover/focus detail for icon-only controls (indicator law: detail is
 *  proximity). Base UI owns the open logic — delay comes from the shared
 *  TooltipProvider so adjacent tooltips warm-open instantly — and the popup
 *  wears the floating-surface skin at the tooltip z. NOT a dismiss layer:
 *  a tooltip is passive detail, so Escape must fall through to real layers. */
export function Tooltip({ children, ...spec }: TooltipProps): React.JSX.Element {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <TooltipSurface {...spec} />
    </BaseTooltip.Root>
  );
}

/** One provider near the app root: the shared open delay + the warm window
 *  (moving between adjacent tooltipped controls shows the next one instantly). */
export function TooltipProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <BaseTooltip.Provider delay={600} closeDelay={0} timeout={400}>
      {children}
    </BaseTooltip.Provider>
  );
}

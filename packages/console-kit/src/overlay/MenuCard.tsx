import { cx } from '../cx.js';

/** The floating option surface with NO padding of its own — for a popup whose regions run
 *  edge to edge (a rail, a full-bleed header), which must reach the rounded ends. Split out
 *  rather than overridden by the caller: both paddings would be emitted and the cascade
 *  would settle it by value order, which is nobody's decision. */
export const menuSurfaceFlush = 'overflow-hidden rounded-r3 border border-s5 bg-s3 shadow-float';

/** The floating option surface — one skin for every popup (bespoke cards, Base UI
 *  popovers, the select). */
export const menuSurface = `${menuSurfaceFlush} py-1`;

export function MenuCard({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div className={cx('slip-enter', menuSurface, className)} {...rest}>
      {children}
    </div>
  );
}

export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected = s4 tint + the trailing mono `Current` marker (one vocabulary everywhere). */
  selected?: boolean;
}

export function MenuItem({
  selected = false,
  disabled = false,
  type = 'button',
  className,
  children,
  ...rest
}: MenuItemProps): React.JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cx(
        'slip flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sec',
        disabled
          ? 'cursor-default text-s6'
          : selected
            ? 'cursor-pointer bg-s4 text-s12'
            : 'cursor-pointer text-s9 hover:bg-s4 hover:text-s11',
        className,
      )}
      {...rest}
    >
      {children}
      {selected && (
        <span className="ml-auto pl-4 font-mono text-caps tracking-normal text-s7">Current</span>
      )}
    </button>
  );
}

/** The 10px tracked-caps section header (menus, sidebars, dialogs). */
export function CapsLabel({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={cx('px-3 pt-2 pb-0.5 text-caps tracking-[0.07em] text-s6 uppercase', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

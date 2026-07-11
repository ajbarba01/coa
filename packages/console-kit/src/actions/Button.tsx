import { cx } from '../cx.js';

export type ButtonVariant = 'primary' | 'quiet' | 'outline' | 'block' | 'ghost' | 'text';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: the accent action (one per view at most) · quiet: the solid workhorse ·
   *  outline: secondary/deny · block: raised square utility · ghost: chrome-adjacent icon ·
   *  text: ink-only toolbar control. */
  variant?: ButtonVariant;
  /** Square icon geometry instead of text padding. */
  icon?: boolean;
}

/** Look per variant. `on` carries hover + press (Slipstream); `off` is the disabled
 *  face — no hover, no press, no pointer (the graduation checklist's rule). */
const FACE: Record<ButtonVariant, { on: string; off: string }> = {
  primary: {
    on: 'slip slip-press cursor-pointer rounded-r2 bg-run font-semibold text-s12 hover:brightness-110',
    off: 'cursor-default rounded-r2 border border-s4 text-s6',
  },
  quiet: {
    on: 'slip slip-press cursor-pointer rounded-r1 border border-s6 bg-s5 font-[550] text-s12 hover:bg-s6',
    off: 'cursor-default rounded-r1 border border-s4 bg-s3 text-s6',
  },
  outline: {
    on: 'slip slip-press cursor-pointer rounded-r1 border border-s4 text-s8 hover:border-s6 hover:text-s11',
    off: 'cursor-default rounded-r1 border border-s3 text-s6',
  },
  block: {
    on: 'slip slip-press cursor-pointer rounded-r2 border border-s5 bg-s4 text-s10 hover:bg-s5 hover:text-s12',
    off: 'cursor-default rounded-r2 border border-s4 bg-s3 text-s6',
  },
  ghost: {
    on: 'slip cursor-pointer rounded-r2 text-s8 hover:bg-s3 hover:text-s10',
    off: 'cursor-default rounded-r2 text-s6',
  },
  text: {
    on: 'slip cursor-pointer font-mono text-s9 hover:text-s11',
    off: 'cursor-default font-mono text-s6',
  },
};

const PRESS: Record<ButtonVariant, string> = {
  primary: 'active:scale-[0.97]',
  quiet: 'active:scale-[0.97]',
  outline: 'active:scale-[0.97]',
  block: 'active:scale-[0.95]',
  ghost: '',
  text: '',
};

const GEOM: Record<ButtonVariant, { text: string; icon: string }> = {
  primary: { text: 'px-4 py-1.5 text-sec', icon: 'flex h-7 w-7 items-center justify-center text-body' },
  quiet: { text: 'px-3 py-1 text-code', icon: 'flex h-7 w-7 items-center justify-center text-code' },
  outline: { text: 'px-3 py-1 text-code', icon: 'flex h-7 w-7 items-center justify-center text-code' },
  block: { text: 'px-3 py-1 text-code', icon: 'flex h-7 w-7 items-center justify-center' },
  ghost: { text: 'px-2 py-1 text-sec', icon: 'flex h-8 w-8 items-center justify-center text-icon' },
  text: { text: 'text-meta', icon: 'text-meta' },
};

export function Button({
  variant = 'quiet',
  icon = false,
  disabled = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  // Square icon buttons press a touch deeper — the smaller face needs the larger delta to read.
  const press = icon && PRESS[variant] !== '' ? 'active:scale-[0.95]' : PRESS[variant];
  const face = disabled ? FACE[variant].off : cx(FACE[variant].on, press);
  return (
    <button
      type={type}
      disabled={disabled}
      className={cx(face, icon ? GEOM[variant].icon : GEOM[variant].text, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

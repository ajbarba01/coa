import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Slot } from 'radix-ui';
import { cx, focusRing } from '../lib/cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and blocks interaction. */
  loading?: boolean;
  /** Render as the single child element (e.g. an anchor) instead of <button>. */
  asChild?: boolean;
  children?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-control border font-medium select-none ' +
  'transition-[background-color,border-color,color] duration-fast disabled:opacity-50 disabled:pointer-events-none';

const bySize: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3.5 text-[13px]',
};

const byVariant: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-on-accent border-transparent hover:bg-accent-hover active:bg-accent-hover',
  secondary:
    'bg-element text-fg border-border-default hover:bg-element-hover active:bg-element-active',
  tertiary:
    'bg-transparent text-fg border-transparent hover:bg-element-hover active:bg-element-active',
  danger: 'bg-danger text-on-accent border-transparent hover:opacity-90 active:opacity-100',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  disabled,
  type,
  className,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'button';
  const isDisabled = disabled === true || loading;
  return (
    <Comp
      // native <button> gets a type; a Slot child (e.g. anchor) must not receive one
      {...(asChild ? {} : { type: type ?? 'button' })}
      data-variant={variant}
      data-size={size}
      data-loading={loading ? 'true' : undefined}
      aria-busy={loading || undefined}
      disabled={asChild ? undefined : isDisabled}
      data-disabled={isDisabled ? 'true' : undefined}
      className={cx(base, bySize[size], byVariant[variant], focusRing, className)}
      {...rest}
    >
      {children}
    </Comp>
  );
}

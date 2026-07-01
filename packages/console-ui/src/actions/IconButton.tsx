import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { ButtonVariant, ButtonSize } from './Button.js';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  icon: LucideIcon;
  /** Required — the icon has no visible text. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const bySize: Record<ButtonSize, string> = {
  sm: 'h-control-sm w-control-sm',
  md: 'h-control-md w-control-md',
};
const byVariant: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover',
  secondary: 'bg-element text-fg border border-border-default hover:bg-element-hover',
  tertiary: 'bg-transparent text-fg hover:bg-element-hover',
  danger: 'bg-danger text-on-accent hover:opacity-90',
};

export function IconButton({
  icon,
  label,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  type,
  className,
  ...rest
}: IconButtonProps): React.JSX.Element {
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      aria-busy={loading || undefined}
      data-variant={variant}
      data-loading={loading ? 'true' : undefined}
      disabled={isDisabled}
      className={cx(
        'inline-flex items-center justify-center rounded-control transition-[color,background-color,transform] duration-fast active:scale-95 data-[state=open]:scale-95 disabled:opacity-50 disabled:pointer-events-none',
        bySize[size],
        byVariant[variant],
        focusRing,
        className,
      )}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 14 : 16} />
    </button>
  );
}

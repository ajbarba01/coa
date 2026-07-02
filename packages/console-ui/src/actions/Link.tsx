import type { AnchorHTMLAttributes } from 'react';
import { cx, focusRing } from '../lib/cx.js';

export type LinkTone = 'default' | 'muted';

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  tone?: LinkTone;
  /** Opens in a new context with hardened rel. */
  external?: boolean;
}

const byTone: Record<LinkTone, string> = {
  default: 'text-accent hover:underline',
  muted: 'text-muted hover:text-fg hover:underline',
};

export function Link({
  tone = 'default',
  external = false,
  className,
  children,
  ...rest
}: LinkProps): React.JSX.Element {
  return (
    <a
      data-tone={tone}
      className={cx(
        'rounded-[2px] underline-offset-2 transition-opacity active:opacity-70',
        byTone[tone],
        focusRing,
        className,
      )}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      {...rest}
    >
      {children}
    </a>
  );
}

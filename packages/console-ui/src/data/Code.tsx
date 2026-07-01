import type { ReactNode } from 'react';
import { cx } from '../lib/cx.js';

export interface CodeProps {
  /** Block renders a <pre> preserving whitespace; otherwise inline <code>. */
  block?: boolean;
  children: ReactNode;
  className?: string;
}

const mono = 'font-mono text-[12px] text-fg';

export function Code({ block = false, children, className }: CodeProps): React.JSX.Element {
  return block ? (
    <pre
      className={cx(
        mono,
        'overflow-auto whitespace-pre rounded-surface border border-hairline bg-subtle p-2 leading-[1.55]',
        className,
      )}
    >
      {children}
    </pre>
  ) : (
    <code className={cx(mono, 'rounded-[3px] bg-subtle px-1 py-0.5', className)}>{children}</code>
  );
}

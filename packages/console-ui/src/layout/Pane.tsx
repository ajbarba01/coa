import type { ReactNode } from 'react';
import { useId } from 'react';
import { cx } from '../lib/cx.js';

export interface PaneProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  /** When true the body scrolls within the pane instead of growing it. */
  scroll?: boolean;
  className?: string;
}

export function Pane({
  title,
  actions,
  children,
  scroll = false,
  className,
}: PaneProps): React.JSX.Element {
  const headingId = useId();
  return (
    <section
      {...(title !== undefined ? { 'aria-labelledby': headingId } : {})}
      className={cx(
        'flex h-full min-h-0 flex-col rounded-surface border border-border-default bg-surface',
        className,
      )}
    >
      {title !== undefined && (
        <header className="flex min-h-9 items-center justify-between border-b border-hairline px-3.5 py-2">
          <h2
            id={headingId}
            className="text-[11px] font-semibold uppercase tracking-[0.06em] text-faint"
          >
            {title}
          </h2>
          {actions}
        </header>
      )}
      <div className={cx('min-h-0 flex-1 p-3.5', scroll && 'overflow-auto')}>{children}</div>
    </section>
  );
}

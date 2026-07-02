import type { ReactNode } from 'react';
import { cx } from '@coa/console-ui';

/** A component family: a labelled section with a hairline-underlined header.
 *  Families are real groups, so the heading is meaning-bearing structure, not
 *  decoration (spec §5.1 #14). */
export function Family({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section aria-label={name} className="flex flex-col gap-4">
      <h3 className="border-b border-hairline pb-1.5 text-body font-semibold text-fg">{name}</h3>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** One specimen row: a fixed label column beside the live component(s). `align`
 *  top-aligns the label for tall specimens (forms, tables). */
export function Row({
  label,
  align = 'center',
  children,
}: {
  label: string;
  align?: 'center' | 'start';
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-4">
      <div className={cx('text-caption text-faint', align === 'start' ? 'pt-1' : 'self-center')}>
        {label}
      </div>
      <div
        className={cx('flex flex-wrap gap-3', align === 'center' ? 'items-center' : 'items-start')}
      >
        {children}
      </div>
    </div>
  );
}

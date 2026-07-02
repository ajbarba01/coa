import type { ReactNode } from 'react';
import { useId } from 'react';
import { cx } from '../lib/cx.js';

export interface PaneProps {
  title?: string;
  /** Replaces the title text with interactive header content (e.g. a switcher);
   *  pass `title` alongside it so the pane region stays named. */
  titleSlot?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** When true the body scrolls within the pane instead of growing it. */
  scroll?: boolean;
  /** When true the body hugs the pane edges (a rail/list owns its own inset). */
  flush?: boolean;
  /** Butts this pane flush against a neighbour on the given edge: drops that edge's
   *  border + corner rounding so the two read as one card (e.g. the nav rail on 'left'). */
  seam?: 'left' | 'right';
  className?: string;
}

export function Pane({
  title,
  titleSlot,
  actions,
  children,
  scroll = false,
  flush = false,
  seam,
  className,
}: PaneProps): React.JSX.Element {
  const headingId = useId();
  const hasHeader = title !== undefined || titleSlot !== undefined;
  const frameSeam =
    seam === 'left'
      ? 'rounded-r-surface border-y border-r border-border-default'
      : seam === 'right'
        ? 'rounded-l-surface border-y border-l border-border-default'
        : 'rounded-surface border border-border-default';
  const headerSeam =
    seam === 'left'
      ? 'rounded-tr-surface'
      : seam === 'right'
        ? 'rounded-tl-surface'
        : 'rounded-t-surface';
  return (
    <section
      {...(titleSlot !== undefined
        ? title !== undefined
          ? { 'aria-label': title }
          : {}
        : title !== undefined
          ? { 'aria-labelledby': headingId }
          : {})}
      className={cx('flex h-full min-h-0 flex-col bg-surface', frameSeam, className)}
    >
      {hasHeader && (
        // Project standard: chrome (title bar, sidebars, pane headers) sits on `subtle`;
        // the panel body stays on the lighter `surface` so content reads a step brighter
        // than its frame. Overlays live one step lighter still, on `raised`.
        <header
          className={cx(
            'flex min-h-9 items-center justify-between gap-2 border-b border-hairline bg-subtle px-3.5 py-2',
            headerSeam,
          )}
        >
          {titleSlot ?? (
            <h2
              id={headingId}
              className="text-caption font-semibold uppercase tracking-[0.06em] text-faint"
            >
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className={cx('min-h-0 flex-1', !flush && 'p-3.5', scroll && 'overflow-auto')}>
        {children}
      </div>
    </section>
  );
}

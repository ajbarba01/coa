import type { ReactNode } from 'react';
import { cx } from '../cx.js';
import { Icon, type IconName } from '../data/Icon.js';

/** The four feedback tones every kit surface shares. It lives with the feedback family
 *  because that is what defines it; the transcript's own notices import it from here. */
export type Status = 'info' | 'success' | 'warning' | 'danger';

/** A tone is a STATE, and the indicator law draws state — so each tone owns a mark
 *  rather than leaning on colour alone, which is not a channel every reader has. */
const MARK: Record<Status, IconName> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

/** `info` is deliberately the muted ground rather than a hue: an informational line is
 *  the quiet default, and spending a colour on it would leave the three that mean
 *  something competing with it. */
const TONE: Record<Status, string> = {
  info: 'text-s9',
  success: 'text-ok',
  warning: 'text-warn',
  danger: 'text-crit',
};

export interface InlineMessageProps {
  tone?: Status;
  children: ReactNode;
  className?: string;
}

/** One line of state beside the thing it is about: a drawn mark plus a short message.
 *  Inline rather than docked, so it reads as a property of its neighbour instead of as a
 *  page-level announcement. */
export function InlineMessage({
  tone = 'info',
  children,
  className,
}: InlineMessageProps): React.JSX.Element {
  return (
    <span
      data-tone={tone}
      className={cx('inline-flex items-center gap-1.5 text-sec', TONE[tone], className)}
    >
      <Icon name={MARK[tone]} />
      {children}
    </span>
  );
}

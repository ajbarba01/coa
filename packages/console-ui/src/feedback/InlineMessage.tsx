import type { ReactNode } from 'react';
import { Info, CircleCheck, TriangleAlert, OctagonAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { Status } from './Banner.js';

export interface InlineMessageProps {
  tone: Status;
  children: ReactNode;
  className?: string;
}

const toneIcon: Record<Status, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};
const toneText: Record<Status, string> = {
  info: 'text-info-text',
  success: 'text-success-text',
  warning: 'text-warning-text',
  danger: 'text-danger-text',
};

export function InlineMessage({
  tone,
  children,
  className,
}: InlineMessageProps): React.JSX.Element {
  return (
    <span
      data-testid="inline-message"
      data-tone={tone}
      role={tone === 'danger' ? 'alert' : undefined}
      className={cx('inline-flex items-center gap-1 text-[12px]', toneText[tone], className)}
    >
      <Icon name={toneIcon[tone]} size={13} />
      {children}
    </span>
  );
}

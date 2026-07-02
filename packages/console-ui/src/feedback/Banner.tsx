import type { ReactNode } from 'react';
import { Info, CircleCheck, TriangleAlert, OctagonAlert, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export type Status = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  tone: Status;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const toneIcon: Record<Status, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
};
const toneClass: Record<Status, string> = {
  info: 'bg-info-tint text-info-text border-info/40',
  success: 'bg-success-tint text-success-text border-success/40',
  warning: 'bg-warning-tint text-warning-text border-warning/40',
  danger: 'bg-danger-tint text-danger-text border-danger/40',
};

export function Banner({
  tone,
  title,
  children,
  onDismiss,
  className,
}: BannerProps): React.JSX.Element {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      data-tone={tone}
      className={cx(
        'flex items-start gap-2 rounded-surface border px-3 py-2 text-label',
        toneClass[tone],
        className,
      )}
    >
      <Icon name={toneIcon[tone]} size={16} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <div className="font-medium text-fg">{title}</div>
        {children !== undefined && <div className="text-muted">{children}</div>}
      </div>
      {onDismiss !== undefined && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className={cx(
            'shrink-0 rounded-control p-0.5 transition-transform hover:bg-element-hover active:scale-90',
            focusRing,
          )}
        >
          <Icon name={X} size={14} />
        </button>
      )}
    </div>
  );
}

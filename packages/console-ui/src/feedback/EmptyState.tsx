import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cx('flex flex-col items-center gap-2 px-6 py-8 text-center', className)}>
      <span className="text-faint">
        <Icon name={icon} size={24} />
      </span>
      <div className="text-[13px] font-medium text-fg">{title}</div>
      <div className="max-w-xs text-[12px] text-muted">{description}</div>
      {action !== undefined && <div className="mt-1">{action}</div>}
    </div>
  );
}

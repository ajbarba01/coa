import type { LucideIcon } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface NavItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface NavListProps {
  label: string;
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function NavList({
  label,
  items,
  activeId,
  onSelect,
  className,
}: NavListProps): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="vertical"
      className={cx('flex flex-col gap-0.5', className)}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active ? 'true' : undefined}
            onClick={() => onSelect(item.id)}
            className={cx(
              'flex items-center gap-2 rounded-control px-2 py-1 text-left text-body text-muted transition-colors duration-fast hover:bg-element-hover active:bg-element-active data-[active=true]:bg-element-active data-[active=true]:text-fg',
              focusRing,
            )}
          >
            {item.icon !== undefined && <Icon name={item.icon} size={16} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

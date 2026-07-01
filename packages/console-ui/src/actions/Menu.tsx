import type { ReactNode } from 'react';
import { DropdownMenu } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  disabled?: boolean;
}

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
}

export function Menu({ trigger, items }: MenuProps): React.JSX.Element {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={4}
          className="z-[200] min-w-40 rounded-surface border border-border-default bg-raised p-1 text-[13px] text-fg shadow-lg"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.id}
              disabled={item.disabled ?? false}
              onSelect={item.onSelect ?? (() => {})}
              className={cx(
                'flex cursor-default items-center gap-2 rounded-control px-2 py-1 outline-none',
                'data-[highlighted]:bg-element-hover data-[disabled]:opacity-50',
              )}
            >
              {item.icon !== undefined && <Icon name={item.icon} size={14} />}
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

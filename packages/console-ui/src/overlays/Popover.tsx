import type { ReactNode } from 'react';
import { Popover as RxPopover } from 'radix-ui';

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
}

export function Popover({ trigger, children }: PopoverProps): React.JSX.Element {
  return (
    <RxPopover.Root>
      <RxPopover.Trigger asChild>{trigger}</RxPopover.Trigger>
      <RxPopover.Portal>
        <RxPopover.Content
          sideOffset={6}
          className="overlay-content z-[500] max-w-xs rounded-surface border border-border-default bg-raised p-3 text-body text-fg shadow-lg focus:outline-none"
        >
          {children}
        </RxPopover.Content>
      </RxPopover.Portal>
    </RxPopover.Root>
  );
}

import type { ReactNode } from 'react';
import { Dialog as RxDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export type SheetSide = 'left' | 'right';

export interface SheetProps {
  trigger: ReactNode;
  title: string;
  side?: SheetSide;
  children: ReactNode;
}

export function Sheet({ trigger, title, side = 'right', children }: SheetProps): React.JSX.Element {
  return (
    <RxDialog.Root>
      <RxDialog.Trigger asChild>{trigger}</RxDialog.Trigger>
      <RxDialog.Portal>
        <RxDialog.Overlay className="fixed inset-0 z-[400] bg-black/50" />
        <RxDialog.Content
          data-side={side}
          className={cx(
            'fixed inset-y-0 z-[400] w-80 max-w-[92vw] border-border-default bg-raised p-4 text-[13px] text-fg shadow-xl focus:outline-none',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          )}
        >
          <div className="mb-2 flex items-start justify-between gap-4">
            <RxDialog.Title className="text-[14px] font-semibold text-fg">{title}</RxDialog.Title>
            <RxDialog.Close
              aria-label="Close"
              className={cx('rounded-control p-0.5 text-muted hover:bg-element-hover', focusRing)}
            >
              <Icon name={X} size={16} />
            </RxDialog.Close>
          </div>
          <div>{children}</div>
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}

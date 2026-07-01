import type { ReactNode } from 'react';
import { Dialog as RxDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';

export interface DialogProps {
  trigger: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  footer,
}: DialogProps): React.JSX.Element {
  return (
    <RxDialog.Root>
      <RxDialog.Trigger asChild>{trigger}</RxDialog.Trigger>
      <RxDialog.Portal>
        <RxDialog.Overlay className="overlay-scrim fixed inset-0 z-[400] bg-black/50" />
        <RxDialog.Content className="dialog-content fixed left-1/2 top-1/2 z-[400] w-[28rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-overlay border border-border-default bg-raised p-4 text-body text-fg shadow-xl focus:outline-none">
          <div className="mb-2 flex items-start justify-between gap-4">
            <RxDialog.Title className="text-heading font-semibold text-fg">{title}</RxDialog.Title>
            <RxDialog.Close
              aria-label="Close"
              className={cx(
                'rounded-control p-0.5 text-muted transition-colors hover:bg-element-hover active:scale-90',
                focusRing,
              )}
            >
              <Icon name={X} size={16} />
            </RxDialog.Close>
          </div>
          {description !== undefined && (
            <RxDialog.Description className="mb-2 text-muted">{description}</RxDialog.Description>
          )}
          <div>{children}</div>
          {footer !== undefined && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}

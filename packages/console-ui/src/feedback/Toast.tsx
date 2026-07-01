import type { ReactNode } from 'react';
import { Toast as RxToast } from 'radix-ui';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';
import { Icon } from '../icon/Icon.js';
import type { Status } from './Banner.js';

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <RxToast.Provider swipeDirection="right">
      {children}
      <RxToast.Viewport className="fixed bottom-3 right-3 z-[600] flex w-80 flex-col gap-2 outline-none" />
    </RxToast.Provider>
  );
}

export interface ToastProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: Status;
  title: string;
  children?: ReactNode;
}

const toneClass: Record<Status, string> = {
  info: 'border-info/40',
  success: 'border-success/40',
  warning: 'border-warning/40',
  danger: 'border-danger/50',
};

export function Toast({
  open,
  onOpenChange,
  tone = 'info',
  title,
  children,
}: ToastProps): React.JSX.Element {
  return (
    <RxToast.Root
      open={open}
      duration={4000}
      {...(onOpenChange !== undefined ? { onOpenChange } : {})}
      data-tone={tone}
      // Dismiss on a click anywhere on the toast, not just the close affordance.
      onClick={() => onOpenChange?.(false)}
      className={cx(
        'toast-root flex cursor-pointer items-start gap-2 rounded-surface border bg-raised px-3 py-2 text-label shadow-lg',
        toneClass[tone],
      )}
    >
      <div className="flex-1">
        <RxToast.Title className="font-medium text-fg">{title}</RxToast.Title>
        {children !== undefined && (
          <RxToast.Description className="text-muted">{children}</RxToast.Description>
        )}
      </div>
      <RxToast.Close
        aria-label="Dismiss"
        className={cx(
          'shrink-0 rounded-control p-0.5 transition-colors hover:bg-element-hover active:scale-90',
          focusRing,
        )}
      >
        <Icon name={X} size={14} />
      </RxToast.Close>
    </RxToast.Root>
  );
}

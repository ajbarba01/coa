import { useEffect, type ReactNode } from 'react';
import { cx } from '../cx.js';
import { Icon } from '../data/Icon.js';
import type { Status } from './InlineMessage.js';

/** Long enough to read a short failure, short enough that a stale message does not sit
 *  over the surface it is about. */
const DURATION_MS = 4000;

export interface ToastProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: Status;
  title: string;
  children?: ReactNode;
}

const TONE: Record<Status, string> = {
  info: 'border-s5',
  success: 'border-ok/40',
  warning: 'border-warn/40',
  danger: 'border-crit/50',
};

/**
 * A transient announcement that does not take focus.
 *
 * Fully CONTROLLED: the caller owns `open`, so there is no internal queue that can drift
 * from the state which produced the message. That is also why this does not use Base UI's
 * toast, which is manager-driven (`useToastManager().add()`) — the console's only toast is
 * a controlled error surface, and syncing controlled state into an imperative manager buys
 * stacking and swipe it never uses while inviting duplicate-add bugs. The kit takes Base
 * UI for mechanics we would otherwise hand-roll badly, namely focus traps and anchored
 * positioning; a toast has neither.
 */
export function Toast({
  open,
  onOpenChange,
  tone = 'info',
  title,
  children,
}: ToastProps): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => onOpenChange?.(false), DURATION_MS);
    return () => clearTimeout(timer);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-tone={tone}
      // Dismiss on a click anywhere, not only the close affordance: the whole card is the
      // target for a message you have finished reading.
      onClick={() => onOpenChange?.(false)}
      className={cx(
        'slip fixed right-3 bottom-3 z-(--z-toast) flex w-80 cursor-pointer items-start gap-2 rounded-r3 border bg-s3 px-3 py-2 text-sec shadow-lg',
        TONE[tone],
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-medium text-s12">{title}</div>
        {children !== undefined && <div className="text-s9">{children}</div>}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          // The card already dismisses; without this the handler would fire twice.
          e.stopPropagation();
          onOpenChange?.(false);
        }}
        className="slip slip-press shrink-0 rounded-r1 p-0.5 hover:bg-s4 focus-visible:outline-focus active:scale-[0.97]"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

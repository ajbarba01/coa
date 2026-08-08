import { Toast } from '@coa/console-kit';
import { useNotices } from './failures.js';

/** Module-level so the toast's auto-dismiss timer isn't restarted by a new closure
 *  identity on every render. */
const onOpenChange = (open: boolean): void => {
  if (!open) useNotices.getState().dismiss();
};

/**
 * The frame-level mount for the shared failure surface. It sits in the composition root
 * next to the edit menu — frame chrome, not a panel — so a write that fails announces
 * itself whatever surface is on screen, and from either side of the daemon gate.
 *
 * Remounted per notice (`key`) so a second announcement restarts the read-it timer
 * instead of inheriting whatever was left of the first one's.
 */
export function FailureToast(): React.JSX.Element | null {
  const notice = useNotices((s) => s.notice);
  if (notice === undefined) return null;
  return (
    <Toast
      key={notice.key}
      open
      onOpenChange={onOpenChange}
      tone={notice.tone}
      title={notice.title}
    >
      {notice.detail}
    </Toast>
  );
}

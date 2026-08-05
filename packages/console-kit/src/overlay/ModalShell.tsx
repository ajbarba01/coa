import { Dialog } from '@base-ui/react/dialog';
import { cx } from '../cx.js';
import { useModalLayer } from './layers.js';

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  'aria-label': string;
  /** Sizes the card (e.g. 'flex h-[70%] w-[70%] flex-col', 'w-96 pb-2'). */
  className?: string;
  children?: React.ReactNode;
}

/** The modal ground: scrim + heavy-shadow card. Base UI owns the focus trap,
 *  scroll lock, and scrim-press dismissal; Escape ordering and superseding the
 *  transient overlays beneath it both run through the kit's layer stack. The
 *  popup is a pointer-transparent centering frame and the card animates inside
 *  it — an entrance keyframe on the popup itself would clobber a centering
 *  transform mid-animation. */
export function ModalShell({
  open,
  onClose,
  className,
  children,
  ...aria
}: ModalShellProps): React.JSX.Element {
  useModalLayer(open, onClose);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, details) => {
        // Same escape contract as PopoverCard: swallow Base UI's own escape
        // close and let the keydown bubble on to the stack's window listener.
        if (!next && details.reason === 'escape-key') {
          details.allowPropagation();
          return;
        }
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-(--z-modal-backdrop) bg-scrim" />
        <Dialog.Popup
          className="pointer-events-none fixed inset-0 z-(--z-modal) flex items-center justify-center outline-none"
          {...aria}
        >
          <div
            className={cx(
              'slip-enter pointer-events-auto overflow-hidden rounded-r4 border border-s5 bg-s2 shadow-modal',
              className,
            )}
          >
            {children}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

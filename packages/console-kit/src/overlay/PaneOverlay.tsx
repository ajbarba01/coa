import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx.js';

/** Focusable descendants of `root`, in DOM order, skipping disabled/`-1` tabindex nodes.
 *  Used to seed initial focus and to wrap Tab at the overlay's edges (focus trap). */
function focusable(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.tabIndex !== -1,
  );
}

export interface PaneOverlayApi {
  open: (content: ReactNode, title?: string) => void;
  close: () => void;
}

interface OverlayState {
  content: ReactNode;
  title?: string | undefined;
}

const PaneOverlayContext = createContext<PaneOverlayApi | null>(null);

/** Cards call this to open their full body in the pane overlay. Returns null when no
 *  PaneOverlayProvider is above (callers fall back to inline expansion). */
export function usePaneOverlay(): PaneOverlayApi | null {
  return useContext(PaneOverlayContext);
}

export interface PaneOverlayProviderProps {
  children: ReactNode;
  className?: string | undefined;
}

/** Wraps a pane and hosts an overlay confined to it: the overlay is `absolute inset-0`
 *  within this `relative` container, so it never covers the window. */
export function PaneOverlayProvider({
  children,
  className,
}: PaneOverlayProviderProps): React.JSX.Element {
  const [state, setState] = useState<OverlayState | null>(null);
  const open = useCallback(
    (content: ReactNode, title?: string) => setState({ content, title }),
    [],
  );
  const close = useCallback(() => setState(null), []);
  const api = useMemo<PaneOverlayApi>(() => ({ open, close }), [open, close]);
  return (
    <PaneOverlayContext.Provider value={api}>
      <div className={cx('relative h-full min-h-0', className)}>
        {children}
        {state !== null && <PaneOverlayHost state={state} onClose={close} />}
      </div>
    </PaneOverlayContext.Provider>
  );
}

function PaneOverlayHost({
  state,
  onClose,
}: {
  state: OverlayState;
  onClose: () => void;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Where focus was before the overlay opened, restored on close so dismissing returns
  // the caret to the Expand control that opened it.
  const restoreRef = useRef<Element | null>(null);

  // Escape closes; Tab is trapped within the panel (a modal overlay must not leak focus
  // to the transcript/composer behind it — WAI-ARIA dialog).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (panel === null) return;
      const items = focusable(panel);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at the edges; also pull focus back in if it has escaped the panel entirely.
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Seed initial focus into the overlay on open, and restore it on close.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, []);

  const title = state.title ?? 'Details';
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop confined to the pane; click to dismiss. */}
      <button
        type="button"
        aria-label="Dismiss"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-scrim"
      />
      <div
        ref={panelRef}
        className="relative m-3 flex max-h-[calc(100%-1.5rem)] w-full flex-col overflow-hidden rounded-r3 border border-s5 bg-s2 shadow-modal"
      >
        <div className="flex items-center justify-between border-b border-s4 px-3 py-2">
          <span className="truncate font-mono text-sec text-s11">{title}</span>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-r1 p-0.5 text-s7 hover:bg-s4 hover:text-s10 focus-visible:outline-focus"
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{state.content}</div>
      </div>
    </div>
  );
}

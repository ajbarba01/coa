import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { cx, focusRing } from '../lib/cx.js';

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
export function PaneOverlayProvider({ children, className }: PaneOverlayProviderProps): React.JSX.Element {
  const [state, setState] = useState<OverlayState | null>(null);
  const open = useCallback((content: ReactNode, title?: string) => setState({ content, title }), []);
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

function PaneOverlayHost({ state, onClose }: { state: OverlayState; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const title = state.title ?? 'Details';
  return (
    <div className="absolute inset-0 z-30 flex flex-col" role="dialog" aria-label={title}>
      {/* Backdrop confined to the pane; click to dismiss. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div className="relative m-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-overlay border border-border-default bg-raised shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
          <span className="text-label font-medium text-fg">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cx('rounded-control p-0.5 text-muted hover:bg-element-hover', focusRing)}
          >
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">{state.content}</div>
      </div>
    </div>
  );
}

import { cx, useDismissLayer } from '@coa/console-kit';
import { createContext, useContext, useState } from 'react';

interface OverlayState {
  title: string;
  meta?: string | undefined;
  node: React.ReactNode;
}

interface OverlayApi {
  open: (o: OverlayState) => void;
}

const OverlayCtx = createContext<OverlayApi | null>(null);

/** A deep tool body expands OVER the transcript region — never the window
 *  (the shell keeps its frame; the conversation handles its own depth). */
export function useTranscriptOverlay(): OverlayApi | null {
  return useContext(OverlayCtx);
}

/** Hosts the expand-to-overlay presentation: a scrim over the transcript
 *  region only, one floating s2/s5 sheet inset from the region's edges, its
 *  own scroll, dismissed by Esc / scrim / ✕. Mount it INSIDE the relative
 *  transcript container. */
export function TranscriptOverlayHost({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  useDismissLayer(overlay !== null, () => setOverlay(null));

  return (
    <OverlayCtx.Provider value={{ open: setOverlay }}>
      {children}
      {overlay !== null && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 px-8 py-6"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOverlay(null);
          }}
        >
          {/* the sheet takes the height of its content, up to the region's inset */}
          <div
            role="dialog"
            aria-label={overlay.title}
            className="slip-enter flex max-h-full w-full flex-col overflow-hidden rounded-r3 border border-s5 bg-s2 shadow-[var(--shadow-float)]"
          >
            <div className="flex flex-none items-center gap-2.5 border-b border-s4 px-3.5 py-2">
              <span className="truncate font-mono text-sec text-s11">{overlay.title}</span>
              {overlay.meta !== undefined && (
                <span className="font-mono text-meta whitespace-nowrap text-s7">
                  {overlay.meta}
                </span>
              )}
              <button
                type="button"
                aria-label="close"
                onClick={() => setOverlay(null)}
                className={cx(
                  'slip ml-auto flex h-6 w-6 flex-none cursor-pointer items-center justify-center',
                  'rounded-r1 text-body text-s7 hover:bg-s4 hover:text-s10',
                )}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">{overlay.node}</div>
          </div>
        </div>
      )}
    </OverlayCtx.Provider>
  );
}

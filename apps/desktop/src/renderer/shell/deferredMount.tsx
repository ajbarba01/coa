import { Spinner } from '@coa/console-kit';
import { memo, startTransition, useEffect, useState } from 'react';

type TransitionFn = (cb: () => void) => void;

/** Skips re-rendering its subtree entirely while frozen — for HIDDEN kept-alive
 *  canvases, which would otherwise re-render on every live publish (the poll,
 *  every streamed frame), making the console slower with each visited surface.
 *  Thawing re-renders in the same commit as the visibility flip, so the tab
 *  never shows stale content. */
export const Freeze = memo(
  function Freeze({ children }: { frozen: boolean; children: React.ReactNode }): React.JSX.Element {
    return <>{children}</>;
  },
  // memo contract: returning true skips the render — exactly and only while
  // the NEXT state is frozen.
  (_prev, next) => next.frozen,
);

/** True once `id`'s content has committed. Every `id` change (and the first
 *  mount) routes through a React transition: the urgent render paints the
 *  switch immediately (chrome + loading circle) while the heavy content
 *  renders concurrently — time-sliced, interruptible by the next switch —
 *  and commits when ready. `transition` is a test seam (jsdom's `act` flushes
 *  real transitions synchronously, hiding the intermediate frame). */
export function useDeferredMount(id: string, transition: TransitionFn = startTransition): boolean {
  const [current, setCurrent] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (current !== id) transition(() => setCurrent(id));
  }, [id, current, transition]);
  return current === id;
}

/** The canvas-level wrapper: content mounts deferred; until it lands the frame
 *  shows the centered loading circle (which reveals 120ms late, so a fast
 *  mount never flashes it). */
export function DeferredCanvas({
  id,
  transition,
  children,
}: {
  id: string;
  transition?: TransitionFn;
  children: React.ReactNode;
}): React.JSX.Element {
  const ready = useDeferredMount(id, transition ?? startTransition);
  if (!ready) {
    // h-full AND flex-1: centered whether the host sizes children by flex
    // (the surface canvas) or by height (the chat pane's tab wrappers).
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center">
        <Spinner label="Loading" />
      </div>
    );
  }
  return <>{children}</>;
}

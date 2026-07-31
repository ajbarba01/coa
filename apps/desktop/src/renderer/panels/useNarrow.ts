import { useEffect, useState } from 'react';

/**
 * Is this PANE narrower than `px`?
 *
 * The pane's own width decides a surface's layout — not the window's. The nav and the dock both
 * steal from the center column, so a viewport breakpoint (or a Tailwind `lg:`) lies about how
 * much room the content actually has: the window can be 1900px wide while the canvas is 600.
 */
export function useNarrow(ref: React.RefObject<HTMLElement | null>, px: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(([entry]) => {
      // Width 0 is a HIDDEN pane, not a narrow one (every visited surface stays mounted
      // behind `display:none`). Acting on it flips the layout while nobody is looking and
      // the surface flashes the wrong shape on its way back in — hold the last real answer.
      if (entry !== undefined && entry.contentRect.width > 0) {
        setNarrow(entry.contentRect.width < px);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return narrow;
}

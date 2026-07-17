import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx.js';

/**
 * A viewport-safe floating detail card (a chart's hover panel, a rich data tooltip).
 *
 * The one job: NEVER be clipped by a window edge. The card is portaled to the body,
 * measures itself, and places itself against the anchor's screen rect — flipping to
 * the other side when the preferred side has no room, and clamping to the viewport
 * on both axes. Every hover panel rides this instead of hand-rolled `fixed` math, so
 * "the card ran off the top of the window" is a bug class, not a recurring bug.
 *
 * Passive detail, like Tooltip: pointer-events off, never a dismiss layer.
 */

export interface FloatPlacement {
  left: number;
  top: number;
  /** True when the preferred side had no room and the card flipped across the anchor. */
  flipped: boolean;
}

/** Pure: where a card of `size` sits against `anchor` in `viewport`. Prefer `side`;
 *  flip when it doesn't fit; clamp the result so the card is always fully on screen. */
export function floatPlacement(
  anchor: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  side: 'top' | 'bottom' = 'top',
  offset = 8,
  margin = 8,
): FloatPlacement {
  const centered = anchor.left + anchor.width / 2 - size.width / 2;
  const left = Math.max(margin, Math.min(centered, viewport.width - size.width - margin));

  const above = anchor.top - offset - size.height;
  const below = anchor.top + anchor.height + offset;
  const fitsAbove = above >= margin;
  const fitsBelow = below + size.height <= viewport.height - margin;

  let top: number;
  let flipped = false;
  if (side === 'top') {
    if (fitsAbove || !fitsBelow) top = above;
    else {
      top = below;
      flipped = true;
    }
  } else {
    if (fitsBelow || !fitsAbove) top = below;
    else {
      top = above;
      flipped = true;
    }
  }
  // Whatever side won, the card never leaves the viewport.
  top = Math.max(margin, Math.min(top, viewport.height - size.height - margin));
  return { left, top, flipped };
}

export interface FloatCardProps {
  /** The anchor's SCREEN rect (`getBoundingClientRect` of the hovered mark). */
  anchor: { left: number; top: number; width: number; height: number };
  side?: 'top' | 'bottom';
  className?: string;
  children?: React.ReactNode;
}

/** The floating-surface skin at the tooltip z, placed by `floatPlacement`. Rendered
 *  invisible for one frame while it measures itself — a card must know its height
 *  before it can promise not to leave the window. */
export function FloatCard({
  anchor,
  side = 'top',
  className,
  children,
}: FloatCardProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    setSize((s) => (s?.width === next.width && s.height === next.height ? s : next));
  }, [children]);

  const placed =
    size === undefined
      ? undefined
      : floatPlacement(
          anchor,
          size,
          { width: window.innerWidth, height: window.innerHeight },
          side,
        );

  return createPortal(
    <div
      ref={ref}
      style={
        placed === undefined
          ? { left: 0, top: 0, visibility: 'hidden' }
          : { left: placed.left, top: placed.top }
      }
      className={cx(
        // slip-enter is the kit's one mount keyframe — entrance only, like every
        // other kit surface; hover cards vanish on the spot.
        'slip-enter pointer-events-none fixed z-(--z-tooltip) rounded-r3 border border-s5 bg-s3 p-2.5 shadow-float',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Slipstream, as motion/react props — ONE vocabulary, shared by every surface that animates.
 *
 * These mirror the tokens (`--dur-*`, `--ease-slip`) and the chat surface's own strip transition,
 * which is the reference: 180ms, expo-out, ≤12px of travel, never bouncy. Two rules learned the
 * hard way and encoded here:
 *
 *   · Cross-fades run CONCURRENTLY (no `mode="wait"`). Waiting for the outgoing pane to leave
 *     before the incoming one arrives doubles the duration — 180ms becomes 360ms, and the surface
 *     feels sluggish even though every number in it is "correct".
 *   · Travel is on ONE axis (y). A `layout` animation on a list drifts rows diagonally as
 *     neighbours reflow, which reads as the content sliding up-and-to-the-right rather than
 *     simply arriving.
 */

/** The Slipstream curve — `--ease-slip`, expo-out. */
export const EASE_SLIP = [0.19, 1, 0.22, 1] as const;

/** The shortest leg (`--dur-swift`) — an OUTGOING half when a sequential swap can't run
 *  concurrently, so the total stays inside one enter instead of doubling. */
export const SLIP_SWIFT = { duration: 0.08, ease: EASE_SLIP } as const;

/** Mount/dismount of a pane or row (`--dur-enter`). */
export const SLIP_ENTER = { duration: 0.18, ease: EASE_SLIP } as const;

/** Hover/colour-weight feedback (`--dur-base`) — tooltips, hover cards. */
export const SLIP_BASE = { duration: 0.14, ease: EASE_SLIP } as const;

/** Position/size moves (`--dur-move`) — a selection tile sliding between cells. */
export const SLIP_MOVE = { duration: 0.2, ease: EASE_SLIP } as const;

/** The one entrance: fade + a short rise. Vertical only. */
export const RISE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: SLIP_ENTER,
} as const;

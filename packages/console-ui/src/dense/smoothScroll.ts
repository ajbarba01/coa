/** A cancelable, near-enough-terminating scroll lerp for the transcript.
 *
 *  react-virtuoso's own `scrollToIndex({ behavior: 'smooth' })` keeps re-targeting
 *  the index as off-screen rows mount and get measured — so it "chases" a moving
 *  target and re-grabs you if you try to scroll away. This owns the animation
 *  instead: it eases `scrollTop` toward a target, STOPS the instant the user scrolls
 *  (wheel / touch / scrollbar drag / keyboard), and ENDS once within a couple of
 *  pixels — so a header click or jump-to-latest lands and stays put.
 */

/** The subset of a scroller element the lerp drives. `HTMLElement` satisfies it;
 *  tests supply a lightweight fake so the animation is exercisable without layout. */
export interface ScrollTarget {
  scrollTop: number;
  addEventListener(
    type: string,
    listener: () => void,
    options?: { passive?: boolean } | boolean,
  ): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface SmoothScrollOptions {
  /** Fraction of the remaining distance covered per frame (0–1). */
  factor?: number;
  /** Distance (px) at which the lerp snaps to target and finishes. */
  stopPx?: number;
  /** Injectable rAF pair (tests drive frames deterministically). */
  raf?: (cb: () => void) => number;
  cancelRaf?: (handle: number) => void;
}

const DEFAULT_FACTOR = 0.22;
const DEFAULT_STOP_PX = 1.5;

/** User gestures that cancel an in-flight lerp. A scrollbar drag lands as a
 *  `pointerdown` on the scroller; wheel/touch/keyboard cover the rest. The lerp's
 *  own `scrollTop` writes emit only `scroll` (absent here), so it never self-cancels. */
const INPUT_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** One easing step. Pure and exported so the near-enough stop is unit-testable
 *  without a DOM. `done` means the target is within `stopPx` — snap and finish. */
export function nextScrollStep(
  current: number,
  target: number,
  factor: number = DEFAULT_FACTOR,
  stopPx: number = DEFAULT_STOP_PX,
): { value: number; done: boolean } {
  const delta = target - current;
  if (Math.abs(delta) <= stopPx) return { value: target, done: true };
  return { value: current + delta * factor, done: false };
}

/** Start easing `scroller.scrollTop` toward the value `resolveTarget()` returns.
 *  `resolveTarget` is polled every frame (so a target measured off the live DOM can
 *  refine as rows mount, and a bottom target tracks a growing list); returning
 *  `undefined` means "not resolvable yet — wait a frame". Returns a `cancel` fn;
 *  the caller cancels on unmount or when starting a new lerp. */
export function startSmoothScroll(
  scroller: ScrollTarget,
  resolveTarget: () => number | undefined,
  options: SmoothScrollOptions = {},
): () => void {
  const factor = options.factor ?? DEFAULT_FACTOR;
  const stopPx = options.stopPx ?? DEFAULT_STOP_PX;
  const raf = options.raf ?? ((cb): number => requestAnimationFrame(cb));
  const cancelRaf = options.cancelRaf ?? ((h): void => cancelAnimationFrame(h));

  let handle: number | undefined;
  let finished = false;
  let lastTarget: number | undefined;

  const stop = (): void => {
    if (finished) return;
    finished = true;
    if (handle !== undefined) cancelRaf(handle);
    for (const type of INPUT_EVENTS) scroller.removeEventListener(type, stop);
  };

  for (const type of INPUT_EVENTS) scroller.addEventListener(type, stop, { passive: true });

  const tick = (): void => {
    if (finished) return;
    const target = resolveTarget() ?? lastTarget;
    if (target === undefined) {
      handle = raf(tick);
      return;
    }
    lastTarget = target;
    const { value, done } = nextScrollStep(scroller.scrollTop, target, factor, stopPx);
    scroller.scrollTop = value;
    if (done) {
      stop();
      return;
    }
    handle = raf(tick);
  };

  handle = raf(tick);
  return stop;
}

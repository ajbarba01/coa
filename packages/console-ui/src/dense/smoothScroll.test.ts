import { describe, expect, it, vi } from 'vitest';
import { nextScrollStep, startSmoothScroll, type ScrollTarget } from './smoothScroll.js';

/** A hand-cranked rAF: `flush(n)` runs the next `n` scheduled callbacks. Each tick
 *  schedules the following one, so `flush(k)` advances `k` animation frames. */
function makeRaf(): {
  raf: (cb: () => void) => number;
  cancelRaf: ReturnType<typeof vi.fn>;
  flush: (n?: number) => void;
} {
  const queue: (() => void)[] = [];
  return {
    raf: (cb) => queue.push(cb),
    cancelRaf: vi.fn(),
    flush: (n = 1) => {
      for (let i = 0; i < n; i++) queue.shift()?.();
    },
  };
}

/** A fake scroller: a mutable `scrollTop` plus a captured listener registry so a test
 *  can dispatch a "user gesture" by name. */
function makeScroller(initial = 0): ScrollTarget & { fire: (type: string) => void } {
  const listeners = new Map<string, Array<() => void>>();
  return {
    scrollTop: initial,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
    },
    fire(type) {
      for (const l of listeners.get(type) ?? []) l();
    },
  };
}

describe('nextScrollStep', () => {
  it('eases a fraction of the remaining distance', () => {
    expect(nextScrollStep(0, 100, 0.25)).toEqual({ value: 25, done: false });
    expect(nextScrollStep(50, 100, 0.5)).toEqual({ value: 75, done: false });
  });

  it('snaps to target and reports done within the stop threshold', () => {
    expect(nextScrollStep(99, 100, 0.5, 1)).toEqual({ value: 100, done: true });
    expect(nextScrollStep(100, 100, 0.5, 1)).toEqual({ value: 100, done: true });
  });
});

describe('startSmoothScroll', () => {
  it('eases scrollTop toward the target and snaps home', () => {
    const s = makeScroller(0);
    const { raf, cancelRaf, flush } = makeRaf();
    startSmoothScroll(s, () => 100, { factor: 0.5, stopPx: 1, raf, cancelRaf });
    flush(1);
    expect(s.scrollTop).toBe(50);
    flush(1);
    expect(s.scrollTop).toBe(75);
    flush(20);
    expect(s.scrollTop).toBe(100);
  });

  it('stops the instant the user scrolls, and does not re-grab', () => {
    const s = makeScroller(0);
    const { raf, cancelRaf, flush } = makeRaf();
    startSmoothScroll(s, () => 100, { factor: 0.5, stopPx: 1, raf, cancelRaf });
    flush(1);
    expect(s.scrollTop).toBe(50);
    s.fire('wheel'); // manual scroll cancels the lerp
    flush(10);
    expect(s.scrollTop).toBe(50); // never advanced again
    expect(cancelRaf).toHaveBeenCalled();
  });

  it('a scrollbar-drag pointerdown also cancels', () => {
    const s = makeScroller(0);
    const { raf, cancelRaf, flush } = makeRaf();
    startSmoothScroll(s, () => 100, { factor: 0.5, stopPx: 1, raf, cancelRaf });
    flush(1);
    s.fire('pointerdown');
    flush(10);
    expect(s.scrollTop).toBe(50);
  });

  it('the returned cancel halts the animation', () => {
    const s = makeScroller(0);
    const { raf, cancelRaf, flush } = makeRaf();
    const cancel = startSmoothScroll(s, () => 100, { factor: 0.5, stopPx: 1, raf, cancelRaf });
    flush(1);
    cancel();
    flush(10);
    expect(s.scrollTop).toBe(50);
  });

  it('waits for a target that is not resolvable yet, then proceeds', () => {
    const s = makeScroller(0);
    const { raf, cancelRaf, flush } = makeRaf();
    const box: { target: number | undefined } = { target: undefined };
    startSmoothScroll(s, () => box.target, { factor: 1, stopPx: 0.5, raf, cancelRaf });
    flush(1);
    expect(s.scrollTop).toBe(0); // target still undefined — no movement
    box.target = 10;
    flush(3);
    expect(s.scrollTop).toBe(10);
  });
});

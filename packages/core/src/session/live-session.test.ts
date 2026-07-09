import { describe, it, expect } from 'vitest';
import type { Push } from '@coa/shared';
import { LiveSession } from './live-session.js';

describe('LiveSession', () => {
  it('fans out an emitted push to every subscriber', () => {
    const s = new LiveSession('c1');
    const a: Push[] = []; const b: Push[] = [];
    s.subscribe((p) => a.push(p));
    s.subscribe((p) => b.push(p));
    const turn: Push = { kind: 'turn', sessionId: 'c1', worktree: '', seq: 0, frame: { t: 'text', text: 'hi' } };
    s.emit(turn);
    expect(a).toContainEqual(turn);
    expect(b).toContainEqual(turn);
  });

  it('emits the current run-status to a late subscriber (hydration)', () => {
    const s = new LiveSession('c1');
    s.setState('running', '/wt');
    const got: Push[] = [];
    s.subscribe((p) => got.push(p));
    expect(got).toContainEqual({ kind: 'status', sessionId: 'c1', worktree: '/wt', state: 'running' });
  });

  it('nextTurn resolves with an enqueued turn, then undefined after close+drain', async () => {
    const s = new LiveSession('c1');
    s.enqueue({ input: 'first' });
    await expect(s.nextTurn()).resolves.toEqual({ input: 'first' });
    const pending = s.nextTurn();
    s.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it('unsubscribe stops delivery', () => {
    const s = new LiveSession('c1');
    const got: Push[] = [];
    const off = s.subscribe((p) => got.push(p));
    off();
    s.emit({ kind: 'turn', sessionId: 'c1', worktree: '', seq: 1, frame: { t: 'text', text: 'x' } });
    expect(got.filter((p) => p.kind === 'turn')).toHaveLength(0);
  });

  it('a throwing sink does not stop fan-out to healthy sinks, and is dropped (FIX #2a)', () => {
    const s = new LiveSession('c1');
    const good: Push[] = [];
    s.subscribe(() => {
      throw new Error('dead sink');
    });
    s.subscribe((p) => good.push(p));
    const turn: Push = { kind: 'turn', sessionId: 'c1', worktree: '', seq: 0, frame: { t: 'text', text: 'hi' } };

    expect(() => s.emit(turn)).not.toThrow();
    expect(good).toContainEqual(turn);

    // The throwing sink was dropped — a second emit only grows the healthy sink's log.
    s.emit(turn);
    expect(good.filter((p) => p === turn || (p.kind === 'turn' && p.seq === 0))).toHaveLength(2);
  });
});

describe('LiveSession — mode-aware steer routing', () => {
  it('passes the steer mode through to the installed sink', () => {
    const s = new LiveSession('c1');
    const seen: Array<{ text: string; mode: string }> = [];
    s.setSteerSink((text, mode) => seen.push({ text, mode }));
    expect(s.pushSteer('a', 'queue')).toBe(true);
    expect(s.pushSteer('b', 'barge-in')).toBe(true);
    expect(seen).toEqual([
      { text: 'a', mode: 'queue' },
      { text: 'b', mode: 'barge-in' },
    ]);
  });

  it('pushSteer returns false when no sink is installed (per-turn fallback)', () => {
    const s = new LiveSession('c1');
    expect(s.pushSteer('a', 'barge-in')).toBe(false);
  });
});

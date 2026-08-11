import { describe, it, expect, vi } from 'vitest';
import { LiveSession } from './live-session.js';
import { runLiveSession } from './run-live-session.js';

describe('runLiveSession', () => {
  it('runs each queued turn in order then idles, and ends when the session closes', async () => {
    const s = new LiveSession('c1');
    const seen: string[] = [];
    const runTurn = vi.fn(async (t) => {
      seen.push(t.input);
    });
    s.enqueue({ input: 'one' });
    s.enqueue({ input: 'two' });
    const done = runLiveSession(s, runTurn);
    // let the two turns drain, then close
    await vi.waitFor(() => expect(seen).toEqual(['one', 'two']));
    expect(s.state).toBe('idle');
    s.close();
    await done;
  });

  it('does not dispatch a turn that was already queued behind an in-flight turn when the session closes mid-turn (Q14)', async () => {
    const s = new LiveSession('c1');
    const seen: string[] = [];
    let releaseFirst: () => void = () => {};
    const runTurn = vi.fn(async (t: { input: string }) => {
      seen.push(t.input);
      if (t.input === 'first') {
        // Block here to simulate a turn still genuinely in flight against the
        // backend (e.g. establishHeldQuery awaiting its boundary) — the exact
        // window in which a registry-driven close (an explicit closeSession,
        // or a cascade from a parent) can race a second, already-queued turn.
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
    });
    s.enqueue({ input: 'first' });
    const done = runLiveSession(s, runTurn);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));

    // The loop is busy inside runTurn('first') and has not called nextTurn()
    // again yet, so this lands in the session's internal queue rather than
    // being handed off directly.
    s.enqueue({ input: 'second' });

    // Close the session the way the registry's single teardown path does —
    // while a turn is still running and another sits queued behind it.
    s.close();
    releaseFirst();
    await done;

    // The queued turn must never reach runTurn (i.e. never dispatch a new
    // backend query) once the session has closed.
    expect(seen).toEqual(['first']);
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it('a throwing turn is surfaced as an error frame and the loop continues', async () => {
    const s = new LiveSession('c1');
    const pushes: unknown[] = [];
    s.subscribe((p) => pushes.push(p));
    let n = 0;
    const runTurn = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('boom');
    });
    s.enqueue({ input: 'bad' });
    s.enqueue({ input: 'good' });
    const done = runLiveSession(s, runTurn);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(2));
    s.close();
    await done;
    expect(pushes).toContainEqual(
      expect.objectContaining({ kind: 'turn', frame: expect.objectContaining({ t: 'error' }) }),
    );
  });

  it('marks the loop-failure error push live-only, so its id never collides with a reloaded frame', async () => {
    const s = new LiveSession('c1');
    const pushes: { live?: boolean; frame?: { t?: string } }[] = [];
    s.subscribe((p) => pushes.push(p as (typeof pushes)[number]));
    const runTurn = vi.fn(async () => {
      throw new Error('boom');
    });
    s.enqueue({ input: 'bad' });
    const done = runLiveSession(s, runTurn);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    s.close();
    await done;
    const errorPush = pushes.find((p) => p.frame?.t === 'error');
    expect(errorPush?.live).toBe(true);
  });
});

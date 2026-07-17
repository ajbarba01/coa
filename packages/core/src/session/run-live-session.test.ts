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
});

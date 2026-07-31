import { describe, expect, it } from 'vitest';
import {
  runChain,
  nextLocalMidnight,
  type ChainEntry,
  type CooldownStore,
  type ProviderOutcome,
} from './routing.js';

/** An in-memory CooldownStore that records calls, for deterministic routing tests. */
function fakeStore(seed: Record<string, number> = {}): CooldownStore & {
  marks: Array<{ id: string; until: number }>;
  cleared: string[];
} {
  const cooldowns = { ...seed };
  const marks: Array<{ id: string; until: number }> = [];
  const cleared: string[] = [];
  return {
    marks,
    cleared,
    isCoolingDown: (id, now) => cooldowns[id] !== undefined && cooldowns[id]! > now,
    markCooldown: (id, until) => {
      cooldowns[id] = until;
      marks.push({ id, until });
    },
    clear: (id) => {
      delete cooldowns[id];
      cleared.push(id);
    },
  };
}

const entry = (keyStateId: string, outcome: ProviderOutcome<string>): ChainEntry<string> => ({
  keyStateId,
  run: async () => outcome,
});

const MIDNIGHT = (now: number) => now + 1_000_000; // deterministic stand-in for the quota cooldown

describe('runChain', () => {
  it('returns the first ok value with its clean flag and clears its prior cooldown', async () => {
    const store = fakeStore();
    const res = await runChain(
      [entry('a', { status: 'ok', value: 'first', clean: true })],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toEqual({ status: 'ok', value: 'first', clean: true });
    expect(store.cleared).toEqual(['a']);
  });

  it('falls through in order to the next live entry', async () => {
    const store = fakeStore();
    const res = await runChain(
      [
        entry('a', { status: 'error', reason: 'boom' }),
        entry('b', { status: 'ok', value: 'second', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toMatchObject({ status: 'ok', value: 'second', clean: false });
  });

  it('skips an entry that is still cooling down', async () => {
    const store = fakeStore({ a: 100 });
    let ran = false;
    const res = await runChain(
      [
        {
          keyStateId: 'a',
          run: async () => {
            ran = true;
            return { status: 'ok', value: 'x', clean: true };
          },
        },
        entry('b', { status: 'ok', value: 'floor', clean: false }),
      ],
      store,
      50, // now < 100 ⇒ 'a' is cooling down
      MIDNIGHT,
    );
    expect(ran).toBe(false);
    expect(res).toMatchObject({ status: 'ok', value: 'floor' });
  });

  it('on a rate-limit with retryAfterMs, cools down until now + retryAfterMs then continues', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'limit', kind: 'rate-limit', retryAfterMs: 5000 }),
        entry('b', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      1000,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([{ id: 'a', until: 6000 }]);
  });

  it('on a quota limit (or a rate-limit with no retryAfterMs), cools down to the quota deadline', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'limit', kind: 'quota' }),
        entry('b', { status: 'limit', kind: 'rate-limit' }), // no retryAfterMs ⇒ ambiguous ⇒ quota deadline
        entry('c', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([
      { id: 'a', until: 1_000_000 },
      { id: 'b', until: 1_000_000 },
    ]);
  });

  it('on an error, tries the next entry WITHOUT setting a cooldown', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'error', reason: 'net' }),
        entry('b', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([]);
  });

  it('returns exhausted with the last reason when every entry is exhausted', async () => {
    const store = fakeStore();
    const res = await runChain(
      [
        entry('a', { status: 'limit', kind: 'quota' }),
        entry('b', { status: 'error', reason: 'dead-url' }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toEqual({ status: 'exhausted', lastReason: 'dead-url' });
  });
});

describe('nextLocalMidnight', () => {
  it('returns the next local midnight strictly after now', () => {
    const now = new Date(2026, 6, 3, 14, 30, 0).getTime(); // 2026-07-03 14:30 local
    const midnight = nextLocalMidnight(now);
    const d = new Date(midnight);
    expect(midnight).toBeGreaterThan(now);
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(4);
  });
});

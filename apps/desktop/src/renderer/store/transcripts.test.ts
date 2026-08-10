// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { TurnFrame } from '@coa/console-viewmodel';
import {
  appendFrames,
  applyReload,
  beginHydration,
  evictColdest,
  evictTranscript,
  flushFrames,
  hydrationFailed,
  resetTranscripts,
  touchTranscript,
  useTranscripts,
} from './transcripts.js';

const text = (id: string, body: string, role: 'you' | 'agent' = 'agent'): TurnFrame => ({
  id,
  role,
  kind: 'text',
  text: body,
});

const entry = (id: string) => useTranscripts.getState().bySession[id];
const frames = (id: string): TurnFrame[] => {
  const e = entry(id);
  if (e?.status !== 'ok') throw new Error(`session ${id} is not materialized`);
  return e.value;
};

function flushRaf(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

beforeEach(() => resetTranscripts());

describe('the transcript slice owns per-session frames', () => {
  it('coalesces appends and lands them in the owning session only', async () => {
    appendFrames('a', [text('a:0', 'first')]);
    appendFrames('b', [text('b:0', 'other')]);
    // Nothing lands synchronously — the flush rides the animation frame.
    expect(entry('a')).toBeUndefined();
    await flushRaf();
    expect(frames('a')).toEqual([text('a:0', 'first')]);
    expect(frames('b')).toEqual([text('b:0', 'other')]);
  });

  it('an append to one session keeps every other entry reference-identical', async () => {
    appendFrames('a', [text('a:0', 'first')]);
    appendFrames('b', [text('b:0', 'other')]);
    await flushRaf();
    const aBefore = entry('a');
    const bBefore = entry('b');
    appendFrames('b', [text('b:1', 'more')]);
    flushFrames();
    expect(entry('a')).toBe(aBefore);
    expect(entry('b')).not.toBe(bBefore);
  });

  it('keeps settled frames identity-stable across appends (the memo-row contract)', async () => {
    appendFrames('a', [text('a:0', 'first')]);
    await flushRaf();
    const settled = frames('a')[0];
    appendFrames('a', [text('a:1', 'second')]);
    flushFrames();
    expect(frames('a')[0]).toBe(settled);
  });

  it('folds streaming deltas into the open block and settles without duplicating', async () => {
    appendFrames('a', [
      { id: 'a:0', role: 'agent', kind: 'text', text: 'hel', streaming: true },
      { id: 'a:1', role: 'agent', kind: 'text', text: 'lo', streaming: true },
    ]);
    await flushRaf();
    expect(frames('a')).toEqual([
      { id: 'a:0', role: 'agent', kind: 'text', text: 'hello', streaming: true },
    ]);
    appendFrames('a', [text('a:2', 'hello there')]);
    flushFrames();
    // The settled frame replaced the open block, keeping the row's id.
    expect(frames('a')).toEqual([{ id: 'a:0', role: 'agent', kind: 'text', text: 'hello there' }]);
  });

  it('hydration states: cold shows loading, a warm entry is never demoted', () => {
    beginHydration('cold');
    expect(entry('cold')).toEqual({ status: 'loading' });
    applyReload('warm', [text('warm:0', 'kept')]);
    beginHydration('warm');
    expect(frames('warm')).toEqual([text('warm:0', 'kept')]);
    hydrationFailed('warm', 'nope');
    expect(frames('warm')).toEqual([text('warm:0', 'kept')]);
    hydrationFailed('cold', 'no daemon');
    expect(entry('cold')).toEqual({ status: 'error', message: 'no daemon' });
  });

  it('a reload into a cold session IS the transcript', () => {
    applyReload('a', [text('a:0', 'from the log')]);
    expect(frames('a')).toEqual([text('a:0', 'from the log')]);
  });

  it('a reload into a warm buffer dedupes the overlap and keeps frames newer than the log', async () => {
    // Live pushes landed seqs 0..2; the reload snapshot covers 0..1 (taken before 2).
    appendFrames('a', [text('a:0', 'hi', 'you'), text('a:1', 'working'), text('a:2', 'newest')]);
    await flushRaf();
    applyReload('a', [text('a:0', 'hi', 'you'), text('a:1', 'working')]);
    expect(frames('a').map((f) => f.id)).toEqual(['a:0', 'a:1', 'a:2']);
  });

  it('a reload folds frames still waiting on the animation frame before merging', () => {
    appendFrames('a', [text('a:5', 'flushed by the merge')]);
    // No rAF wait: applyReload must flush the pending buffer itself, or the merge
    // would run against an empty entry and the follow-up flush would double frames.
    applyReload('a', [text('a:4', 'from the log')]);
    expect(frames('a').map((f) => f.id)).toEqual(['a:4', 'a:5']);
  });

  it('console-local optimistic frames yield to a reload (the durable log is the authority)', async () => {
    appendFrames('a', [text('you:1', 'typed locally', 'you'), text('a:0', 'persisted')]);
    await flushRaf();
    applyReload('a', [text('a:0', 'persisted'), text('a:1', 'canonical user turn', 'you')]);
    expect(frames('a').map((f) => f.id)).toEqual(['a:0', 'a:1']);
  });

  it('a streaming partial newer than the log survives a reload merge as the open block', async () => {
    appendFrames('a', [
      text('a:0', 'settled'),
      { id: 'a:1', role: 'agent', kind: 'text', text: 'partial…', streaming: true },
    ]);
    await flushRaf();
    applyReload('a', [text('a:0', 'settled')]);
    expect(frames('a')).toEqual([
      text('a:0', 'settled'),
      { id: 'a:1', role: 'agent', kind: 'text', text: 'partial…', streaming: true },
    ]);
    // The settled frame that eventually arrives still replaces that open block.
    appendFrames('a', [text('a:2', 'partial…done')]);
    flushFrames();
    expect(frames('a')).toEqual([
      text('a:0', 'settled'),
      { id: 'a:1', role: 'agent', kind: 'text', text: 'partial…done' },
    ]);
  });

  it('evicts a deleted session outright', async () => {
    appendFrames('a', [text('a:0', 'x')]);
    await flushRaf();
    evictTranscript('a');
    expect(entry('a')).toBeUndefined();
  });

  it('a deleted session stays gone even with frames still waiting on the flush', async () => {
    appendFrames('a', [text('a:0', 'x')]);
    // The delete lands mid-buffer (the ordinary case for a session deleted while its
    // optimistic send frame is still queued).
    evictTranscript('a');
    await flushRaf();
    flushFrames();
    expect(entry('a')).toBeUndefined();
  });
});

describe('the memory cap over materialized transcripts', () => {
  /** Materialize `ids` in order, so each is warmer than the one before it. */
  function materialize(...ids: string[]): void {
    for (const id of ids) {
      appendFrames(id, [text(`${id}:0`, 'x')]);
      flushFrames();
    }
  }
  const held = (): string[] => Object.keys(useTranscripts.getState().bySession).sort();

  it('keeps the store at the cap by dropping the coldest entries first', () => {
    materialize('a', 'b', 'c', 'd');
    expect(evictColdest([], 2)).toEqual(['a', 'b']);
    expect(held()).toEqual(['c', 'd']);
  });

  it('holds everything while the store is within the cap', () => {
    materialize('a', 'b');
    expect(evictColdest([], 2)).toEqual([]);
    expect(held()).toEqual(['a', 'b']);
  });

  it('never evicts a mounted transcript, however far over the cap', () => {
    materialize('a', 'b', 'c');
    // Every entry is an open tab: the working set simply exceeds the cap. Blanking a
    // visible tab to make room would be a worse answer than holding one more transcript.
    expect(evictColdest(['a', 'b', 'c'], 1)).toEqual([]);
    expect(held()).toEqual(['a', 'b', 'c']);
  });

  it('evicts only as far as the unprotected entries reach', () => {
    materialize('cold', 'a', 'b');
    expect(evictColdest(['a', 'b'], 1)).toEqual(['cold']);
    expect(held()).toEqual(['a', 'b']);
  });

  it('ranks a session the user opened above a noisier one it never read', () => {
    materialize('read', 'streaming');
    // `read` was materialized first, so stream traffic alone would make it the coldest.
    touchTranscript('read');
    expect(evictColdest([], 1)).toEqual(['streaming']);
    expect(held()).toEqual(['read']);
  });

  it('an evicted session that comes back is the newest, not still the oldest', () => {
    materialize('a', 'b');
    evictColdest([], 1);
    materialize('a');
    expect(evictColdest([], 1)).toEqual(['b']);
    expect(held()).toEqual(['a']);
  });
});

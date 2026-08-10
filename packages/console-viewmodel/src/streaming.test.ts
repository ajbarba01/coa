import { describe, expect, it } from 'vitest';
import { appendStreamingFrame, reconcileStreaming } from './streaming.js';
import type { TurnFrame } from './reads.js';

const textDelta = (id: string, text: string): TurnFrame => ({
  id,
  role: 'agent',
  kind: 'text',
  text,
  streaming: true,
});
const thinkingDelta = (id: string, text: string): TurnFrame => ({
  id,
  role: 'agent',
  kind: 'thinking',
  text,
  streaming: true,
});
const settledText = (id: string, text: string): TurnFrame => ({
  id,
  role: 'agent',
  kind: 'text',
  text,
});
const settledThinking = (id: string, text: string): TurnFrame => ({
  id,
  role: 'agent',
  kind: 'thinking',
  text,
});

describe('reconcileStreaming', () => {
  it('settles an open thinking block when agent output text begins (#3)', () => {
    const turns = reconcileStreaming([], [thinkingDelta('th', 'reasoning')]);
    expect((turns[0] as { streaming?: boolean }).streaming).toBe(true);
    // Output text starts → the reasoning that preceded it is done, so its live flag clears
    // now (its auto-collapse fires) rather than waiting for the message-end settled frame.
    const next = reconcileStreaming(turns, [textDelta('tx', 'Answer')]);
    const thinking = next.find((f) => f.kind === 'thinking') as { streaming?: boolean };
    expect(thinking.streaming).toBe(false);
  });

  it('accumulates consecutive text deltas into one live block', () => {
    const turns = reconcileStreaming([], [textDelta('a', 'Hel'), textDelta('b', 'lo')]);
    expect(turns).toEqual([
      { id: 'a', role: 'agent', kind: 'text', text: 'Hello', streaming: true },
    ]);
  });

  it('replaces the live text block with the settled frame (no double-render), keeping the id', () => {
    const turns = reconcileStreaming(
      [],
      [textDelta('a', 'Hel'), textDelta('b', 'lo'), settledText('c', 'Hello')],
    );
    expect(turns).toEqual([{ id: 'a', role: 'agent', kind: 'text', text: 'Hello' }]);
  });

  it('settles a thinking block that is no longer the trailing frame (thinking, then text stream)', () => {
    // real order within a round-trip: thinking deltas, text deltas, settled thinking, settled text
    const turns = reconcileStreaming(
      [],
      [
        thinkingDelta('t1', 'po'),
        thinkingDelta('t2', 'nder'),
        textDelta('x1', 'Ans'),
        textDelta('x2', 'wer'),
        settledThinking('ts', 'ponder'),
        settledText('xs', 'Answer'),
      ],
    );
    expect(turns).toEqual([
      { id: 't1', role: 'agent', kind: 'thinking', text: 'ponder' },
      { id: 'x1', role: 'agent', kind: 'text', text: 'Answer' },
    ]);
  });

  it('passes non-streaming frames through unchanged (pass-through floor / reloaded log has no deltas)', () => {
    const you: TurnFrame = { id: 'u', role: 'you', kind: 'text', text: 'hi' };
    const settled = settledText('s', 'reply');
    expect(reconcileStreaming([], [you, settled])).toEqual([you, settled]);
  });

  it('starts a fresh live block per round-trip (a settled block is not re-opened)', () => {
    const first = reconcileStreaming([], [textDelta('a', 'one'), settledText('b', 'one')]);
    const second = reconcileStreaming(first, [textDelta('c', 'two')]);
    expect(second).toEqual([
      { id: 'a', role: 'agent', kind: 'text', text: 'one' },
      { id: 'c', role: 'agent', kind: 'text', text: 'two', streaming: true },
    ]);
  });

  it('leaves a tool_use frame between blocks intact', () => {
    const toolUse: TurnFrame = {
      id: 'tu',
      role: 'agent',
      kind: 'tool-use',
      tool: 'Read',
      input: '{}',
    };
    const turns = reconcileStreaming([], [textDelta('a', 'Hi'), settledText('b', 'Hi'), toolUse]);
    expect(turns).toEqual([{ id: 'a', role: 'agent', kind: 'text', text: 'Hi' }, toolUse]);
  });
});

describe('appendStreamingFrame', () => {
  it('does not mutate the input array', () => {
    const prev: TurnFrame[] = [textDelta('a', 'Hel')];
    const next = appendStreamingFrame(prev, textDelta('b', 'lo'));
    expect(prev).toEqual([{ id: 'a', role: 'agent', kind: 'text', text: 'Hel', streaming: true }]);
    expect(next[0]).toMatchObject({ text: 'Hello' });
  });
});

describe('an interrupted turn settles from the daemon, not a console-side seal', () => {
  it('replaces the live block with the daemon-settled frame instead of appending a duplicate', () => {
    // The daemon settles the partial it streamed (deltas are never persisted) and pushes it as a
    // settled frame. Reconciliation must REPLACE the live block — appending would show the same
    // partial twice (the reported duplicated-poem bug).
    const live = reconcileStreaming([], [textDelta('a', 'The clock'), textDelta('b', 'maker')]);
    const settled = reconcileStreaming(live, [settledText('c', 'The clockmaker')]);
    expect(settled).toEqual([{ id: 'a', role: 'agent', kind: 'text', text: 'The clockmaker' }]);
  });

  it('settles an open reasoning block from the daemon frame, so the next turn opens a fresh one', () => {
    const live = reconcileStreaming([], [thinkingDelta('t', 'half a thought')]);
    const settled = reconcileStreaming(live, [settledThinking('ts', 'half a thought')]);
    expect(settled).toEqual([{ id: 't', role: 'agent', kind: 'thinking', text: 'half a thought' }]);
    const next = reconcileStreaming(settled, [thinkingDelta('t2', 'new thought')]);
    expect(next).toHaveLength(2);
  });
});

import type { Push, TurnFrame as WireTurnFrame } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { pushToBanner, pushToViewFrames } from './turn-map.js';

/** Wrap a wire turn frame in its `turn` Push (sessionId `s`, given seq). */
const turn = (frame: WireTurnFrame, seq = 0): Push => ({
  kind: 'turn',
  sessionId: 's',
  worktree: 'w',
  seq,
  frame,
});

describe('pushToViewFrames — daemon CON-PUSH → console TurnFrame', () => {
  it('maps assistant text to a text frame keyed by session:seq', () => {
    expect(pushToViewFrames(turn({ t: 'text', text: 'hello' }, 2))).toEqual([
      { id: 's:2', role: 'agent', kind: 'text', text: 'hello' },
    ]);
  });

  it('renders a tool_use with its args stringified', () => {
    expect(pushToViewFrames(turn({ t: 'tool_use', tool: 'Read', input: { path: 'a.ts' }, handle: 'h' }))).toEqual([
      { id: 's:0', role: 'agent', kind: 'tool-use', tool: 'Read', input: '{"path":"a.ts"}' },
    ]);
  });

  it('maps a tool_result, carrying ok + the pointer as output', () => {
    expect(pushToViewFrames(turn({ t: 'tool_result', handle: 'h', ok: false, pointer: 'boom' }))).toEqual([
      { id: 's:0', role: 'agent', kind: 'tool-result', tool: '', output: 'boom', ok: false },
    ]);
  });

  it('surfaces an error frame as an agent text line', () => {
    const frames = pushToViewFrames(turn({ t: 'error', message: 'kaboom', origin: 'loop' }));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ role: 'agent', kind: 'text' });
    expect((frames[0] as { text: string }).text).toContain('kaboom');
  });

  it('shows thinking as an agent text line', () => {
    expect(pushToViewFrames(turn({ t: 'thinking', text: 'hmm' }))[0]).toMatchObject({
      role: 'agent',
      kind: 'text',
    });
  });

  it('drops lifecycle-only frames (turn-boundary, subagent, reconcile, permission)', () => {
    expect(pushToViewFrames(turn({ t: 'turn-boundary', role: 'assistant' }))).toEqual([]);
    expect(pushToViewFrames(turn({ t: 'subagent', childWorktree: 'c', event: 'spawn' }))).toEqual([]);
    expect(pushToViewFrames(turn({ t: 'reconcile', changeSeq: 1, pointer: 'p' }))).toEqual([]);
    expect(pushToViewFrames(turn({ t: 'permission', requestId: 'r' }))).toEqual([]);
  });

  it('ignores non-turn pushes (cost/status handled elsewhere)', () => {
    expect(pushToViewFrames({ kind: 'status', sessionId: 's', worktree: 'w', state: 'running' })).toEqual([]);
    expect(pushToViewFrames({ kind: 'cost', sessionId: 's', spent: 1, remaining: 2, capHit: false })).toEqual([]);
  });

  it('never routes a banner into the transcript (it is system-only)', () => {
    const banner: Push = {
      kind: 'banner',
      sessionId: 's',
      banner: { id: 'drift', kind: 'drift', reason: 'r' },
    };
    expect(pushToViewFrames(banner)).toEqual([]);
  });
});

describe('pushToBanner — banner push → system banner', () => {
  it('yields the descriptor of a banner push', () => {
    const banner: Push = {
      kind: 'banner',
      sessionId: 's',
      banner: {
        id: 'drift',
        kind: 'drift',
        reason: 'The config changed under the running prompt.',
        actions: [{ id: 'recompile', label: 'Recompile', primary: true }],
      },
    };
    expect(pushToBanner(banner)).toEqual(banner.banner);
  });

  it('yields undefined for any non-banner push', () => {
    expect(pushToBanner({ kind: 'status', sessionId: 's', worktree: 'w', state: 'running' })).toBeUndefined();
    expect(pushToBanner({ kind: 'tokens', sessionId: 's', delta: 'x' })).toBeUndefined();
  });
});

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
    expect(
      pushToViewFrames(turn({ t: 'tool_use', tool: 'Read', input: { path: 'a.ts' }, handle: 'h' })),
    ).toEqual([
      {
        id: 's:0',
        role: 'agent',
        kind: 'tool-use',
        tool: 'Read',
        input: '{"path":"a.ts"}',
        handle: 'h',
      },
    ]);
  });

  it('maps a tool_result, carrying ok + the pointer as output', () => {
    expect(
      pushToViewFrames(turn({ t: 'tool_result', handle: 'h', ok: false, pointer: 'boom' })),
    ).toEqual([
      {
        id: 's:0',
        role: 'agent',
        kind: 'tool-result',
        tool: '',
        output: 'boom',
        ok: false,
        handle: 'h',
      },
    ]);
  });

  it('maps thinking to a thinking frame', () => {
    expect(pushToViewFrames(turn({ t: 'thinking', text: 'hmm' }))[0]).toMatchObject({
      kind: 'thinking',
      role: 'agent',
      text: 'hmm',
    });
  });

  it('carries the thinking durationMs through so the reveal shows "Thought for Ns" live and on reload', () => {
    expect(
      pushToViewFrames(turn({ t: 'thinking', text: 'hmm', durationMs: 4200 }))[0],
    ).toMatchObject({
      kind: 'thinking',
      text: 'hmm',
      durationMs: 4200,
    });
  });

  it('maps a text-delta to a streaming agent text frame', () => {
    expect(pushToViewFrames(turn({ t: 'text-delta', text: 'Hel' }, 3))).toEqual([
      { id: 's:3', role: 'agent', kind: 'text', text: 'Hel', streaming: true },
    ]);
  });

  it('maps a thinking-delta to a streaming agent thinking frame', () => {
    expect(pushToViewFrames(turn({ t: 'thinking-delta', text: 'po' }, 4))).toEqual([
      { id: 's:4', role: 'agent', kind: 'thinking', text: 'po', streaming: true },
    ]);
  });

  it('maps the interrupted marker to its own view frame (so live and reload render the same line)', () => {
    expect(pushToViewFrames(turn({ t: 'interrupted' }, 9))).toEqual([
      { id: 's:9', kind: 'interrupted' },
    ]);
  });

  it('drops empty-text thinking frames', () => {
    expect(pushToViewFrames(turn({ t: 'thinking', text: '  ' }))).toEqual([]);
  });

  it('maps error to an error frame with origin', () => {
    expect(
      pushToViewFrames(turn({ t: 'error', message: 'boom', origin: 'tool' }))[0],
    ).toMatchObject({
      kind: 'error',
      message: 'boom',
      origin: 'tool',
    });
  });

  it('maps a TodoWrite tool_use to a plan frame', () => {
    const f = pushToViewFrames(
      turn({
        t: 'tool_use',
        tool: 'TodoWrite',
        handle: 'h',
        input: {
          todos: [{ content: 'ship it', status: 'in_progress', activeForm: 'Shipping it' }],
        },
      }),
    )[0];
    expect(f).toMatchObject({ kind: 'plan', items: [{ text: 'ship it', status: 'in-progress' }] });
  });

  it('maps a non-TodoWrite tool_use to a tool-use frame carrying its handle', () => {
    expect(
      pushToViewFrames(
        turn({ t: 'tool_use', tool: 'Read', input: { path: 'a' }, handle: 'h9' }),
      )[0],
    ).toMatchObject({ kind: 'tool-use', tool: 'Read', handle: 'h9' });
  });

  it('maps a subagent frame and sets child depth from parentTurn', () => {
    const push = {
      ...turn({ t: 'subagent', childWorktree: 'wt', event: 'rollup' }),
      parentTurn: { sessionId: 's', seq: 0 },
    };
    expect(pushToViewFrames(push as Push)[0]).toMatchObject({
      kind: 'subagent',
      childWorktree: 'wt',
      depth: 1,
    });
  });

  it('still drops turn-boundary and reconcile (deferred)', () => {
    expect(pushToViewFrames(turn({ t: 'turn-boundary', role: 'assistant' }))).toEqual([]);
    expect(pushToViewFrames(turn({ t: 'reconcile', changeSeq: 1, pointer: 'p' }))).toEqual([]);
  });

  it('ignores non-turn pushes (cost/status handled elsewhere)', () => {
    expect(
      pushToViewFrames({ kind: 'status', sessionId: 's', worktree: 'w', state: 'running' }),
    ).toEqual([]);
    expect(
      pushToViewFrames({ kind: 'cost', sessionId: 's', spent: 1, remaining: 2, capHit: false }),
    ).toEqual([]);
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
    expect(
      pushToBanner({ kind: 'status', sessionId: 's', worktree: 'w', state: 'running' }),
    ).toBeUndefined();
    expect(pushToBanner({ kind: 'tokens', sessionId: 's', delta: 'x' })).toBeUndefined();
  });
});

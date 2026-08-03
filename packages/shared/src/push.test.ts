import { describe, expect, it } from 'vitest';
import { pushSchema, turnFrameSchema } from './push.js';

describe('pushSchema', () => {
  it('accepts the tokens floor stream', () => {
    expect(pushSchema.parse({ kind: 'tokens', sessionId: 's1', delta: 'hello' }).kind).toBe(
      'tokens',
    );
  });

  it('accepts a structured turn carrying a tool_use frame', () => {
    const push = {
      kind: 'turn' as const,
      sessionId: 's1',
      worktree: 'wt-1',
      seq: 12,
      frame: { t: 'tool_use' as const, tool: 'edit_symbol', input: { ref: 'foo' }, handle: 'h1' },
    };
    expect(pushSchema.parse(push)).toMatchObject({ kind: 'turn', frame: { t: 'tool_use' } });
  });

  it('accepts a system banner carrying an actionable drift notice', () => {
    const push = {
      kind: 'banner' as const,
      sessionId: 's1',
      banner: {
        id: 'drift',
        kind: 'drift' as const,
        reason: 'The agent config changed under the running prompt.',
        actions: [
          { id: 'recompile', label: 'Recompile', primary: true },
          { id: 'keep', label: 'Keep' },
        ],
      },
    };
    expect(pushSchema.parse(push)).toMatchObject({ kind: 'banner', banner: { kind: 'drift' } });
  });

  it('accepts a banner with no actions (a passive notice)', () => {
    const push = {
      kind: 'banner' as const,
      sessionId: 's1',
      banner: { id: 'cache', kind: 'cache' as const, reason: 'Prompt cache likely cold.' },
    };
    expect(pushSchema.safeParse(push).success).toBe(true);
  });

  it('rejects a banner with an unknown banner kind', () => {
    const push = {
      kind: 'banner',
      sessionId: 's1',
      banner: { id: 'x', kind: 'nonsense', reason: 'r' },
    };
    expect(pushSchema.safeParse(push).success).toBe(false);
  });

  it('rejects an unknown push kind', () => {
    expect(pushSchema.safeParse({ kind: 'telepathy', sessionId: 's1' }).success).toBe(false);
  });

  it('accepts the interrupted status (a user stop, not a governance block)', () => {
    const push = {
      kind: 'status' as const,
      sessionId: 's1',
      worktree: 'wt-1',
      state: 'interrupted' as const,
    };
    expect(pushSchema.parse(push)).toMatchObject({ kind: 'status', state: 'interrupted' });
  });
});

describe('turnFrameSchema', () => {
  it('accepts each discriminated variant', () => {
    expect(turnFrameSchema.parse({ t: 'thinking', text: 'hmm' }).t).toBe('thinking');
    expect(turnFrameSchema.parse({ t: 'reconcile', changeSeq: 4, pointer: 'p' }).t).toBe(
      'reconcile',
    );
    expect(turnFrameSchema.parse({ t: 'subagent', childWorktree: 'wt-2', event: 'spawn' }).t).toBe(
      'subagent',
    );
  });

  it('rejects a frame with a bad origin enum', () => {
    expect(turnFrameSchema.safeParse({ t: 'error', message: 'm', origin: 'space' }).success).toBe(
      false,
    );
  });

  it('accepts the interrupted marker frame (a persisted user stop, not an error)', () => {
    expect(turnFrameSchema.parse({ t: 'interrupted' })).toEqual({ t: 'interrupted' });
  });

  it('carries an optional thinking durationMs (persisted so reload shows "Thought for Ns" identically)', () => {
    const withDuration = turnFrameSchema.parse({ t: 'thinking', text: 'hmm', durationMs: 4200 });
    expect(withDuration).toEqual({ t: 'thinking', text: 'hmm', durationMs: 4200 });
    // Still optional — a non-streamed backend (or the floor) omits it.
    expect(turnFrameSchema.parse({ t: 'thinking', text: 'hmm' })).toEqual({
      t: 'thinking',
      text: 'hmm',
    });
  });
});

describe('turnFrameSchema delta kinds', () => {
  it('accepts a text-delta frame', () => {
    const parsed = turnFrameSchema.parse({ t: 'text-delta', text: 'hel' });
    expect(parsed).toEqual({ t: 'text-delta', text: 'hel' });
  });

  it('accepts a thinking-delta frame', () => {
    const parsed = turnFrameSchema.parse({ t: 'thinking-delta', text: 'ponder' });
    expect(parsed).toEqual({ t: 'thinking-delta', text: 'ponder' });
  });
});

describe('turnFrameSchema — the deliberate-stop vocabulary', () => {
  it('accepts a cost-cap deny', () => {
    const frame = { t: 'deny', denyKind: 'cost-cap', reason: 'cost cap reached' };
    expect(turnFrameSchema.parse(frame)).toEqual(frame);
  });

  it('accepts a close-gate deny', () => {
    const frame = { t: 'deny', denyKind: 'close-gate', reason: 'open invariant' };
    expect(turnFrameSchema.parse(frame)).toEqual(frame);
  });

  it('rejects a denyKind the console cannot render', () => {
    // The enum matches console-viewmodel's `reads.ts` exactly; widening it here without
    // widening the renderer would ship a frame nothing can draw.
    expect(() =>
      turnFrameSchema.parse({ t: 'deny', denyKind: 'max-turns', reason: 'x' }),
    ).toThrow();
  });

  it('carries an optional terminal reason on a turn boundary', () => {
    expect(
      turnFrameSchema.parse({ t: 'turn-boundary', role: 'assistant', terminal: 'max_turns' }),
    ).toEqual({ t: 'turn-boundary', role: 'assistant', terminal: 'max_turns' });
    expect(turnFrameSchema.parse({ t: 'turn-boundary', role: 'assistant' })).toEqual({
      t: 'turn-boundary',
      role: 'assistant',
    });
  });
});

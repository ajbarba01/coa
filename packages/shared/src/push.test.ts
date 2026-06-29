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

  it('rejects an unknown push kind', () => {
    expect(pushSchema.safeParse({ kind: 'telepathy', sessionId: 's1' }).success).toBe(false);
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
});

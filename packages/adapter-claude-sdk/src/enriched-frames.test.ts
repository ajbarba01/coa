import { describe, it, expect } from 'vitest';
import { messageToEnrichedFrames } from './enriched-frames.js';

describe('messageToEnrichedFrames', () => {
  it('carries the full tool-result body as `full` alongside the lossy pointer frame', () => {
    const msg = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'h1', content: 'THE FULL RESULT BODY' }],
      },
    } as never;
    const out = messageToEnrichedFrames(msg);
    expect(out).toEqual([
      {
        frame: { t: 'tool_result', handle: 'h1', ok: true, pointer: 'THE FULL RESULT BODY' },
        full: 'THE FULL RESULT BODY',
      },
    ]);
  });

  it('emits a plain frame (no full) for a text/assistant message', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } } as never;
    expect(messageToEnrichedFrames(msg)).toEqual([{ frame: { t: 'text', text: 'hi' } }]);
  });
});

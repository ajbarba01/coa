import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { messageToBackendMessages } from './transcript.js';

/** Build a minimal SDK message; the mapper reads only a few fields (cast through unknown). */
function sdk(message: unknown): SDKMessage {
  return message as SDKMessage;
}

describe('messageToBackendMessages — SDK message → neutral transcript', () => {
  it('maps an assistant text turn to one assistant message', () => {
    expect(
      messageToBackendMessages(
        sdk({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
      ),
    ).toEqual([{ role: 'assistant', content: 'hello' }]);
  });

  it('joins multiple text blocks and carries tool_use blocks as toolCalls', () => {
    expect(
      messageToBackendMessages(
        sdk({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'let me ' },
              { type: 'text', text: 'look' },
              { type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a.ts' } },
            ],
          },
        }),
      ),
    ).toEqual([
      {
        role: 'assistant',
        content: 'let me look',
        toolCalls: [{ id: 'tu_1', name: 'Read', arguments: { path: 'a.ts' } }],
      },
    ]);
  });

  it('drops thinking/unknown blocks from the neutral content (memory is text + calls)', () => {
    expect(
      messageToBackendMessages(
        sdk({
          type: 'assistant',
          message: {
            content: [
              { type: 'thinking', thinking: 'secret' },
              { type: 'text', text: 'answer' },
            ],
          },
        }),
      ),
    ).toEqual([{ role: 'assistant', content: 'answer' }]);
  });

  it('maps a user tool_result to a tool message keyed by tool_use_id, keeping FULL content', () => {
    const big = 'x'.repeat(5000);
    expect(
      messageToBackendMessages(
        sdk({
          type: 'user',
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: big }] },
        }),
      ),
    ).toEqual([{ role: 'tool', toolCallId: 'tu_1', content: big }]);
  });

  it('flattens an array tool_result to its joined text', () => {
    expect(
      messageToBackendMessages(
        sdk({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_2',
                content: [
                  { type: 'text', text: 'line1\n' },
                  { type: 'text', text: 'line2' },
                ],
              },
            ],
          },
        }),
      ),
    ).toEqual([{ role: 'tool', toolCallId: 'tu_2', content: 'line1\nline2' }]);
  });

  it('ignores the echoed plain-string user prompt (the caller records it from raw input)', () => {
    expect(messageToBackendMessages(sdk({ type: 'user', message: { content: 'hi' } }))).toEqual([]);
  });

  it('drops an empty assistant turn and transport/result messages', () => {
    expect(
      messageToBackendMessages(sdk({ type: 'assistant', message: { content: [] } })),
    ).toEqual([]);
    expect(messageToBackendMessages(sdk({ type: 'result', subtype: 'success' }))).toEqual([]);
    expect(messageToBackendMessages(sdk({ type: 'system', subtype: 'init' }))).toEqual([]);
  });
});

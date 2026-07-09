import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackendMessage } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import {
  dropTrailingDanglingToolCall,
  messageToBackendMessages,
  tapStreamedUserTurns,
} from './transcript.js';

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

describe('dropTrailingDanglingToolCall — trims an unanswered tool_use before it is flushed', () => {
  it('drops a trailing assistant message whose toolCalls never got a matching tool result', () => {
    const messages: BackendMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tu_1', name: 'Read', arguments: {} }],
      },
    ];
    expect(dropTrailingDanglingToolCall(messages)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('drops multiple trailing dangling assistant turns in a row', () => {
    const messages: BackendMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'Read', arguments: {} }] },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tu_2', name: 'Read', arguments: {} }] },
    ];
    expect(dropTrailingDanglingToolCall(messages)).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('leaves a transcript ending in a tool result unchanged (D85 no-op)', () => {
    const messages: BackendMessage[] = [
      { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'Read', arguments: {} }] },
      { role: 'tool', toolCallId: 'tu_1', content: 'result' },
    ];
    expect(dropTrailingDanglingToolCall(messages)).toEqual(messages);
  });

  it('leaves a transcript ending in a plain assistant answer unchanged (D85 no-op)', () => {
    const messages: BackendMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'done' },
    ];
    expect(dropTrailingDanglingToolCall(messages)).toEqual(messages);
  });

  it('leaves an empty transcript unchanged', () => {
    expect(dropTrailingDanglingToolCall([])).toEqual([]);
  });
});

describe('tapStreamedUserTurns — records each streamed user/steer turn at consumption time', () => {
  it('records one streamed turn into the transcript and yields it onward unchanged', async () => {
    async function* one(): AsyncGenerator<string> {
      yield 'hello';
    }
    const transcript: BackendMessage[] = [];
    const seen: string[] = [];
    for await (const text of tapStreamedUserTurns(one(), transcript)) seen.push(text);

    expect(seen).toEqual(['hello']);
    expect(transcript).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('records multiple streamed turns (an initial turn then a steer) in order', async () => {
    async function* two(): AsyncGenerator<string> {
      yield 'first';
      yield 'also do X';
    }
    const transcript: BackendMessage[] = [];
    for await (const _text of tapStreamedUserTurns(two(), transcript)) {
      // drain
    }

    expect(transcript).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'also do X' },
    ]);
  });

  it('appends to a transcript that already carries prior history, without disturbing it', async () => {
    async function* one(): AsyncGenerator<string> {
      yield 'new turn';
    }
    const transcript: BackendMessage[] = [{ role: 'assistant', content: 'earlier reply' }];
    for await (const _text of tapStreamedUserTurns(one(), transcript)) {
      // drain
    }

    expect(transcript).toEqual([
      { role: 'assistant', content: 'earlier reply' },
      { role: 'user', content: 'new turn' },
    ]);
  });
});

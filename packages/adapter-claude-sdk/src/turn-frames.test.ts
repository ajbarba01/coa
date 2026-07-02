import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { messageToFrames } from './turn-frames.js';

/**
 * Build a minimal SDK message of the given shape. The mapper only reads a few
 * fields, so tests supply just those (cast through `unknown` — the SDK's full
 * record is large and irrelevant to the mapping).
 */
function sdk(message: unknown): SDKMessage {
  return message as SDKMessage;
}

describe('messageToFrames — SDK message → neutral M0 TurnFrame', () => {
  it('maps assistant text blocks to text frames', () => {
    const frames = messageToFrames(
      sdk({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }),
    );
    expect(frames).toEqual([{ t: 'text', text: 'hello' }]);
  });

  it('maps assistant thinking blocks to thinking frames', () => {
    const frames = messageToFrames(
      sdk({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'hmm' }] } }),
    );
    expect(frames).toEqual([{ t: 'thinking', text: 'hmm' }]);
  });

  it('maps a tool_use block to a tool_use frame, carrying the id as the handle', () => {
    const frames = messageToFrames(
      sdk({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { path: 'a.ts' } }],
        },
      }),
    );
    expect(frames).toEqual([
      { t: 'tool_use', tool: 'Read', input: { path: 'a.ts' }, handle: 'tu_1' },
    ]);
  });

  it('maps a user tool_result block to a tool_result frame keyed by tool_use_id', () => {
    const frames = messageToFrames(
      sdk({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'ok', is_error: false }],
        },
      }),
    );
    expect(frames).toEqual([{ t: 'tool_result', handle: 'tu_1', ok: true, pointer: 'ok' }]);
  });

  it('marks an errored tool_result as not ok', () => {
    const frames = messageToFrames(
      sdk({
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'boom', is_error: true }],
        },
      }),
    );
    expect(frames).toEqual([{ t: 'tool_result', handle: 'tu_2', ok: false, pointer: 'boom' }]);
  });

  it('ignores a plain-string user message (the human turn, not a tool result)', () => {
    const frames = messageToFrames(sdk({ type: 'user', message: { content: 'hi there' } }));
    expect(frames).toEqual([]);
  });

  it('emits a turn-boundary on a successful result, carrying the stop reason', () => {
    const frames = messageToFrames(
      sdk({ type: 'result', subtype: 'success', stop_reason: 'end_turn', is_error: false }),
    );
    expect(frames).toEqual([{ t: 'turn-boundary', role: 'assistant', stop: 'end_turn' }]);
  });

  it('emits an error frame then a turn-boundary on an error result', () => {
    const frames = messageToFrames(
      sdk({ type: 'result', subtype: 'error_during_execution', is_error: true }),
    );
    expect(frames).toEqual([
      { t: 'error', message: 'error_during_execution', origin: 'loop' },
      { t: 'turn-boundary', role: 'assistant' },
    ]);
  });

  it('maps multiple blocks in order and drops unknown block kinds', () => {
    const frames = messageToFrames(
      sdk({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'one' },
            { type: 'image', source: {} },
            { type: 'tool_use', id: 'tu_3', name: 'Grep', input: {} },
          ],
        },
      }),
    );
    expect(frames).toEqual([
      { t: 'text', text: 'one' },
      { t: 'tool_use', tool: 'Grep', input: {}, handle: 'tu_3' },
    ]);
  });

  it('returns nothing for transport/system messages the transcript does not render', () => {
    expect(messageToFrames(sdk({ type: 'system', subtype: 'init' }))).toEqual([]);
  });
});

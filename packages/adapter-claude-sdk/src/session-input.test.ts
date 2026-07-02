import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { toSdkPrompt } from './session-input.js';

async function* strings(...items: string[]): AsyncIterable<string> {
  for (const item of items) yield item;
}

async function collect(prompt: string | AsyncIterable<SDKUserMessage>): Promise<SDKUserMessage[]> {
  if (typeof prompt === 'string') throw new Error('expected a stream');
  const out: SDKUserMessage[] = [];
  for await (const message of prompt) out.push(message);
  return out;
}

describe('toSdkPrompt — neutral session input → SDK prompt', () => {
  it('passes a one-shot string through unchanged', () => {
    expect(toSdkPrompt('do the thing')).toBe('do the thing');
  });

  it('wraps each streamed user-turn string as an SDK user message', async () => {
    const messages = await collect(toSdkPrompt(strings('first', 'second')));
    expect(messages).toEqual([
      { type: 'user', message: { role: 'user', content: 'first' }, parent_tool_use_id: null },
      { type: 'user', message: { role: 'user', content: 'second' }, parent_tool_use_id: null },
    ]);
  });
});

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * The M9 neutral→SDK input mapping: coa's backend-neutral session input (a
 * one-shot string or a stream of user-turn strings) → the Claude SDK's `query`
 * prompt. A string passes through as the SDK's one-shot form; a stream is wrapped
 * turn-by-turn into `SDKUserMessage`s (streaming-input mode). This isolates the
 * SDK's user-message shape to M9 so M8's session seam stays backend-neutral and a
 * from-scratch adapter maps the same neutral input to its own wire format.
 */
export function toSdkPrompt(
  input: string | AsyncIterable<string>,
): string | AsyncIterable<SDKUserMessage> {
  return typeof input === 'string' ? input : toUserMessages(input);
}

async function* toUserMessages(input: AsyncIterable<string>): AsyncIterable<SDKUserMessage> {
  for await (const text of input) {
    yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
  }
}

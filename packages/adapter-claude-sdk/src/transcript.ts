import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BackendMessage, LoopToolCall } from '@coa/shared';

/**
 * The M9 SDK→neutral-transcript mapping: one Claude `SDKMessage` → zero or more
 * {@link BackendMessage}s, the provider-neutral chat-transcript record M8 persists
 * as a conversation's canonical memory (conversation-store `messages.json`).
 *
 * This is the counterpart to {@link messageToFrames} (the lossy UI render stream):
 * where a frame keeps only a tool-result pointer, this keeps the FULL content the
 * model saw — so the transcript is a lossless source that any backend can replay
 * (a pure-API backend resends it as `history`; it is the source when a session
 * switches providers). The Claude adapter accumulates these across a turn and
 * reports the full transcript so it lands in the same neutral shape DeepSeek uses.
 *
 * Only assistant text/tool_use and user tool_result blocks carry memory; the
 * echoed user prompt (plain text on a `user` message) is added by the caller from
 * the raw input, and transport/system/result messages map to nothing.
 */

/** A content block as it appears on an assistant/user SDK message (the fields the mapper reads). */
interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
}

/** Map one SDK message to the neutral transcript messages it contributes. */
export function messageToBackendMessages(message: SDKMessage): BackendMessage[] {
  switch (message.type) {
    case 'assistant':
      return assistantMessages(contentBlocks(message.message.content));
    case 'user':
      return toolResultMessages(contentBlocks(message.message.content));
    default:
      return [];
  }
}

function contentBlocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

/** One assistant message → one neutral message: joined text + the tool calls it emitted. */
function assistantMessages(blocks: ContentBlock[]): BackendMessage[] {
  const text = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const toolCalls: LoopToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id ?? '', name: b.name ?? '', arguments: b.input ?? {} }));
  // Skip an empty assistant turn (no text, no calls) so the transcript stays tight.
  if (text === '' && toolCalls.length === 0) return [];
  const msg: BackendMessage = { role: 'assistant', content: text };
  if (toolCalls.length > 0) msg.toolCalls = toolCalls;
  return [msg];
}

/** A user message carries tool RESULTS (the SDK injects them as user turns) → one neutral `tool` message each. */
function toolResultMessages(blocks: ContentBlock[]): BackendMessage[] {
  return blocks
    .filter((b) => b.type === 'tool_result')
    .map((b) => ({
      role: 'tool' as const,
      toolCallId: b.tool_use_id ?? '',
      content: resultText(b.content),
    }));
}

/** The full tool-result text the model saw (lossless — unlike the render stream's short pointer). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('');
  }
  return '';
}

/**
 * Trim a transcript so it never ends on an unanswered `tool_use` (the block-preserving
 * invariant the pure-API driver already enforces via `lastConsistent` — see
 * `packages/loop-driver/src/driver.ts`). If the stream ends (an interrupt, or a mid-tool
 * error) between an assistant `tool_use` message and its `tool_result`, the accumulated
 * transcript ends with a dangling assistant message carrying `toolCalls` and no following
 * `tool` messages. Replayed as structured `history` on a cross-provider switch, an
 * OpenAI-compatible endpoint rejects an assistant `tool_calls` turn with no matching `tool`
 * results — so drop any such trailing turn before it is flushed. On a clean exit the
 * transcript already ends with the tool results (or a plain assistant answer), so this is a
 * no-op (D85 byte-identical).
 */
export function dropTrailingDanglingToolCall(messages: readonly BackendMessage[]): BackendMessage[] {
  const trimmed = [...messages];
  while (
    trimmed.length > 0 &&
    trimmed[trimmed.length - 1]!.role === 'assistant' &&
    (trimmed[trimmed.length - 1]!.toolCalls?.length ?? 0) > 0
  ) {
    trimmed.pop();
  }
  return trimmed;
}

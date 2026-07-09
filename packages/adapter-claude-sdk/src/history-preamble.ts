import type { BackendMessage } from '@coa/shared';

/**
 * Render a neutral transcript as a first-turn context preamble for the Agent SDK.
 * Used only on a cross-provider switch INTO Claude, where there is no resumable
 * server session for this conversation: the SDK cannot ingest a foreign transcript
 * into its own (CLI-internal) store, so coa carries the prior memory forward by
 * prepending it, in-band, to the first Claude user turn. It's a faithful, readable
 * reconstruction of the turns the user already saw — lossy formatting is fine here
 * (it's context the model reads, not the canonical record, which stays intact).
 */
function renderMessage(message: BackendMessage): string {
  switch (message.role) {
    case 'user':
      return `User: ${message.content}`;
    case 'assistant': {
      const calls = (message.toolCalls ?? [])
        .map((c) => `\n  → called ${c.name}(${JSON.stringify(c.arguments)})`)
        .join('');
      return `Assistant: ${message.content}${calls}`;
    }
    case 'tool':
      return `Tool result: ${message.content}`;
    case 'system':
      return `System: ${message.content}`;
  }
}

export function formatHistoryPreamble(history: readonly BackendMessage[]): string {
  const body = history.map(renderMessage).join('\n\n');
  return [
    '<prior_conversation>',
    'This conversation continues from a session that ran on a different model. The',
    'full exchange so far is reproduced below so you have complete context. Continue',
    'naturally from where it left off; do not restate or summarize it to the user.',
    '',
    body,
    '</prior_conversation>',
  ].join('\n');
}

/** Prepend the preamble to the turn's user prompt, when there is prior memory to carry. */
export function withHistoryPreamble(input: string, history: readonly BackendMessage[]): string {
  if (history.length === 0) return input;
  return `${formatHistoryPreamble(history)}\n\n${input}`;
}

/**
 * The streaming-input counterpart to {@link withHistoryPreamble}: wraps a stream of
 * user-turn strings so the preamble is prepended to the FIRST yielded turn only —
 * every later turn (a steer M8 injects into the same feed) passes through unchanged.
 * With no history this is a pure pass-through (D85 strict-superset).
 *
 * This wrapper is model-delivery only — it augments what the model sees, never the
 * canonical record (the append-only event log, docs/adr/0010).
 */
export function withHistoryPreambleStreaming(
  input: AsyncIterable<string>,
  history: readonly BackendMessage[],
): AsyncIterable<string> {
  if (history.length === 0) return input;
  return (async function* () {
    let isFirst = true;
    for await (const text of input) {
      yield isFirst ? withHistoryPreamble(text, history) : text;
      isFirst = false;
    }
  })();
}

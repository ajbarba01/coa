/**
 * The full tool-result text the model saw (lossless — unlike the render stream's short
 * pointer). Exported for `enriched-frames.ts`, which attaches it as the append-only event
 * log's `full` companion to the lossy pointer frame — the canonical
 * transcript is the read-time fold over `events.ndjson`, not a separately maintained record.
 */
export function resultText(content: unknown): string {
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

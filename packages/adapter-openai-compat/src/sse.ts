/**
 * A minimal SSE reader for the OpenAI-compatible streaming chat API: consumes the
 * response body byte stream, buffers across chunk boundaries, and yields each `data:`
 * payload's parsed JSON, stopping at the `[DONE]` sentinel. A malformed JSON event is
 * skipped (degrade, not throw) so a single bad line never poisons the whole stream.
 */
export async function* parseSseChunks(body: AsyncIterable<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
      if (dataLine === undefined) continue;
      const data = dataLine.slice(5).trim();
      if (data === '[DONE]') return;
      if (data === '') continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* skip a malformed event */
      }
    }
  }
}

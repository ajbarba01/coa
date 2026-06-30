/**
 * M8 — the newline-delimited JSON (NDJSON) framing codec for the daemon protocol.
 * It turns a byte stream into discrete JSON-RPC message lines and back, the layer
 * between any stream transport (named pipe / socket / stdio) and the
 * transport-agnostic {@link dispatch} router. Pure and platform-neutral; it does
 * NOT parse or validate JSON (that is `dispatch`'s Zod-validate-before-touch step)
 * — it only frames. NDJSON matches the repo's existing `*.ndjson` WAL convention.
 */

/** Serialize a message as one newline-terminated JSON line. */
export function encodeLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** Incremental line framer: feed stream chunks, get back the complete lines so far. */
export class FrameDecoder {
  private buffer = '';

  /** Append a chunk and return every newly completed (non-blank) line; partials stay buffered. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let nl = this.buffer.indexOf('\n');
    while (nl !== -1) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, '');
      this.buffer = this.buffer.slice(nl + 1);
      if (line.trim() !== '') lines.push(line);
      nl = this.buffer.indexOf('\n');
    }
    return lines;
  }
}

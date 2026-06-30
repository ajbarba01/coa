import { RPC_ERROR, type RpcErrorResponse } from '@coa/shared';
import { encodeLine, FrameDecoder } from './codec.js';
import { dispatch, type RpcHandlers } from './router.js';

/**
 * M8 — serve the JSON-RPC dispatch router over a byte stream. This is the
 * transport-neutral glue: it frames the stream into NDJSON lines (the
 * {@link FrameDecoder}), JSON-parses each (a malformed line → a `-32700` parse
 * error, the one error the router cannot see because it is handed already-parsed
 * values), routes through {@link dispatch}, and writes back each request's
 * response line (notifications produce none). It works over any duplex — a named
 * pipe, a Unix socket, or stdio — so the OS-specific bind/peer-cred layer wraps
 * this without re-implementing the protocol.
 *
 * Messages are handled in arrival order via a serialized promise chain, so a
 * client reading the stream sees responses in a stable sequence. `idle()` resolves
 * when the currently-queued work has settled (the test/await seam).
 */

/** The minimal duplex this serves over (a `net.Socket` / pipe / stdio stream satisfies it). */
export interface DuplexLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  write(data: string): void;
}

export interface StreamServer {
  /** Resolves when the in-flight message chain has settled (no new data queued). */
  idle: () => Promise<void>;
}

export function serveOverStream(stream: DuplexLike, handlers: RpcHandlers): StreamServer {
  const decoder = new FrameDecoder();
  let chain: Promise<void> = Promise.resolve();

  stream.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const lineText of decoder.push(text)) {
      chain = chain.then(() => handleLine(lineText, handlers, stream));
    }
  });

  return { idle: () => chain };
}

async function handleLine(line: string, handlers: RpcHandlers, stream: DuplexLike): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    stream.write(encodeLine(parseError()));
    return;
  }
  const response = await dispatch(parsed, handlers);
  if (response !== undefined) stream.write(encodeLine(response));
}

function parseError(): RpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id: null,
    error: { code: RPC_ERROR.parseError, message: 'parse error' },
  };
}

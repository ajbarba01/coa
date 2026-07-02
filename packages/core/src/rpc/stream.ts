import { RPC_ERROR, type RpcErrorResponse, type RpcNotification } from '@coa/shared';
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
 *
 * The server→client direction is `push`: an id-less JSON-RPC notification written
 * to the same stream (the R-12 push channel — turn/cost/flag notifications). It is
 * exposed on the returned {@link StreamServer} and, so a handler can push to *its
 * own* connection, handed to the optional per-connection handler factory.
 */

/** The minimal duplex this serves over (a `net.Socket` / pipe / stdio stream satisfies it). */
export interface DuplexLike {
  on(event: 'data', listener: (chunk: Buffer | string) => void): void;
  write(data: string): void;
}

/** The per-connection surface a handler factory receives — today just the push channel. */
export interface RpcConnection {
  /** Send a server→client notification over this connection (no id, no response). */
  push: (note: RpcNotification) => void;
}

/** Static handlers, or a factory that builds them with the connection's push channel bound in. */
export type StreamHandlers = RpcHandlers | ((connection: RpcConnection) => RpcHandlers);

export interface StreamServer {
  /** Resolves when the in-flight message chain has settled (no new data queued). */
  idle: () => Promise<void>;
  /** Send a server→client notification over this connection. */
  push: (note: RpcNotification) => void;
}

export function serveOverStream(stream: DuplexLike, handlers: StreamHandlers): StreamServer {
  const push = (note: RpcNotification): void => stream.write(encodeLine(note));
  const resolved = typeof handlers === 'function' ? handlers({ push }) : handlers;
  const decoder = new FrameDecoder();
  let chain: Promise<void> = Promise.resolve();

  stream.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const lineText of decoder.push(text)) {
      chain = chain.then(() => handleLine(lineText, resolved, stream));
    }
  });

  return { idle: () => chain, push };
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

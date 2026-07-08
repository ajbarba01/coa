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
  /**
   * Optional: registers a listener that fires once the underlying connection
   * closes. Only a real transport (e.g. the `net.Socket`-backed adapter
   * `transport.ts` builds) provides this; a `DuplexLike` fake/test double that
   * doesn't model teardown may omit it entirely and still satisfy this type —
   * `serveOverStream` guards with a runtime check before calling it.
   */
  onClose?(listener: () => void): void;
}

/** The per-connection surface a handler factory receives. */
export interface RpcConnection {
  /** Send a server→client notification over this connection (no id, no response). */
  push: (note: RpcNotification) => void;
  /**
   * Register a listener that fires once this connection's underlying stream
   * closes (e.g. a dropped socket) — the teardown seam a handler factory uses to
   * release its own per-connection state (subscriptions, sinks) so a dropped
   * connection doesn't leak them (see `session-handlers.ts`'s `buildSessionHandlers`).
   */
  onClose: (listener: () => void) => void;
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
  const closeListeners = new Set<() => void>();
  const onClose = (listener: () => void): void => {
    closeListeners.add(listener);
  };
  const resolved = typeof handlers === 'function' ? handlers({ push, onClose }) : handlers;
  const decoder = new FrameDecoder();
  let chain: Promise<void> = Promise.resolve();

  stream.on('data', (chunk) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const lineText of decoder.push(text)) {
      chain = chain.then(() => handleLine(lineText, resolved, stream));
    }
  });

  // Fire every registered close-listener exactly once the underlying connection
  // actually closes — a `DuplexLike` that doesn't model teardown (e.g. a test
  // fake) simply never fires them, which is fine (nothing to release).
  if (typeof stream.onClose === 'function') {
    stream.onClose(() => {
      for (const listener of [...closeListeners]) listener();
      closeListeners.clear();
    });
  }

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

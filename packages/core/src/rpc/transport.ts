import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { serveOverStream } from './stream.js';
import type { RpcHandlers } from './router.js';

/**
 * M8 — the OS-stream transport: bind a Unix domain socket (Linux/macOS) or a
 * Windows named pipe and serve the JSON-RPC router over each connection. Node's
 * `net` handles both endpoint kinds from a single `listen(path)`, so this stays
 * one implementation; the path shape (`\\.\pipe\…` vs a `.sock` file) is the only
 * platform difference and is chosen by the caller.
 *
 * ⚠ SECURITY TRIPWIRE (D140, deferred): this binds with Node `net`'s DEFAULT
 * endpoint security. The hardened controls D140 mandates are NOT yet applied —
 * Unix peer-cred uid-reject (`SO_PEERCRED`/`LOCAL_PEERCRED`) and the Windows
 * custom DACL + `FILE_FLAG_FIRST_PIPE_INSTANCE` + `PIPE_REJECT_REMOTE_CLIENTS`
 * are unreachable through `net` and need a native addon. Acceptable for the v1
 * attended single-user-local product; this MUST be closed before any multi-user
 * or remote-daemon mode (the socket is the approval + secret-read gate). The
 * per-connection callback below is the seam where the peer-cred/DACL check lands.
 */

export interface RpcServer {
  /** The bound path (pipe name or socket file). */
  readonly path: string;
  /** Stop accepting connections and release the endpoint. */
  close: () => Promise<void>;
}

/**
 * The default daemon endpoint (D140 placement). Windows → a named pipe; Unix →
 * `$XDG_RUNTIME_DIR/coa/coa.sock` when set, else `~/.coa/run/coa.sock`. The Unix
 * parent dir must be created `0700` before binding (the daemon host does this).
 */
export function defaultDaemonPath(): string {
  if (process.platform === 'win32') return '\\\\.\\pipe\\coa';
  const runtime = process.env['XDG_RUNTIME_DIR'];
  return runtime !== undefined && runtime !== ''
    ? join(runtime, 'coa', 'coa.sock')
    : join(homedir(), '.coa', 'run', 'coa.sock');
}

/** Bind `path` and serve `handlers` over every connection. Rejects if the path is already in use. */
export function listen(path: string, handlers: RpcHandlers): Promise<RpcServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      // ⚠ D140 seam — the peer-cred (Unix) / DACL (Windows) check belongs here.
      socket.setEncoding('utf8');
      serveOverStream(socket, handlers);
    });

    server.once('error', reject);
    server.listen(path, () => {
      server.removeListener('error', reject);
      resolve({
        path,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

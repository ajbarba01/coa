import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveOverStream, type DuplexLike, type StreamHandlers } from './stream.js';

/**
 * The OS-stream transport: bind a Unix domain socket (Linux/macOS) or a
 * Windows named pipe and serve the JSON-RPC router over each connection. Node's
 * `net` handles both endpoint kinds from a single `listen(path)`, so this stays
 * one implementation; the path shape (`\\.\pipe\…` vs a `.sock` file) is the only
 * platform difference and is chosen by the caller.
 *
 * ⚠ SECURITY TRIPWIRE (hardening deferred): this binds with Node `net`'s DEFAULT
 * endpoint security. The mandated hardened endpoint controls are NOT yet applied —
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
 * Canonical form of a project root for IDENTITY comparisons — the resolved
 * absolute path, case-folded on Windows (whose filesystem is case-insensitive) so
 * the SAME project compares equal regardless of trailing slash, `/` vs `\`, or the
 * drive-letter case a picker dialog / CLI argv / second-instance launch happens to
 * hand back. Exported so every consumer that needs "is this the same project"
 * (a desktop window registry, a recent-projects list) shares this ONE definition —
 * it is also exactly what {@link defaultDaemonPath} hashes, so two processes
 * agreeing on a project's identity always agree on its endpoint too. `platform` is
 * injected (defaults to the real one) so the rule is testable on every host OS.
 */
export function canonicalProjectRoot(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const resolved = resolve(root);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * A short, endpoint-name-safe deterministic id for a project root: the same root
 * (however it's spelled) always yields the same id, and different roots yield
 * different ids (a truncated SHA-256 — collision risk is negligible at
 * single-machine desktop-app scale). This is what lets a daemon endpoint be keyed
 * by PROJECT rather than shared app-wide.
 */
export function projectEndpointId(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return createHash('sha256').update(canonicalProjectRoot(root, platform)).digest('hex').slice(0, 16);
}

/**
 * The daemon endpoint for `root`'s project — a DETERMINISTIC function of the
 * (normalized) project root, not one fixed app-wide name. This is what lets (a) a
 * CLI invocation `cd`'d into a project resolve the SAME pipe/socket a daemon
 * already serving that project is bound to, and (b) "is this project already
 * open" be answered by probing the one endpoint its root hashes to, with no
 * second discovery mechanism. Windows → a named pipe; Unix →
 * `$XDG_RUNTIME_DIR/coa/coa-<id>.sock` when set, else `~/.coa/run/coa-<id>.sock`.
 * The Unix parent dir must be created `0700` before binding (the daemon host does
 * this). `platform` is injected (defaults to the real one) for testability.
 */
export function defaultDaemonPath(
  root: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const id = projectEndpointId(root, platform);
  if (platform === 'win32') return `\\\\.\\pipe\\coa-${id}`;
  const runtime = process.env['XDG_RUNTIME_DIR'];
  const base =
    runtime !== undefined && runtime !== '' ? join(runtime, 'coa') : join(homedir(), '.coa', 'run');
  return join(base, `coa-${id}.sock`);
}

/**
 * Bind `path` and serve `handlers` over every connection. `handlers` may be a
 * static map or a per-connection factory (called once per connection with that
 * connection's push channel — the push-notification seam a session uses to stream turns to the
 * client that started it). Rejects if the path is already in use.
 */
export function listen(path: string, handlers: StreamHandlers): Promise<RpcServer> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket) => {
      // ⚠ endpoint-security seam — the peer-cred (Unix) / DACL (Windows) check belongs here.
      socket.setEncoding('utf8');
      // A write to a socket the peer already dropped (or that was destroyed)
      // surfaces as an async 'error' event; with no listener, Node treats that as
      // an uncaught exception and takes the whole daemon down. Swallow it — a
      // dead connection is not a daemon-level failure (the fan-out crash-safety
      // in live-session.ts's `emit` already drops the sink that hit this).
      socket.on('error', () => {});
      // Adapt the real socket into a `DuplexLike` that also exposes the `close`
      // event as `onClose`, so `serveOverStream`'s connection-close teardown (the
      // seam `session-handlers.ts` uses to release its per-connection sinks) is
      // wired for real connections, not just test doubles.
      const duplex: DuplexLike = {
        on: (event, listener) => socket.on(event, listener),
        write: (data) => socket.write(data),
        onClose: (listener) => socket.on('close', listener),
      };
      serveOverStream(duplex, handlers);
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

import { existsSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { listen, type RpcServer } from './transport.js';
import type { StreamHandlers } from './stream.js';

/**
 * M8 — the crash-safe daemon bind lifecycle (D140 clause 6). The rule: NEVER
 * blind-unlink-then-bind (that is a TOCTOU socket-squat). Instead probe first —
 * connect-and-see whether a live daemon answers. If one does, refuse (the caller
 * should attach as a client). If the path only holds a STALE endpoint (a Unix
 * socket file left by a crashed daemon — Windows pipes vanish with their owner),
 * reclaim it and bind. The exclusive single-daemon `flock` (clause 7) is a later
 * refinement; probe-before-bind already prevents two live daemons racing.
 */

const PROBE_TIMEOUT_MS = 500;

/** True iff a daemon is currently accepting connections on `path`. */
export function probeDaemon(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const settle = (live: boolean): void => {
      socket.destroy();
      resolve(live);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => resolve(false));
    setTimeout(() => settle(false), PROBE_TIMEOUT_MS).unref();
  });
}

/** Bind the daemon endpoint safely: refuse if one is live, reclaim a stale socket, else bind. */
export async function bindDaemon(path: string, handlers: StreamHandlers): Promise<RpcServer> {
  if (await probeDaemon(path)) {
    throw new Error(`a coa daemon is already serving ${path}`);
  }
  // Probe said no live daemon — a remaining socket file is stale (Unix only). Safe to reclaim.
  if (process.platform !== 'win32' && existsSync(path)) rmSync(path, { force: true });
  return listen(path, handlers);
}

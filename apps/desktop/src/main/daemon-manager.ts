import type { DaemonStatus } from '../shared/methods.js';
import type { DaemonClient } from './daemon.js';

export type { DaemonStatus };

/**
 * The main-process owner of the daemon's lifecycle + connection, behind the
 * title-bar Start/Stop/Restart control. Daemon status is a *transport* fact
 * (when the daemon is down the RPC reads fail), so the app tracks it here and
 * pushes it to the renderer on its own channel — independent of the daemon's
 * own RPC data.
 *
 * `stop` tears the daemon down over the pipe (the `shutdown` verb) rather than by
 * PID, so it also reaps a daemon this app didn't spawn (an orphan from a prior
 * run — the dev papercut). A spawned child is still tracked and killed as a
 * fallback + on app quit. An unexpected connection drop (crash) flips the status
 * to `error` via the connect seam's `onClose`.
 *
 * All IO is injected (probe/connect/spawn/delay) so the state machine is a pure,
 * testable unit — the real wiring lives in the composition root (`index.ts`).
 */

/** A spawned daemon process — just what the manager needs to reap it. */
export interface DaemonProcess {
  kill: () => void;
}

export interface DaemonManagerDeps {
  /** Whether a daemon is already serving the endpoint (so `start` attaches instead of double-spawning). */
  probe: (path: string) => Promise<boolean>;
  /** Connect a client; `onClose` fires if the connection later drops. */
  connect: (path: string, onClose: () => void) => Promise<DaemonClient>;
  /** Spawn a fresh daemon process, returning a handle to reap it. */
  spawn: () => DaemonProcess;
  path: string;
  /** Connect retry after a spawn (the daemon needs a beat to bind). */
  retry?: { attempts: number; delayMs: number };
  /** Injectable sleep (tests). */
  delay?: (ms: number) => Promise<void>;
}

export interface DaemonManager {
  status: () => DaemonStatus;
  /**
   * The live client for a daemon read. Waits out an in-progress start (the launch
   * race) but NEVER initiates one — so a read can't silently resurrect a daemon the
   * user deliberately stopped. Rejects when not running (surfaced as a read error).
   */
  client: () => Promise<DaemonClient>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  /** Subscribe to status changes; returns an unsubscribe. Fires immediately with the current status. */
  onStatus: (listener: (status: DaemonStatus) => void) => () => void;
  /** Reap the daemon connection + child on app quit (best-effort). */
  dispose: () => void;
}

const DEFAULT_RETRY = { attempts: 20, delayMs: 100 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function createDaemonManager(deps: DaemonManagerDeps): DaemonManager {
  const retry = deps.retry ?? DEFAULT_RETRY;
  const delay = deps.delay ?? sleep;
  const listeners = new Set<(status: DaemonStatus) => void>();

  let status: DaemonStatus = 'stopped';
  let client: DaemonClient | undefined;
  let proc: DaemonProcess | undefined;
  // Guards a deliberate teardown so its `onClose` doesn't masquerade as a crash.
  let expectingClose = false;
  // Serializes start/stop/restart so overlapping clicks can't interleave transitions.
  let inflight: Promise<void> = Promise.resolve();

  const setStatus = (next: DaemonStatus): void => {
    if (next === status) return;
    status = next;
    for (const listener of listeners) listener(status);
  };

  const onClientClose = (): void => {
    if (expectingClose) return; // a deliberate stop/restart handles its own status
    client = undefined;
    proc = undefined;
    setStatus('error'); // the daemon dropped out from under us
  };

  const connectWithRetry = async (): Promise<DaemonClient> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
      try {
        return await deps.connect(deps.path, onClientClose);
      } catch (err) {
        lastErr = err;
        await delay(retry.delayMs);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('daemon connect failed');
  };

  const doStart = async (): Promise<void> => {
    if (status === 'running' && client !== undefined) return;
    setStatus('starting');
    try {
      // Attach to a live daemon if one is already serving; otherwise spawn one.
      if (!(await deps.probe(deps.path))) proc = deps.spawn();
      client = await connectWithRetry();
      setStatus('running');
    } catch {
      client = undefined;
      setStatus('error');
    }
  };

  const doStop = async (): Promise<void> => {
    expectingClose = true;
    try {
      if (client !== undefined) {
        // Best-effort graceful stop over the pipe (reaps orphans too), then close.
        await client.request('shutdown').catch(() => undefined);
        await client.close().catch(() => undefined);
      }
      proc?.kill();
    } finally {
      client = undefined;
      proc = undefined;
      expectingClose = false;
      setStatus('stopped');
    }
  };

  // Chain each transition after the previous so concurrent calls stay ordered.
  const enqueue = (op: () => Promise<void>): Promise<void> => {
    inflight = inflight.then(op, op);
    return inflight;
  };

  return {
    status: () => status,
    client: async () => {
      // Wait out any queued/in-progress transition (the launch start, a restart) so a
      // read doesn't race ahead of it — but never START one, so a read can't resurrect
      // a daemon the user deliberately stopped.
      await inflight.catch(() => undefined);
      if (status !== 'running' || client === undefined) throw new Error('daemon is not running');
      return client;
    },
    start: () => enqueue(doStart),
    stop: () => enqueue(doStop),
    restart: () =>
      enqueue(async () => {
        await doStop();
        await doStart();
      }),
    onStatus: (listener) => {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },
    dispose: () => {
      expectingClose = true;
      void client?.close().catch(() => undefined);
      proc?.kill();
      client = undefined;
      proc = undefined;
    },
  };
}

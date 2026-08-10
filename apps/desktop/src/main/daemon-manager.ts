import type { DaemonReport, DaemonStatus } from '../shared/methods.js';
import type { DaemonClient } from './daemon.js';

export type { DaemonReport, DaemonStatus };

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
 * Every failure keeps its REASON alongside the status. A bare `error` enum tells the
 * user only that they are stuck; the reason is what lets them act, so the manager
 * carries the daemon's own complaint (or the error that ended the connect) through to
 * the gate instead of dropping it.
 *
 * All IO is injected (probe/connect/spawn/delay) so the state machine is a pure,
 * testable unit — the real wiring lives in the composition root (`index.ts`).
 */

/** A spawned daemon process — just what the manager needs to reap it, plus whatever
 *  the child itself said about dying (see {@link failureLine}). */
export interface DaemonProcess {
  kill: () => void;
  /** The child's own account of what went wrong, if it managed to say anything. */
  failure?: () => string | undefined;
}

/**
 * Pick the line most likely to say WHY out of a captured stderr tail. Neither end of the
 * tail is reliable on its own: Node prints the offending source line ABOVE the message
 * and the stack frames below it, so this looks for a line that NAMES a failure and only
 * falls back to the last thing said.
 *
 * The MOST RECENT such line wins, not the first. The tail is a rolling window over
 * everything the daemon has ever said, and the daemon reports its own routine trouble on
 * stderr too (a conversation record it could not read, observation it had to stop) — so
 * the oldest error-shaped line in the window is usually the least related to why the
 * process just died. Stack frames are skipped on the way: a frame's own path can carry
 * `errors` (`node:internal/errors`) without saying anything at all.
 */
export function failureLine(tail: string): string | undefined {
  const lines = tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return undefined;
  const said = lines.filter((line) => !/^at\s/.test(line));
  return (
    said.findLast((line) => /error|cannot|denied|refused|not found|missing/i.test(line)) ??
    lines.at(-1)
  );
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
  /** How long `stop` waits for the endpoint to actually release (see doStop). */
  drain?: { attempts: number; delayMs: number };
  /** Injectable sleep (tests). */
  delay?: (ms: number) => Promise<void>;
}

export interface DaemonManager {
  status: () => DaemonStatus;
  /** The status plus the reason behind a failure — what main pushes to the renderer. */
  report: () => DaemonReport;
  /**
   * The live client for a daemon read. Waits out an in-progress start (the launch
   * race) but NEVER initiates one — so a read can't silently resurrect a daemon the
   * user deliberately stopped. Rejects when not running (surfaced as a read error).
   */
  client: () => Promise<DaemonClient>;
  start: () => Promise<void>;
  /**
   * Attach to a daemon that is ALREADY serving the endpoint, and do nothing at all when
   * none is. This is `start` minus the spawn: it exists so a caller that retries forever
   * (the gate) can keep picking up an out-of-band `coa serve` without relaunching a
   * daemon that has already failed to launch the same way over and over.
   */
  adopt: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  /** Subscribe to status changes; returns an unsubscribe. Fires immediately with the current report. */
  onStatus: (listener: (report: DaemonReport) => void) => () => void;
  /** Reap the daemon connection + child on app quit (best-effort). */
  dispose: () => void;
}

const DEFAULT_RETRY = { attempts: 50, delayMs: 100 };
const DEFAULT_DRAIN = { attempts: 30, delayMs: 100 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function createDaemonManager(deps: DaemonManagerDeps): DaemonManager {
  const retry = deps.retry ?? DEFAULT_RETRY;
  const drain = deps.drain ?? DEFAULT_DRAIN;
  const delay = deps.delay ?? sleep;
  const listeners = new Set<(report: DaemonReport) => void>();

  let status: DaemonStatus = 'stopped';
  /** Why the current status is what it is — set on failure, cleared on every good outcome. */
  let reason: string | undefined;
  let client: DaemonClient | undefined;
  let proc: DaemonProcess | undefined;
  // Every connection gets an epoch, and a teardown burns it. `onClose` is a socket
  // event: it lands whenever the OS gets round to it, which for a deliberate stop is
  // AFTER we've finished stopping, and for a restart can be after the NEXT connection
  // has started. A close only speaks for its own epoch — anything older is the wake of
  // a teardown we did on purpose, not a daemon dropping out from under us.
  let epoch = 0;
  // Serializes start/stop/restart so overlapping clicks can't interleave transitions.
  let inflight: Promise<void> = Promise.resolve();

  const report = (): DaemonReport => (reason === undefined ? { status } : { status, reason });

  // A changed REASON is a change worth announcing even when the status letter is the
  // same: two failed starts in a row are both `error`, and the second one's explanation
  // is the current truth. Suppressing it would pin the gate to the first failure's text.
  const setStatus = (next: DaemonStatus, nextReason?: string): void => {
    if (next === status && nextReason === reason) return;
    status = next;
    reason = nextReason;
    const snapshot = report();
    for (const listener of listeners) listener(snapshot);
  };

  const onClientClose = (era: number): void => {
    if (era !== epoch) return;
    // Read the child's last words BEFORE dropping the handle — a daemon that crashed
    // usually explained itself on stderr on the way out.
    const said = proc?.failure?.();
    client = undefined;
    proc = undefined;
    // the daemon dropped out from under us
    setStatus('error', said ?? 'the daemon connection closed unexpectedly');
  };

  const connectWithRetry = async (era: number): Promise<DaemonClient> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
      try {
        return await deps.connect(deps.path, () => onClientClose(era));
      } catch (err) {
        lastErr = err;
        await delay(retry.delayMs);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('daemon connect failed');
  };

  const doStart = async (spawnIfAbsent: boolean): Promise<void> => {
    if (status === 'running' && client !== undefined) return;
    // Probe FIRST so an adopt-only attempt can bow out silently: with nothing serving
    // there is nothing to attach to, and announcing a failure the caller never asked to
    // provoke would overwrite whatever the last real attempt reported.
    const serving = await deps.probe(deps.path);
    if (!serving && !spawnIfAbsent) return;
    const era = (epoch += 1);
    setStatus('starting');
    try {
      // Attach to a live daemon if one is already serving; otherwise spawn one.
      if (!serving) proc = deps.spawn();
      client = await connectWithRetry(era);
      setStatus('running');
    } catch (err) {
      client = undefined;
      // The child's own words beat the symptom we observed: "connect failed" is what we
      // saw happen, the daemon's stderr is why it happened.
      setStatus('error', proc?.failure?.() ?? messageOf(err));
    }
  };

  const doStop = async (): Promise<void> => {
    epoch += 1; // burn the connection: its close is now expected, whenever it arrives
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
    }
    // The daemon outlives its own shutdown reply: the endpoint stays bound until the
    // process is really gone. A `start` that races that window PROBES A LIVE PIPE, so it
    // attaches to the corpse instead of spawning — and reports the corpse's close as a
    // crash. Stopping isn't done until the endpoint is free (bounded: a pipe that never
    // releases is still reported stopped, and the next start will spawn over it).
    for (let i = 0; i < drain.attempts && (await deps.probe(deps.path)); i += 1) {
      await delay(drain.delayMs);
    }
    // A deliberate stop is not a failure: drop any reason the last one left behind.
    setStatus('stopped', undefined);
  };

  // Chain each transition after the previous so concurrent calls stay ordered.
  const enqueue = (op: () => Promise<void>): Promise<void> => {
    inflight = inflight.then(op, op);
    return inflight;
  };

  return {
    status: () => status,
    report,
    client: async () => {
      // Wait out any queued/in-progress transition (the launch start, a restart) so a
      // read doesn't race ahead of it — but never START one, so a read can't resurrect
      // a daemon the user deliberately stopped.
      await inflight.catch(() => undefined);
      if (status !== 'running' || client === undefined) throw new Error('daemon is not running');
      return client;
    },
    start: () => enqueue(() => doStart(true)),
    adopt: () => enqueue(() => doStart(false)),
    stop: () => enqueue(doStop),
    restart: () =>
      enqueue(async () => {
        await doStop();
        await doStart(true);
      }),
    onStatus: (listener) => {
      listeners.add(listener);
      listener(report());
      return () => listeners.delete(listener);
    },
    dispose: () => {
      epoch += 1;
      void client?.close().catch(() => undefined);
      proc?.kill();
      client = undefined;
      proc = undefined;
    },
  };
}

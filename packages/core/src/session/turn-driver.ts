import type { StartedHandle } from './frame-recorder.js';
import type { LiveSession, Sink, TurnRequest } from './live-session.js';
import type { LiveSessionRegistry } from './live-registry.js';
import type { SessionDeps } from './session.js';

/**
 * The contract every drive strategy is built against.
 *
 * A drive strategy runs a turn, but the facts it needs to do so are split across two
 * scopes: the daemon's (the session deps, the live-session registry) and the ONE RPC
 * connection that asked for the turn (which sink to hydrate, which unsubscribes to collect
 * at close, which role this particular request carried). The connection-scoped half is why
 * the strategies were nested closures to begin with. Passing it as an explicit object keeps
 * a driver a plain function of its inputs — testable and readable on its own — without
 * smuggling per-connection state into module scope, where two concurrent connections would
 * silently share it.
 */
export interface TurnDriverDeps {
  deps: SessionDeps;
  registry: LiveSessionRegistry;
  /** This turn's connection-scoped extras, if the connection recorded any. */
  turnMeta: (turn: TurnRequest) => TurnMeta | undefined;
  /** Hand back an unsubscribe for the connection to run when it closes — a dropped console
   *  must not leave a sink fanned out to forever. */
  addUnsubscriber: (off: () => void) => void;
  /** Report a turn's terminal status. The single funnel every strategy's settlement goes
   *  through, so a child session's parent gets told exactly once, however the turn ended. */
  emitStatus: (
    session: LiveSession,
    worktree: string,
    state: TerminalState,
    detail?: string,
  ) => void;
}

/** How a turn ended, as the status push renders it. A user stop is `interrupted`, never
 *  `error` — the distinction the whole settlement path exists to preserve. */
export type TerminalState = 'done' | 'error' | 'interrupted';

/**
 * The per-turn bookkeeping `TurnRequest` (live-session.ts) has no room for:
 * the legacy singular `role` field (superseded by `roles` but still read by
 * `assemblePieces`/the config-hash), the one-shot connection to (re)subscribe once this
 * turn's `onStart` fires, and the one-shot resolver the founding session-creation call
 * awaits to learn the worktree. Held by the connection in a map keyed by object identity,
 * so it never leaks past the turn it describes.
 */
export interface TurnMeta {
  role: string;
  /** Set only the first time a given connection sends against this conversation
   *  id — consumed (once) inside `onStart`, so hydration coincides with the
   *  turn's true first status instead of a spurious leading `idle`. */
  subscribe?: Sink;
  /** Set only for the FOUNDING turn (a brand-new `LiveSession`) — resolves the
   *  RPC response with the worktree once `onStart` fires, mirroring today's
   *  early, non-blocking `ready` resolution. */
  onReady?: (started: StartedHandle) => void;
}

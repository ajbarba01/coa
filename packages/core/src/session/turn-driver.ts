import type { LiveSession, QueuedTurn } from './live-session.js';
import type { LiveSessionRegistry } from './live-registry.js';
import type { SessionDeps } from './session.js';

/**
 * The contract every drive strategy is built against.
 *
 * Everything here is DAEMON-scoped and lives as long as the daemon does: the session
 * deps, the live-session registry, the one status funnel. Nothing a single caller owns
 * appears in it, because a live session outlives — and is shared by — every caller that
 * ever talks to it. The per-turn facts a strategy also needs (which role this request
 * carried, which sink to hydrate, who is waiting on the worktree) ride the
 * {@link QueuedTurn} itself, so they reach the driver whoever queued the turn.
 */
export interface TurnDriverDeps {
  deps: SessionDeps;
  registry: LiveSessionRegistry;
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
 * Attach the sender's sink to the session's fan-out, and hand the unsubscribe back.
 * Called from inside a strategy's `onStart` — never earlier — so hydration lands on the
 * turn's TRUE first status instead of a spurious leading `idle`; both strategies do this
 * identically, so the rule lives here once. A turn with no subscription (the sender is
 * already attached, or has no sink at all) is a no-op.
 */
export function attachSubscriber(session: LiveSession, turn: QueuedTurn): void {
  const subscription = turn.subscribe;
  if (subscription === undefined) return;
  subscription.onAttached(session.subscribe(subscription.sink));
}

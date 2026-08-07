import { describeLoopFailure } from './loop-failure.js';
import type { LiveSession, TurnRequest } from './live-session.js';

/** A single turn's execution, dispatched by `runLiveSession` for each queued
 *  `TurnRequest`. Encapsulates the backend-specific work (e.g. the per-turn
 *  `createSession` call); the loop itself stays backend-neutral. */
export type RunTurn = (turn: TurnRequest, session: LiveSession) => Promise<void>;

/**
 * The daemon-owned turn loop: drains `session`'s queued turns one at a time,
 * running each through `runTurn` and toggling the session back to `idle`
 * afterward. Ends once the session is closed and its queue is drained.
 *
 * a throwing `runTurn` is caught and surfaced as an error frame via
 * `session.emit` rather than propagating — a failed turn never kills the live
 * session, so the loop always continues to the next queued turn.
 */
export async function runLiveSession(session: LiveSession, runTurn: RunTurn): Promise<void> {
  let seq = 0;
  let turn: TurnRequest | undefined;
  while ((turn = await session.nextTurn()) !== undefined) {
    try {
      await runTurn(turn, session);
    } catch (e) {
      session.emit({
        kind: 'turn',
        sessionId: session.id,
        worktree: session.worktree ?? '',
        seq: seq++,
        frame: { t: 'error', message: describeLoopFailure(e), origin: 'loop' },
      });
    }
    session.setState('idle');
  }
}

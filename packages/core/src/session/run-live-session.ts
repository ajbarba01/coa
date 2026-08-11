import { describeLoopFailure } from './loop-failure.js';
import type { LiveSession, QueuedTurn } from './live-session.js';

/** A single turn's execution, dispatched by `runLiveSession` for each queued
 *  turn. Encapsulates the backend-specific work (e.g. the per-turn
 *  `createSession` call); the loop itself stays backend-neutral. */
export type RunTurn = (turn: QueuedTurn, session: LiveSession) => Promise<void>;

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
  // Live-only counter: these error frames never reach the durable log, so this
  // sequence is independent of the frame recorder's persisted one — every push
  // it stamps MUST carry `live: true`, or its ids collide with reloaded frames.
  let seq = 0;
  let turn: QueuedTurn | undefined;
  while ((turn = await session.nextTurn()) !== undefined) {
    try {
      await runTurn(turn, session);
    } catch (e) {
      session.emit({
        kind: 'turn',
        sessionId: session.id,
        worktree: session.worktree ?? '',
        seq: seq++,
        live: true,
        frame: { t: 'error', message: describeLoopFailure(e), origin: 'loop' },
      });
    }
    session.setState('idle');
  }
}

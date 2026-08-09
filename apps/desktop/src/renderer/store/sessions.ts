import { create } from 'zustand';
import type { SessionSummary } from '@coa/console-viewmodel';
import type { Remote } from '../panels/state.js';

/**
 * The session slice: the rail/tab list, which session the chat surface shows, and the
 * per-session run claims. Everything here changes on session-domain events (a list
 * refresh, a status push, a send) — never on streamed frames, so tab strips and pills
 * re-render only when a session-level fact moves.
 */
interface SessionsState {
  list: Remote<SessionSummary[]>;
  /** The conversation the chat pane shows; its agentRef drives the rail selection. */
  activeSessionId?: string | undefined;
  /** Run status keyed by session. Set optimistically on send, then driven by the
   *  daemon's `status` pushes: `running` (re)affirms, terminal states clear. The pill,
   *  the steer-mode composer, and the queued-message release all hang off this map. */
  runStatus: Record<string, { since: number }>;
  /** Bumped per session on every send — the transcript's snap-to-bottom nonce. */
  sendNonce: Record<string, number>;
}

export const useSessions = create<SessionsState>(() => ({
  list: { status: 'loading' },
  activeSessionId: undefined,
  runStatus: {},
  sendNonce: {},
}));

/** The current session summaries, or [] while not loaded (helper for writers). */
export function sessionsValue(): SessionSummary[] {
  const list = useSessions.getState().list;
  return list.status === 'ok' ? list.value : [];
}

export function setSessionList(list: Remote<SessionSummary[]>): void {
  useSessions.setState({ list });
}

/** Patch the loaded list in place (an optimistic single-entry update — e.g. the send
 *  applying a staged model pin). A not-yet-loaded list has nothing to patch. */
export function patchSessionList(patch: (sessions: SessionSummary[]) => SessionSummary[]): void {
  useSessions.setState((s) =>
    s.list.status === 'ok' ? { list: { status: 'ok', value: patch(s.list.value) } } : s,
  );
}

export function setActiveSession(id: string | undefined): void {
  useSessions.setState({ activeSessionId: id });
}

/** A `running` status push (re)affirms the claim — an existing `since` stays, so the
 *  elapsed timer never restarts mid-turn. */
export function markRunning(sessionId: string): void {
  useSessions.setState((s) =>
    s.runStatus[sessionId] !== undefined
      ? s
      : { runStatus: { ...s.runStatus, [sessionId]: { since: Date.now() } } },
  );
}

/** A send starts a fresh claim — `since` resets so the pill times THIS turn. */
export function beginRun(sessionId: string): void {
  useSessions.setState((s) => ({
    runStatus: { ...s.runStatus, [sessionId]: { since: Date.now() } },
  }));
}

/** Drop a session's run claim — it is not running, whatever this renderer last thought.
 *  A stale entry does not merely look wrong: it holds queued follow-ups forever. */
export function clearRunStatus(sessionId: string): void {
  useSessions.setState((s) => {
    if (s.runStatus[sessionId] === undefined) return s;
    const runStatus = { ...s.runStatus };
    delete runStatus[sessionId];
    return { runStatus };
  });
}

/** Forget every run claim — a fresh daemon connection cannot be running a turn this
 *  renderer started. Only run state clears: the active conversation, its transcript
 *  and the rail are untouched, so a mid-use restart never moves the user. */
export function clearAllRunStatus(): void {
  useSessions.setState((s) => (Object.keys(s.runStatus).length === 0 ? s : { runStatus: {} }));
}

export function bumpSendNonce(sessionId: string): void {
  useSessions.setState((s) => ({
    sendNonce: { ...s.sendNonce, [sessionId]: (s.sendNonce[sessionId] ?? 0) + 1 },
  }));
}

/** Session-delete housekeeping for this slice. */
export function evictSessionState(sessionId: string): void {
  useSessions.setState((s) => {
    const runStatus = { ...s.runStatus };
    const sendNonce = { ...s.sendNonce };
    delete runStatus[sessionId];
    delete sendNonce[sessionId];
    return { runStatus, sendNonce };
  });
}

/** Test seam. */
export function resetSessions(): void {
  useSessions.setState(
    { list: { status: 'loading' }, activeSessionId: undefined, runStatus: {}, sendNonce: {} },
    true,
  );
}

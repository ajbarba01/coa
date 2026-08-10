import { create } from 'zustand';
import type { SessionSummary, SessionUsage } from '@coa/console-viewmodel';
import type { PendingApprovalItem, Remote, SessionModeState } from '../panels/state.js';

/** Live child status keyed by CHILD session id, mirrored from the parent stream's
 *  spawn/completion announcements. Live-only: a reload never replays them, so an absent
 *  entry means "not observed", never "idle". */
export type SubagentState = 'running' | 'completed' | 'errored' | 'stopped';

/**
 * The session slice: the rail/tab list, which session the chat surface shows, and every
 * per-session fact that is NOT transcript frames — run claims, send nonces, the
 * permission-mode reflection, the pending-ask queue, the last settled turn's usage, and
 * the subagent dock's child statuses.
 *
 * Everything here changes on session-domain events (a list refresh, a status/mode/
 * approval/usage push, a send) — never on streamed turn frames, so tab strips and pills
 * re-render only when a session-level fact actually moves.
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
  /** A session's live permission-mode reflection — the daemon's own `mode` push or the
   *  `sessionMode` reattach read. Absent ⇒ not yet hydrated (the vm falls back to the
   *  active agent's configured default). Never decided here. */
  modeBySession: Record<string, SessionModeState>;
  /** Every approval request still awaiting a reply, per session, oldest first (FIFO —
   *  the longest-waiting ask is what is blocking the session). */
  pendingApprovalsBySession: Record<string, PendingApprovalItem[]>;
  /** The last settled turn's usage per session — the adapters' own settlement numbers,
   *  never invented locally. The context ring reads it against the active model's window. */
  usageBySession: Record<string, SessionUsage>;
  /** Live child status keyed by CHILD session id. The subagent dock reads it beside
   *  `runStatus`, which only covers sessions THIS console subscribed to. */
  subagentStatus: Record<string, { state: SubagentState }>;
}

const EMPTY: SessionsState = {
  list: { status: 'loading' },
  activeSessionId: undefined,
  runStatus: {},
  sendNonce: {},
  modeBySession: {},
  pendingApprovalsBySession: {},
  usageBySession: {},
  subagentStatus: {},
};

export const useSessions = create<SessionsState>(() => ({ ...EMPTY }));

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

/** Mirror the daemon's permission-mode reflection for one session. The daemon is the ONE
 *  authority here; the console only ever repeats what it was told. */
export function setSessionMode(sessionId: string, mode: SessionModeState): void {
  useSessions.setState((s) => ({ modeBySession: { ...s.modeBySession, [sessionId]: mode } }));
}

/** Queue a live ask oldest-first, so a rare concurrent-call case never loses one request
 *  to the other overwriting it. */
export function enqueueApproval(sessionId: string, item: PendingApprovalItem): void {
  useSessions.setState((s) => ({
    pendingApprovalsBySession: {
      ...s.pendingApprovalsBySession,
      [sessionId]: [...(s.pendingApprovalsBySession[sessionId] ?? []), item],
    },
  }));
}

/** REPLACE a session's queue with the daemon's own snapshot (the reattach read): a
 *  request resolved while this console was disconnected must not linger. */
export function setPendingApprovals(sessionId: string, items: PendingApprovalItem[]): void {
  useSessions.setState((s) => ({
    pendingApprovalsBySession: { ...s.pendingApprovalsBySession, [sessionId]: items },
  }));
}

/** Drop one answered ask from a session's queue (optimistic — the console asked for the
 *  decision, so the card goes now rather than a round trip later). */
export function dequeueApproval(sessionId: string, requestId: string): void {
  useSessions.setState((s) => {
    const pending = s.pendingApprovalsBySession[sessionId];
    if (pending === undefined) return s;
    return {
      pendingApprovalsBySession: {
        ...s.pendingApprovalsBySession,
        [sessionId]: pending.filter((p) => p.requestId !== requestId),
      },
    };
  });
}

/** A turn that just ended — however it ended — leaves no in-flight tool call still
 *  waiting on an answer: a pending ask belongs to the turn that raised it, and that turn
 *  is over. Without this, Stop mid-ask left the composer gate-locked on a request nothing
 *  could ever answer. */
export function clearPendingApprovals(sessionId: string): void {
  useSessions.setState((s) => {
    if (s.pendingApprovalsBySession[sessionId] === undefined) return s;
    const pendingApprovalsBySession = { ...s.pendingApprovalsBySession };
    delete pendingApprovalsBySession[sessionId];
    return { pendingApprovalsBySession };
  });
}

/** The per-turn usage mirror. Each push REPLACES rather than accumulates: the settled
 *  `tokensIn` already covers the whole context handed over. */
export function setSessionUsage(sessionId: string, usage: SessionUsage): void {
  useSessions.setState((s) => ({ usageBySession: { ...s.usageBySession, [sessionId]: usage } }));
}

/** Record a child session's announced state, keyed by the CHILD's id. */
export function setSubagentStatus(childSessionId: string, state: SubagentState): void {
  useSessions.setState((s) => ({
    subagentStatus: { ...s.subagentStatus, [childSessionId]: { state } },
  }));
}

/** Session-delete housekeeping for this slice: every per-session record the deleted id
 *  owns. Children a deleted parent spawned are NOT cascaded — that needs the session
 *  tree, and a wrong cascade would blank a dock row for a child still running. */
export function evictSessionState(sessionId: string): void {
  useSessions.setState((s) => {
    const runStatus = { ...s.runStatus };
    const sendNonce = { ...s.sendNonce };
    const modeBySession = { ...s.modeBySession };
    const pendingApprovalsBySession = { ...s.pendingApprovalsBySession };
    const usageBySession = { ...s.usageBySession };
    const subagentStatus = { ...s.subagentStatus };
    delete runStatus[sessionId];
    delete sendNonce[sessionId];
    delete modeBySession[sessionId];
    delete pendingApprovalsBySession[sessionId];
    delete usageBySession[sessionId];
    delete subagentStatus[sessionId];
    return {
      runStatus,
      sendNonce,
      modeBySession,
      pendingApprovalsBySession,
      usageBySession,
      subagentStatus,
    };
  });
}

/** Test seam. */
export function resetSessions(): void {
  useSessions.setState({ ...EMPTY }, true);
}

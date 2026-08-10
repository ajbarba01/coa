import { create } from 'zustand';
import { reconcileStreaming, type TurnFrame } from '@coa/console-viewmodel';
import type { Remote } from '../panels/state.js';

/**
 * The transcript slice — the ONE owner of every session's materialized frames.
 *
 * `bySession` maps a session id to its transcript's load state: an absent key is a
 * session never hydrated (cold), `loading`/`error` are the cold-open states, and `ok`
 * is a live, materialized transcript that pushes keep current from then on. Each open
 * tab subscribes to its own entry, so an append re-renders exactly the transcript it
 * belongs to — never the other tabs, never the chrome.
 *
 * Only the controller writes here (through the module functions below); components
 * read via `useTranscripts`. Frame arrays are append-stable: previously-seen frames
 * keep their object identity across appends, which is what lets the transcript's
 * memoized rows skip re-rendering settled history.
 *
 * Being the only owner also makes this the only place transcripts can accumulate, so it
 * carries the recency signal the memory cap sorts on (`evictColdest`). The cap itself is
 * the controller's — it is the one that knows which entries are mounted.
 */
export type TranscriptEntry = Remote<TurnFrame[]>;

interface TranscriptsState {
  bySession: Record<string, TranscriptEntry>;
}

export const useTranscripts = create<TranscriptsState>(() => ({ bySession: {} }));

/** The live frames of a session, or undefined when not materialized (helper for writers). */
export function framesOf(sessionId: string): TurnFrame[] | undefined {
  const entry = useTranscripts.getState().bySession[sessionId];
  return entry?.status === 'ok' ? entry.value : undefined;
}

// Recency for the eviction cap, as a monotonic counter rather than a clock: several
// transcripts routinely move inside the same millisecond (one flush lands every buffered
// session at once), and a system clock that steps backwards must never make a
// just-opened conversation look like the coldest one in the store.
let touchClock = 0;
const lastTouched = new Map<string, number>();

function touch(sessionId: string): void {
  touchClock += 1;
  lastTouched.set(sessionId, touchClock);
}

/** Mark a transcript as USED — the console looked at it, not merely streamed into it.
 *  Activation is the signal (see `sessionOps.activateSession`): a conversation the user
 *  just read is the last one worth evicting once its tab closes, however quiet it was. */
export function touchTranscript(sessionId: string): void {
  touch(sessionId);
}

// Frames arriving between animation frames are coalesced: token streaming emits many
// `text-delta` pushes per second, and applying each synchronously (reconcile + a
// transcript re-render per token) saturates the renderer. Incoming frames buffer per
// session and flush once per `requestAnimationFrame`, so transcripts repaint at the
// display's refresh rate no matter how fast tokens arrive.
const pendingBySession = new Map<string, TurnFrame[]>();
let flushHandle: number | undefined;

/** rAF when the platform has one (the renderer); a short timer elsewhere (node tests). */
function schedule(cb: () => void): number {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(cb)
    : (setTimeout(cb, 16) as unknown as number);
}
function unschedule(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/** Buffer frames for a session and schedule the coalesced flush. */
export function appendFrames(sessionId: string, frames: TurnFrame[]): void {
  if (frames.length === 0) return;
  const q = pendingBySession.get(sessionId);
  if (q !== undefined) q.push(...frames);
  else pendingBySession.set(sessionId, [...frames]);
  if (flushHandle === undefined) flushHandle = schedule(flushFrames);
}

/** Reconcile every session's buffered frames into its own entry, in one store write.
 *  Runs on the animation frame, or synchronously (`flushFrames`) when a terminal status
 *  needs the final frames landed first — also the guard against a throttled rAF. */
export function flushFrames(): void {
  if (flushHandle !== undefined) {
    unschedule(flushHandle);
    flushHandle = undefined;
  }
  if (pendingBySession.size === 0) return;
  for (const sessionId of pendingBySession.keys()) touch(sessionId);
  useTranscripts.setState((s) => {
    const bySession = { ...s.bySession };
    for (const [sessionId, frames] of pendingBySession) {
      const prev = bySession[sessionId];
      const base = prev?.status === 'ok' ? prev.value : [];
      // A `text-delta`/`thinking-delta` accumulates into the live block, then the settled
      // frame replaces it (deltas are delivery-only; the settled frame is authoritative).
      bySession[sessionId] = { status: 'ok', value: reconcileStreaming(base, frames) };
    }
    pendingBySession.clear();
    return { bySession };
  });
}

/** Mark a cold session as loading. A warm entry is left alone — its frames keep showing
 *  while any background reconcile runs (cache-first open). */
export function beginHydration(sessionId: string): void {
  touch(sessionId);
  useTranscripts.setState((s) =>
    s.bySession[sessionId] !== undefined
      ? s
      : { bySession: { ...s.bySession, [sessionId]: { status: 'loading' } } },
  );
}

/** A cold open that could not load shows its error; a warm entry keeps its frames (the
 *  reconcile was best-effort — stale-but-real beats an error card). */
export function hydrationFailed(sessionId: string, message: string): void {
  touch(sessionId);
  useTranscripts.setState((s) => {
    const prev = s.bySession[sessionId];
    if (prev?.status === 'ok') return s;
    return { bySession: { ...s.bySession, [sessionId]: { status: 'error', message } } };
  });
}

/** The seq a view frame's id carries when it names a persisted record of this session
 *  (`${sessionId}:${seq}` — pushes and reloads share the scheme by construction), or
 *  undefined for a console-local frame (an optimistic `you:` echo, a note). */
function seqOf(sessionId: string, frameId: string): number | undefined {
  const prefix = `${sessionId}:`;
  if (!frameId.startsWith(prefix)) return undefined;
  const n = Number(frameId.slice(prefix.length));
  return Number.isInteger(n) ? n : undefined;
}

/**
 * Land a reloaded transcript. Cold entry: the reload IS the transcript. Warm entry (a
 * resubscribe after the daemon connection was lost, or a background reconcile): the
 * durable log is the authority for everything it covers — the reloaded frames replace
 * the buffer up to the log's highest seq, and only live frames NEWER than that fold
 * back on top (frames pushed while the reload was in flight — the mid-run race that
 * used to be dropped outright). Console-local frames (optimistic `you:` echoes) yield
 * to the log: a reload only lands here when the daemon's record is the truer story.
 */
export function applyReload(sessionId: string, reloadedFrames: TurnFrame[]): void {
  // Fold any buffered live frames first so the merge sees the full live state.
  flushFrames();
  touch(sessionId);
  useTranscripts.setState((s) => {
    const prev = s.bySession[sessionId];
    if (prev?.status !== 'ok')
      return {
        bySession: { ...s.bySession, [sessionId]: { status: 'ok', value: reloadedFrames } },
      };
    let maxSeq = -1;
    for (const f of reloadedFrames) {
      const n = seqOf(sessionId, f.id);
      if (n !== undefined && n > maxSeq) maxSeq = n;
    }
    const newer = prev.value.filter((f) => {
      const n = seqOf(sessionId, f.id);
      return n !== undefined && n > maxSeq;
    });
    return {
      bySession: {
        ...s.bySession,
        [sessionId]: { status: 'ok', value: reconcileStreaming(reloadedFrames, newer) },
      },
    };
  });
}

/** Drop a deleted session's transcript. */
export function evictTranscript(sessionId: string): void {
  // Frames still waiting on the animation frame go too, or the flush that follows would
  // rebuild the entry a moment after it was dropped — a transcript for a conversation
  // that no longer exists, which nothing would ever evict again.
  pendingBySession.delete(sessionId);
  lastTouched.delete(sessionId);
  useTranscripts.setState((s) => {
    if (s.bySession[sessionId] === undefined) return s;
    const bySession = { ...s.bySession };
    delete bySession[sessionId];
    return { bySession };
  });
}

/**
 * Hold the store to `cap` materialized transcripts, dropping the least recently used
 * ones first, and answer with what was dropped so the caller can forget them too (the
 * controller's attached set — an evicted session that still counts as attached would
 * never re-hydrate, and would render empty forever).
 *
 * `protectedIds` — the shell's open tabs plus the active session — are NEVER evicted at
 * any cap: every one of them is a mounted transcript host, and dropping its entry would
 * blank a tab the user is looking at. A working set larger than the cap therefore simply
 * exceeds it; the cap bounds what is kept BEYOND the working set (a closed tab's
 * transcript, kept warm so reopening it is free), never the working set itself.
 *
 * Evicting a session that is still streaming costs nothing durable: the daemon holds the
 * log, and the next activation re-attaches and reload-merges it back to full fidelity.
 */
export function evictColdest(protectedIds: readonly string[], cap: number): string[] {
  const ids = Object.keys(useTranscripts.getState().bySession);
  const overflow = ids.length - cap;
  if (overflow <= 0) return [];
  const keep = new Set(protectedIds);
  const doomed = ids
    .filter((id) => !keep.has(id))
    // Coldest first. An entry with no recorded touch (it cannot happen through the
    // writers above, but the ordering must be total) sorts as the coldest of all.
    .sort((a, b) => (lastTouched.get(a) ?? 0) - (lastTouched.get(b) ?? 0))
    .slice(0, overflow);
  if (doomed.length === 0) return [];
  for (const id of doomed) {
    pendingBySession.delete(id);
    lastTouched.delete(id);
  }
  useTranscripts.setState((s) => {
    const bySession = { ...s.bySession };
    for (const id of doomed) delete bySession[id];
    return { bySession };
  });
  return doomed;
}

/** Test seam: forget everything, including frames still waiting on a flush. */
export function resetTranscripts(): void {
  pendingBySession.clear();
  lastTouched.clear();
  if (flushHandle !== undefined) {
    unschedule(flushHandle);
    flushHandle = undefined;
  }
  useTranscripts.setState({ bySession: {} }, true);
}

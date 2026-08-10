import { LiveSession } from './live-session.js';
import { descendantsOf } from './lineage.js';

/** A cancellable handle returned by `setTimer`. */
interface TimerHandle {
  clear: () => void;
}

/**
 * Constructor options for {@link LiveSessionRegistry}. `now` and `setTimer`
 * are injectable so idle-timeout behavior is deterministic in tests; `now` is
 * reserved for future use (e.g. surfacing last-activity timestamps).
 */
export interface LiveRegistryOptions {
  idleMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /**
   * Fired once, synchronously, from `close(id)` (the SINGLE teardown path — see
   * `close` below) right before the session is torn down and removed: idle-evict,
   * the `closeSession` verb, and `closeAll()` (daemon shutdown) all route through
   * it exactly once per session. This is where a caller (e.g. `apps/cli`) hangs
   * the change-event-spine checkpoint + worktree release so cleanup happens in exactly one place.
   */
  onClose?: (session: LiveSession) => void;
}

interface Entry {
  session: LiveSession;
  timer: TimerHandle | undefined;
}

function defaultSetTimer(fn: () => void, ms: number): TimerHandle {
  const h = setTimeout(fn, ms);
  if (typeof h.unref === 'function') h.unref();
  return { clear: () => clearTimeout(h) };
}

/**
 * The daemon-wide home for every conversation's `LiveSession`, keyed by
 * conversation id. Owns idle-timeout lifecycle: a session left untouched for
 * `idleMs` is closed and evicted automatically, so a long-lived daemon
 * doesn't accumulate abandoned sessions.
 */
export class LiveSessionRegistry {
  #entries = new Map<string, Entry>();
  #idleMs: number | undefined;
  #setTimer: (fn: () => void, ms: number) => TimerHandle;
  #onClose: ((session: LiveSession) => void) | undefined;

  constructor(options: LiveRegistryOptions = {}) {
    this.#idleMs = options.idleMs;
    this.#setTimer = options.setTimer ?? defaultSetTimer;
    this.#onClose = options.onClose;
  }

  /** Look up an existing session, or create and register a new one. `lineage`
   *  is forwarded to the {@link LiveSession} constructor unchanged; a session
   *  created with no lineage is a root, matching prior behavior exactly. */
  getOrCreate(
    id: string,
    lineage?: { parent?: string; root?: string },
  ): { session: LiveSession; created: boolean } {
    const existing = this.#entries.get(id);
    if (existing) return { session: existing.session, created: false };
    const session = new LiveSession(id, lineage);
    this.#entries.set(id, { session, timer: undefined });
    this.#arm(id);
    return { session, created: true };
  }

  /** Look up a session without creating one. */
  get(id: string): LiveSession | undefined {
    return this.#entries.get(id)?.session;
  }

  /**
   * The SINGLE teardown path for a session — idle-eviction, the `closeSession`
   * verb, and `closeAll()` (shutdown) all call this and only this. Clears the
   * idle timer, aborts an in-flight turn (if any), runs `onClose` (the
   * checkpoint/worktree-release hook), closes the session's turn channel, and
   * removes it from the registry.
   *
   * With idle-eviction now running-aware (see `#onIdleFire`), this only ever
   * aborts a turn on the explicit `closeSession` verb or on shutdown — never on
   * a silent idle-timeout race against a genuinely active adapter (v1-acceptable
   * per the daemon-authoritative live session).
   */
  close(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    // Seal the WHOLE subtree before tearing any of it down: a descendant emits
    // its own completion notice as it closes, and an unsealed ancestor queue
    // would let that late notice wake a tree the user deliberately stopped.
    // Sealing every queue up front — before any teardown starts running — means
    // there is no window in which a descendant mid-teardown can still land a
    // push on another queue in the subtree; by the time #closeOne begins doing
    // anything observable, every queue in the subtree already rejects writes.
    //
    // descendantsOf walks DOWN from `id` via each session's `parent` link, so
    // this cascade only reaches a child whose `parent` was actually set at
    // creation (getOrCreate's `lineage` argument) — whatever spawns a child
    // session must pass that lineage, or the child silently falls outside every
    // cascade run against its ancestors.
    const descendants = descendantsOf(
      id,
      [...this.#entries.values()].map((e) => e.session),
    );
    for (const descendantId of descendants)
      this.#entries.get(descendantId)?.session.deliveries.seal();
    entry.session.deliveries.seal();
    for (const descendantId of descendants) this.#closeOne(descendantId);
    this.#closeOne(id);
  }

  /** The actual per-session teardown: idle-timer clear, user-stop-safe abort,
   *  `onClose`, channel close, and map removal. Cascading only decides WHICH
   *  ids this runs for and seals every queue first — this logic itself is
   *  unchanged from before cascading existed. */
  #closeOne(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.timer?.clear();
    const { session } = entry;
    if (session.control !== undefined) {
      // a close-triggered abort is a user-style stop, never a governance
      // block — request the stop BEFORE aborting so the drive strategy's
      // settlement (the same state `interruptSession` relies on) suppresses the
      // resulting throw/settle instead of rendering it as an error. This cascade
      // never runs the driver's close-out closure (no settled partial, no interrupt
      // marker — a hard teardown, not a graceful one), so it closes the stop itself,
      // synchronously, before the abort: `requestStop()` alone leaves the phase at
      // stop-requested, where frames are still meant to flow, and the abort's own
      // straggler would be recorded before this session's later settle() ever runs.
      // closeStop() makes `inert` true immediately, so nothing the abort provokes —
      // synchronously or later — gets recorded for a session this call already decided
      // to end. Both returns are intentionally unchecked: whichever phase this session
      // was already in (a concurrent user stop can have moved it), the pair together
      // always leaves the machine in stopped or settled — both already inert — so there
      // is no phase this can reach where the abort's straggler would still be recorded.
      session.control.lifecycle.requestStop();
      session.control.lifecycle.closeStop();
      session.control.controller.abort();
    }
    this.#onClose?.(session);
    session.close();
    this.#entries.delete(id);
  }

  /** Close and remove every registered session. */
  closeAll(): void {
    for (const id of [...this.#entries.keys()]) this.close(id);
  }

  /** Reset the idle timer for `id` (never stacks timers). Called on any turn activity. */
  touch(id: string): void {
    if (!this.#entries.has(id)) return;
    this.#arm(id);
  }

  /** Clear any existing idle timer for `id` and, when `idleMs` is set, arm a fresh one. */
  #arm(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.timer?.clear();
    entry.timer = undefined;
    if (this.#idleMs === undefined) return;
    entry.timer = this.#setTimer(() => this.#onIdleFire(id), this.#idleMs);
  }

  /**
   * The idle timer fired for `id`. A session still genuinely `running` a turn
   * (FIX #1) is NOT evicted — that would detach the loop mid-run, orphaning it
   * from `interruptSession`/`steerSession` and risking a second `LiveSession`
   * minted for the same conversation on the next send. Instead, re-arm and keep
   * waiting; only a session that is actually `idle` when the timer fires is
   * evicted.
   */
  #onIdleFire(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    if (entry.session.state === 'running') {
      this.#arm(id);
      return;
    }
    this.close(id);
  }
}

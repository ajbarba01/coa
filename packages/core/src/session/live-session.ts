import type { ModelSelection, Push } from '@coa/shared';
import { DeliveryQueue } from './delivery.js';
import type { TurnLifecycle } from './turn-lifecycle.js';

/**
 * A `LiveSession`'s run state — whether the backend loop is actively driving a
 * turn or waiting on the next one. Maps directly onto the `status` push's
 * `state` enum (a subset of it).
 */
export type RunState = 'idle' | 'running';

/**
 * The per-turn request fields a caller enqueues onto a session, mirroring
 * `createParams` in `session-handlers.ts` (minus the fields that only make
 * sense at session-creation time, e.g. `conversationId`).
 */
export interface TurnRequest {
  input: string;
  /** The legacy singular role — superseded by `roles`, but still what `assemblePieces`
   *  and the config hash read. It rides the turn (rather than the sender's own
   *  bookkeeping) because the daemon, not the sender, is what drives the turn. */
  role?: string;
  model?: ModelSelection;
  roles?: string[];
  scope?: string;
  packageIds?: string[];
  exclude?: string[];
}

/** A subscriber callback that receives every push fanned out by a session. */
export type Sink = (push: Push) => void;

/** Where a turn is running, as the backend reports it at `onStart`. */
export interface StartedHandle {
  id: string;
  worktree: string;
}

/**
 * A caller's request to join this session's fan-out AT THE TURN'S TRUE FIRST STATUS
 * rather than right now — hydrating on arrival would push a spurious leading `idle`
 * ahead of the run it is meant to describe. `onAttached` hands the unsubscribe back so
 * the caller can release the sink when it goes away (a dropped console must not leave a
 * sink fanned out to forever).
 */
export interface TurnSubscription {
  sink: Sink;
  onAttached: (off: () => void) => void;
}

/**
 * What actually rides a session's queue: the request, plus the one-shot callbacks the
 * SENDER attached to this particular turn. They travel WITH the turn because a live
 * session is driven by the daemon, not by whichever caller founded it — anything the
 * founder kept privately would be invisible to every later sender's turn.
 */
export interface QueuedTurn extends TurnRequest {
  /** Set only the first time a given caller sends against this session — consumed
   *  (once) inside the driver's `onStart`. */
  subscribe?: TurnSubscription;
  /** Set only for the FOUNDING turn (a brand-new session) — resolves the caller's
   *  pending answer with the worktree as soon as the turn starts. */
  onReady?: (started: StartedHandle) => void;
}

/**
 * The CURRENTLY in-flight turn's control state (CHAT-10): one
 * {@link AbortController} whose signal the session layer forwards to the adapter as the
 * neutral user-stop, plus the turn's {@link TurnLifecycle} — the one owned state that
 * says where the turn stands, and so whether a settlement is looking at a user stop or a
 * genuine loop failure (an interrupt must never surface as an error). The driver that
 * started the run owns the same lifecycle instance, so the service and the driver read
 * one state rather than two flags they have to keep in agreement. Lives on the
 * {@link LiveSession} (not a per-connection map) so ANY connection sharing the daemon's
 * registry — not just the one that started the turn — can resolve and act on it (see
 * the daemon-authoritative reattach contract).
 */
export interface TurnControl {
  controller: AbortController;
  lifecycle: TurnLifecycle;
  /**
   * Which drive strategy owns this turn (the held-open streaming-input strategy). `held-open` ⇒ a steer
   * is routed into the live query's derived input feed via {@link LiveSession.pushSteer};
   * absent/`per-turn` ⇒ the caller pushes onto `session.deliveries` directly, for the
   * backend to drain at its next round trip. Set when the turn starts.
   */
  mode?: 'per-turn' | 'held-open';
}

/**
 * The long-lived, in-memory home for a single conversation's live state: an
 * input turn-channel the backend loop drains one turn at a time, an
 * `idle`/`running` run-state, and the set of subscriber sinks (e.g. RPC
 * connections) that get every push fanned out to them. Pure and
 * backend-agnostic — it owns no loop, no adapter, no persistence.
 */
export class LiveSession {
  readonly id: string;
  /** The session that spawned this one; absent ⇒ a root a person started. */
  readonly parent: string | undefined;
  /** This session's family-tree root — itself, for a root session. */
  readonly root: string;
  worktree: string | undefined;
  state: RunState = 'idle';
  /** The currently in-flight turn's control state; `undefined` when idle. */
  control: TurnControl | undefined = undefined;
  /**
   * Text waiting to reach this session's model mid-loop. Sealed by `close()` so a
   * delivery arriving after teardown can never wake a stopped session.
   */
  readonly deliveries = new DeliveryQueue();

  #sinks = new Set<Sink>();
  #queue: QueuedTurn[] = [];
  #waiter: ((turn: QueuedTurn | undefined) => void) | undefined;
  #closed = false;
  #steerSink: ((text: string) => void) | undefined = undefined;
  #interruptClosure: (() => boolean) | undefined = undefined;
  #onClose: Array<() => void> = [];

  constructor(id: string, lineage?: { parent?: string; root?: string }) {
    this.id = id;
    this.parent = lineage?.parent;
    this.root = lineage?.root ?? id;
  }

  /**
   * Point the held-open steer route at the live query's derived input feed (the SDK
   * streaming-input strategy). Set by the held-open driver when
   * a query is established, cleared (`undefined`) when it terminates; a `per-turn`
   * session leaves it unset, so {@link pushSteer} reports it has nowhere to route.
   */
  setSteerSink(sink: ((text: string) => void) | undefined): void {
    this.#steerSink = sink;
  }

  /** Route a steer into the live held-open query's derived input feed. Returns
   *  `false` when no held-open query is active (the caller falls back to pushing
   *  onto `session.deliveries` directly). */
  pushSteer(text: string): boolean {
    if (this.#steerSink === undefined) return false;
    this.#steerSink(text);
    return true;
  }

  /**
   * Register how a user stop closes the in-flight turn (set by the driver when a turn starts,
   * cleared when it ends). The closure settles the turn's streamed-but-unsettled blocks, records
   * the interrupt marker, and stops the backend the way THAT drive strategy must (a held-open
   * query takes a turn-level interrupt and stays alive; a per-turn loop aborts). Keeping it here
   * lets `interruptSession` stay strategy-agnostic (the backend-blind-core rule).
   */
  setInterruptClosure(fn: (() => boolean) | undefined): void {
    this.#interruptClosure = fn;
  }

  /** Close the in-flight turn on a user stop. Returns `false` when no turn is in flight
   *  (a held-open query keeps its control state between turns, so the closure decides). */
  closeInterrupted(): boolean {
    return this.#interruptClosure?.() ?? false;
  }

  /** Register a finalizer run once from {@link close} — where the held-open driver
   *  ends its derived input feed so the long-lived backend query terminates after
   *  the last turn's result. */
  onClose(fn: () => void): void {
    this.#onClose.push(fn);
  }

  /** Add `sink` to the fan-out set, hydrate it with the current status push,
   *  and return an unsubscribe function. */
  subscribe(sink: Sink): () => void {
    this.#sinks.add(sink);
    // The hydration call is subject to the same crash-safety as `emit` below — a
    // sink that throws on its very first push is dropped rather than propagating
    // into the caller (e.g. a driver's `onStart`).
    try {
      sink(this.#statusPush());
    } catch {
      this.#sinks.delete(sink);
    }
    return () => this.#sinks.delete(sink);
  }

  /** Fan `push` out to every subscribed sink. A sink that throws (e.g. a dropped
   *  connection) is dropped from the fan-out set instead of aborting delivery to
   *  the others or propagating into a caller like `setState`. */
  emit(push: Push): void {
    for (const sink of [...this.#sinks]) {
      try {
        sink(push);
      } catch {
        this.#sinks.delete(sink);
      }
    }
  }

  /** Queue `turn` for the loop to drain, resolving a pending `nextTurn()` waiter
   *  immediately if one is parked. A no-op once `close()` has run — the queue
   *  must not outlive the session, so nothing enqueued after teardown is ever
   *  kept around to be drained later (mirrors `deliveries`' sealed-push guard). */
  enqueue(turn: QueuedTurn): void {
    if (this.#closed) return;
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter(turn);
      return;
    }
    this.#queue.push(turn);
  }

  /** Resolve with the next queued turn, or wait for one to be enqueued. Once
   *  `close()` has been called and the queue is drained, resolves `undefined`. */
  async nextTurn(): Promise<QueuedTurn | undefined> {
    if (this.#queue.length > 0) return this.#queue.shift();
    if (this.#closed) return undefined;
    return new Promise<QueuedTurn | undefined>((resolve) => {
      this.#waiter = resolve;
    });
  }

  /** Mark the channel closed; run the registered finalizers (e.g. ending a
   *  held-open query's input feed), drop any turn still sitting in the queue,
   *  and resolve any parked `nextTurn()` waiter with `undefined`. */
  close(): void {
    this.#closed = true;
    this.deliveries.seal();
    // A turn already queued but not yet drained must not outlive the session:
    // left in place, the NEXT `nextTurn()` call (once the loop's current turn
    // finishes) would still find it and hand it to `runTurn`, dispatching a
    // brand-new backend query the registry — which has already deleted this
    // session's entry by the time close() runs — has no record of. Drop it
    // explicitly instead of letting `nextTurn()` silently drain it later.
    this.#queue = [];
    // Finalizers first (and once): ending the held-open input feed lets the backend
    // query drain its last result before the parked loop wakes and exits.
    const finalizers = this.#onClose;
    this.#onClose = [];
    for (const fn of finalizers) fn();
    if (this.#waiter) {
      const waiter = this.#waiter;
      this.#waiter = undefined;
      waiter(undefined);
    }
  }

  /** Update the run state (and worktree, if given) and emit the resulting
   *  status push to every subscriber. */
  setState(state: RunState, worktree?: string): void {
    this.state = state;
    if (worktree !== undefined) this.worktree = worktree;
    this.emit(this.#statusPush());
  }

  #statusPush(): Push {
    return { kind: 'status', sessionId: this.id, worktree: this.worktree ?? '', state: this.state };
  }
}

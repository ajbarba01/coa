import type { ModelSelection, Push } from '@coa/shared';

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
  model?: ModelSelection;
  roles?: string[];
  scope?: string;
  packageIds?: string[];
  exclude?: string[];
}

/** A subscriber callback that receives every push fanned out by a session. */
export type Sink = (push: Push) => void;

/**
 * The CURRENTLY in-flight turn's control state (CHAT-10): one
 * {@link AbortController} whose signal M8 forwards to the adapter as the
 * neutral user-stop, and a queue of steer turns the pure-API driver drains at
 * its next safe boundary. `interrupted` distinguishes a user-initiated stop
 * from a genuine loop failure in `session-handlers.ts`'s settlement — SC-1: an
 * interrupt must never surface as an error. Lives on the {@link LiveSession}
 * (not a per-connection map) so ANY connection sharing the daemon's registry —
 * not just the one that started the turn — can resolve and act on it (see
 * docs/adr/0011, the G4 reattach contract).
 */
export interface TurnControl {
  controller: AbortController;
  steer: string[];
  interrupted: boolean;
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
  worktree: string | undefined;
  state: RunState = 'idle';
  /** The currently in-flight turn's control state; `undefined` when idle. */
  control: TurnControl | undefined = undefined;

  #sinks = new Set<Sink>();
  #queue: TurnRequest[] = [];
  #waiter: ((turn: TurnRequest | undefined) => void) | undefined;
  #closed = false;

  constructor(id: string) {
    this.id = id;
  }

  /** Add `sink` to the fan-out set, hydrate it with the current status push,
   *  and return an unsubscribe function. */
  subscribe(sink: Sink): () => void {
    this.#sinks.add(sink);
    // The hydration call is subject to the same crash-safety as `emit` below — a
    // sink that throws on its very first push is dropped rather than propagating
    // into the caller (e.g. `onStart` in session-handlers.ts).
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
   *  immediately if one is parked. */
  enqueue(turn: TurnRequest): void {
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
  async nextTurn(): Promise<TurnRequest | undefined> {
    if (this.#queue.length > 0) return this.#queue.shift();
    if (this.#closed) return undefined;
    return new Promise<TurnRequest | undefined>((resolve) => {
      this.#waiter = resolve;
    });
  }

  /** Mark the channel closed; any parked `nextTurn()` waiter resolves `undefined`. */
  close(): void {
    this.#closed = true;
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

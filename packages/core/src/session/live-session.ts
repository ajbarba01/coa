import { randomUUID } from 'node:crypto';
import type {
  Attachment,
  ModelSelection,
  PermissionMode,
  Push,
  ToolCall,
  ToolClass,
} from '@coa/shared';
import { DeliveryQueue } from './delivery.js';
import type { TurnLifecycle } from './turn-lifecycle.js';

/** The system-wide mode floor a session with no agent-resolved default falls back
 *  to — `manual` (ask before writes/commands), the same balanced default Claude
 *  Code's own `default` mode uses. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'manual';

/** A still-pending approval request, as replayed to a caller reading the current
 *  snapshot (e.g. a console reattach) — the push payload minus its resolver. */
export interface PendingApprovalSnapshot {
  requestId: string;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
}

/** Best-effort one-line summary of a proposed tool call, for the approval card.
 *  Prefers a symbol ref's name/path (edit_symbol) over a plain arg (Write/Edit's
 *  `path`, apply_patch's `target`, Bash's `command`); falls back to the bare
 *  tool name when neither is present. Pure and total — never throws. */
function summarizeToolCall(call: ToolCall): string {
  const ref = call.ref;
  if (ref !== undefined) {
    const label =
      'name' in ref ? ref.name : ref.symbol !== undefined ? `${ref.path}#${ref.symbol}` : ref.path;
    return `${call.tool} ${label}`;
  }
  for (const key of ['path', 'target', 'command']) {
    const value = call.args[key];
    if (typeof value === 'string') return `${call.tool} ${value}`;
  }
  return call.tool;
}

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
  /** Attachments on THIS turn's user message (the one shared wire shape). Rides the
   *  turn to the backend adapter; absent/empty ⇒ byte-identical to before. */
  attachments?: readonly Attachment[];
  /** Whether the turn's model reports image-input support — resolved DAEMON-side
   *  from the model-metadata catalog at the RPC edge (never client-claimed), and
   *  consumed by the adapter's image gate. Absent ⇒ unverified, treated as no. */
  visionSupported?: boolean;
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
  /**
   * Set on a spawned child's FOUNDING turn (`SessionService#startChild`, from
   * `StartChildRequest.isolate`) — an ordinary `send()` never sets this, so a
   * top-level session is never isolated. `bindWorktree` is idempotent per session
   * (see `WorktreeManager`), so a later turn on the same child omitting this is
   * normally fine: the session's isolation decision was already made on its first
   * turn, and `WorktreeManager` still remembers it in-process. That memory does NOT
   * survive a daemon restart, though — `SessionService#wake` (waking an idle child
   * to deliver an inbound message) re-sets this field from the persisted
   * `SessionMeta.isolated` flag specifically to cover that case, so a resumed
   * session's worktree binding never silently degrades to the shared root.
   */
  isolate?: boolean;
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

  /** F2: this session's CONFIGURED permission mode — settable live via {@link setMode};
   *  a mode-aware `canUseTool` predicate reads it fresh on every call (see
   *  `permission.ts`'s `ModeDeps.getMode`), so a switch takes effect starting with
   *  the NEXT tool call, never retroactively on one already in flight. */
  mode: PermissionMode;
  /** F2: whether the CURRENTLY active backend adapter can actually honor an ask (a
   *  real approval seam) — set once per turn-drive, when the provider is known
   *  (see the daemon's `resolveMode` wiring). Defaults `true`: every backend wired
   *  today genuinely awaits `canUseTool`, so a session read before its first turn
   *  reports the honest floor rather than a premature degrade. */
  approvalSeam = true;

  #sinks = new Set<Sink>();
  #queue: QueuedTurn[] = [];
  #waiter: ((turn: QueuedTurn | undefined) => void) | undefined;
  #closed = false;
  #steerSink: ((text: string) => void) | undefined = undefined;
  #interruptClosure: (() => boolean) | undefined = undefined;
  #onClose: Array<() => void> = [];
  #pendingApprovals = new Map<
    string,
    { resolve: (decision: 'allow' | 'deny') => void; snapshot: PendingApprovalSnapshot }
  >();

  constructor(
    id: string,
    lineage?: { parent?: string; root?: string },
    defaultMode: PermissionMode = DEFAULT_PERMISSION_MODE,
  ) {
    this.id = id;
    this.parent = lineage?.parent;
    this.root = lineage?.root ?? id;
    this.mode = defaultMode;
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

  /** F2: live-switch this session's permission mode and reflect the change to
   *  every subscriber (the `mode` push). Taking effect starting with the NEXT
   *  tool call is a property of HOW the predicate reads `mode` (fresh, every
   *  call — see `permission.ts`), not of this method. */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
    this.emit(this.#modePush());
  }

  /** F2: record whether the active backend adapter can currently honor an ask (a
   *  per-turn-drive fact, since it can only be known once the provider is
   *  resolved). Re-emits the reflection only when the EFFECTIVE mode actually
   *  changes as a result, so an unchanged provider across turns never spams a
   *  push nothing downstream needs to react to. */
  setApprovalSeam(seam: boolean): void {
    if (seam === this.approvalSeam) return;
    const before = this.effectiveMode();
    this.approvalSeam = seam;
    if (this.effectiveMode() !== before) this.emit(this.#modePush());
  }

  /** F2: the mode the `canUseTool` predicate actually enforces right now —
   *  `bypass` whenever {@link approvalSeam} is false, regardless of the
   *  configured {@link mode} (SC-1 honesty: never claim an enforcement the
   *  backend cannot deliver). */
  effectiveMode(): PermissionMode {
    return this.approvalSeam ? this.mode : 'bypass';
  }

  #modePush(): Push {
    const effectiveMode = this.effectiveMode();
    return {
      kind: 'mode',
      sessionId: this.id,
      mode: this.mode,
      effectiveMode,
      ...(effectiveMode !== this.mode
        ? { degraded: 'the active backend has no approval seam — enforcement degrades to bypass' }
        : {}),
    };
  }

  /**
   * F2: ask the user, blocking until they answer ({@link resolveApproval}) or
   * the session closes (resolves `'deny'` — fail-safe, so a torn-down session
   * never leaves the awaiting `canUseTool` call hanging on a promise nothing
   * will ever settle). Pushes the pending request live (the `approval` push)
   * and reflects `blocked-approval` on the status channel WITHOUT touching
   * `state` itself (mirrors the ad hoc terminal-status pushes
   * `session-service.ts` emits for `done`/`error`/`interrupted`) — the turn is
   * still `running` underneath; the running status resumes once answered.
   */
  requestApproval(call: ToolCall, toolClass: ToolClass): Promise<'allow' | 'deny'> {
    const requestId = randomUUID();
    const snapshot: PendingApprovalSnapshot = {
      requestId,
      tool: call.tool,
      summary: summarizeToolCall(call),
      input: call.args,
    };
    this.emit({
      kind: 'approval',
      requestId,
      sessionId: this.id,
      summary: snapshot.summary,
      tool: call.tool,
      input: call.args,
      toolClass,
    });
    this.emit({
      kind: 'status',
      sessionId: this.id,
      worktree: this.worktree ?? '',
      state: 'blocked-approval',
    });
    return new Promise<'allow' | 'deny'>((resolve) => {
      this.#pendingApprovals.set(requestId, { resolve, snapshot });
    });
  }

  /** F2: resolve a pending approval request. `false` ⇒ no such pending request
   *  (already answered, the session was already torn down, or the id is stale/
   *  unknown) — a second answer to the same id is a harmless no-op, not an error. */
  resolveApproval(requestId: string, decision: 'allow' | 'deny'): boolean {
    const pending = this.#pendingApprovals.get(requestId);
    if (pending === undefined) return false;
    this.#pendingApprovals.delete(requestId);
    pending.resolve(decision);
    // Only reflect back to `running` once EVERY pending ask has cleared — another
    // one still open means the turn is still blocked on it.
    if (this.#pendingApprovals.size === 0) {
      this.emit({
        kind: 'status',
        sessionId: this.id,
        worktree: this.worktree ?? '',
        state: this.state === 'running' ? 'running' : 'idle',
      });
    }
    return true;
  }

  /** F2: every approval request still awaiting a reply, as a plain read (e.g. for
   *  a console reattach to learn what's pending without waiting on a push). */
  pendingApprovals(): PendingApprovalSnapshot[] {
    return [...this.#pendingApprovals.values()].map((p) => p.snapshot);
  }

  /**
   * F2: fail-safe-resolve every still-pending ask as denied WITHOUT the
   * intermediate running/idle reflection {@link resolveApproval} emits (the
   * caller is about to emit its own terminal status right after — `interrupted`
   * from a user Stop, or nothing at all from {@link close}'s hard teardown —
   * so an extra flip back to running first would be a lie no one asked to see).
   * Called from a user Stop (`SessionService.interrupt`): a turn that just
   * stopped will never make the tool call its ask was blocking, so leaving the
   * ask pending would hang the daemon's `#pendingApprovals` entry forever (and
   * a later reattach's `sessionMode` snapshot would keep reporting a request
   * for a tool call that will never happen) while gate-locking the composer,
   * which has no answer it could ever send. Also the tail of {@link close}'s own
   * fail-safe, so there is exactly one place this logic lives.
   */
  abandonPendingApprovals(): void {
    for (const pending of this.#pendingApprovals.values()) pending.resolve('deny');
    this.#pendingApprovals.clear();
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
    // F2 fail-safe: a still-pending ask must not hang forever once the session is
    // torn down — resolve every one as denied so its awaiting `canUseTool` call
    // unblocks instead of leaking a promise nothing will ever settle.
    this.abandonPendingApprovals();
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

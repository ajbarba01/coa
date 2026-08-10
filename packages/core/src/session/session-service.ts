import { randomUUID } from 'node:crypto';
import type {
  AgentSummary,
  ApprovalDecision,
  Attachment,
  ModelSelection,
  PermissionMode,
  TurnFrame,
} from '@coa/shared';
import type { MessagingDeps } from '../workbench/messaging.js';
import type { SpawnDeps } from '../workbench/spawn.js';
import type { ConversationStore, SessionMeta } from './conversation-store.js';
import { createHeldOpenDriver } from './held-open-driver.js';
import { descendantsOf } from './lineage.js';
import type { LiveSessionRegistry } from './live-registry.js';
import {
  DEFAULT_PERMISSION_MODE,
  type LiveSession,
  type PendingApprovalSnapshot,
  type QueuedTurn,
  type Sink,
  type TurnSubscription,
} from './live-session.js';
import {
  buildRoster,
  dispatchMessage,
  type DispatchDeps,
  type LiveState,
  type MeshLookup,
  type RosterMember,
} from './message-dispatch.js';
import type { AgentMessage, MessageLog } from './message-log.js';
import { renderMidTurnDelivery, renderWakeInput } from './message-render.js';
import { renderChildEnded, type SessionEndReason } from './notify.js';
import { runPerTurn } from './per-turn-driver.js';
import { runLiveSession, type RunTurn } from './run-live-session.js';
import type { SessionDeps } from './session.js';
import { foldTreeToTranscript, latestAssistantText } from './transcript-projection.js';
import type { TerminalState, TurnDriverDeps } from './turn-driver.js';
import { deriveTitle } from './turn-persistence.js';

/** `#emitStatus`'s `TerminalState` → `notify.ts`'s `SessionEndReason` — the one mapping
 *  shared by the completion notice (`#notifyParentIfChild`), the completion announcement
 *  (`#announceSubagent`), and the roster's own last-observed-end read (`#lastEnd`). */
function toEndReason(state: TerminalState): SessionEndReason {
  return state === 'done' ? 'completed' : state === 'error' ? 'errored' : 'stopped';
}

/**
 * The daemon's one owner of live-session lifetime (docs/adr/0011). Constructed ONCE, at
 * the composition root, beside the registry and the conversation store it drives.
 *
 * The daemon is authoritative for a conversation's liveness, so the machinery that keeps
 * a conversation running has to outlive any single caller. That is what this class is:
 * `send` is **send-or-create** — it resolves (or mints) the conversation id, queues the
 * request onto the {@link LiveSessionRegistry}'s one {@link LiveSession} for that id,
 * and, only the first time, starts the daemon-owned turn loop that drains that queue one
 * turn at a time. Every later send — from ANY caller, over any transport — rides the same
 * loop. A live session runs headless with zero subscribers; nothing about its lifecycle
 * depends on whoever happened to found it.
 *
 * That is also why nothing caller-scoped is stored here. A caller's per-turn facts (the
 * role it asked for, the sink it wants hydrated, the answer it is waiting on) travel WITH
 * the turn, as {@link QueuedTurn} fields. State kept privately by the founding caller
 * would be invisible to the drive loop the moment a different caller sent the next turn —
 * silently dropping that turn's role and never hydrating its sink.
 *
 * When the request carries a `conversationId` and a {@link ConversationStore} is wired,
 * the conversation is **persistent**: the store supplies the prior backend session id to
 * resume (so the model has memory), the user prompt and every streamed frame are appended
 * durably, the `seq` continues from the stored tip, and the backend's own session id is
 * captured for the next send. Without a `conversationId` the conversation is ephemeral
 * (the CLI `coa run` path) — nothing is persisted and `seq` starts at 0 each turn.
 */

export interface SessionServiceOptions {
  deps: SessionDeps;
  registry: LiveSessionRegistry;
  /** The durable conversation record; absent ⇒ every conversation is ephemeral. */
  store?: ConversationStore;
  /**
   * The LIVE effective agent set. Read per spawn, never cached: an agent authored
   * moments ago must be spawnable immediately. Absent ⇒ spawning stays unavailable
   * (see {@link SessionService.spawnFor}).
   */
  listAgents?: () => readonly AgentSummary[];
  /**
   * The durable inter-agent message log (docs/adr/0039). Absent ⇒ messaging stays
   * unavailable (see {@link SessionService.messagingFor}) — the same absent-port floor
   * `store`/`listAgents` already establish for spawning.
   */
  messageLog?: MessageLog;
}

/** One send against a conversation: the turn's own content plus the two one-shot
 *  callbacks the caller attaches to THIS turn. */
export interface SendRequest {
  /** The persistent conversation to run within; absent ⇒ mint an ephemeral one-shot. */
  conversationId?: string;
  input: string;
  role: string;
  roles?: string[];
  scope: string;
  model?: ModelSelection;
  packageIds?: string[];
  exclude?: string[];
  /** Attachments on this send's user message; ride the queued turn to the adapter. */
  attachments?: readonly Attachment[];
  /** Daemon-resolved image-input capability for this send's model (see `TurnRequest`). */
  visionSupported?: boolean;
  /** Join this session's fan-out at the turn's true first status; absent ⇒ the caller is
   *  already attached (or wants nothing pushed to it). */
  subscribe?: TurnSubscription;
}

/** What a spawn call carries. Model/roles/packages deliberately are NOT here: they come
 *  from the agent DEFINITION, which is the whole point of dispatching via the registry. */
export interface StartChildRequest {
  agentRef: string;
  description: string;
  prompt: string;
  /** Give the child its own git worktree instead of sharing the parent's; absent/`false`
   *  ⇒ today's shared-root behavior, byte-identical. */
  isolate?: boolean | undefined;
}

export class SessionService {
  readonly #deps: SessionDeps;
  readonly #registry: LiveSessionRegistry;
  readonly #store: ConversationStore | undefined;
  readonly #listAgents: (() => readonly AgentSummary[]) | undefined;
  readonly #messageLog: MessageLog | undefined;
  readonly #driverDeps: TurnDriverDeps;
  /** The last `SessionEndReason` this process itself observed for a session, keyed by
   *  id — populated in `#emitStatus`, read by the roster's graded-confidence liveness
   *  (`#roster`/`message-dispatch.ts`'s `buildRoster`). In-process only (not persisted):
   *  a session that ended in a PRIOR daemon lifetime reads as advisory, never fabricating
   *  an observation this process never made (SC-1 honesty). */
  readonly #lastEnd = new Map<string, { reason: SessionEndReason; at: string }>();
  /** A per-session counter for the three LIVE-ONLY subagent announcement frames
   *  (`#announceSubagent`) — a separate numbering space from the persisted event log's
   *  own `seq` (these frames are never appended to it; see `push.ts`'s doc comment on
   *  the three `subagent-*` kinds). */
  readonly #liveSeq = new Map<string, number>();

  constructor(options: SessionServiceOptions) {
    this.#deps = options.deps;
    this.#registry = options.registry;
    this.#store = options.store;
    this.#listAgents = options.listAgents;
    this.#messageLog = options.messageLog;
    this.#driverDeps = {
      deps: this.#deps,
      registry: this.#registry,
      emitStatus: (session, worktree, state, detail) =>
        this.#emitStatus(session, worktree, state, detail),
    };
  }

  /**
   * Send-or-create: queue `req` as a turn on this conversation's live session, starting
   * the daemon-owned turn loop if this send founded it. Resolves with the worktree —
   * awaited from the founding turn's start, or read straight off an already-live session
   * (whose queued turn may sit behind another still in flight, so waiting would stall the
   * answer for no gain).
   */
  async send(req: SendRequest): Promise<{ sessionId: string; worktree: string }> {
    const id = req.conversationId ?? this.#deps.newSessionId();
    // F2: a new session inherits its agent's configured default mode. The
    // conversation's `agentRef` — when one was pre-created via the `newSession`
    // record (the console's normal top-level flow, before this first send) —
    // resolves through the SAME live agent list a spawn uses; an ephemeral send
    // with no store, or a conversation record with no agentRef, falls back to the
    // system floor. Ignored by `getOrCreate` when the session already exists.
    const defaultMode = this.#resolveDefaultMode(this.#store?.getMeta(id)?.agentRef);
    const { session, created } = this.#registry.getOrCreate(id, undefined, defaultMode);

    const turn: QueuedTurn = {
      input: req.input,
      role: req.role,
      scope: req.scope,
      ...(req.model !== undefined ? { model: req.model } : {}),
      ...(req.roles !== undefined ? { roles: req.roles } : {}),
      ...(req.packageIds !== undefined ? { packageIds: req.packageIds } : {}),
      ...(req.exclude !== undefined ? { exclude: req.exclude } : {}),
      ...(req.attachments !== undefined ? { attachments: req.attachments } : {}),
      ...(req.visionSupported !== undefined ? { visionSupported: req.visionSupported } : {}),
      ...(req.subscribe !== undefined ? { subscribe: req.subscribe } : {}),
    };

    let ready: Promise<string> | undefined;
    if (created) {
      ready = new Promise<string>((resolve) => {
        turn.onReady = (started) => resolve(started.worktree);
      });
      // Only a conversation with a durable id persists; `coa run`'s one-shot does not.
      void runLiveSession(
        session,
        this.#makeRunTurn(req.conversationId !== undefined ? this.#store : undefined),
      );
    }

    session.enqueue(turn);
    this.#registry.touch(id);

    if (ready !== undefined) return { sessionId: id, worktree: await ready };
    return { sessionId: id, worktree: session.worktree ?? '' };
  }

  /**
   * Join an already-known session's push stream, hydrating `sink` immediately with the
   * session's CURRENT run-status — the daemon is the source of truth for liveness, never
   * the client's own tracking. Returns the unsubscribe, or `undefined` for an unknown id.
   */
  subscribe(id: string, sink: Sink): (() => void) | undefined {
    return this.#registry.get(id)?.subscribe(sink);
  }

  /**
   * A user-initiated stop — never a governance block. Strategy-agnostic: the in-flight
   * turn's registered closure settles the partial the model streamed, records the
   * `interrupted` marker (persisted, so a reload reads the same transcript AND the model's
   * next turn knows it was cut off), and stops the backend the way that drive strategy
   * must. Each driver's settlement then suppresses the resulting throw/settle from
   * rendering as an error: a user stop is never an error.
   *
   * The stop is a two-step move on the turn's own lifecycle — request, then either the
   * driver closes it or the request is withdrawn — so a stop is never half-applied and
   * the caller's negative result and the turn's state can never disagree.
   */
  interrupt(id: string): boolean {
    const session = this.#registry.get(id);
    const lifecycle = session?.control?.lifecycle;
    if (session === undefined || lifecycle === undefined) return false;
    // Only a running turn can be stopped: a redundant Stop finds no edge and is reported
    // as "nothing to stop", leaving the earlier stop's own state intact.
    if (!lifecycle.requestStop()) return false;
    // A held-open query keeps `control` between turns, so the closure is the authority on
    // whether a turn was actually in flight.
    if (!session.closeInterrupted()) {
      lifecycle.abandonStop();
      return false;
    }
    // F2: the stopped turn will never make the tool call any pending ask of its was
    // blocking — fail-safe-deny it now (same reasoning as the session-teardown fail-safe
    // in `LiveSession.close`) rather than leaving it hanging: unanswerable forever, and
    // gate-locking the composer with a request no response could ever reach.
    session.abandonPendingApprovals();
    this.#emitStatus(session, session.worktree ?? '', 'interrupted');
    return true;
  }

  /**
   * Queue a mid-turn steer: one steer, one destination. The held-open route (its steer
   * sink lives in held-open-driver.ts) delivers it into the WORKING turn via the session's
   * delivery queue, or feeds it as a plain next turn when the query idles; a per-turn
   * backend has no held-open sink, so the same delivery queue is pushed directly here —
   * the running loop drains it at its own next round trip. `text` must already be trimmed
   * (see the caller's note on why the trimmed form is what gets recorded).
   */
  steer(id: string, text: string): boolean {
    const session = this.#registry.get(id);
    if (session?.control === undefined) return false;
    if (text === '') return false;
    if (session.control.mode === 'held-open') {
      session.pushSteer(text);
    } else {
      // Per-turn backends have no held-open sink; the same one queue reaches their loop
      // at the top of its next round trip.
      session.deliveries.push({ origin: 'user', text });
    }
    return true;
  }

  /**
   * F2 — RPC verb `setMode`. Live-switch a session's permission mode; takes
   * effect starting with the NEXT tool call (the mode-aware predicate reads it
   * fresh every call — see `permission.ts`), never retroactively on one already
   * in flight. `false` ⇒ unknown session id, nothing changed.
   */
  setMode(id: string, mode: PermissionMode): boolean {
    const session = this.#registry.get(id);
    if (session === undefined) return false;
    session.setMode(mode);
    return true;
  }

  /**
   * F2 — RPC verb `respondApproval`. Answer a pending ask raised by the
   * mode-aware predicate, unblocking the `canUseTool` call it is holding open.
   * `decision` is the WIRE vocabulary (`'approve'|'deny'`, matching the
   * console's existing approve/deny controls); mapped here onto the internal
   * `'allow'|'deny'` `LiveSession.resolveApproval` vocabulary. `false` ⇒ unknown
   * session id, or no pending request with that id (already answered, or stale)
   * — a second answer to the same id is a harmless no-op, not an error.
   */
  respondApproval(id: string, requestId: string, decision: ApprovalDecision): boolean {
    const session = this.#registry.get(id);
    if (session === undefined) return false;
    return session.resolveApproval(requestId, decision === 'approve' ? 'allow' : 'deny');
  }

  /**
   * F2 — RPC verb `sessionMode`. A plain synchronous snapshot of a session's
   * permission-mode state: the configured `mode`, the `effectiveMode` actually
   * enforced right now (differs from `mode` only when the active backend has no
   * approval seam — SC-1 honesty), and every approval request still awaiting a
   * reply. For a console that wants "what mode is this session in / is
   * something pending" without waiting on the next live push (e.g. a reattach).
   * `undefined` ⇒ unknown session id.
   */
  modeSnapshot(
    id: string,
  ):
    | { mode: PermissionMode; effectiveMode: PermissionMode; pending: PendingApprovalSnapshot[] }
    | undefined {
    const session = this.#registry.get(id);
    if (session === undefined) return undefined;
    return {
      mode: session.mode,
      effectiveMode: session.effectiveMode(),
      pending: session.pendingApprovals(),
    };
  }

  /**
   * F2: resolve the mode a NEW session should start in — its agent's configured
   * `defaultMode` when `agentRef` resolves through the live agent list, else the
   * system floor. Used by both `send` (a top-level session, via the
   * conversation record's `agentRef`) and `#startChild` (a spawn, via its own
   * `agentRef` directly) so registry default flows identically either way.
   */
  #resolveDefaultMode(agentRef: string | undefined): PermissionMode {
    const agent =
      agentRef !== undefined ? this.#listAgents?.().find((a) => a.ref === agentRef) : undefined;
    return agent?.defaultMode ?? DEFAULT_PERMISSION_MODE;
  }

  /**
   * Delegates entirely to `registry.close` — the SINGLE teardown path: checkpoint +
   * worktree-release happen exactly once, via the registry's `onClose` hook (wired at
   * daemon composition), so this never calls `deps.checkpoint`/`deps.releaseWorktree`
   * itself (that would double-release, since idle-eviction and shutdown call the registry
   * too).
   */
  close(id: string): boolean {
    if (this.#registry.get(id) === undefined) return false;
    this.#registry.close(id);
    return true;
  }

  /**
   * The drift banner's `recompile` action: drop the session's frozen prompt AND its
   * resume token, so the next send recompiles from the current config and starts a
   * fresh backend session with it (memory is carried across via the transcript). The
   * old server session still holds the superseded prompt, so resuming it would keep
   * the stale prompt — hence both are cleared.
   */
  recompilePrompt(id: string): boolean {
    if (this.#store === undefined) return false;
    this.#store.clearCompilation(id);
    this.#store.clearBackendSession(id);
    return true;
  }

  /**
   * This session's subagent-dispatch port, bound to `sessionId` as the parent a spawn
   * writes into the child's lineage. Spawning needs BOTH a persistent store (a child's
   * lineage lives in `SessionMeta`, and `store.create`/`getMeta` are what makes the
   * parent notice ever fire) and the agent lookup — absent either, spawning stays
   * unavailable rather than half-working.
   */
  spawnFor(sessionId: string): SpawnDeps | undefined {
    const store = this.#store;
    const listAgents = this.#listAgents;
    if (store === undefined || listAgents === undefined) return undefined;
    return {
      listAgents,
      startChild: (req) => this.#startChild(sessionId, req, store, listAgents),
    };
  }

  /** Start a child session for `parentId`. Returns once the child has STARTED, never once
   *  it has finished (the non-blocking contract: surface, never block). Reachable only
   *  through {@link spawnFor}, which is what proves the store + agent list exist. */
  #startChild(
    parentId: string,
    req: StartChildRequest,
    store: ConversationStore,
    listAgents: () => readonly AgentSummary[],
  ): { sessionId: string } {
    const id = this.#deps.newSessionId();
    // `registry.get(parentId)?.root` — not the store's — because a parent already torn
    // down still has a durable `SessionMeta`, but its LIVE root is what the cascade
    // (a parent-link walk over live sessions, lineage.ts) actually needs. Falling back
    // to `parentId` covers the already-gone-parent case below: the child still gets a
    // well-formed (if orphaned) root rather than an undefined one.
    const root = this.#registry.get(parentId)?.root ?? parentId;
    const scope = store.getMeta(parentId)?.scope ?? '';
    // The LIVE effective set, read fresh (never cached) — an agent authored moments
    // ago must be spawnable immediately, and `req.agentRef` already comes from a
    // registry-resolved match (`spawn.ts` validates before ever calling this).
    const agent = listAgents().find((a) => a.ref === req.agentRef);

    // A spawn against an already-closed (or, since `registry.close` never yields
    // mid-cascade, equivalently an already-CLOSING) parent still creates and runs the
    // child: refusing would need either a throw (forbidden — the system never blocks a
    // spawn) or a bogus id the caller would wrongly read as success (worse — the work the
    // model asked for would silently never happen). The result is a deliberate orphan: no
    // live ancestor is left to ever cascade a stop through it, but it still runs its one
    // assigned turn to completion and self-cleans via the ordinary idle-eviction timer.
    // F2: the spawned child inherits ITS agent's configured default mode (not the
    // parent's live/current mode — a subagent's caution level is a property of
    // what it IS, not of whatever the parent happened to be set to).
    const { session } = this.#registry.getOrCreate(
      id,
      { parent: parentId, root },
      this.#resolveDefaultMode(agent?.ref),
    );
    store.create({
      id,
      agentRef: req.agentRef,
      title: deriveTitle(req.description),
      scope,
      parent: parentId,
      root,
      // Persisted (not just carried on this founding turn's QueuedTurn) so a later
      // daemon restart can still tell `#wake` this child owns its own worktree —
      // see `SessionMeta.isolated`'s doc.
      isolate: req.isolate === true,
    });

    const turn: QueuedTurn = {
      input: req.prompt,
      scope,
      role: agent?.roles?.[0] ?? '',
      // Model choice routes through the agent DEFINITION, never the spawn call — the
      // whole reason dispatch goes via the registry. An agentRef the registry no
      // longer recognizes by the time this runs (a narrow TOCTOU on a hand-edited
      // agent file) degrades to the account default rather than carrying no model.
      ...(agent?.provider !== undefined ||
      agent?.model !== undefined ||
      agent?.reasoning !== undefined
        ? {
            model: {
              ...(agent?.provider !== undefined ? { provider: agent.provider } : {}),
              ...(agent?.model !== undefined ? { model: agent.model } : {}),
              ...(agent?.reasoning !== undefined ? { reasoning: agent.reasoning } : {}),
            },
          }
        : {}),
      ...(agent?.roles !== undefined ? { roles: agent.roles } : {}),
      ...(agent?.packageIds !== undefined ? { packageIds: agent.packageIds } : {}),
      ...(agent?.exclude !== undefined ? { exclude: agent.exclude } : {}),
      ...(req.isolate !== undefined ? { isolate: req.isolate } : {}),
      // Announce the spawn to the PARENT's own live transcript once the child's worktree
      // is bound (the earliest point the announcement has anything real to say) — a
      // best-effort live annotation (`#announceSubagent` no-ops if the parent isn't
      // currently subscribed), never awaited, so it cannot delay `startChild`'s own
      // non-blocking return below.
      onReady: (started) => {
        this.#announceSubagent(parentId, {
          t: 'subagent-spawn',
          childSessionId: id,
          childWorktree: started.worktree,
          agentRef: req.agentRef,
          description: req.description,
          isolate: req.isolate === true,
        });
      },
    };

    // Non-blocking (the design's re-entrancy retirement): start the loop and return
    // immediately, never awaiting its completion. `runLiveSession` never rejects — a
    // turn's own failure is caught and rendered as an error frame — so there is no
    // unhandled rejection here to strand the parent; the `errored` notice reaches it
    // through `#emitStatus` like any other end.
    void runLiveSession(session, this.#makeRunTurn(store));
    session.enqueue(turn);
    this.#registry.touch(id);
    return { sessionId: id };
  }

  /**
   * The turn dispatcher, built once per live session. It consults the injected, abstract
   * per-provider strategy verdict — NEVER the backend itself, so composition stays
   * backend-neutral — and hands the turn to that strategy's driver. The held-open driver
   * is created here rather than per turn because its query, its shared cursor, and its
   * start handle are exactly what must survive from one turn to the next.
   */
  #makeRunTurn(persistentStore: ConversationStore | undefined): RunTurn {
    const heldOpen = createHeldOpenDriver(this.#driverDeps, persistentStore);
    return async (turn, session) => {
      const provider = turn.model?.provider ?? 'claude';
      const strategy = this.#deps.sessionStrategy?.(provider) ?? 'per-turn';
      if (strategy === 'held-open') {
        await heldOpen.run(turn, session);
        return;
      }
      // Provider switched to a per-turn backend mid-conversation ⇒ retire any open held
      // query first (its input feed closes, the query terminates), then run the turn
      // through the per-turn driver.
      await heldOpen.close();
      await runPerTurn(this.#driverDeps, turn, session, persistentStore);
    };
  }

  #emitStatus(session: LiveSession, worktree: string, state: TerminalState, detail?: string): void {
    session.emit({ kind: 'status', sessionId: session.id, worktree, state });
    // Recorded for every session that ends a turn this way, not only a child — the
    // roster's graded-confidence liveness (`#roster`) reads it for ANY tree member, not
    // just parent/child pairs, so this cannot be scoped to the child-only branch below.
    this.#lastEnd.set(session.id, { reason: toEndReason(state), at: new Date().toISOString() });
    this.#notifyParentIfChild(session, state, detail);
  }

  /**
   * A child's ending is a system fact, not a message from the child: the child never
   * composes it, and a model must not be able to fabricate one about itself —
   * `renderChildEnded` hardcodes `origin: 'system'`, unreachable from any tool handler.
   * Hooked into `#emitStatus` — the ONE place every drive strategy (per-turn, held-open),
   * a direct interrupt, AND a cascade abort all funnel their terminal status through —
   * rather than duplicated at each settlement call site. A cascade abort
   * (`live-registry.ts`'s `#closeOne`) requests the stop on the turn's lifecycle before it
   * aborts a running turn, so that turn's own settlement lands here exactly like a direct
   * interrupt would, reported as `stopped`. A session with no parent (the overwhelming common case)
   * is untouched: `store?.getMeta(...)?.parent` is undefined, so this is a no-op.
   */
  #notifyParentIfChild(session: LiveSession, state: TerminalState, detail?: string): void {
    const meta = this.#store?.getMeta(session.id);
    if (meta?.parent === undefined) return;
    const parentSession = this.#registry.get(meta.parent);
    const reason: SessionEndReason = toEndReason(state);
    // The result only matters (and is only worth the extra read) for a genuine
    // completion — an errored/stopped child has no answer to quote, just `detail`.
    const result = reason === 'completed' ? this.#childResultText(session.id) : undefined;
    // The live announcement (for the console's own card) and the delivery (what the
    // model actually reads) carry the exact same facts — computed once, above, and
    // fanned out to both. `#announceSubagent` no-ops for an already-gone parent
    // exactly like the delivery push below does.
    this.#announceSubagent(meta.parent, {
      t: 'subagent-completion',
      childSessionId: session.id,
      childWorktree: session.worktree ?? '',
      agentRef: meta.agentRef,
      reason,
      ...(detail !== undefined ? { detail } : {}),
      ...(result !== undefined ? { result } : {}),
    });
    // A sealed queue silently drops this — the cancel-guard doing its job after a
    // cascade stop (delivery.ts), not an error to handle. An already-gone parent
    // (`registry.get` returns undefined) is the same: nothing left to notify.
    parentSession?.deliveries.push(
      renderChildEnded({
        child: session.id,
        agentRef: meta.agentRef,
        reason,
        ...(detail !== undefined ? { detail } : {}),
        ...(result !== undefined ? { result } : {}),
      }),
    );
  }

  /**
   * Push a live-only announcement onto `sessionId`'s own turn stream — a
   * `subagent-spawn`/`subagent-completion`/`subagent-message` frame (docs/adr/0039),
   * for the console to render as a dedicated block (the next phase's job; this only
   * emits the frame correctly). Never persisted to the append-only event log (unlike
   * every other `TurnFrame` this daemon emits) — a per-session counter distinct from the
   * turn's own persisted `seq`, exactly like the existing `status`/`cost`/`mode` pushes
   * are already live-only. A no-op for a session with no live entry (torn down, or never
   * subscribed to) — `session.emit` itself is a no-op with zero subscribers regardless,
   * so this is belt-and-braces, not load-bearing.
   */
  #announceSubagent(sessionId: string, frame: TurnFrame): void {
    const session = this.#registry.get(sessionId);
    if (session === undefined) return;
    session.emit({
      kind: 'turn',
      sessionId,
      worktree: session.worktree ?? '',
      seq: this.#nextLiveSeq(sessionId),
      frame,
    });
  }

  #nextLiveSeq(sessionId: string): number {
    const n = this.#liveSeq.get(sessionId) ?? 0;
    this.#liveSeq.set(sessionId, n + 1);
    return n;
  }

  /**
   * This session's messaging port, bound to `sessionId` as the sender every dispatched
   * message is stamped with (unforgeable: `session.ts`'s `sessionId` is the daemon's
   * own, never model-supplied — see docs/adr/0039). Needs a persistent store (mesh
   * membership and a recipient's agent/role/scope all come from `SessionMeta`) and the
   * durable message log; absent either, messaging stays unavailable rather than
   * half-working — the same absent-port floor `spawnFor` already establishes.
   */
  messagingFor(sessionId: string): MessagingDeps | undefined {
    const store = this.#store;
    const messageLog = this.#messageLog;
    if (store === undefined || messageLog === undefined) return undefined;
    return {
      send: (args) => this.#sendMessage(sessionId, args, store, messageLog),
      roster: () => this.#roster(sessionId, store),
    };
  }

  /**
   * Dispatch one message from `fromId`: validate + resolve via the pure
   * `dispatchMessage` (mesh membership, thread identity, delivery plan), append it to
   * the durable log, then realize the plan — push onto the recipient's in-flight turn's
   * delivery queue (`mid-turn`) or wake a fresh one (`wake`; see {@link #wake}). Reachable
   * only through {@link messagingFor}, which is what proves the store + log exist.
   */
  #sendMessage(
    fromId: string,
    args: { to: string; body: string; replyTo?: string },
    store: ConversationStore,
    messageLog: MessageLog,
  ) {
    const lookup = (id: string): MeshLookup | undefined => {
      const meta = store.getMeta(id);
      if (meta === undefined) return undefined;
      return { agentRef: meta.agentRef, ...(meta.root !== undefined ? { root: meta.root } : {}) };
    };
    const liveState = (id: string): LiveState => {
      const session = this.#registry.get(id);
      if (session === undefined) return 'not-registered';
      return session.state === 'running' ? 'running' : 'idle';
    };
    const deps: DispatchDeps = {
      lookup,
      liveState,
      resolveThread: (replyTo) => {
        const root = lookup(args.to)?.root ?? args.to;
        return messageLog.get(root, replyTo)?.threadId;
      },
      newId: () => randomUUID(),
      now: () => new Date().toISOString(),
    };
    const outcome = dispatchMessage(
      {
        from: fromId,
        to: args.to,
        body: args.body,
        ...(args.replyTo !== undefined ? { replyTo: args.replyTo } : {}),
      },
      deps,
    );
    if (!outcome.applied) return outcome;
    messageLog.append(outcome.message);
    this.#realizeDelivery(outcome.message, outcome.plan.kind, outcome.fromAgentRef, store);
    return outcome;
  }

  /** Realize a dispatched message's delivery plan, and announce it (live-only) on
   *  BOTH sides of the send — the sender's own transcript sees "I sent X", the
   *  recipient's sees "I received X", exactly mirroring how a person watching either
   *  session would want to see the exchange happen. */
  #realizeDelivery(
    message: AgentMessage,
    plan: 'mid-turn' | 'wake',
    fromAgentRef: string,
    store: ConversationStore,
  ): void {
    const base = {
      messageId: message.id,
      threadId: message.threadId,
      ...(message.replyTo !== undefined ? { replyTo: message.replyTo } : {}),
      from: message.from,
      to: message.to,
      body: message.body,
    } as const;
    this.#announceSubagent(message.from, { t: 'subagent-message', direction: 'sent', ...base });
    if (plan === 'mid-turn') {
      this.#registry
        .get(message.to)
        ?.deliveries.push(
          renderMidTurnDelivery({ fromAgentRef, from: message.from, body: message.body }),
        );
    } else {
      this.#wake(
        message.to,
        store,
        renderWakeInput({ fromAgentRef, from: message.from, body: message.body }),
      );
    }
    this.#announceSubagent(message.to, { t: 'subagent-message', direction: 'received', ...base });
  }

  /**
   * Start (or resume) `to`'s drive loop with `input` as a fresh turn — the ONLY way to
   * reach a session that is not currently mid-turn, since a plain queue push
   * (`session.deliveries`) is drained only from INSIDE an already-running turn (nothing
   * is parked reading it while a session idles at `nextTurn()`). Covers three of the
   * design doc's four receiver states at once (idle / finished / not-yet-started — see
   * `message-dispatch.ts`'s `DeliveryPlan` doc for why coa's turn model collapses them):
   * `getOrCreate` transparently revives an idle-evicted session (reconstructing its
   * lineage from the STORE's permanent `parent`/`root`, since the live registry has no
   * record of it) or joins the queue an already-registered one is parked on. `to` is
   * assumed already validated by `dispatchMessage` (an unknown id never reaches here);
   * a `store.getMeta` miss is defensive-only. Mirrors `#startChild`'s own
   * agent-definition-to-role/model/roles/packageIds/exclude derivation, since a woken
   * session's next turn needs the exact same facts a spawn's founding turn does —
   * INCLUDING `isolate`: `meta.isolated` is what `#startChild` persisted at spawn
   * time, and re-supplying it here is what lets a woken turn rebind its own worktree
   * after a daemon restart, when `WorktreeManager`'s in-memory record of the
   * session's prior isolation decision no longer exists (docs/adr/0037).
   */
  #wake(to: string, store: ConversationStore, input: string): void {
    const meta = store.getMeta(to);
    if (meta === undefined) return;
    const lineage =
      meta.parent !== undefined
        ? { parent: meta.parent, root: meta.root ?? meta.parent }
        : meta.root !== undefined
          ? { root: meta.root }
          : undefined;
    const { session, created } = this.#registry.getOrCreate(
      to,
      lineage,
      this.#resolveDefaultMode(meta.agentRef),
    );
    if (created) {
      void runLiveSession(session, this.#makeRunTurn(store));
    }
    const agent = this.#listAgents?.().find((a) => a.ref === meta.agentRef);
    const turn: QueuedTurn = {
      input,
      scope: meta.scope,
      role: agent?.roles?.[0] ?? '',
      ...(agent?.provider !== undefined ||
      agent?.model !== undefined ||
      agent?.reasoning !== undefined
        ? {
            model: {
              ...(agent?.provider !== undefined ? { provider: agent.provider } : {}),
              ...(agent?.model !== undefined ? { model: agent.model } : {}),
              ...(agent?.reasoning !== undefined ? { reasoning: agent.reasoning } : {}),
            },
          }
        : {}),
      ...(agent?.roles !== undefined ? { roles: agent.roles } : {}),
      ...(agent?.packageIds !== undefined ? { packageIds: agent.packageIds } : {}),
      ...(agent?.exclude !== undefined ? { exclude: agent.exclude } : {}),
      // Re-supply the session's isolation decision from persisted `SessionMeta` —
      // see this method's doc — rather than trusting `WorktreeManager` to still
      // remember it, which it will not across a daemon restart.
      ...(meta.isolated === true ? { isolate: true } : {}),
    };
    session.enqueue(turn);
    this.#registry.touch(to);
  }

  /**
   * `selfId`'s live roster: every member of its family tree (itself included),
   * relationship-labeled and liveness-graded (`message-dispatch.ts`'s `buildRoster`).
   * `store.list()` is scanned and filtered by shared root — an O(all-sessions) read,
   * the same accepted-at-today's-scale tradeoff `descendantsOf` already documents
   * (docs/adr/0034) — rather than a maintained tree index.
   */
  #roster(selfId: string, store: ConversationStore) {
    const selfRoot = store.getMeta(selfId)?.root ?? selfId;
    const members: RosterMember[] = store
      .list()
      .filter((m) => (m.root ?? m.id) === selfRoot)
      .map((m: SessionMeta) =>
        m.parent !== undefined
          ? { id: m.id, agentRef: m.agentRef, parent: m.parent }
          : { id: m.id, agentRef: m.agentRef },
      );
    const liveState = (id: string): LiveState => {
      const session = this.#registry.get(id);
      if (session === undefined) return 'not-registered';
      return session.state === 'running' ? 'running' : 'idle';
    };
    return buildRoster(selfId, members, liveState, (id) => this.#lastEnd.get(id));
  }

  /**
   * A completed child's own final answer, for `#notifyParentIfChild`'s notice.
   * Folds the child's event log — and, if it spawned any children of its own,
   * theirs too — via `foldTreeToTranscript` (a read-time join, never a second
   * writer) rather than re-deriving transcript joining here, then takes the
   * last assistant message via `latestAssistantText`. `descendantsOf` walks the
   * STORE's session list (not the live registry): a completed child's own
   * children may have already been torn down, but their durable event logs are
   * exactly what a full answer needs. `undefined` when there is no store, the
   * child produced no assistant text, or its events could not be read — the
   * caller's fallback sentence covers all three identically (SC-1: this never
   * throws and never blocks the notice on a read that didn't pan out).
   */
  #childResultText(childId: string): string | undefined {
    const store = this.#store;
    if (store === undefined) return undefined;
    const rootEvents = store.getEvents(childId).events;
    const descendantIds = descendantsOf(
      childId,
      store.list().map((m) => ({ id: m.id, parent: m.parent })),
    );
    const descendants = new Map(
      descendantIds.map((id) => [id, store.getEvents(id).events] as const),
    );
    return latestAssistantText(foldTreeToTranscript(rootEvents, descendants));
  }
}

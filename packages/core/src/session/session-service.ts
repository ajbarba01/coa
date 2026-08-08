import type { AgentSummary, ModelSelection } from '@coa/shared';
import type { SpawnDeps } from '../workbench/spawn.js';
import type { ConversationStore } from './conversation-store.js';
import { createHeldOpenDriver } from './held-open-driver.js';
import type { LiveSessionRegistry } from './live-registry.js';
import type { LiveSession, QueuedTurn, Sink, TurnSubscription } from './live-session.js';
import { renderChildEnded, type SessionEndReason } from './notify.js';
import { runPerTurn } from './per-turn-driver.js';
import { runLiveSession, type RunTurn } from './run-live-session.js';
import type { SessionDeps } from './session.js';
import type { TerminalState, TurnDriverDeps } from './turn-driver.js';
import { deriveTitle } from './turn-persistence.js';

/**
 * The daemon's one owner of live-session lifetime. Constructed ONCE, at
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
}

export class SessionService {
  readonly #deps: SessionDeps;
  readonly #registry: LiveSessionRegistry;
  readonly #store: ConversationStore | undefined;
  readonly #listAgents: (() => readonly AgentSummary[]) | undefined;
  readonly #driverDeps: TurnDriverDeps;

  constructor(options: SessionServiceOptions) {
    this.#deps = options.deps;
    this.#registry = options.registry;
    this.#store = options.store;
    this.#listAgents = options.listAgents;
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
    const { session, created } = this.#registry.getOrCreate(id);

    const turn: QueuedTurn = {
      input: req.input,
      role: req.role,
      scope: req.scope,
      ...(req.model !== undefined ? { model: req.model } : {}),
      ...(req.roles !== undefined ? { roles: req.roles } : {}),
      ...(req.packageIds !== undefined ? { packageIds: req.packageIds } : {}),
      ...(req.exclude !== undefined ? { exclude: req.exclude } : {}),
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
   */
  interrupt(id: string): boolean {
    const session = this.#registry.get(id);
    if (session?.control === undefined) return false;
    session.control.interrupted = true;
    // A held-open query keeps `control` between turns, so the closure is the authority on
    // whether a turn was actually in flight.
    if (!session.closeInterrupted()) {
      session.control.interrupted = false;
      return false;
    }
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
    const { session } = this.#registry.getOrCreate(id, { parent: parentId, root });
    store.create({
      id,
      agentRef: req.agentRef,
      title: deriveTitle(req.description),
      scope,
      parent: parentId,
      root,
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
    this.#notifyParentIfChild(session, state, detail);
  }

  /**
   * A child's ending is a system fact, not a message from the child: the child never
   * composes it, and a model must not be able to fabricate one about itself —
   * `renderChildEnded` hardcodes `origin: 'system'`, unreachable from any tool handler.
   * Hooked into `#emitStatus` — the ONE place every drive strategy (per-turn, held-open),
   * a direct interrupt, AND a cascade abort all funnel their terminal status through —
   * rather than duplicated at each settlement call site. A cascade abort
   * (`live-registry.ts`'s `#closeOne`) marks `control.interrupted` before it aborts a
   * running turn, so that turn's own settlement lands here exactly like a direct interrupt
   * would, reported as `stopped`. A session with no parent (the overwhelming common case)
   * is untouched: `store?.getMeta(...)?.parent` is undefined, so this is a no-op.
   */
  #notifyParentIfChild(session: LiveSession, state: TerminalState, detail?: string): void {
    const meta = this.#store?.getMeta(session.id);
    if (meta?.parent === undefined) return;
    const parentSession = this.#registry.get(meta.parent);
    const reason: SessionEndReason =
      state === 'done' ? 'completed' : state === 'error' ? 'errored' : 'stopped';
    // A sealed queue silently drops this — the cancel-guard doing its job after a
    // cascade stop (delivery.ts), not an error to handle. An already-gone parent
    // (`registry.get` returns undefined) is the same: nothing left to notify.
    parentSession?.deliveries.push(
      renderChildEnded({
        child: session.id,
        agentRef: meta.agentRef,
        reason,
        ...(detail !== undefined ? { detail } : {}),
      }),
    );
  }
}

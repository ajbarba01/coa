import { z } from 'zod';
import { modelSelectionSchema, type AgentSummary, type RpcNotification } from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import type { SessionDeps } from './session.js';
import type { ConversationStore } from './conversation-store.js';
import { renderChildEnded, type SessionEndReason } from './notify.js';
import type { LiveSession, Sink, TurnRequest } from './live-session.js';
import type { LiveSessionRegistry } from './live-registry.js';
import { runLiveSession, type RunTurn } from './run-live-session.js';
import { createHeldOpenDriver } from './held-open-driver.js';
import { runPerTurn } from './per-turn-driver.js';
import type { TerminalState, TurnDriverDeps, TurnMeta } from './turn-driver.js';
import { deriveTitle } from './turn-persistence.js';

/**
 * The session-lifecycle RPC surface — `createSession`/`closeSession`/`subscribeSession`/
 * `interruptSession`/`steerSession`/`recompilePrompt` — mapped onto the domain modules that
 * do the work. Each verb here is meant to stay near-trivial: resolve the session, hand off,
 * answer. The drive strategies live in `per-turn-driver.ts` and `held-open-driver.ts`; how a
 * frame is written lives in `frame-recorder.ts`; what a turn does to the durable record lives
 * in `turn-persistence.ts`.
 *
 * The daemon is the authoritative owner of a live session's lifecycle AND liveness
 * (docs/adr/0011): a {@link LiveSessionRegistry}, keyed by conversation id, holds one
 * {@link LiveSession} per conversation across every turn it ever runs. `createSession` is
 * **send-or-create**: it resolves (or mints) the conversation id, enqueues the request as a
 * `TurnRequest`, and — only the first time — starts a daemon-owned turn loop
 * (`runLiveSession`) that drains the session's queue one turn at a time. A connection is a
 * stateless, reattachable subscriber: it fans into the live session via `subscribe`, which
 * immediately hydrates it with the session's CURRENT run-status — the console-reattach seam.
 * A live session runs headless with zero subscribers; nothing about its lifecycle depends on
 * any one connection.
 *
 * That is also why this function is called once per connection and threads its own state
 * (which sinks it opened, which conversations it already subscribed to, what each queued
 * turn carried) into the drivers explicitly, as {@link TurnDriverDeps}. Two consoles talking
 * to one daemon share every live session and share none of this.
 *
 * When the request carries a `conversationId` and a {@link ConversationStore} is wired, the
 * conversation is **persistent**: the store supplies the prior backend session id to resume
 * (so the model has memory), the user prompt and every streamed frame are appended durably,
 * the `seq` continues from the stored tip, and the backend's own session id is captured for
 * the next send. Without a `conversationId` the conversation is ephemeral (the CLI
 * `coa run` path) — nothing is persisted and `seq` starts at 0 each turn.
 */

const createParams = z.object({
  role: z.string().default(''),
  /** The chosen roles (assembly selection); preferred over `role` when present. */
  roles: z.array(z.string()).optional(),
  scope: z.string().default(''),
  input: z.string(),
  model: modelSelectionSchema.optional(),
  /** Assembly selection: opt-in packages added / default packages excluded (both role-gated). */
  packageIds: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  /** The persistent conversation to run within; absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
});
type CreateParams = z.infer<typeof createParams>;

const closeParams = z.object({ id: z.string() });
const interruptParams = z.object({ id: z.string() });
// `mode` is intentionally not accepted (and not `.strict()`-rejected): there is only one
// steer left, and a stale caller still sending `mode` (an older console build) must degrade
// to an ordinary steer, not break — Zod strips the unknown key rather than erroring on it.
const steerParams = z.object({ id: z.string(), text: z.string() });
const subscribeParams = z.object({ id: z.string() });

/** Build the per-turn queue payload from a `createSession` request (the fields
 *  `TurnRequest` — live-session.ts — actually carries; `role` rides separately
 *  in `TurnMeta`, turn-driver.ts). */
function turnRequestFromParams(params: CreateParams): TurnRequest {
  return {
    input: params.input,
    scope: params.scope,
    ...(params.model !== undefined ? { model: params.model } : {}),
    ...(params.roles !== undefined ? { roles: params.roles } : {}),
    ...(params.packageIds !== undefined ? { packageIds: params.packageIds } : {}),
    ...(params.exclude !== undefined ? { exclude: params.exclude } : {}),
  };
}

/** Start a child session for `parentId`: everything `spawn.ts`'s `SpawnDeps.startChild`
 *  needs, plus the parent id its fixed signature deliberately omits (see the module doc
 *  above `buildSessionHandlers`). Returns once the child has STARTED, never once it has
 *  finished (the non-blocking contract: surface, never block). */
export type StartChildFn = (
  parentId: string,
  req: { agentRef: string; description: string; prompt: string },
) => { sessionId: string };

/**
 * The subagent-dispatch wiring `buildSessionHandlers` needs beyond `registry`/`store`:
 * the live effective agent set (so a spawned child's turn can carry its agent
 * DEFINITION's provider/model/reasoning/roles/packageIds/exclude — the spawn call
 * itself carries none of these, by design) and a callback that receives this
 * connection's `startChild` the moment it's built.
 *
 * `onStartChild` — not a return value — because `buildSessionHandlers` is called fresh
 * per RPC connection, while the daemon's ONE `SpawnDeps.startChild` (wired into the
 * governed tool catalogue at composition time, before any connection exists) is bound
 * to the REAL calling session per spawn via `session.ts`'s `resolveSpawn(sessionId)` —
 * never an ambient "current session" guess, which would race across the concurrently-
 * live sessions this feature itself creates (a parent and its already-running child).
 * The composition root captures whichever `startChild` fires last into a late-bound
 * holder; every connection's version is behaviorally identical (same `deps`/`store`/
 * `registry`), so it doesn't matter which one ends up captured.
 */
export interface SpawnSupport {
  /** The LIVE effective agent set. Called per spawn, never cached (mirrors `spawn.ts`). */
  listAgents: () => readonly AgentSummary[];
  onStartChild: (startChild: StartChildFn) => void;
}

export function buildSessionHandlers(
  deps: SessionDeps,
  connection: RpcConnection,
  store: ConversationStore | undefined,
  registry: LiveSessionRegistry,
  spawnSupport?: SpawnSupport,
): RpcHandlers {
  const emit: Sink = (push) => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  const emitStatus = (
    session: LiveSession,
    worktree: string,
    state: TerminalState,
    detail?: string,
  ): void => {
    session.emit({ kind: 'status', sessionId: session.id, worktree, state });
    notifyParentIfChild(session, state, detail);
  };

  /**
   * A child's ending is a system fact, not a message from the child: the child never
   * composes it, and a model must not be able to fabricate one about itself —
   * `renderChildEnded` hardcodes `origin: 'system'`, unreachable from any tool handler.
   * Hooked into `emitStatus` — the ONE place every drive strategy (per-turn, held-open),
   * a direct `interruptSession` call, AND a cascade abort all funnel their terminal
   * status through — rather than duplicated at each settlement call site. A cascade
   * abort (`live-registry.ts`'s `#closeOne`) marks `control.interrupted` before it
   * aborts a running turn, so that turn's own settlement lands here exactly like a
   * direct interrupt would, reported as `stopped`. A session with no parent (the
   * overwhelming common case) is untouched: `store?.getMeta(...)?.parent` is undefined,
   * so this is a no-op.
   */
  function notifyParentIfChild(session: LiveSession, state: TerminalState, detail?: string): void {
    const meta = store?.getMeta(session.id);
    if (meta?.parent === undefined) return;
    const parentSession = registry.get(meta.parent);
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

  const turnMeta = new WeakMap<TurnRequest, TurnMeta>();
  // Which conversation ids THIS connection has already arranged to (re)subscribe
  // to — so a second send on the same conversation doesn't queue a redundant
  // onStart-time subscribe (subscribe() always re-hydrates on every call).
  const subscribedSessions = new Set<string>();
  // Every unsubscribe this CONNECTION has accumulated (the onStart founder-subscribe
  // AND subscribeSession) — run once, in full, when the connection closes, so a
  // dropped connection (a console reload, a crashed client) doesn't leak a sink
  // forever fanned out to (see connection-close teardown hardening).
  const unsubscribers: Array<() => void> = [];
  connection.onClose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    subscribedSessions.clear();
  });

  /** The per-connection half of what a drive strategy needs — passed, never reached for,
   *  so two connections can drive the same daemon without sharing any of it. */
  const driverDeps: TurnDriverDeps = {
    deps,
    registry,
    turnMeta: (turn) => turnMeta.get(turn),
    addUnsubscriber: (off) => unsubscribers.push(off),
    emitStatus,
  };

  /**
   * The turn dispatcher, built once per live session. It consults the injected, abstract
   * per-provider strategy verdict — NEVER the backend itself, so composition stays
   * backend-neutral — and hands the turn to that strategy's driver. The held-open driver is
   * created here rather than per turn because its query, its shared cursor, and its start
   * handle are exactly what must survive from one turn to the next.
   */
  function makeRunTurn(persistentStore: ConversationStore | undefined): RunTurn {
    const heldOpen = createHeldOpenDriver(driverDeps, persistentStore);
    return async (turn, session) => {
      const provider = turn.model?.provider ?? 'claude';
      const strategy = deps.sessionStrategy?.(provider) ?? 'per-turn';
      if (strategy === 'held-open') {
        await heldOpen.run(turn, session);
        return;
      }
      // Provider switched to a per-turn backend mid-conversation ⇒ retire any open held
      // query first (its input feed closes, the query terminates), then run the turn
      // through the per-turn driver.
      await heldOpen.close();
      await runPerTurn(driverDeps, turn, session, persistentStore);
    };
  }

  // Spawning needs BOTH a persistent store (a child's lineage lives in `SessionMeta`,
  // and `store.create`/`getMeta` are what makes the notify hook above ever fire) and
  // the caller-supplied agent lookup — absent either, spawning stays unavailable for
  // this connection (nothing about this branch runs when spawnSupport is unset).
  if (spawnSupport !== undefined && store !== undefined) {
    const boundStore = store;
    const startChild: StartChildFn = (parentId, req) => {
      const id = deps.newSessionId();
      // `registry.get(parentId)?.root` — not `store`'s — because a parent already torn
      // down still has a durable `SessionMeta`, but its LIVE root is what the cascade
      // (a parent-link walk over live sessions, lineage.ts) actually needs. Falling back
      // to `parentId` covers the already-gone-parent case below: the child still gets a
      // well-formed (if orphaned) root rather than an undefined one.
      const root = registry.get(parentId)?.root ?? parentId;
      const scope = boundStore.getMeta(parentId)?.scope ?? '';
      // The LIVE effective set, read fresh (never cached) — an agent authored moments
      // ago must be spawnable immediately, and `req.agentRef` already comes from a
      // registry-resolved match (`spawn.ts` validates before ever calling this).
      const agent = spawnSupport.listAgents().find((a) => a.ref === req.agentRef);

      // A spawn against an already-closed (or, since `registry.close` never yields
      // mid-cascade, equivalently an already-CLOSING) parent still creates and runs the
      // child: refusing would need either a throw (forbidden — the system never blocks a spawn) or a bogus id the
      // caller would wrongly read as success (worse — the work the model asked for
      // would silently never happen). The result is a deliberate orphan: no live
      // ancestor is left to ever cascade a stop through it, but it still runs its one
      // assigned turn to completion and self-cleans via the ordinary idle-eviction timer.
      const { session } = registry.getOrCreate(id, { parent: parentId, root });
      boundStore.create({
        id,
        agentRef: req.agentRef,
        title: deriveTitle(req.description),
        scope,
        parent: parentId,
        root,
      });

      const turn: TurnRequest = {
        input: req.prompt,
        scope,
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
      turnMeta.set(turn, { role: agent?.roles?.[0] ?? '' });

      // Non-blocking (the design's re-entrancy retirement): start the loop and return
      // immediately, never awaiting its completion. `runLiveSession` never rejects — a
      // turn's own failure is caught and rendered as an error frame (`runPerTurn`'s own
      // try/catch, above) — so there is no unhandled rejection here to strand the
      // parent; the `errored` notice reaches it through `emitStatus` like any other end.
      void runLiveSession(session, makeRunTurn(boundStore));
      session.enqueue(turn);
      registry.touch(id);
      return { sessionId: id };
    };
    spawnSupport.onStartChild(startChild);
  }

  return {
    createSession: rpcMethod(createParams, async (params) => {
      const id = params.conversationId ?? deps.newSessionId();
      const { session, created } = registry.getOrCreate(id);

      const turn = turnRequestFromParams(params);
      const meta: TurnMeta = { role: params.role };
      turnMeta.set(turn, meta);
      // Subscribe THIS connection (once) — deferred to inside the driver's `onStart`, so
      // hydration lands on the turn's true first status instead of firing here, ahead of
      // it, as a spurious leading `idle`.
      if (!subscribedSessions.has(id)) {
        meta.subscribe = emit;
        subscribedSessions.add(id);
      }

      let ready: Promise<string> | undefined;
      if (created) {
        ready = new Promise<string>((resolve) => {
          meta.onReady = (s) => resolve(s.worktree);
        });
        void runLiveSession(
          session,
          makeRunTurn(params.conversationId !== undefined ? store : undefined),
        );
      }

      session.enqueue(turn);
      registry.touch(id);

      if (ready !== undefined) return { sessionId: id, worktree: await ready };
      // An already-live session: don't block on the queued turn (it may sit
      // behind another in-flight one) — the worktree is already known.
      return { sessionId: id, worktree: session.worktree ?? '' };
    }),

    // Console reattach: join an already-known session's push stream. `subscribe`
    // immediately hydrates this connection with the session's CURRENT run-status —
    // the daemon is the source of truth for liveness, never the client's own tracking.
    subscribeSession: rpcMethod(subscribeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { subscribed: false };
      unsubscribers.push(session.subscribe(emit));
      subscribedSessions.add(params.id);
      return { subscribed: true };
    }),

    // Delegates entirely to `registry.close` — the SINGLE teardown path: checkpoint +
    // worktree-release happen exactly once, via the registry's `onClose` hook (wired at
    // daemon composition in `apps/cli/src/cli.ts`), so this verb never calls
    // `deps.checkpoint`/`deps.releaseWorktree` itself (that would double-release, since
    // idle-eviction and shutdown call the registry too).
    closeSession: rpcMethod(closeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { closed: false };
      registry.close(params.id);
      return { closed: true };
    }),

    // A user-initiated stop — never a governance block. Strategy-agnostic: the in-flight
    // turn's registered closure settles the partial the model streamed, records the
    // `interrupted` marker (persisted, so a reload reads the same transcript AND the model's
    // next turn knows it was cut off), and stops the backend the way that drive strategy must.
    // Each driver's settlement then suppresses the resulting throw/settle from rendering as
    // an error: a user stop is never an error.
    interruptSession: rpcMethod(interruptParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { interrupted: false };
      session.control.interrupted = true;
      // A held-open query keeps `control` between turns, so the closure is the authority on
      // whether a turn was actually in flight.
      if (!session.closeInterrupted()) {
        session.control.interrupted = false;
        return { interrupted: false };
      }
      emitStatus(session, session.worktree ?? '', 'interrupted');
      return { interrupted: true };
    }),

    // Queue a mid-turn steer: one steer, one destination. The held-open route (its steer
    // sink lives in held-open-driver.ts) delivers it into the WORKING turn via the session's
    // delivery queue, or feeds it as a plain next turn when the query idles; a per-turn
    // backend has no held-open sink, so the same delivery queue is pushed directly here —
    // the running loop drains it at its own next round trip.
    // A blank-after-trim steer is a no-op — it would otherwise be recorded as a blank user
    // turn in canonical memory. The TRIMMED text is what gets recorded (not the raw param):
    // the console's own composer already trims before sending (console.ts `steerSession`),
    // so this is a no-op on the shipped path, and it keeps the console's optimistic pin —
    // built from that same trimmed text — matching the daemon's recorded line exactly. That
    // reconciliation counts matching lines, so an inexact match hangs the pin until the idle
    // sweep clears it (docs/adr/0031).
    steerSession: rpcMethod(steerParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { steered: false };
      const text = params.text.trim();
      if (text === '') return { steered: false };
      if (session.control.mode === 'held-open') {
        session.pushSteer(text);
      } else {
        // Per-turn backends have no held-open sink; the same one queue reaches their loop
        // at the top of its next round trip.
        session.deliveries.push({ origin: 'user', text });
      }
      return { steered: true };
    }),

    // The drift banner's `recompile` action: drop the session's frozen prompt AND its
    // resume token, so the next send recompiles from the current config and starts a
    // fresh backend session with it (memory is carried across via the transcript). The
    // old server session still holds the superseded prompt, so resuming it would keep
    // the stale prompt — hence both are cleared.
    recompilePrompt: rpcMethod(z.object({ sessionId: z.string() }), (params) => {
      if (store === undefined) return { recompiled: false };
      store.clearCompilation(params.sessionId);
      store.clearBackendSession(params.sessionId);
      return { recompiled: true };
    }),
  };
}

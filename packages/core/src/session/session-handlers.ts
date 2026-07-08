import { z } from 'zod';
import {
  modelSelectionSchema,
  type BackendMessage,
  type RpcNotification,
  type TurnFrame,
} from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import { createSession, type SessionDeps } from './session.js';
import type { ConversationStore } from './conversation-store.js';
import { planMemory, type MemoryPlan } from './memory-plan.js';
import { describeLoopFailure } from './loop-failure.js';
import type { LiveSession, Sink, TurnRequest } from './live-session.js';
import type { LiveSessionRegistry } from './live-registry.js';
import { runLiveSession, type RunTurn } from './run-live-session.js';
import {
  configHashOf,
  frozenModelMatches,
  modelPromptKeyOf,
  promptVersionOf,
  type FrozenCompilation,
  type PromptConfig,
} from './prompt-freeze.js';

/**
 * M8 — the session-lifecycle RPC surface (CON-CAT `createSession`/`closeSession`/
 * `subscribeSession`) plus the emission policy for the R-12 push channel.
 *
 * The daemon is the authoritative owner of a live session's lifecycle AND
 * liveness (see docs/adr/0011): a {@link LiveSessionRegistry}, keyed by
 * conversation id, holds one {@link LiveSession} per conversation across every
 * turn it ever runs. `createSession` is **send-or-create**: it resolves (or
 * mints) the conversation id, enqueues the request as a `TurnRequest`, and —
 * only the first time — starts a daemon-owned turn loop (`runLiveSession`) that
 * drains the session's queue one turn at a time, running each through the
 * EXISTING per-turn `createSession` (session.ts) unchanged in substance. A
 * connection is a stateless, reattachable subscriber: it fans into the live
 * session via `subscribe`, which immediately hydrates it with the session's
 * CURRENT run-status — the G4 reattach seam. A live session runs headless with
 * zero subscribers; nothing about its lifecycle depends on any one connection.
 *
 * When the request carries a `conversationId` and a {@link ConversationStore} is
 * wired, the conversation is **persistent** (R-7): the store supplies the prior
 * backend session id to `resume` (so the model has memory), the user prompt and
 * every streamed frame are appended durably, the `seq` continues from the
 * stored tip, and the backend's own session id is captured for the next send.
 * Without a `conversationId` the conversation is ephemeral (the CLI `coa run`
 * path) — nothing is persisted and `seq` starts at 0 each turn.
 *
 * `interruptSession`/`steerSession` (CHAT-10) act on the CURRENTLY in-flight
 * turn's control state: interrupt aborts a neutral `AbortSignal` the adapter
 * honors on BOTH backends; steer queues a turn the pure-API driver drains at
 * its next safe boundary. SC-1: a user-initiated interrupt is never rendered as
 * an error — see the `interrupted` guard in `makeRunTurn`'s settlement below.
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
  /** The persistent conversation to run within (R-7); absent ⇒ an ephemeral one-shot. */
  conversationId: z.string().optional(),
});
type CreateParams = z.infer<typeof createParams>;

const closeParams = z.object({ id: z.string() });
const interruptParams = z.object({ id: z.string() });
const steerParams = z.object({ id: z.string(), text: z.string() });
const subscribeParams = z.object({ id: z.string() });

/**
 * The per-turn bookkeeping `TurnRequest` (live-session.ts) has no room for:
 * the legacy singular `role` field (superseded by `roles` but still read by
 * `assemblePieces`/the config-hash — see `turnRequestFromParams`), the
 * one-shot connection to (re)subscribe once this turn's `onStart` fires, and
 * the one-shot resolver the founding `createSession` call awaits to learn the
 * worktree. Keyed by object identity so it never leaks past the turn it
 * describes.
 */
interface TurnMeta {
  role: string;
  /** Set only the first time a given connection sends against this conversation
   *  id — consumed (once) inside `onStart`, so hydration coincides with the
   *  turn's true first status instead of a spurious leading `idle`. */
  subscribe?: Sink;
  /** Set only for the FOUNDING turn (a brand-new `LiveSession`) — resolves the
   *  RPC response with the worktree once `onStart` fires, mirroring today's
   *  early, non-blocking `ready` resolution. */
  onReady?: (started: { id: string; worktree: string }) => void;
}

/** A session's rail label from its opening prompt (single line, bounded) — the VSCode-style auto-title. */
export function deriveTitle(input: string): string {
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (oneLine === '') return 'new session';
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}…`;
}

/** Build the per-turn queue payload from a `createSession` request (the fields
 *  `TurnRequest` — live-session.ts — actually carries; `role` rides separately
 *  in `TurnMeta`, see above). */
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

export function buildSessionHandlers(
  deps: SessionDeps,
  connection: RpcConnection,
  store: ConversationStore | undefined,
  registry: LiveSessionRegistry,
): RpcHandlers {
  const emit: Sink = (push) => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  const emitStatus = (
    session: LiveSession,
    worktree: string,
    state: 'done' | 'error' | 'interrupted',
  ): void => session.emit({ kind: 'status', sessionId: session.id, worktree, state });

  const turnMeta = new WeakMap<TurnRequest, TurnMeta>();
  // Which conversation ids THIS connection has already arranged to (re)subscribe
  // to — so a second send on the same conversation doesn't queue a redundant
  // onStart-time subscribe (subscribe() always re-hydrates on every call).
  const subscribedSessions = new Set<string>();
  // Every unsubscribe this CONNECTION has accumulated (the onStart founder-subscribe
  // AND subscribeSession) — run once, in full, when the connection closes, so a
  // dropped connection (a console reload, a crashed client) doesn't leak a sink
  // forever fanned out to (see docs/adr/0011; connection-close teardown hardening).
  const unsubscribers: Array<() => void> = [];
  connection.onClose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    subscribedSessions.clear();
  });

  /**
   * Run ONE turn of `session` through today's per-turn `createSession`
   * (session.ts) — the neutral facade both backends run unchanged (D85; see
   * docs/adr/0011). `persistentStore` is fixed at session-creation time:
   * `undefined` for an ephemeral session (no `conversationId` on the founding
   * request), even if a store happens to be wired to this connection.
   */
  function makeRunTurn(persistentStore: ConversationStore | undefined): RunTurn {
    return async (turn, session) => {
      const meta = turnMeta.get(turn);
      const role = meta?.role ?? '';
      const persistIn =
        persistentStore !== undefined ? { convId: session.id, store: persistentStore } : undefined;
      let seq = 0;
      // The per-turn memory strategy (resume vs. replay vs. preamble), computed from
      // the stored selection stamp and the canonical transcript. Ephemeral (no-store)
      // turns carry no memory, so the default is a fresh, memoryless plan.
      let plan: MemoryPlan = { history: [], deliverHistoryAsPreamble: false };
      // The provider/model this turn actually routes to (mirrors session.ts's default).
      const provider = turn.model?.provider ?? 'claude';
      const model = turn.model?.model;
      // The model facts the `## Model` prompt line depends on (provider/model/effort).
      // A frozen prompt is reused only when this matches the model it was compiled
      // with — a switch recompiles so the line stays correct. This is SEPARATE from
      // the drift key (configHash): a model switch never trips the drift banner.
      const modelKey = modelPromptKeyOf(turn.model);
      // The drift-relevant config that SHAPES the prompt (role + package selection,
      // never the model) — hashed into the frozen compilation so a later config change
      // under the frozen prompt is detectable.
      const currentConfig: PromptConfig = {
        role,
        ...(turn.roles !== undefined ? { roles: [...turn.roles].sort() } : {}),
        ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
        ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
      };
      // The session's frozen compilation (reused every turn for cache warmth) and its
      // prompt version — undefined until the first turn compiles it below.
      let frozen: FrozenCompilation | undefined;
      let promptVersion: string | undefined;

      if (persistIn !== undefined) {
        const { convId: id, store: cs } = persistIn;
        if (cs.getMeta(id) === undefined) {
          cs.create({
            id,
            // Known mock coupling: `agentRef` stands in for a real agent reference;
            // prefer the first selected role when present. A proper agent-ref is out
            // of scope here.
            agentRef: turn.roles?.[0] ?? role,
            title: deriveTitle(turn.input),
            scope: turn.scope ?? '',
          });
        }
        const prior = cs.reload(id);
        const transcript = cs.loadBackendMessages(id);
        const storedFrozen = cs.getCompilation(id);
        // Reuse the frozen prompt only when the send's model matches the one it was
        // compiled with; a model switch drops it here (undefined ⇒ recompile below),
        // so the `## Model` line is re-authored — silently, WITHOUT touching drift.
        frozen =
          storedFrozen !== undefined && frozenModelMatches(storedFrozen, modelKey)
            ? storedFrozen
            : undefined;
        promptVersion = frozen?.promptVersion;
        // The PRIOR turn's stored facts (read before this turn re-pins the selection),
        // shared by the memory plan. Drift + cache-status banners are now computed
        // PREDICTIVELY in the console (from the pinned selection + the running prompt's
        // config it reads back), so the daemon no longer emits them on send.
        const priorMeta = cs.getMeta(id);
        seq = prior.length === 0 ? 0 : prior[prior.length - 1]!.seq + 1;
        // First message of a still-untitled session sets the VSCode-style auto-title.
        if (prior.length === 0) {
          const title = cs.getMeta(id)?.title;
          if (title === undefined || title === '' || title === 'new session') {
            cs.rename(id, deriveTitle(turn.input));
          }
        }
        // Decide how to hand memory to this turn's backend BEFORE re-pinning the
        // selection (the plan reads the PRIOR turn's resume stamp), then pin what this
        // turn runs on so a restart/next turn routes to the same backend the memory
        // lives in — the fix for a conversation silently reviving on the wrong backend.
        plan = planMemory({
          provider,
          ...(model !== undefined ? { model } : {}),
          ...(promptVersion !== undefined ? { promptVersion } : {}),
          meta: priorMeta,
          transcript,
        });
        // Pin the EFFECTIVE selection (provider defaulted to the routed backend), not
        // the raw request — a send that names only a model must still record which
        // backend it ran on, or the pin is incomplete and a later provider switch is
        // invisible to both routing and the cache-status check.
        cs.setSelection(id, {
          provider,
          ...(model !== undefined ? { model } : {}),
          ...(turn.model?.reasoning !== undefined ? { reasoning: turn.model.reasoning } : {}),
        });
        // Persist (but never push — the console already showed it optimistically) the user turn.
        cs.append(id, [{ seq, frame: { t: 'text', text: turn.input, role: 'user' } }]);
        seq += 1;
      }

      let started: { id: string; worktree: string } | undefined;
      const record = (frame: TurnFrame): void => {
        if (started === undefined) return;
        const s = seq++;
        session.emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
        if (persistIn !== undefined) persistIn.store.append(persistIn.convId, [{ seq: s, frame }]);
      };

      // The neutral user-stop + steer queue for THIS turn (CHAT-10). Created
      // unconditionally — a turn never interrupted/steered behaves byte-identically
      // to today (D85); the controller's signal just never aborts and the queue stays
      // empty. Registered against `control` in `onStart`, keyed by the conversation id
      // — so `interruptSession`/`steerSession` can find the in-flight turn.
      const controller = new AbortController();
      const steer: string[] = [];

      try {
        await createSession(
          {
            role,
            ...(turn.roles !== undefined ? { roles: turn.roles } : {}),
            scope: turn.scope ?? '',
            input: turn.input,
            ...(turn.model ? { model: turn.model } : {}),
            ...(turn.packageIds !== undefined ? { packageIds: turn.packageIds } : {}),
            ...(turn.exclude !== undefined ? { exclude: turn.exclude } : {}),
            sessionId: session.id,
            ...(plan.resume !== undefined ? { resume: plan.resume } : {}),
            ...(plan.history.length > 0 ? { history: plan.history } : {}),
            ...(plan.deliverHistoryAsPreamble ? { deliverHistoryAsPreamble: true } : {}),
            // Reuse the frozen prompt when the session has one; otherwise let the loop
            // compile fresh and freeze the result (first turn only).
            ...(frozen !== undefined ? { frozen: { neutral: frozen.neutral, frame: frozen.frame } } : {}),
            ...(persistIn !== undefined && frozen === undefined
              ? {
                  onCompile: (compiled) => {
                    promptVersion = promptVersionOf(compiled.neutral);
                    persistIn.store.setCompilation(persistIn.convId, {
                      ...compiled,
                      promptVersion,
                      configHash: configHashOf(currentConfig),
                      config: currentConfig,
                      model: modelKey,
                    });
                  },
                }
              : {}),
            ...(persistIn !== undefined
              ? {
                  // Stamp the resume token with the provider/model + frozen prompt it's
                  // valid for, so a later model/provider switch OR a deliberate recompile
                  // falls back to replay instead of resuming a stale server session.
                  onBackendSession: (id: string) =>
                    persistIn.store.setBackendSession(persistIn.convId, id, {
                      provider,
                      ...(model !== undefined ? { model } : {}),
                      ...(promptVersion !== undefined ? { promptVersion } : {}),
                    }),
                  onBackendMessages: (messages: readonly BackendMessage[]) =>
                    persistIn.store.saveBackendMessages(persistIn.convId, messages),
                }
              : {}),
            signal: controller.signal,
            drainSteer: () => steer.splice(0, steer.length),
            onStart: (s) => {
              started = s;
              session.control = { controller, steer, interrupted: false };
              session.setState('running', s.worktree);
              // Turn activity resets the idle-eviction clock (FIX #1) — belt-and-braces
              // alongside the running-aware idle timer in live-registry.ts, so a session
              // whose loop keeps running past `idleMs` is never detached mid-turn.
              registry.touch(session.id);
              // Hydration now reflects the true first status ('running') — never a
              // spurious leading 'idle' — because this fires AFTER setState above.
              if (meta?.subscribe !== undefined) unsubscribers.push(session.subscribe(meta.subscribe));
              meta?.onReady?.(s);
            },
            onTurn: record,
          },
          deps,
        );
        // A pure-API backend aborted at the loop's top-of-iteration boundary settles
        // cleanly (no throw) — so a completed interrupt is seen here, not in `catch`.
        const interrupted = session.control?.interrupted === true;
        session.control = undefined;
        // SC-1: `interruptSession` already emitted the `'interrupted'` status
        // synchronously when it aborted — this clean-break settle must not emit it a
        // second time. Only a genuine, non-interrupted completion emits `'done'`.
        if (interrupted) return;
        if (started !== undefined) emitStatus(session, started.worktree, 'done');
      } catch (err) {
        // A mid-turn throw (most often a dropped connection to the provider)
        // leaves the backend session id captured but this turn's canonical
        // transcript unsaved — a resume on the next send would replay a phantom
        // server session the model never advanced. Drop the token so the next
        // send replays the last-good transcript instead (fail-safe, not resume).
        if (persistIn !== undefined) persistIn.store.clearBackendSession(persistIn.convId);
        const interrupted = session.control?.interrupted === true;
        session.control = undefined;
        // SC-1: an interrupt is a user stop, not a governance block — an aborted
        // in-flight request (the Claude SDK path, or a pure-API fetch abort) throws
        // here, but it must never render as an error. `interruptSession` already
        // emitted the `'interrupted'` status; nothing further to surface.
        if (interrupted) return;
        const message = describeLoopFailure(err);
        if (started !== undefined) {
          record({ t: 'error', message, origin: 'loop' });
          emitStatus(session, started.worktree, 'error');
        }
      }
    };
  }

  return {
    createSession: rpcMethod(createParams, async (params) => {
      const id = params.conversationId ?? deps.newSessionId();
      const { session, created } = registry.getOrCreate(id);

      const turn = turnRequestFromParams(params);
      const meta: TurnMeta = { role: params.role };
      turnMeta.set(turn, meta);
      // Subscribe THIS connection (once) — deferred to inside `onStart` (see
      // `makeRunTurn`) so hydration lands on the turn's true first status
      // instead of firing here, ahead of it, as a spurious leading `idle`.
      if (!subscribedSessions.has(id)) {
        meta.subscribe = emit;
        subscribedSessions.add(id);
      }

      let ready: Promise<string> | undefined;
      if (created) {
        ready = new Promise<string>((resolve) => {
          meta.onReady = (s) => resolve(s.worktree);
        });
        void runLiveSession(session, makeRunTurn(params.conversationId !== undefined ? store : undefined));
      }

      session.enqueue(turn);
      registry.touch(id);

      if (ready !== undefined) return { sessionId: id, worktree: await ready };
      // An already-live session: don't block on the queued turn (it may sit
      // behind another in-flight one) — the worktree is already known.
      return { sessionId: id, worktree: session.worktree ?? '' };
    }),

    // Console reattach (G4): join an already-known session's push stream. `subscribe`
    // immediately hydrates this connection with the session's CURRENT run-status —
    // the daemon is the source of truth for liveness, never the client's own tracking.
    subscribeSession: rpcMethod(subscribeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { subscribed: false };
      unsubscribers.push(session.subscribe(emit));
      subscribedSessions.add(params.id);
      return { subscribed: true };
    }),

    // Delegates entirely to `registry.close` — the SINGLE teardown path (FIX #3):
    // checkpoint + worktree-release now happen exactly once, via the registry's
    // `onClose` hook (wired at daemon composition in `apps/cli/src/cli.ts`), so
    // this verb no longer calls `deps.checkpoint`/`deps.releaseWorktree` itself
    // (that would double-release under idle-eviction/shutdown also calling it).
    closeSession: rpcMethod(closeParams, (params) => {
      const session = registry.get(params.id);
      if (session === undefined) return { closed: false };
      registry.close(params.id);
      return { closed: true };
    }),

    // A user-initiated stop (CHAT-10) — SC-1: never a governance block. Aborts the
    // in-flight turn's neutral signal (both backends honor it); `makeRunTurn`'s
    // settlement above suppresses the resulting throw/settle from ever rendering as
    // an error.
    interruptSession: rpcMethod(interruptParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { interrupted: false };
      session.control.interrupted = true;
      session.control.controller.abort();
      emitStatus(session, session.worktree ?? '', 'interrupted');
      return { interrupted: true };
    }),

    // Queue a mid-turn steer (CHAT-10); the pure-API driver drains it at its next
    // safe boundary (SDK-path steering is a separate follow-up — see the M9 seam).
    steerSession: rpcMethod(steerParams, (params) => {
      const session = registry.get(params.id);
      if (session?.control === undefined) return { steered: false };
      session.control.steer.push(params.text);
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

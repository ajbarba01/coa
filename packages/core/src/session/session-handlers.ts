import { z } from 'zod';
import {
  modelSelectionSchema,
  type BackendMessage,
  type Push,
  type RpcNotification,
  type Session,
  type TurnFrame,
} from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import { closeSession as closeSessionCore, createSession, type SessionDeps } from './session.js';
import type { ConversationStore } from './conversation-store.js';
import { planMemory, type MemoryPlan } from './memory-plan.js';
import {
  configHashOf,
  frozenModelMatches,
  modelPromptKeyOf,
  promptVersionOf,
  type FrozenCompilation,
  type PromptConfig,
} from './prompt-freeze.js';

/**
 * M8 — the session-lifecycle RPC surface (CON-CAT `createSession`/`closeSession`)
 * plus the emission policy for the R-12 push channel. This is where the neutral
 * per-frame stream from the loop becomes the sequenced `turn` Push the client
 * renders: M9 maps its backend messages to M0 {@link TurnFrame}s, and here M8
 * assigns each a monotonic `seq`, tags it with the session id + worktree, and
 * emits it (plus `running`/`done`/`error` status) over the connection that
 * started the session.
 *
 * When the request carries a `conversationId` and a {@link ConversationStore} is
 * wired, the session is a turn in a **persistent** conversation (R-7): the store
 * supplies the prior backend session id to `resume` (so the model has memory),
 * the user prompt and every streamed frame are appended durably, the `seq`
 * continues from the stored tip, and the backend's own session id is captured for
 * the next send. Without a `conversationId` the session is ephemeral (the CLI
 * `coa run` path) — nothing is persisted and `seq` starts at 0.
 *
 * `createSession` is non-blocking: it starts the loop, returns `{ sessionId,
 * worktree }` as soon as the session is bound (the `onStart` seam), and streams
 * everything else asynchronously. A loop failure is surfaced as an error frame +
 * an `error` status, never a thrown RPC (SC-1: surface, don't cage).
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

const closeParams = z.object({ id: z.string() });

/** A session's rail label from its opening prompt (single line, bounded) — the VSCode-style auto-title. */
export function deriveTitle(input: string): string {
  const oneLine = input.replace(/\s+/g, ' ').trim();
  if (oneLine === '') return 'new session';
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}…`;
}

export function buildSessionHandlers(
  deps: SessionDeps,
  connection: RpcConnection,
  store?: ConversationStore,
): RpcHandlers {
  const live = new Map<string, Session>();

  const emit = (push: Push): void => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  const status = (sessionId: string, worktree: string, state: 'running' | 'done' | 'error'): void =>
    emit({ kind: 'status', sessionId, worktree, state });

  return {
    createSession: rpcMethod(createParams, async (params) => {
      const convId = params.conversationId;
      const persistIn = convId !== undefined && store !== undefined ? { convId, store } : undefined;
      let seq = 0;
      // The per-turn memory strategy (resume vs. replay vs. preamble), computed from
      // the stored selection stamp and the canonical transcript. Ephemeral (no-store)
      // sessions carry no memory, so the default is a fresh, memoryless plan.
      let plan: MemoryPlan = { history: [], deliverHistoryAsPreamble: false };
      // The provider/model this turn actually routes to (mirrors session.ts's default).
      const provider = params.model?.provider ?? 'claude';
      const model = params.model?.model;
      // The model facts the `## Model` prompt line depends on (provider/model/effort).
      // A frozen prompt is reused only when this matches the model it was compiled
      // with — a switch recompiles so the line stays correct. This is SEPARATE from
      // the drift key (configHash): a model switch never trips the drift banner.
      const modelKey = modelPromptKeyOf(params.model);
      // The drift-relevant config that SHAPES the prompt (role + package selection,
      // never the model) — hashed into the frozen compilation so a later config change
      // under the frozen prompt is detectable.
      const currentConfig: PromptConfig = {
        role: params.role,
        ...(params.roles !== undefined ? { roles: [...params.roles].sort() } : {}),
        ...(params.packageIds !== undefined ? { packageIds: params.packageIds } : {}),
        ...(params.exclude !== undefined ? { exclude: params.exclude } : {}),
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
            agentRef: params.roles?.[0] ?? params.role,
            title: deriveTitle(params.input),
            scope: params.scope,
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
            cs.rename(id, deriveTitle(params.input));
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
          ...(params.model?.reasoning !== undefined ? { reasoning: params.model.reasoning } : {}),
        });
        // Persist (but never push — the console already showed it optimistically) the user turn.
        cs.append(id, [{ seq, frame: { t: 'text', text: params.input, role: 'user' } }]);
        seq += 1;
      }

      let started: { id: string; worktree: string } | undefined;
      const record = (frame: TurnFrame): void => {
        if (started === undefined) return;
        const s = seq++;
        emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: s, frame });
        if (persistIn !== undefined) persistIn.store.append(persistIn.convId, [{ seq: s, frame }]);
      };

      const ready = new Promise<{ id: string; worktree: string }>((resolve) => {
        void createSession(
          {
            role: params.role,
            ...(params.roles !== undefined ? { roles: params.roles } : {}),
            scope: params.scope,
            input: params.input,
            ...(params.model ? { model: params.model } : {}),
            ...(params.packageIds !== undefined ? { packageIds: params.packageIds } : {}),
            ...(params.exclude !== undefined ? { exclude: params.exclude } : {}),
            ...(persistIn !== undefined ? { sessionId: persistIn.convId } : {}),
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
            onStart: (s) => {
              started = s;
              status(s.id, s.worktree, 'running');
              resolve(s);
            },
            onTurn: record,
          },
          deps,
        )
          .then((session) => {
            live.set(session.id, session);
            status(session.id, session.worktree, 'done');
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'session failed';
            if (started !== undefined) {
              record({ t: 'error', message, origin: 'loop' });
              status(started.id, started.worktree, 'error');
            }
          });
      });
      const s = await ready;
      return { sessionId: s.id, worktree: s.worktree };
    }),

    closeSession: rpcMethod(closeParams, (params) => {
      const session = live.get(params.id);
      if (session === undefined) return { closed: false };
      closeSessionCore(session, deps);
      live.delete(params.id);
      return { closed: true };
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

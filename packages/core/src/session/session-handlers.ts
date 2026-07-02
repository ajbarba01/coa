import { z } from 'zod';
import {
  modelSelectionSchema,
  type BackendMessage,
  type Banner,
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
import { cacheColdReasons, type CacheColdReason } from './cache-status.js';
import {
  configHashOf,
  promptHasDrifted,
  promptVersionOf,
  type FrozenCompilation,
  type PromptConfig,
} from './prompt-freeze.js';

/** The prompt-drift notice — a SYSTEM-only banner (never sent to the agent) raised
 *  when the governance config changed under a running frozen prompt. `recompile`
 *  drops the frozen prompt so the next turn compiles fresh; `keep` is a client-side
 *  dismissal (the daemon already suppresses re-nagging the same drift). */
const DRIFT_BANNER: Banner = {
  id: 'drift',
  kind: 'drift',
  reason:
    'The agent configuration changed while a compiled prompt is running. The active ' +
    'prompt still reflects the earlier configuration — recompile to apply the change, ' +
    'or keep the current prompt.',
  actions: [
    { id: 'recompile', label: 'Recompile', primary: true },
    { id: 'keep', label: 'Keep current' },
  ],
};

/** Per-provider prompt-cache TTL (ms) — the idle window past which a turn is treated
 *  as cold. Baked-in defaults (Claude 5 min); a provider absent here ⇒ the staleness
 *  check is off (e.g. DeepSeek). A console-settings override is a later seam. */
const CACHE_STALENESS_MS: Record<string, number> = { claude: 5 * 60_000 };

const CACHE_REASON_TEXT: Record<CacheColdReason, string> = {
  'provider-changed': 'the backend changed',
  'model-changed': 'the model changed',
  'prompt-recompiled': 'the prompt was recompiled',
  stale: 'the session was idle',
};

/** The deterministic cache-status notice — a passive SYSTEM banner (no model call)
 *  telling the user this turn starts cold, so it may be slower and cost more. */
function cacheBanner(reasons: readonly CacheColdReason[]): Banner {
  const phrases = reasons.map((r) => CACHE_REASON_TEXT[r]).join(', ');
  return {
    id: 'cache',
    kind: 'cache',
    reason: `This turn starts with a cold prompt cache (${phrases}), so it may be slower and cost more.`,
  };
}

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
  // The drift config-hash last surfaced per session, so a kept banner is not re-nagged
  // on every subsequent send while the config stays changed. In-memory for the
  // connection's lifetime (a restart re-surfaces an unresolved drift once — the
  // documented tripwire; persistent dismissal is a later refinement).
  const lastDriftHash = new Map<string, string>();
  // The last cache-cold reason-set surfaced per session, so an unchanged cold status
  // is not re-emitted every send (in-memory, same lifetime + tripwire as the drift memo).
  const lastCacheSig = new Map<string, string>();

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
      // The drift-relevant config that SHAPES the prompt (role + package selection,
      // never the model) — hashed into the frozen compilation so a later config change
      // under the frozen prompt is detectable.
      const currentConfig: PromptConfig = {
        role: params.role,
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
            agentRef: params.role,
            title: deriveTitle(params.input),
            scope: params.scope,
          });
        }
        const prior = cs.reload(id);
        const transcript = cs.loadBackendMessages(id);
        frozen = cs.getCompilation(id);
        promptVersion = frozen?.promptVersion;
        // The PRIOR turn's stored facts (read before this turn re-pins the selection),
        // shared by the memory plan, the drift check, and the cache-status check.
        const priorMeta = cs.getMeta(id);
        // Surface a drift banner when the config that shapes the prompt changed under
        // the running frozen compilation — deduped by hash so a kept banner is not
        // re-raised on the next send. Resolved drift (config matched again, or a
        // recompile) clears the memo so a later change re-surfaces.
        if (frozen !== undefined && promptHasDrifted(frozen, currentConfig)) {
          const driftHash = configHashOf(currentConfig);
          if (lastDriftHash.get(id) !== driftHash) {
            lastDriftHash.set(id, driftHash);
            emit({ kind: 'banner', sessionId: id, banner: DRIFT_BANNER });
          }
        } else {
          lastDriftHash.delete(id);
        }
        // Surface a deterministic cache-status banner when this turn starts cold
        // (backend/model switch, recompile, or an idle gap past the provider's TTL) —
        // deduped by reason-set so an unchanged status is not re-nagged.
        const coldReasons = cacheColdReasons({
          // Only a continuation has a warm cache to invalidate — the first turn is cold
          // by definition and carries no banner (a fresh meta has no prior selection).
          ...(priorMeta !== undefined && prior.length > 0
            ? {
                prior: {
                  ...(priorMeta.provider !== undefined ? { provider: priorMeta.provider } : {}),
                  ...(priorMeta.model !== undefined ? { model: priorMeta.model } : {}),
                  ...(priorMeta.resumeStamp?.promptVersion !== undefined
                    ? { promptVersion: priorMeta.resumeStamp.promptVersion }
                    : {}),
                  at: priorMeta.updatedAt,
                },
              }
            : {}),
          current: {
            provider,
            ...(model !== undefined ? { model } : {}),
            ...(promptVersion !== undefined ? { promptVersion } : {}),
          },
          now: new Date().toISOString(),
          ...(CACHE_STALENESS_MS[provider] !== undefined
            ? { stalenessMs: CACHE_STALENESS_MS[provider] }
            : {}),
        });
        if (coldReasons.length > 0) {
          const sig = coldReasons.join(',');
          if (lastCacheSig.get(id) !== sig) {
            lastCacheSig.set(id, sig);
            emit({ kind: 'banner', sessionId: id, banner: cacheBanner(coldReasons) });
          }
        } else {
          lastCacheSig.delete(id);
        }
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
        cs.setSelection(id, params.model ?? { provider });
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
      lastDriftHash.delete(params.sessionId);
      return { recompiled: true };
    }),
  };
}

import { z } from 'zod';
import { modelSelectionSchema, type Push, type RpcNotification, type Session, type TurnFrame } from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import { closeSession as closeSessionCore, createSession, type SessionDeps } from './session.js';
import type { ConversationStore } from './conversation-store.js';

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
      let resume: string | undefined;

      if (persistIn !== undefined) {
        const { convId: id, store: cs } = persistIn;
        if (cs.getMeta(id) === undefined) {
          cs.create({ id, agentRef: params.role, title: deriveTitle(params.input), scope: params.scope });
        }
        const prior = cs.reload(id);
        seq = prior.length === 0 ? 0 : prior[prior.length - 1]!.seq + 1;
        // First message of a still-untitled session sets the VSCode-style auto-title.
        if (prior.length === 0) {
          const title = cs.getMeta(id)?.title;
          if (title === undefined || title === '' || title === 'new session') {
            cs.rename(id, deriveTitle(params.input));
          }
        }
        resume = cs.getMeta(id)?.backendSessionId;
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
            ...(persistIn !== undefined ? { sessionId: persistIn.convId } : {}),
            ...(resume !== undefined ? { resume } : {}),
            ...(persistIn !== undefined
              ? { onBackendSession: (id: string) => persistIn.store.setBackendSession(persistIn.convId, id) }
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
  };
}

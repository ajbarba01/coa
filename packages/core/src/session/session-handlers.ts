import { z } from 'zod';
import { modelSelectionSchema, type Push, type RpcNotification, type Session, type TurnFrame } from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import { closeSession as closeSessionCore, createSession, type SessionDeps } from './session.js';

/**
 * M8 — the session-lifecycle RPC surface (CON-CAT `createSession`/`closeSession`)
 * plus the emission policy for the R-12 push channel. This is where the neutral
 * per-frame stream from the loop becomes the sequenced `turn` Push the client
 * renders: M9 maps its backend messages to M0 {@link TurnFrame}s, and here M8
 * assigns each a monotonic `seq`, tags it with the session id + worktree, and
 * emits it (plus `running`/`done`/`error` status) over the connection that
 * started the session.
 *
 * `createSession` is non-blocking: it starts the loop, returns `{ sessionId,
 * worktree }` as soon as the session is bound (the `onStart` seam), and streams
 * everything else asynchronously — so the connection's request chain stays free
 * for later verbs (interactive input, interrupt). A loop failure is surfaced as an
 * error frame + an `error` status, never a thrown RPC (SC-1: surface, don't cage).
 *
 * The live-session map is per-connection (a v0 floor): `closeSession` resolves a
 * session started on the same connection. A daemon-wide registry keyed by worktree
 * (for console reconnect across connections) is the follow-on with the R-7 store.
 */

const createParams = z.object({
  role: z.string().default(''),
  scope: z.string().default(''),
  input: z.string(),
  model: modelSelectionSchema.optional(),
});

const closeParams = z.object({ id: z.string() });

export function buildSessionHandlers(deps: SessionDeps, connection: RpcConnection): RpcHandlers {
  const live = new Map<string, Session>();

  const emit = (push: Push): void => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  const status = (sessionId: string, worktree: string, state: 'running' | 'done' | 'error'): void =>
    emit({ kind: 'status', sessionId, worktree, state });

  return {
    createSession: rpcMethod(createParams, async (params) => {
      let started: { id: string; worktree: string } | undefined;
      let seq = 0;
      const ready = new Promise<{ id: string; worktree: string }>((resolve) => {
        void createSession(
          {
            role: params.role,
            scope: params.scope,
            input: params.input,
            ...(params.model ? { model: params.model } : {}),
            onStart: (s) => {
              started = s;
              status(s.id, s.worktree, 'running');
              resolve(s);
            },
            onTurn: (frame: TurnFrame) => {
              if (started !== undefined) {
                emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: seq++, frame });
              }
            },
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
              emit({ kind: 'turn', sessionId: started.id, worktree: started.worktree, seq: seq++, frame: { t: 'error', message, origin: 'loop' } });
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

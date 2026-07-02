import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { ConversationStore } from './conversation-store.js';

/**
 * M8 — the session-record RPC surface over the R-7 conversation store: the CON-CAT
 * `reloadConversation` read plus the console's session-list verbs (create / list /
 * rename / delete). These are thin, synchronous wrappers — the durable behavior
 * lives in the {@link ConversationStore}; here we only Zod-validate params and
 * shape the result. The turn-streaming `createSession` lifecycle stays in
 * `session-handlers.ts`; this file owns the persistent session as a *record*.
 */

const newParams = z.object({ agentRef: z.string(), scope: z.string().default('') });
const idParams = z.object({ id: z.string() });
const renameParams = z.object({ id: z.string(), title: z.string() });

export function buildConversationHandlers(store: ConversationStore): RpcHandlers {
  return {
    newSession: rpcMethod(newParams, (params) => {
      const id = randomUUID();
      store.create({ id, agentRef: params.agentRef, title: 'new session', scope: params.scope });
      return { id };
    }),
    // Enrich each summary with the running prompt's source config (from the frozen
    // compilation), so the console can detect prompt drift predictively — comparing the
    // config a send would use against what the live prompt reflects. Absent until the
    // first turn freezes a prompt (and cleared by a recompile).
    listSessions: rpcMethod(z.object({}).optional(), () =>
      store.list().map((meta) => {
        const config = store.getCompilation(meta.id)?.config;
        return config === undefined ? meta : { ...meta, promptConfig: config };
      }),
    ),
    reloadConversation: rpcMethod(idParams, (params) => store.reload(params.id)),
    renameSession: rpcMethod(renameParams, (params) => {
      store.rename(params.id, params.title);
      return { ok: true };
    }),
    deleteSession: rpcMethod(idParams, (params) => {
      store.remove(params.id);
      return { ok: true };
    }),
  };
}

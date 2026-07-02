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
    listSessions: rpcMethod(z.object({}).optional(), () => store.list()),
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

import { z } from 'zod';
import { modelSelectionSchema, type RpcNotification } from '@coa/shared';
import { rpcMethod, type RpcHandlers } from '../rpc/router.js';
import type { RpcConnection } from '../rpc/stream.js';
import type { Sink } from './live-session.js';
import type { SessionService } from './session-service.js';

/**
 * The session-lifecycle RPC surface — `createSession`/`closeSession`/`subscribeSession`/
 * `interruptSession`/`steerSession`/`recompilePrompt` — as pure translation. Each verb
 * parses its params, calls the daemon's one {@link SessionService}, and shapes the answer.
 * No session state lives here: what a live session IS, and how long it lives, belongs to
 * the service (session-service.ts), because a live session outlives any one connection.
 *
 * What this function does own is genuinely per-connection and dies with the socket: the
 * push sink, which conversations THIS connection has already arranged to hear, and the
 * unsubscribes to run when it drops. A connection is a stateless, reattachable subscriber
 * — two consoles talking to one daemon share every live session and share none of this.
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

const closeParams = z.object({ id: z.string() });
const interruptParams = z.object({ id: z.string() });
// `mode` is intentionally not accepted (and not `.strict()`-rejected): there is only one
// steer left, and a stale caller still sending `mode` (an older console build) must degrade
// to an ordinary steer, not break — Zod strips the unknown key rather than erroring on it.
const steerParams = z.object({ id: z.string(), text: z.string() });
const subscribeParams = z.object({ id: z.string() });

export function buildSessionHandlers(
  service: SessionService,
  connection: RpcConnection,
): RpcHandlers {
  const emit: Sink = (push) => {
    connection.push({ jsonrpc: '2.0', method: 'push', params: push } satisfies RpcNotification);
  };
  // Which conversation ids THIS connection has already arranged to (re)subscribe
  // to — so a second send on the same conversation doesn't queue a redundant
  // deferred subscribe (subscribing always re-hydrates on every call).
  const subscribedSessions = new Set<string>();
  // Every unsubscribe this CONNECTION has accumulated (the deferred send-time subscribe
  // AND subscribeSession) — run once, in full, when the connection closes, so a
  // dropped connection (a console reload, a crashed client) doesn't leak a sink
  // forever fanned out to.
  const unsubscribers: Array<() => void> = [];
  connection.onClose(() => {
    for (const off of unsubscribers) off();
    unsubscribers.length = 0;
    subscribedSessions.clear();
  });

  return {
    createSession: rpcMethod(createParams, async (params) => {
      const conversationId = params.conversationId;
      // Subscribe THIS connection once per conversation — deferred to the turn's own
      // start, so hydration lands on its true first status instead of firing here, ahead
      // of it, as a spurious leading `idle`. An ephemeral send has no id until the
      // service mints one, so it always subscribes.
      const attaching = conversationId === undefined || !subscribedSessions.has(conversationId);
      const result = await service.send({
        input: params.input,
        role: params.role,
        scope: params.scope,
        ...(conversationId !== undefined ? { conversationId } : {}),
        ...(params.model !== undefined ? { model: params.model } : {}),
        ...(params.roles !== undefined ? { roles: params.roles } : {}),
        ...(params.packageIds !== undefined ? { packageIds: params.packageIds } : {}),
        ...(params.exclude !== undefined ? { exclude: params.exclude } : {}),
        ...(attaching
          ? { subscribe: { sink: emit, onAttached: (off: () => void) => unsubscribers.push(off) } }
          : {}),
      });
      if (attaching) subscribedSessions.add(result.sessionId);
      return result;
    }),

    // Console reattach: join an already-known session's push stream. Subscribing
    // immediately hydrates this connection with the session's CURRENT run-status —
    // the daemon is the source of truth for liveness, never the client's own tracking.
    subscribeSession: rpcMethod(subscribeParams, (params) => {
      const off = service.subscribe(params.id, emit);
      if (off === undefined) return { subscribed: false };
      unsubscribers.push(off);
      subscribedSessions.add(params.id);
      return { subscribed: true };
    }),

    closeSession: rpcMethod(closeParams, (params) => ({ closed: service.close(params.id) })),

    interruptSession: rpcMethod(interruptParams, (params) => ({
      interrupted: service.interrupt(params.id),
    })),

    // A blank-after-trim steer is a no-op — it would otherwise be recorded as a blank user
    // turn in canonical memory. The TRIMMED text is what gets sent on (not the raw param):
    // the console's own composer already trims before sending (console.ts `steerSession`),
    // so this is a no-op on the shipped path, and it keeps the console's optimistic pin —
    // built from that same trimmed text — matching the daemon's recorded line exactly. That
    // reconciliation counts matching lines, so an inexact match hangs the pin until the idle
    // sweep clears it (docs/adr/0031).
    steerSession: rpcMethod(steerParams, (params) => ({
      steered: service.steer(params.id, params.text.trim()),
    })),

    recompilePrompt: rpcMethod(z.object({ sessionId: z.string() }), (params) => ({
      recompiled: service.recompilePrompt(params.sessionId),
    })),
  };
}

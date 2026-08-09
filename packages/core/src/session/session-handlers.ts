import { z } from 'zod';
import {
  approvalDecisionSchema,
  attachmentSchema,
  modelSelectionSchema,
  permissionModeSchema,
  type RpcNotification,
} from '@coa/shared';
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
  /** Attachments on this send's user message (the one shared wire shape). */
  attachments: z.array(attachmentSchema).optional(),
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
// F2
const setModeParams = z.object({ id: z.string(), mode: permissionModeSchema });
const respondApprovalParams = z.object({
  id: z.string(),
  requestId: z.string(),
  decision: approvalDecisionSchema,
});
const sessionModeParams = z.object({ id: z.string() });

/**
 * The daemon host's per-backend capability facts, injected (the provider→backend map
 * lives in the app's adapter factory, and the model-metadata catalog beside it —
 * `core` owns neither). Absent entirely, or a missing member ⇒ the conservative
 * floor: attachments are refused for every provider (better an honest refusal at
 * the RPC edge than a turn that silently drops them).
 */
export interface SessionCapabilities {
  /** Whether `provider`'s adapter can carry attachments at all. */
  attachmentsSupported?: (provider: string) => boolean;
  /** Whether `modelId` on `provider` reports image-input support (the metadata
   *  catalog's tri-state collapsed honestly: only a verified 'supported' is true). */
  visionSupported?: (provider: string, modelId: string | undefined) => boolean;
}

export function buildSessionHandlers(
  service: SessionService,
  connection: RpcConnection,
  capabilities: SessionCapabilities = {},
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
      // Attachments are honored only where the resolved provider's adapter can carry
      // them — refused HERE, as a typed RPC error the sender surfaces, never silently
      // dropped on the way to a backend with no seam for them (the Claude SDK path
      // today). The vision fact is resolved daemon-side from the metadata catalog,
      // never trusted from the client: only a verified 'supported' opens the image gate.
      const attachments = params.attachments;
      const provider = params.model?.provider ?? 'claude';
      let visionSupported: boolean | undefined;
      if (attachments !== undefined && attachments.length > 0) {
        if (capabilities.attachmentsSupported?.(provider) !== true) {
          throw new Error(`the ${provider} backend cannot carry attachments yet`);
        }
        visionSupported = capabilities.visionSupported?.(provider, params.model?.model) === true;
      }
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
        ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
        ...(visionSupported !== undefined ? { visionSupported } : {}),
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

    // ---- F2 permission modes ----
    //
    // `setMode` — request: `{ id: string, mode: 'plan'|'manual'|'edits'|'bypass' }`.
    // Live-switches session `id`'s configured permission mode. Response:
    // `{ set: boolean }` — `false` ⇒ unknown session id, nothing changed. Takes
    // effect starting with the session's NEXT tool call (never retroactively on
    // one already in flight — the mode-aware `canUseTool` predicate reads the
    // live session's mode fresh on every call). The daemon also fans out a
    // `push` notification with `params.kind === 'mode'` (`{ sessionId, mode,
    // effectiveMode, degraded? }`) to every subscriber of `id`, including this
    // caller — the RPC response and the push both land, so don't double-apply.
    setMode: rpcMethod(setModeParams, (params) => ({
      set: service.setMode(params.id, params.mode),
    })),

    // `respondApproval` — request: `{ id: string, requestId: string, decision:
    // 'approve'|'deny' }`. Answers a pending ask the mode-aware predicate raised
    // for session `id` (its `requestId` arrived earlier on a `push` notification
    // with `params.kind === 'approval'`: `{ requestId, sessionId, summary, tool?,
    // input?, toolClass? }`). Response: `{ resolved: boolean }` — `false` ⇒
    // unknown session id, OR no pending request with that `requestId` (already
    // answered, or stale — answering the same id twice is a harmless no-op, not
    // an error, so a duplicate/racing click never needs special-casing). A
    // resolved ask un-blocks the `canUseTool` call it was holding open and — once
    // every pending ask on the session has cleared — the daemon pushes a
    // `status` notification back to `running` (mirroring the `blocked-approval`
    // status pushed when the ask was first raised).
    respondApproval: rpcMethod(respondApprovalParams, (params) => ({
      resolved: service.respondApproval(params.id, params.requestId, params.decision),
    })),

    // `sessionMode` — request: `{ id: string }`. A plain synchronous read of
    // session `id`'s CURRENT permission-mode state, for a console that wants it
    // without waiting on the next live `mode`/`approval` push (e.g. right after a
    // reattach). Response, session known: `{ found: true, mode:
    // PermissionMode, effectiveMode: PermissionMode, pending: Array<{
    // requestId, tool, summary, input }> }` — `effectiveMode` differs from
    // `mode` only when the active backend has no approval seam (SC-1: the chip
    // must say so honestly rather than claim an enforcement that isn't real);
    // `pending` is every approval request still awaiting a reply (usually 0 or
    // 1, but never assumed — concurrent tool calls can each raise their own).
    // Response, unknown session id: `{ found: false }`.
    sessionMode: rpcMethod(sessionModeParams, (params) => {
      const snapshot = service.modeSnapshot(params.id);
      return snapshot === undefined ? { found: false } : { found: true, ...snapshot };
    }),
  };
}

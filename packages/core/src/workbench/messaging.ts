import type { CoaError, ToolResponse } from '@coa/shared';
import { sanitizeEchoedText } from './spawn.js';

/**
 * The model-facing agent-to-agent messaging surface (docs/adr/0039). `send_message` and
 * `list_agents` are ordinary coa tools — `PreToolUse` gates them exactly like every
 * other call (one bounded tool surface, governed at one seam), so no governance surface
 * lives here. Mirrors `spawn.ts`'s shape: the port is declared, not supplied — the
 * daemon injects the real dispatch/roster reads at the composition root, bound to the
 * calling session as sender (`SessionService.messagingFor`).
 *
 * Every type here is a STRUCTURAL mirror of its `session/message-dispatch.ts` counterpart
 * rather than an import of it — `dependency-cruiser`'s `core-workbench-only-sanctioned-reads`
 * rule forbids workbench from importing `session/` (the workbench is a producer that may
 * read flags/context/governance, never a sibling ring sideways), the same reason
 * `spawn.ts` restates `AgentSummary`'s shape rather than reaching past its own port.
 */
export interface MessagingDeps {
  /** Dispatch one message from the bound (calling) session. Never throws. */
  send: (args: { to: string; body: string; replyTo?: string }) => SendMessageOutcome;
  /** The bound session's live roster — every member of its family tree. */
  roster: () => readonly RosterRow[];
}

/** A structural mirror of `message-dispatch.ts`'s `RosterEntry` — see the module doc
 *  for why this is a copy, not an import. */
export interface RosterRow {
  sessionId: string;
  agentRef: string;
  relation: 'self' | 'parent' | 'child' | 'ancestor' | 'descendant' | 'other';
  live: 'running' | 'idle' | 'not-registered';
  confidence: 'observed' | 'advisory';
  endReason?: 'completed' | 'errored' | 'stopped';
}

/** The outcome the workbench-layer `sendMessage` hands back — a thin wrapper over
 *  `message-dispatch.ts`'s own `SendMessageOutcome`, adding the wire-facing `delivery`
 *  label a model can read without knowing this module's internal `DeliveryPlan` shape. */
export type SendMessageResult =
  | { applied: true; id: string; threadId: string; to: string; delivery: 'mid-turn' | 'wake' }
  | { applied: false; error: CoaError };

/** The outcome of `SessionService.messagingFor(...).send`, restated here so this module
 *  does not import `session/message-dispatch.ts`'s types directly (workbench stays a
 *  leaf the session layer depends ON, never the reverse). Structurally identical to
 *  `message-dispatch.ts`'s `SendMessageOutcome`. */
export type SendMessageOutcome =
  | {
      applied: true;
      message: { id: string; threadId: string; to: string };
      plan: { kind: 'mid-turn' } | { kind: 'wake' };
    }
  | { applied: false; error: CoaError };

/**
 * Send a message to another agent within this session's family tree. Non-blocking by
 * construction: dispatch either queues onto the recipient's in-flight turn or wakes a
 * fresh one — this call itself never waits on either. `to`/`body`/`replyTo` are opaque
 * data on every path (never interpolated into a message this handler constructs), so
 * they carry no injection surface of their own within this module — the daemon-side
 * dispatch/render layer is what sanitizes the body before a recipient ever reads it.
 */
export function sendMessage(
  args: { to: string; body: string; replyTo?: string },
  deps: MessagingDeps,
): ToolResponse<SendMessageResult> {
  const outcome = deps.send(args);
  const safeTo = sanitizeEchoedText(args.to);
  if (!outcome.applied) {
    return {
      result: { applied: false, error: outcome.error },
      handle: `send_message:${outcome.error.code}`,
      pointer: safeTo,
    };
  }
  return {
    result: {
      applied: true,
      id: outcome.message.id,
      threadId: outcome.message.threadId,
      to: outcome.message.to,
      delivery: outcome.plan.kind,
    },
    handle: `send_message:${outcome.message.id}`,
    pointer: outcome.message.id,
  };
}

/** How many roster rows a reply shows before truncating — bounds the REPLY, not the
 *  tree, the same reasoning `spawn.ts`'s `MAX_LISTED_AGENTS` documents for the
 *  known-agents listing. */
const MAX_ROSTER_ROWS = 100;

export type ListAgentsResult =
  | { applied: true; agents: string[]; omitted: number }
  | { applied: false; error: CoaError };

/**
 * The live roster: every agent running (or recently run) in this session's family
 * tree, relationship-labeled relative to the caller (self/parent/child/ancestor/
 * descendant/other — never a flat list, the critique's own named gap). One JSON object
 * per row (`spawn.ts`'s `listKnownAgents` reasoning applies identically here: a
 * hand-built label string is still forgeable printable text, one quoted/escaped JSON
 * value per line is not) — `agentRef` is `SAFE_REF`-constrained upstream and `sessionId`
 * is a daemon-generated id, so neither needs sanitizing before it rides back, unlike
 * `find_agent`'s hand-authored `name`/`description` fields.
 */
export function listRoster(deps: Pick<MessagingDeps, 'roster'>): ToolResponse<ListAgentsResult> {
  const all = deps.roster();
  const shown = all.slice(0, MAX_ROSTER_ROWS);
  const rows = shown.map((r) =>
    JSON.stringify({
      sessionId: r.sessionId,
      agentRef: r.agentRef,
      relation: r.relation,
      live: r.live,
      confidence: r.confidence,
      ...(r.endReason !== undefined ? { endReason: r.endReason } : {}),
    }),
  );
  const omitted = all.length - shown.length;
  return {
    result: { applied: true, agents: rows, omitted },
    handle: `list_agents:${all.length}`,
    pointer: 'roster',
  };
}

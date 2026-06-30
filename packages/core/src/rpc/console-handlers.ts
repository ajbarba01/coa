import type { FeedView } from '@coa/shared';
import { z } from 'zod';
import type { Checkpoint } from '../checkpoint.js';
import type { CapState } from '../governance/cost-cap.js';
import type { DecisionEntry } from '../governance/governance-log.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * M8 — the read-only slice of the CON-CAT method catalogue: the inspector verbs
 * the human console calls to SEE coa's state. Each is a non-mutating render over a
 * daemon-core method that already exists (the "(b)" tag — this wiring is the work,
 * not new behavior); the console computes nothing. They are injected as narrow
 * ports so this module stays testable without standing up the whole daemon, and
 * plug straight into the transport-agnostic {@link dispatch} router.
 *
 * Scope is the read-only inspector reads (`capState`/`flagsForUser`/`getDecision`/
 * `why`/`listTimeline`); the mutating and subscription verbs (approvals, feedback,
 * turn streams) and the verbs that wrap not-yet-built core methods (context/graph/
 * health/ledger) layer on as those surfaces land. M9-style `null` stands in for an
 * absent decision — a JSON-RPC `result` cannot be `undefined`.
 */
export interface ConsoleReadPorts {
  /** M7 cost surface — non-mutating, safe to call repeatedly. */
  capState: (sessionId?: string) => CapState;
  /** M3 CF-1 user-audience feed (crit/high expanded, med/low collapsed-but-counted). */
  flagsForUser: (scope?: string) => FeedView;
  /** M7 Decision log — read one numbered entry. */
  readDecision: (id: number) => DecisionEntry | undefined;
  /** M7 Decision log — the decisions governing a target (the EXPLAIN `why`). */
  decisionsByTarget: (target: string) => DecisionEntry[];
  /** M1 timeline — the checkpoints behind the rewind/undo view (D98). */
  listTimeline: () => Checkpoint[];
}

const sessionParams = z.object({ sessionId: z.string().optional() }).optional();
const scopeParams = z.object({ scope: z.string().optional() }).optional();
const idParams = z.object({ id: z.number() });
const targetParams = z.object({ target: z.string() });
const noParams = z.unknown().optional();

/** Build the read-only inspector handler map for {@link dispatch}. */
export function buildConsoleHandlers(ports: ConsoleReadPorts): RpcHandlers {
  return {
    capState: rpcMethod(sessionParams, (p) => ports.capState(p?.sessionId)),
    flagsForUser: rpcMethod(scopeParams, (p) => ports.flagsForUser(p?.scope)),
    getDecision: rpcMethod(idParams, (p) => ports.readDecision(p.id) ?? null),
    why: rpcMethod(targetParams, (p) => ports.decisionsByTarget(p.target)),
    listTimeline: rpcMethod(noParams, () => ports.listTimeline()),
  };
}

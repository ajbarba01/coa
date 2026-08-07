import {
  agentFileSchema,
  type AgentDiagnostic,
  type AgentFile,
  type AgentSummary,
  type FeedView,
  type PackageSummary,
  type RoleSummary,
} from '@coa/shared';
import { z } from 'zod';
import type { Checkpoint } from '../checkpoint.js';
import type { CapState } from '../governance/cost-cap.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The read-only slice of the CON-CAT method catalogue: the inspector verbs
 * the human console calls to SEE coa's state. Each is a non-mutating render over a
 * daemon-core method that already exists (the "(b)" tag — this wiring is the work,
 * not new behavior); the console computes nothing. They are injected as narrow
 * ports so this module stays testable without standing up the whole daemon, and
 * plug straight into the transport-agnostic {@link dispatch} router.
 *
 * Scope is the read-only inspector reads (`capState`/`flagsForUser`/`listTimeline`);
 * the mutating and subscription verbs (approvals, feedback, turn streams) and the
 * verbs that wrap not-yet-built core methods (context/graph/health/ledger) layer
 * on as those surfaces land.
 */
export interface ConsoleReadPorts {
  /** The cost surface — non-mutating, safe to call repeatedly. */
  capState: (sessionId?: string) => CapState;
  /** The flag pipeline's user-audience feed (crit/high expanded, med/low collapsed-but-counted). */
  flagsForUser: (scope?: string) => FeedView;
  /** The checkpoint timeline — the ordered list the console's Timeline panel renders. */
  listTimeline: () => Checkpoint[];
}

const sessionParams = z.object({ sessionId: z.string().optional() }).optional();
const scopeParams = z.object({ scope: z.string().optional() }).optional();
const noParams = z.unknown().optional();

/** Build the read-only inspector handler map for {@link dispatch}. */
export function buildConsoleHandlers(ports: ConsoleReadPorts): RpcHandlers {
  return {
    capState: rpcMethod(sessionParams, (p) => ports.capState(p?.sessionId)),
    flagsForUser: rpcMethod(scopeParams, (p) => ports.flagsForUser(p?.scope)),
    listTimeline: rpcMethod(noParams, () => ports.listTimeline()),
  };
}

/**
 * The agent-assembly catalogue reads — the verbs the console calls to populate its
 * role/package picker. Both are pure projections over the registries (no daemon
 * state), injected as narrow ports so the source can move from the starter set to
 * user-authored `.coa/` packages without touching this wiring.
 */
export interface RegistryReadPorts {
  /** Every role, as its picker summary (Pieces dropped). */
  listRoles: () => RoleSummary[];
  /** Every package, as its picker summary (Pieces dropped). */
  listPackages: () => PackageSummary[];
}

/** Build the role/package catalogue handler map for {@link dispatch}. */
export function buildRegistryHandlers(ports: RegistryReadPorts): RpcHandlers {
  return {
    listRoles: rpcMethod(noParams, () => ports.listRoles()),
    listPackages: rpcMethod(noParams, () => ports.listPackages()),
  };
}

/**
 * The agent-definition registry verbs. Reads are always fresh (an agent authored
 * elsewhere is visible without a restart); writes are validated at this edge, so a
 * definition can never reach disk without the `description` delegation depends on.
 * `builtin` is not a writable scope — those definitions ship in code.
 */
export interface AgentRegistryPorts {
  listAgents: () => { agents: AgentSummary[]; diagnostics: AgentDiagnostic[] };
  saveAgent: (ref: string, file: AgentFile, scope: 'personal' | 'project') => void;
  deleteAgent: (ref: string, scope: 'personal' | 'project') => boolean;
}

const writableScope = z.enum(['personal', 'project']);
const saveAgentParams = z.object({
  ref: z.string().min(1),
  scope: writableScope,
  file: agentFileSchema,
});
const deleteAgentParams = z.object({ ref: z.string().min(1), scope: writableScope });

export function buildAgentRegistryHandlers(ports: AgentRegistryPorts): RpcHandlers {
  return {
    listAgents: rpcMethod(noParams, () => ports.listAgents()),
    saveAgent: rpcMethod(saveAgentParams, (p) => {
      ports.saveAgent(p.ref, p.file, p.scope);
      return { ok: true };
    }),
    deleteAgent: rpcMethod(deleteAgentParams, (p) => ({
      removed: ports.deleteAgent(p.ref, p.scope),
    })),
  };
}

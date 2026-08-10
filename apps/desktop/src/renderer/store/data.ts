import { create } from 'zustand';
import type {
  AgentDiagnostic,
  AgentSummary,
  CapState,
  Checkpoint,
  FeedView,
  ModelDescriptor,
  ModelMetadata,
  PackageSummary,
  RoleSummary,
  WorktreeView,
} from '@coa/console-viewmodel';
import type { AccountsInfo, Remote } from '../panels/state.js';

/**
 * The daemon-data slice: everything the console reads from the daemon that is not a
 * session or a transcript — the slow-changing surfaces (cap/flags/timeline ride the 2s
 * poll; accounts/models/metadata/catalogue/agents/worktrees are boot reads refreshed on
 * demand). A poll tick that returns what the last one did keeps every reference
 * unchanged, so nothing re-renders; a changed key replaces that key alone.
 */
interface DataState {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
  accounts: Remote<AccountsInfo>;
  models: Remote<ModelDescriptor[]>;
  /** The per-model info catalog (context window/pricing/modalities/reasoning) — the
   *  context ring, the model-picker hover card, and attach gating all read this.
   *  Absent fields on a row are genuine unknowns, never fabricated. */
  modelMetadata: Remote<ModelMetadata[]>;
  roles: Remote<RoleSummary[]>;
  packages: Remote<PackageSummary[]>;
  /** Every session running in its own isolated git worktree — the Worktree dock's rows. */
  worktrees: Remote<WorktreeView[]>;
  /** The daemon's registered agents (built-in ∪ personal ∪ project). */
  agents: Remote<AgentSummary[]>;
  /** Load problems the registry reported alongside the list — a broken agent file has a
   *  visible reason instead of the agent just not being there. Rides the same read as
   *  `agents` and degrades to `[]` with it. */
  agentDiagnostics: AgentDiagnostic[];
}

const EMPTY: DataState = {
  cap: { status: 'loading' },
  flags: { status: 'loading' },
  timeline: { status: 'loading' },
  accounts: { status: 'loading' },
  models: { status: 'loading' },
  modelMetadata: { status: 'loading' },
  roles: { status: 'loading' },
  packages: { status: 'loading' },
  worktrees: { status: 'loading' },
  agents: { status: 'loading' },
  agentDiagnostics: [],
};

export const useDaemonData = create<DataState>(() => ({ ...EMPTY }));

/** Cheap structural equality for a `Remote`: cap/flags/timeline are plain JSON (Zod-
 *  inferred wire types — no functions, Dates, or cycles), so stringifying substitutes
 *  for a real deep-equal. This is what keeps an unchanged poll tick from touching any
 *  subscriber: an equal value keeps the previous reference. */
function remoteEqual<T>(a: Remote<T>, b: Remote<T>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The 2s poll's three reads, compared PER KEY: a tick where only `cap` moved replaces
 *  `cap` alone, so the flags HUD and the timeline surface keep their references and
 *  never re-render for news that was not theirs. */
export function setSlowData(next: {
  cap: Remote<CapState>;
  flags: Remote<FeedView>;
  timeline: Remote<Checkpoint[]>;
}): void {
  useDaemonData.setState((s) => {
    const cap = remoteEqual(s.cap, next.cap) ? s.cap : next.cap;
    const flags = remoteEqual(s.flags, next.flags) ? s.flags : next.flags;
    const timeline = remoteEqual(s.timeline, next.timeline) ? s.timeline : next.timeline;
    if (cap === s.cap && flags === s.flags && timeline === s.timeline) return s;
    return { cap, flags, timeline };
  });
}

export function setAccounts(accounts: Remote<AccountsInfo>): void {
  useDaemonData.setState({ accounts });
}

export function setModels(models: Remote<ModelDescriptor[]>): void {
  useDaemonData.setState({ models });
}

export function setModelMetadata(modelMetadata: Remote<ModelMetadata[]>): void {
  useDaemonData.setState({ modelMetadata });
}

export function setCatalogue(
  roles: Remote<RoleSummary[]>,
  packages: Remote<PackageSummary[]>,
): void {
  useDaemonData.setState({ roles, packages });
}

export function setWorktrees(worktrees: Remote<WorktreeView[]>): void {
  useDaemonData.setState({ worktrees });
}

/** The current models, or [] while not loaded (helper for the note derivations). */
export function modelsValue(): ModelDescriptor[] {
  const models = useDaemonData.getState().models;
  return models.status === 'ok' ? models.value : [];
}

/** The current agent list, or [] while not loaded (helper for the agent ops). */
export function agentsValue(): AgentSummary[] {
  const agents = useDaemonData.getState().agents;
  return agents.status === 'ok' ? agents.value : [];
}

export function setAgents(agents: AgentSummary[], diagnostics?: AgentDiagnostic[]): void {
  useDaemonData.setState((s) => ({
    agents: { status: 'ok', value: agents },
    agentDiagnostics: diagnostics ?? s.agentDiagnostics,
  }));
}

/** Test seam. */
export function resetDaemonData(): void {
  useDaemonData.setState({ ...EMPTY }, true);
}

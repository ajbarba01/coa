import type { ContextPackage, FeedView, ToolResponse } from '@coa/shared';
import type { CapState } from '../governance/cost-cap.js';
import type { DecisionEntry } from '../governance/governance-log.js';

/**
 * M6 Graph/Context/Flags + Explain — the read surface over the governed session
 * state (D103). Each return is a distilled handle + a pointer. Surfaces whose
 * upstream is not yet built degrade honestly to a floor (D85): `context_status`
 * returns the live cap with a null assembled-context until M4's package lands,
 * and `get_spec` returns null until M4's spec store exists. `why`/`get_decision`
 * read M7's append-only Decision log; `run_checks` runs M3's pipeline on demand.
 */
export interface InspectDeps {
  /** Run M3's flag pipeline for a scope and return the user-audience feed. */
  runChecks: (scope?: string) => FeedView;
  /** The non-mutating M7 cap read (never the charging path). */
  capState: () => CapState;
  /** M4's assembled-context package — floored until L-ASM is built. */
  contextPackage?: () => ContextPackage | undefined;
  /** M7 decision-log entries governing a target (serves `why`). */
  decisionsByTarget: (target: string) => readonly DecisionEntry[];
  /** A numbered M7 decision-log entry (serves `get_decision`). */
  readDecision: (id: number) => DecisionEntry | undefined;
  /** M4's governing spec for a ref — floored until the spec store is built. */
  getSpec?: (ref: string) => string | undefined;
}

export type ContextStatusResult = { cap: CapState; context: ContextPackage | null };
export type WhyResult = { target: string; decisions: readonly DecisionEntry[] };
export type GetDecisionResult = { found: true; decision: DecisionEntry } | { found: false };
export type GetSpecResult = { ref: string; spec: string | null };

/** `run_checks` — run the flag pipeline on demand for a scope. */
export function runChecks(req: { scope?: string }, deps: InspectDeps): ToolResponse<FeedView> {
  const result = deps.runChecks(req.scope);
  return wrap(result, `checks:${req.scope ?? 'all'}`, req.scope ?? 'all');
}

/** `context_status` — the assembled-context + cap state (assembled context floored). */
export function contextStatus(deps: InspectDeps): ToolResponse<ContextStatusResult> {
  const context = deps.contextPackage?.() ?? null;
  return wrap({ cap: deps.capState(), context }, 'context-status', 'session');
}

/** `why` — the rationale for a constraint/decision, keyed by an arbitrary target. */
export function why(req: { target: string }, deps: InspectDeps): ToolResponse<WhyResult> {
  const decisions = deps.decisionsByTarget(req.target);
  return wrap({ target: req.target, decisions }, `why:${req.target}`, req.target);
}

/** `get_decision` — a numbered Decision-log entry. */
export function getDecision(
  req: { id: number },
  deps: InspectDeps,
): ToolResponse<GetDecisionResult> {
  const decision = deps.readDecision(req.id);
  return decision
    ? wrap({ found: true, decision }, `decision:${req.id}`, String(req.id))
    : wrap({ found: false }, 'decision:miss', String(req.id));
}

/** `get_spec` — the governing spec for a symbol/scope (floored until M4's spec store exists). */
export function getSpec(req: { ref: string }, deps: InspectDeps): ToolResponse<GetSpecResult> {
  const spec = deps.getSpec?.(req.ref) ?? null;
  return wrap({ ref: req.ref, spec }, `spec:${req.ref}`, req.ref);
}

/** Build a distilled-handle tool return (grounding/flags are added by the enrich decorator). */
function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}

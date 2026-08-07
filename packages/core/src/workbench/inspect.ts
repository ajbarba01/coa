import type { ContextPackage, FeedView, ToolResponse } from '@coa/shared';
import type { CapState } from '../governance/cost-cap.js';

/**
 * M6 Graph/Context/Flags + Explain — the read surface over the governed session
 * state (D103). Each return is a distilled handle + a pointer. Surfaces whose
 * upstream is not yet built degrade honestly to a floor (D85): `context_status`
 * returns the live cap with a null assembled-context until M4's package lands,
 * and `get_spec` returns null until M4's spec store exists. `run_checks` runs
 * M3's pipeline on demand.
 */
export interface InspectDeps {
  /** Run M3's flag pipeline for a scope and return the user-audience feed. */
  runChecks: (scope?: string) => FeedView;
  /** The non-mutating M7 cap read (never the charging path). */
  capState: () => CapState;
  /** M4's assembled-context package — floored until L-ASM is built. */
  contextPackage?: () => ContextPackage | undefined;
  /** M4's governing spec for a ref — floored until the spec store is built. */
  getSpec?: (ref: string) => string | undefined;
}

export type ContextStatusResult = { cap: CapState; context: ContextPackage | null };
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

/** `get_spec` — the governing spec for a symbol/scope (floored until M4's spec store exists). */
export function getSpec(req: { ref: string }, deps: InspectDeps): ToolResponse<GetSpecResult> {
  const spec = deps.getSpec?.(req.ref) ?? null;
  return wrap({ ref: req.ref, spec }, `spec:${req.ref}`, req.ref);
}

/** Build a distilled-handle tool return (flags are added by the enrich decorator). */
function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}

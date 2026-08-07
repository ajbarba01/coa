import type { ContextPackage, FeedView, ToolResponse } from '@coa/shared';
import type { CapState } from '../governance/cost-cap.js';

/**
 * Graph/Context/Flags + Explain — the read surface over the governed session
 * state. Each return is a distilled handle + a pointer. Surfaces whose
 * upstream is not yet built degrade honestly to a floor: `context_status`
 * returns the live cap with a null assembled-context until the context layer's package lands,
 * and `get_spec` returns null until the context layer's spec store exists. `run_checks` runs
 * the flag pipeline on demand.
 */
export interface InspectDeps {
  /** Run the flag pipeline for a scope and return the user-audience feed. */
  runChecks: (scope?: string) => FeedView;
  /** The non-mutating governance cap read (never the charging path). */
  capState: () => CapState;
  /** The context layer's assembled-context package — floored until L-ASM is built. */
  contextPackage?: () => ContextPackage | undefined;
  /** The context layer's governing spec for a ref — floored until the spec store is built. */
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

/** `get_spec` — the governing spec for a symbol/scope (floored until the context layer's spec store exists). */
export function getSpec(req: { ref: string }, deps: InspectDeps): ToolResponse<GetSpecResult> {
  const spec = deps.getSpec?.(req.ref) ?? null;
  return wrap({ ref: req.ref, spec }, `spec:${req.ref}`, req.ref);
}

/** Build a distilled-handle tool return (flags are added by the enrich decorator). */
function wrap<R>(result: R, handle: string, pointer: string): ToolResponse<R> {
  return { result, handle, pointer };
}

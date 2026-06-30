import type { InjectionBundle, ToolCall, ToolResponse } from '@coa/shared';
import { ground, type SymbolOracle } from '../context/grounding.js';

/**
 * M6 — the cross-cutting return enrichment. Every tool return is post-processed
 * so the agent gets project truth + gated flags inline with its result: an
 * advisory grounding block on a symbol near-miss (M4.ground) and the gated
 * agent-audience flags for the touched scope (M3.flagsForAgent). Both are
 * advisory and never block (SC-1); when there is nothing to surface the return
 * passes through untouched (the D85 floor).
 *
 * SCO-4 scope-delivery (`scopeDocs`) is not wired here yet — it lands with M4's
 * scopeDeliver and is omitted at the floor until then.
 */
export interface EnrichDeps {
  /** M1's symbol read-surface for the existence-grounding check. */
  oracle: SymbolOracle;
  /** M3's gated agent-audience flags for a scope (high-confidence ∧ crit|high). */
  flagsForAgent: (scope?: string) => InjectionBundle;
}

/** Decorate a raw tool return with grounding + gated flags. */
export function enrich<R>(
  call: ToolCall,
  response: ToolResponse<R>,
  deps: EnrichDeps,
): ToolResponse<R> {
  const grounding = ground(call, deps.oracle);
  const bundle = deps.flagsForAgent(scopeOf(call));
  const flags = bundle.groups.length > 0 ? bundle : undefined;
  return {
    ...response,
    ...(grounding ? { grounding } : {}),
    ...(flags ? { flags } : {}),
  };
}

/** The scope a call touches: the ref's path when it has one, else unscoped. */
function scopeOf(call: ToolCall): string | undefined {
  const ref = call.ref;
  return ref && 'path' in ref ? ref.path : undefined;
}

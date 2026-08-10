import type { InjectionBundle, ToolCall, ToolResponse } from '@coa/shared';

/**
 * The cross-cutting return enrichment. Every tool return is post-processed so
 * the agent gets the gated agent-audience flags for the touched scope inline
 * with its result. The flags are advisory and never block; when there is
 * nothing to surface the return passes through untouched.
 */
export interface EnrichDeps {
  /** The gated agent-audience flags for a scope (high-confidence ∧ crit|high). */
  flagsForAgent: (scope?: string) => InjectionBundle;
}

/** Decorate a raw tool return with the gated flags for its scope. */
export function enrich<R>(
  call: ToolCall,
  response: ToolResponse<R>,
  deps: EnrichDeps,
): ToolResponse<R> {
  const bundle = deps.flagsForAgent(scopeOf(call));
  const flags = bundle.groups.length > 0 ? bundle : undefined;
  return {
    ...response,
    ...(flags ? { flags } : {}),
  };
}

/** The scope a call touches: the ref's path when it has one, else unscoped. */
function scopeOf(call: ToolCall): string | undefined {
  const ref = call.ref;
  return ref && 'path' in ref ? ref.path : undefined;
}

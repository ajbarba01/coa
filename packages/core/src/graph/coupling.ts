import type { EdgeType, GraphEdge } from '@coa/shared';

/**
 * The coupling substrate. Coupling metrics (CBO/RFC/fan-in/out) need
 * typed, weighted symbol edges the import-only model lacked. This returns the
 * **typed/weighted fan** over `calls`/`inherits` (the OO coupling edges; module-
 * tier `depends-on`/`imports` are a different granularity) plus the cheap,
 * deterministic counts. The context layer's L-HLT composes the actual non-compensatory
 * health profile from this — the kernel owns the substrate, not the metric judgment.
 * Staleness ignores `weight` and this fan entirely.
 */
export interface CouplingFan {
  node: string;
  fanOut: number;
  fanIn: number;
  /** Coupling-between-objects: distinct nodes coupled in either direction. */
  cbo: number;
  outgoing: { to: string; type: EdgeType; weight: number }[];
  incoming: { from: string; type: EdgeType; weight: number }[];
}

const COUPLING_TYPES: ReadonlySet<EdgeType> = new Set<EdgeType>(['calls', 'inherits']);

export function computeCoupling(node: string, edges: GraphEdge[]): CouplingFan {
  const outgoing = edges
    .filter((e) => e.from === node && COUPLING_TYPES.has(e.type))
    .map((e) => ({ to: e.to, type: e.type, weight: e.weight ?? 1 }));
  const incoming = edges
    .filter((e) => e.to === node && COUPLING_TYPES.has(e.type))
    .map((e) => ({ from: e.from, type: e.type, weight: e.weight ?? 1 }));

  const outNodes = new Set(outgoing.map((o) => o.to));
  const inNodes = new Set(incoming.map((i) => i.from));

  return {
    node,
    fanOut: outNodes.size,
    fanIn: inNodes.size,
    cbo: new Set([...outNodes, ...inNodes]).size,
    outgoing,
    incoming,
  };
}

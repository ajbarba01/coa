import type { EdgeProvenance, EdgeType, GraphEdge, GraphNodeKind } from '@coa/shared';

/**
 * The in-memory typed dependency graph — M1's central projection (P4), the hot
 * read path. The floor keeps the node set and typed edges and answers the
 * dependency reads every consumer needs. Its one structural invariant is the
 * **declared-layer DAG**: an authored (`declared`/`gated`) edge that would close
 * a cycle is rejected. Inferred/convention edges are stored as-is — the GRF-1
 * retained-cycle model and the cycle/coupling/temporal views are a later batch.
 */
const DECLARED_LAYER: ReadonlySet<EdgeProvenance> = new Set<EdgeProvenance>(['declared', 'gated']);
const DEPENDENCY_TYPES: ReadonlySet<EdgeType> = new Set<EdgeType>(['depends-on', 'imports']);

export class TypedGraph {
  private readonly nodeKinds = new Map<string, GraphNodeKind>();
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();

  /** Register (or re-register) a node's kind. Edges auto-create bare nodes too. */
  setNode(id: string, kind: GraphNodeKind): void {
    this.nodeKinds.set(id, kind);
  }

  hasNode(id: string): boolean {
    return this.nodeKinds.has(id) || this.outgoing.has(id) || this.incoming.has(id);
  }

  /** True iff adding this authored edge would close a cycle in the declared layer. */
  wouldCreateCycle(edge: GraphEdge): boolean {
    if (!DECLARED_LAYER.has(edge.provenance)) return false;
    if (edge.from === edge.to) return true;
    // A cycle forms iff `edge.to` can already reach `edge.from` over declared edges.
    return this.reachesOverDeclaredLayer(edge.to, edge.from);
  }

  /** Add an edge, enforcing the declared-layer DAG invariant. */
  applyEdge(edge: GraphEdge): void {
    if (this.wouldCreateCycle(edge)) {
      throw new Error(`declared-layer cycle rejected: ${edge.from} -> ${edge.to} (${edge.type})`);
    }
    this.removeEdge(edge.from, edge.to, edge.type); // idempotent re-assert overwrites
    push(this.outgoing, edge.from, edge);
    push(this.incoming, edge.to, edge);
  }

  retractEdge(from: string, to: string, type: EdgeType): void {
    this.removeEdge(from, to, type);
  }

  /** Direct dependencies (outgoing depends-on/imports targets). */
  dependencies(id: string): string[] {
    return (this.outgoing.get(id) ?? [])
      .filter((e) => DEPENDENCY_TYPES.has(e.type))
      .map((e) => e.to);
  }

  /** Direct dependents (incoming depends-on/imports sources). */
  dependents(id: string): string[] {
    return (this.incoming.get(id) ?? [])
      .filter((e) => DEPENDENCY_TYPES.has(e.type))
      .map((e) => e.from);
  }

  provenanceOf(from: string, to: string, type: EdgeType): EdgeProvenance | undefined {
    return (this.outgoing.get(from) ?? []).find((e) => e.to === to && e.type === type)?.provenance;
  }

  /** All edges leaving `id` (any type). */
  outEdges(id: string): GraphEdge[] {
    return [...(this.outgoing.get(id) ?? [])];
  }

  edges(): GraphEdge[] {
    return [...this.outgoing.values()].flat();
  }

  private reachesOverDeclaredLayer(start: string, goal: string): boolean {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined || seen.has(node)) continue;
      if (node === goal) return true;
      seen.add(node);
      for (const e of this.outgoing.get(node) ?? []) {
        if (DECLARED_LAYER.has(e.provenance)) stack.push(e.to);
      }
    }
    return false;
  }

  private removeEdge(from: string, to: string, type: EdgeType): void {
    filterOut(this.outgoing, from, to, type, 'to');
    filterOut(this.incoming, to, from, type, 'from');
  }
}

function push(index: Map<string, GraphEdge[]>, key: string, edge: GraphEdge): void {
  const list = index.get(key);
  if (list) list.push(edge);
  else index.set(key, [edge]);
}

function filterOut(
  index: Map<string, GraphEdge[]>,
  key: string,
  other: string,
  type: EdgeType,
  otherField: 'to' | 'from',
): void {
  const list = index.get(key);
  if (!list) return;
  index.set(
    key,
    list.filter((e) => !(e[otherField] === other && e.type === type)),
  );
}

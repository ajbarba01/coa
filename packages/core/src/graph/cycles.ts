import type { EdgeType, GraphEdge } from '@coa/shared';

/**
 * Cycles/tangles as first-class findings. A dependency cycle is the #1
 * "spaghetti" signal, so the graph **retains every intra-cycle edge** and the SCC
 * condensation is a *view* computed on demand here — never a destructive write
 * that collapses the edges. Beyond detecting the strongly-connected component,
 * this names the specific **back-edge(s) to cut** (a minimum-feedback-arc-set
 * heuristic): the one fact a maintainer needs (which import to delete), not an
 * opaque "modules A,B,C tangle" blob.
 */
export interface CycleComponent {
  id: string;
  /** The nodes in the cycle (sorted). */
  members: string[];
  /** The edges whose removal would break the cycle (DFS back-edges). */
  backEdges: GraphEdge[];
}

/** Edges that represent a dependency for the purpose of cycle detection. */
const STRUCTURAL: ReadonlySet<EdgeType> = new Set<EdgeType>([
  'depends-on',
  'imports',
  'calls',
  'inherits',
  'derived-from',
  'generated-from',
]);

export function findCycles(allEdges: GraphEdge[]): CycleComponent[] {
  const edges = allEdges.filter((e) => STRUCTURAL.has(e.type));
  const adjacency = buildAdjacency(edges);
  const components: CycleComponent[] = [];

  for (const scc of tarjan(adjacency)) {
    const members = [...scc].sort();
    if (!isCycle(members, edges)) continue;
    const memberSet = new Set(members);
    const internal = edges.filter((e) => memberSet.has(e.from) && memberSet.has(e.to));
    components.push({
      id: members.join('|'),
      members,
      backEdges: findBackEdges(members, internal),
    });
  }

  return components.sort((a, b) => compare(a.members[0], b.members[0]));
}

function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
  }
  for (const e of edges) adjacency.get(e.from)?.push(e.to);
  for (const [node, targets] of adjacency) adjacency.set(node, [...targets].sort());
  return adjacency;
}

/** Tarjan's strongly-connected-components, with deterministic node/neighbor order. */
function tarjan(adjacency: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  const visit = (v: string): void => {
    const vIndex = counter++;
    index.set(v, vIndex);
    let vLow = vIndex;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      const wIndex = index.get(w);
      if (wIndex === undefined) {
        visit(w);
        vLow = Math.min(vLow, low.get(w) ?? vLow);
      } else if (onStack.has(w)) {
        vLow = Math.min(vLow, wIndex);
      }
    }
    low.set(v, vLow);

    if (vLow === vIndex) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      sccs.push(component);
    }
  };

  for (const node of [...adjacency.keys()].sort()) {
    if (!index.has(node)) visit(node);
  }
  return sccs;
}

function isCycle(members: string[], edges: GraphEdge[]): boolean {
  if (members.length > 1) return true;
  const only = members[0];
  return only !== undefined && edges.some((e) => e.from === only && e.to === only);
}

/** DFS the induced subgraph; an edge to a node still on the recursion stack is a back-edge. */
function findBackEdges(members: string[], internal: GraphEdge[]): GraphEdge[] {
  const out = new Map<string, GraphEdge[]>();
  for (const m of members) out.set(m, []);
  for (const e of internal) out.get(e.from)?.push(e);
  for (const [node, list] of out)
    out.set(
      node,
      [...list].sort((a, b) => compare(a.to, b.to)),
    );

  const state = new Map<string, 'visiting' | 'done'>();
  const back: GraphEdge[] = [];

  const dfs = (u: string): void => {
    state.set(u, 'visiting');
    for (const e of out.get(u) ?? []) {
      const s = state.get(e.to);
      if (s === 'visiting') back.push(e);
      else if (s === undefined) dfs(e.to);
    }
    state.set(u, 'done');
  };

  for (const m of members) if (!state.has(m)) dfs(m);
  return back;
}

function compare(a: string | undefined, b: string | undefined): number {
  return (a ?? '') < (b ?? '') ? -1 : (a ?? '') > (b ?? '') ? 1 : 0;
}

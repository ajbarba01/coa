import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '@coa/shared';
import { findCycles } from './cycles.js';

const edge = (from: string, to: string): GraphEdge => ({
  from,
  to,
  type: 'depends-on',
  provenance: 'inferred',
});

describe('findCycles (retained-cycle model)', () => {
  it('finds no cycle in a DAG', () => {
    expect(findCycles([edge('a', 'b'), edge('b', 'c')])).toEqual([]);
  });

  it('reports a cycle as an SCC with the back-edge(s) to cut', () => {
    const components = findCycles([edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(components).toHaveLength(1);
    expect(components[0]?.members).toEqual(['a', 'b', 'c']);
    // exactly one back-edge breaks this 3-cycle
    expect(components[0]?.backEdges).toHaveLength(1);
    const back = components[0]?.backEdges[0];
    expect(back && [back.from, back.to]).toEqual(['c', 'a']);
  });

  it('retains every intra-cycle edge — the SCC is a view, nothing is deleted', () => {
    const edges = [edge('a', 'b'), edge('b', 'a')];
    const components = findCycles(edges);
    expect(components[0]?.members).toEqual(['a', 'b']);
    expect(edges).toHaveLength(2); // input untouched
  });

  it('separates independent cycles into distinct components', () => {
    const components = findCycles([
      edge('a', 'b'),
      edge('b', 'a'),
      edge('x', 'y'),
      edge('y', 'x'),
      edge('b', 'x'), // a bridge between the two 2-cycles, not part of either
    ]);
    expect(components.map((c) => c.members)).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ]);
  });

  it('detects a self-loop as a cycle', () => {
    const components = findCycles([edge('a', 'a')]);
    expect(components[0]?.members).toEqual(['a']);
  });

  it('only follows structural dependency edges', () => {
    const govCycle: GraphEdge[] = [
      { from: 'p', to: 'q', type: 'governed-by', provenance: 'declared' },
      { from: 'q', to: 'p', type: 'documents', provenance: 'declared' },
    ];
    expect(findCycles(govCycle)).toEqual([]);
  });
});

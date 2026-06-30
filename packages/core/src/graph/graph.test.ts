import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '@coa/shared';
import { TypedGraph } from './graph.js';

const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from,
  to,
  type: 'depends-on',
  provenance: 'declared',
  ...over,
});

describe('TypedGraph', () => {
  it('records edges and answers dependency reads both ways', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('a', 'b'));
    g.applyEdge(edge('b', 'c'));
    expect(g.dependencies('a')).toEqual(['b']);
    expect(g.dependents('c')).toEqual(['b']);
    expect(g.hasNode('c')).toBe(true);
    expect(g.hasNode('z')).toBe(false);
  });

  it('rejects a declared edge that would close a cycle (declared layer is a DAG)', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('a', 'b'));
    g.applyEdge(edge('b', 'c'));
    expect(g.wouldCreateCycle(edge('c', 'a'))).toBe(true);
    expect(() => g.applyEdge(edge('c', 'a'))).toThrow();
    // the rejected edge left no trace
    expect(g.dependencies('c')).toEqual([]);
  });

  it('does not cycle-reject inferred structural edges (GRF-1 retention is a later batch)', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('a', 'b', { provenance: 'inferred' }));
    g.applyEdge(edge('b', 'a', { provenance: 'inferred' }));
    expect(g.wouldCreateCycle(edge('b', 'a', { provenance: 'inferred' }))).toBe(false);
    expect(g.dependents('a')).toEqual(['b']);
  });

  it('retracts an edge', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('a', 'b'));
    g.retractEdge('a', 'b', 'depends-on');
    expect(g.dependencies('a')).toEqual([]);
  });

  it('reports an edge provenance', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('a', 'b', { provenance: 'gated' }));
    expect(g.provenanceOf('a', 'b', 'depends-on')).toBe('gated');
  });

  it('lists every governed-by edge as referrer ⇒ constraint, excluding other edge types', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('docA', 'no-raw-sql', { type: 'governed-by' }));
    g.applyEdge(edge('docB', 'no-raw-sql', { type: 'governed-by' }));
    g.applyEdge(edge('docA', 'mod', { type: 'depends-on' }));
    expect(g.governedByEdges().map((e) => [e.from, e.to])).toEqual([
      ['docA', 'no-raw-sql'],
      ['docB', 'no-raw-sql'],
    ]);
  });

  it('drops a governed-by edge from the listing once it is retracted', () => {
    const g = new TypedGraph();
    g.applyEdge(edge('docA', 'no-raw-sql', { type: 'governed-by' }));
    g.retractEdge('docA', 'no-raw-sql', 'governed-by');
    expect(g.governedByEdges()).toEqual([]);
  });
});

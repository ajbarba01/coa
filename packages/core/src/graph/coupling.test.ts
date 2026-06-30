import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '@coa/shared';
import { computeCoupling } from './coupling.js';

const call = (from: string, to: string, weight?: number): GraphEdge => ({
  from,
  to,
  type: 'calls',
  provenance: 'inferred',
  ...(weight !== undefined ? { weight } : {}),
});

describe('computeCoupling (GRF-4 typed/weighted fan)', () => {
  const edges: GraphEdge[] = [
    call('A', 'B', 3),
    call('A', 'C'),
    { from: 'A', to: 'D', type: 'inherits', provenance: 'inferred' },
    call('E', 'A'),
    { from: 'A', to: 'X', type: 'depends-on', provenance: 'inferred' }, // module-tier, not coupling
  ];

  it('reports the cheap deterministic counts over calls/inherits only', () => {
    const fan = computeCoupling('A', edges);
    expect(fan.fanOut).toBe(3); // B, C, D
    expect(fan.fanIn).toBe(1); // E
    expect(fan.cbo).toBe(4); // B, C, D, E
  });

  it('carries the typed, weighted outgoing fan (default weight 1)', () => {
    const fan = computeCoupling('A', edges);
    const toB = fan.outgoing.find((o) => o.to === 'B');
    const toC = fan.outgoing.find((o) => o.to === 'C');
    expect(toB?.weight).toBe(3);
    expect(toC?.weight).toBe(1);
    expect(fan.outgoing.some((o) => o.to === 'X')).toBe(false); // depends-on excluded
  });

  it('carries incoming callers', () => {
    expect(computeCoupling('A', edges).incoming.map((i) => i.from)).toEqual(['E']);
  });

  it('is empty for an uncoupled node', () => {
    const fan = computeCoupling('Z', edges);
    expect(fan).toEqual({ node: 'Z', fanOut: 0, fanIn: 0, cbo: 0, outgoing: [], incoming: [] });
  });
});

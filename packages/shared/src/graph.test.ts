import { describe, expect, it } from 'vitest';
import { graphEdgeSchema, symbolRecordSchema } from './graph.js';

describe('graphEdgeSchema', () => {
  it('accepts an edge with provenance, weight, and an inScc marker (GRF-1/3/4)', () => {
    const edge = {
      from: 'a',
      to: 'b',
      type: 'calls' as const,
      provenance: 'convention' as const,
      weight: 3,
      inScc: 'scc-7',
    };
    expect(graphEdgeSchema.parse(edge)).toEqual(edge);
  });

  it('rejects an unknown edge type and an unknown provenance', () => {
    const ok = { from: 'a', to: 'b', type: 'imports' as const, provenance: 'inferred' as const };
    expect(graphEdgeSchema.parse(ok)).toMatchObject({ type: 'imports' });
    expect(graphEdgeSchema.safeParse({ ...ok, type: 'teleports' }).success).toBe(false);
    expect(graphEdgeSchema.safeParse({ ...ok, provenance: 'vibes' }).success).toBe(false);
  });
});

describe('symbolRecordSchema', () => {
  it('accepts a minimal record and a fully-specified one', () => {
    expect(symbolRecordSchema.parse({ name: 'foo', definedIn: 'src/a.ts' }).name).toBe('foo');
    const full = {
      name: 'capturePayment',
      signature: '(id: string) => Promise<void>',
      definedIn: 'src/pay.ts',
      scope: 'payments',
      kind: 'function',
      generated: false,
    };
    expect(symbolRecordSchema.parse(full)).toEqual(full);
  });
});

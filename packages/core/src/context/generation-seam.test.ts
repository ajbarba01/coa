import { describe, expect, it } from 'vitest';
import type { GraphEdge, SymbolRecord } from '@coa/shared';
import type { GenerationRelation, GenerationRunner, RegenOutput } from './ssot-constraint.js';
import {
  publishGenerationSeam,
  type SeamPublisher,
  type SymbolExtractor,
} from './generation-seam.js';

const rel = (over: Partial<GenerationRelation> = {}): GenerationRelation => ({
  name: 'api-types',
  source: 'openapi.yaml',
  target: 'src/api.ts',
  lang: 'typescript',
  ...over,
});

const sym = (name: string): SymbolRecord => ({ name, definedIn: '1:1', kind: 'type' });

function runner(outputs: Record<string, RegenOutput>): GenerationRunner {
  return {
    regenerate: (relation) => outputs[relation.name] ?? { kind: 'text', bytes: '' },
    readTarget: () => '',
  };
}

function recorder(): {
  publisher: SeamPublisher;
  declared: { symbols: SymbolRecord[]; from: string }[];
  edges: GraphEdge[];
} {
  const declared: { symbols: SymbolRecord[]; from: string }[] = [];
  const edges: GraphEdge[] = [];
  return {
    publisher: {
      declareSymbols: (symbols, from) => {
        declared.push({ symbols, from });
      },
      assertEdge: (edge) => {
        edges.push(edge);
      },
    },
    declared,
    edges,
  };
}

const extractFrom =
  (table: Record<string, string[]>): SymbolExtractor =>
  (relation) =>
    (table[relation.name] ?? []).map(sym);

describe('publishGenerationSeam — the L-GEN→L-GND seam (declared_symbols + generated-from)', () => {
  it('declares the generated symbols under the target so the existence tier no longer false-misses them', () => {
    const { publisher, declared } = recorder();
    const seam = publishGenerationSeam(
      [rel()],
      runner({ 'api-types': { kind: 'text', bytes: '...' } }),
      extractFrom({ 'api-types': ['Pet', 'Order'] }),
      publisher,
    );
    expect(declared).toHaveLength(1);
    expect(declared[0]?.from).toBe('src/api.ts');
    expect(declared[0]?.symbols.map((s) => s.name)).toEqual(['Pet', 'Order']);
    expect([...seam.declaredSymbols]).toEqual(['Pet', 'Order']);
  });

  it('marks every declared symbol as generated', () => {
    const { publisher, declared } = recorder();
    publishGenerationSeam(
      [rel()],
      runner({ 'api-types': { kind: 'text', bytes: '...' } }),
      extractFrom({ 'api-types': ['Pet'] }),
      publisher,
    );
    expect(declared[0]?.symbols.every((s) => s.generated === true)).toBe(true);
  });

  it('records a generated-from edge from the target to its source', () => {
    const { publisher, edges } = recorder();
    publishGenerationSeam(
      [rel()],
      runner({ 'api-types': { kind: 'text', bytes: '...' } }),
      extractFrom({ 'api-types': ['Pet'] }),
      publisher,
    );
    expect(edges).toEqual([
      { from: 'src/api.ts', to: 'openapi.yaml', type: 'generated-from', provenance: 'declared' },
    ]);
  });

  it('records provenance but declares no symbols for binary/non-canonicalizable output', () => {
    const { publisher, declared, edges } = recorder();
    const seam = publishGenerationSeam(
      [rel()],
      runner({ 'api-types': { kind: 'binary' } }),
      extractFrom({ 'api-types': ['Pet'] }),
      publisher,
    );
    expect(declared).toEqual([]);
    expect(seam.declaredSymbols.size).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe('generated-from');
  });

  it('declares no symbols when extraction yields none, but still records provenance', () => {
    const { publisher, declared, edges } = recorder();
    publishGenerationSeam(
      [rel()],
      runner({ 'api-types': { kind: 'text', bytes: '' } }),
      extractFrom({ 'api-types': [] }),
      publisher,
    );
    expect(declared).toEqual([]);
    expect(edges).toHaveLength(1);
  });

  it('unions declared symbols across all relations', () => {
    const { publisher } = recorder();
    const seam = publishGenerationSeam(
      [rel({ name: 'a', target: 'a.ts' }), rel({ name: 'b', target: 'b.ts' })],
      runner({ a: { kind: 'text', bytes: 'x' }, b: { kind: 'text', bytes: 'y' } }),
      extractFrom({ a: ['Foo'], b: ['Bar'] }),
      publisher,
    );
    expect([...seam.declaredSymbols].sort()).toEqual(['Bar', 'Foo']);
  });
});

import { describe, expect, it } from 'vitest';
import type { Piece } from '@coa/shared';
import { TypedGraph } from './graph.js';
import { PieceStore, resolvePiece } from './resolve-piece.js';

const piece = (name: string, over: Partial<Piece> = {}): Piece => ({
  name,
  description: '',
  body: '',
  axes: { delivery: 'pull', salience: 'never', provenance: 'authored' },
  ...over,
});

describe('resolvePiece', () => {
  it('resolves a registered piece by ref', () => {
    const store = new PieceStore();
    store.register(piece('guide', { body: 'hello' }));
    const graph = new TypedGraph();
    expect(resolvePiece('guide', { store, graph }).body).toBe('hello');
  });

  it('merges governed-by authority edges from the graph (TAX-2)', () => {
    const store = new PieceStore();
    store.register(piece('guide'));
    const graph = new TypedGraph();
    graph.applyEdge({
      from: 'guide',
      to: 'no-secrets',
      type: 'governed-by',
      provenance: 'declared',
    });
    expect(resolvePiece('guide', { store, graph }).governedBy).toContain('no-secrets');
  });

  it('is byte-identical regardless of caller (a pure function of its inputs)', () => {
    const store = new PieceStore();
    store.register(piece('guide', { body: 'x' }));
    const graph = new TypedGraph();
    expect(resolvePiece('guide', { store, graph })).toEqual(
      resolvePiece('guide', { store, graph }),
    );
  });

  it('throws on an unknown ref', () => {
    expect(() =>
      resolvePiece('nope', { store: new PieceStore(), graph: new TypedGraph() }),
    ).toThrow();
  });
});

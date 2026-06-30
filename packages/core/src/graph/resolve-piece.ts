import type { Piece, PieceRef } from '@coa/shared';
import type { TypedGraph } from './graph.js';

/** The resident store of compiled {@link Piece}s, keyed by name (the piece node id). */
export class PieceStore {
  private readonly pieces = new Map<string, Piece>();

  register(piece: Piece): void {
    this.pieces.set(piece.name, piece);
  }

  get(name: string): Piece | undefined {
    return this.pieces.get(name);
  }
}

/**
 * The pure piece-resolver (D101): byte-identical output regardless of caller (the
 * workbench's `get_piece` tool and the config compiler call the same resolver),
 * which is why it reads M1's own store + graph. It augments the piece's authored
 * `governedBy` with any `governed-by` authority edges (TAX-2) recorded in the
 * graph for the piece node.
 */
export function resolvePiece(ref: PieceRef, deps: { store: PieceStore; graph: TypedGraph }): Piece {
  const piece = deps.store.get(ref);
  if (!piece) throw new Error(`piece not found: ${ref}`);

  const fromGraph = deps.graph
    .outEdges(ref)
    .filter((e) => e.type === 'governed-by')
    .map((e) => e.to);
  const governedBy = [...new Set([...(piece.governedBy ?? []), ...fromGraph])];

  return governedBy.length > 0 ? { ...piece, governedBy } : piece;
}

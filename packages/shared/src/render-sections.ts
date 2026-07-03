import type { Piece } from './piece.js';
import { SLOTS } from './slots.js';

/** Render ordered Pieces into the DC-6 section skeleton: each non-empty slot as its header followed by that
 *  slot's Piece bodies (blank-line separated), slots in SLOTS order, then any unslotted Pieces last with no
 *  header. Pure + deterministic (byte-stable for identical input → cache-safe). Within a slot, Pieces keep
 *  their incoming order. */
export function renderSections(pieces: readonly Piece[]): string {
  const known = new Set<string>(SLOTS.map((s) => s.id));
  const blocks: string[] = [];
  for (const slot of SLOTS) {
    const bodies = pieces.filter((piece) => piece.slot === slot.id).map((piece) => piece.body);
    if (bodies.length > 0) blocks.push([slot.header, bodies.join('\n\n')].join('\n\n'));
  }
  const endBucket = pieces
    .filter((piece) => piece.slot === undefined || !known.has(piece.slot))
    .map((piece) => piece.body);
  if (endBucket.length > 0) blocks.push(endBucket.join('\n\n'));
  return blocks.join('\n\n');
}

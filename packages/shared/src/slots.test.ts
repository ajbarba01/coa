import { describe, expect, it } from 'vitest';
import { SLOTS, slotIdSchema } from './slots.js';
import { pieceSchema } from './piece.js';

describe('SLOTS', () => {
  it('is the DC-6 order with markdown headers', () => {
    expect(SLOTS.map((s) => s.id)).toEqual([
      'identity',
      'model',
      'tone',
      'tool-use',
      'code-discipline',
      'governance',
      'roles',
      'project',
      'volatile',
    ]);
    for (const s of SLOTS) expect(s.header.startsWith('## ')).toBe(true);
  });
  it('validates a known slot and rejects an unknown one', () => {
    expect(slotIdSchema.safeParse('identity').success).toBe(true);
    expect(slotIdSchema.safeParse('nope').success).toBe(false);
  });
  it('accepts a Piece with a slot and one without', () => {
    const base = {
      name: 'n',
      description: 'd',
      body: 'b',
      axes: { delivery: 'push', salience: 'never', provenance: 'authored' },
    } as const;
    expect(pieceSchema.safeParse({ ...base, slot: 'identity' }).success).toBe(true);
    expect(pieceSchema.safeParse(base).success).toBe(true);
  });
});

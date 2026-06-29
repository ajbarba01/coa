import { describe, expect, it } from 'vitest';
import { pieceSchema } from './piece.js';

describe('pieceSchema', () => {
  it('accepts a vanilla skill (the empty-config defaults)', () => {
    const vanilla = {
      name: 'redact',
      description: 'redact secrets from a string',
      body: '# Redact\n…',
      axes: {
        delivery: 'pull' as const,
        salience: 'never' as const,
        provenance: 'authored' as const,
      },
    };
    const parsed = pieceSchema.parse(vanilla);
    expect(parsed.axes).toEqual({ delivery: 'pull', salience: 'never', provenance: 'authored' });
    expect(parsed.governedBy).toBeUndefined();
  });

  it('accepts a salience cadence and a governed-by link', () => {
    const piece = {
      name: 'commit-style',
      description: 'subject-only conventional commits',
      body: '…',
      axes: {
        delivery: 'push' as const,
        salience: { cadenceTokens: 4000 },
        provenance: 'authored' as const,
      },
      governedBy: ['constraint:commit-subject'],
    };
    expect(pieceSchema.parse(piece).axes.salience).toEqual({ cadenceTokens: 4000 });
  });

  it('rejects an unknown delivery axis value', () => {
    const bad = {
      name: 'x',
      description: 'y',
      body: 'z',
      axes: { delivery: 'shove', salience: 'never', provenance: 'authored' },
    };
    expect(pieceSchema.safeParse(bad).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import type { Piece, SymbolRecord } from '@coa/shared';
import { findReferences, getPiece, getSymbol, outline, type RetrieveDeps } from './retrieve.js';

const userName: SymbolRecord = { name: 'userName', definedIn: 'src/u.ts', signature: 'string' };

const piece: Piece = {
  name: 'house-style',
  description: 'the rules',
  body: 'always X',
  axes: { delivery: 'pull', salience: 'never', authority: 'advisory', lifecycle: 'reference' },
};

const deps = (over: Partial<RetrieveDeps> = {}): RetrieveDeps => ({
  worktreeRoot: '/repo',
  lookupSymbol: (name) => (name === 'userName' ? userName : undefined),
  outline: (path) => (path === 'src/u.ts' ? [userName] : []),
  references: (symbol) => (symbol === 'userName' ? ['src/a.ts', 'src/b.ts'] : []),
  resolvePiece: (ref) => (ref === 'house-style' ? piece : undefined),
  ...over,
});

describe('getSymbol', () => {
  it('returns the distilled symbol record for a known name', () => {
    const out = getSymbol({ name: 'userName' }, deps());
    expect(out.result).toEqual({ found: true, symbol: userName });
    expect(out.pointer).toBe('src/u.ts');
  });

  it('returns not-found for an unknown symbol', () => {
    const out = getSymbol({ name: 'nope' }, deps());
    expect(out.result).toMatchObject({ found: false });
  });

  it('rejects a path-bearing ref that escapes the worktree', () => {
    const out = getSymbol({ path: '../../etc/passwd', symbol: 'x' }, deps());
    expect(out.result).toEqual({ found: false, reason: 'path-escape' });
  });
});

describe('findReferences', () => {
  it('returns the reference sites of a symbol', () => {
    const out = findReferences({ symbol: 'userName' }, deps());
    expect(out.result).toEqual({ symbol: 'userName', sites: ['src/a.ts', 'src/b.ts'] });
  });
});

describe('outline', () => {
  it("returns the file's structural symbols", () => {
    const out = outline({ path: 'src/u.ts' }, deps());
    expect(out.result).toEqual({ path: 'src/u.ts', symbols: [userName] });
  });
});

describe('getPiece', () => {
  it('resolves a reference Piece on demand', () => {
    const out = getPiece({ ref: 'house-style' }, deps());
    expect(out.result).toEqual({ found: true, piece });
  });

  it('returns not-found for an unknown Piece ref', () => {
    const out = getPiece({ ref: 'ghost' }, deps());
    expect(out.result).toEqual({ found: false });
  });
});

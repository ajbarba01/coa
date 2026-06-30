import { describe, expect, it } from 'vitest';
import { reparseSymbols } from './reparse.js';

describe('reparseSymbols (the M1→M2 driving seam)', () => {
  it('drives M2 and qualifies the byte-local location with the file path', () => {
    const symbols = reparseSymbols({
      path: 'src/charge.ts',
      lang: 'typescript',
      bytes: 'function add(a: number) {}',
    });
    const add = symbols.find((s) => s.name === 'add');
    expect(add?.kind).toBe('function');
    expect(add?.definedIn).toMatch(/^src\/charge\.ts:\d+:\d+$/);
  });

  it('yields no symbols for an ungrammared file (Tier-0 floor)', () => {
    expect(reparseSymbols({ path: 'notes.txt', lang: 'plain', bytes: 'just prose' })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { symbolRecordSchema, type SymbolRecord } from '@coa/shared';
import { parse, type SourceFile } from './parser.js';
import type { CST } from '@coa/shared';
import { extractSymbols } from './extract-symbols.js';

const cstOf = (file: SourceFile): CST => {
  const r = parse(file);
  if ('ok' in r && r.ok === false) throw new Error('parse failed');
  return r;
};

const SAMPLE = `function add(a: number, b: number): number {
  return a + b;
}
class Foo extends Bar {
  field: string = "x";
  method(n: number): void {}
}
interface Shape { area(): number; }
type ID = string;
enum Color { Red, Green }
const arrow = (x: number) => x * 2;
let y = 5;
`;

describe('extractSymbols', () => {
  const symbols = extractSymbols(cstOf({ lang: 'typescript', bytes: SAMPLE }));
  const by = (name: string): SymbolRecord | undefined => symbols.find((s) => s.name === name);

  it('emits schema-valid records', () => {
    for (const s of symbols) expect(symbolRecordSchema.parse(s)).toBeTruthy();
  });

  it('extracts top-level declarations with their kinds', () => {
    expect(by('add')?.kind).toBe('function');
    expect(by('Foo')?.kind).toBe('class');
    expect(by('Shape')?.kind).toBe('interface');
    expect(by('ID')?.kind).toBe('type');
    expect(by('Color')?.kind).toBe('enum');
    expect(by('y')?.kind).toBe('variable');
  });

  it('treats a const bound to an arrow/function as a callable', () => {
    expect(by('arrow')?.kind).toBe('function');
    expect(by('arrow')?.signature).toContain('(x: number)');
  });

  it('extracts class members and qualifies their scope', () => {
    expect(by('method')?.kind).toBe('method');
    expect(by('method')?.scope).toBe('Foo');
  });

  it('captures a callable signature where the grammar affords it', () => {
    expect(by('add')?.signature).toContain('(a: number, b: number)');
    expect(by('add')?.signature).toContain('number');
  });

  it('records an in-file definition location (no path — the spine qualifies it)', () => {
    expect(by('add')?.definedIn).toMatch(/^\d+:\d+$/);
    // `add` is declared on line 1.
    expect(by('add')?.definedIn?.startsWith('1:')).toBe(true);
  });

  it('returns no symbols for the Tier-0 floor (ungrammared) CST', () => {
    expect(extractSymbols(cstOf({ lang: 'plain', bytes: 'just some prose\n' }))).toEqual([]);
  });
});

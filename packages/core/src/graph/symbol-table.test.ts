import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '@coa/shared';
import { SymbolTable } from './symbol-table.js';

const sym = (name: string, definedIn: string): SymbolRecord => ({
  name,
  definedIn,
  kind: 'function',
});

describe('SymbolTable', () => {
  it('indexes per-file records and looks them up by name', () => {
    const table = new SymbolTable();
    table.indexFile('a.ts', [sym('foo', 'a.ts:1:1'), sym('bar', 'a.ts:5:1')]);
    expect(table.lookup('foo')?.definedIn).toBe('a.ts:1:1');
    expect(table.lookup('missing')).toBeUndefined();
  });

  it('replaces a file’s symbols on reparse (no stale names linger)', () => {
    const table = new SymbolTable();
    table.indexFile('a.ts', [sym('foo', 'a.ts:1:1')]);
    table.indexFile('a.ts', [sym('renamed', 'a.ts:1:1')]);
    expect(table.lookup('foo')).toBeUndefined();
    expect(table.lookup('renamed')?.definedIn).toBe('a.ts:1:1');
  });

  it('keeps symbols from distinct files independent', () => {
    const table = new SymbolTable();
    table.indexFile('a.ts', [sym('foo', 'a.ts:1:1')]);
    table.indexFile('b.ts', [sym('baz', 'b.ts:1:1')]);
    table.removeFile('a.ts');
    expect(table.lookup('foo')).toBeUndefined();
    expect(table.lookup('baz')?.definedIn).toBe('b.ts:1:1');
    expect(table.names()).toEqual(['baz']);
  });
});

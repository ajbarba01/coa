import { describe, expect, it } from 'vitest';
import { cstSchema } from '@coa/shared';
import { parse } from './parser.js';
import type { SerializedNode } from './cst.js';

const ok = <T extends { lang: string }>(r: T | { ok: false }): T => {
  if ('ok' in r && r.ok === false) throw new Error('expected a CST, got a parse failure');
  return r as T;
};

describe('parse', () => {
  it('parses TypeScript into a schema-valid, serializable CST', () => {
    const cst = ok(parse({ lang: 'typescript', bytes: 'function add(a: number) { return a; }' }));
    expect(cstSchema.parse(cst)).toBeTruthy();
    expect(cst.lang).toBe('typescript');
    // The tree survives a JSON round-trip (it crosses the parser process boundary).
    expect(JSON.parse(JSON.stringify(cst.tree))).toEqual(cst.tree);
  });

  it('produces a concrete tree the pure extractors can walk without the addon', () => {
    const cst = ok(parse({ lang: 'typescript', bytes: 'const x = 1;' }));
    const root = cst.tree as SerializedNode;
    expect(root.type).toBe('program');
    expect(root.children.length).toBeGreaterThan(0);
    expect(typeof root.text).toBe('string');
  });

  it('hashes the input bytes (same bytes -> same hash; different -> different)', () => {
    const a = ok(parse({ lang: 'typescript', bytes: 'const x = 1;' }));
    const b = ok(parse({ lang: 'typescript', bytes: 'const x = 1;' }));
    const c = ok(parse({ lang: 'typescript', bytes: 'const x = 2;' }));
    expect(a.bytesHash).toBe(b.bytesHash);
    expect(a.bytesHash).not.toBe(c.bytesHash);
    expect(a.bytesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never throws on malformed source — returns an error-tolerant CST', () => {
    const cst = ok(parse({ lang: 'typescript', bytes: 'function broken( {' }));
    expect((cst.tree as SerializedNode).type).toBe('program');
  });

  it('returns a degenerate single-node floor CST for an ungrammared language', () => {
    const cst = ok(parse({ lang: 'gdscript', bytes: 'extends Node\nfunc _ready():\n\tpass\n' }));
    const root = cst.tree as SerializedNode;
    expect(root.children).toEqual([]);
    expect(root.text).toBe('extends Node\nfunc _ready():\n\tpass\n');
    expect(root.endPosition.row).toBe(3);
  });
});

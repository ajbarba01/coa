import { describe, expect, it } from 'vitest';
import { parse } from '@coa/code-intel';
import type { CST } from '@coa/shared';
import { extractImports } from './extract-imports.js';

const cstOf = (bytes: string): CST => {
  const r = parse({ lang: 'typescript', bytes });
  if ('ok' in r) throw new Error('parse failed');
  return r;
};

describe('extractImports (the tree-sitter import-graph floor)', () => {
  it('emits inferred import edges for static imports and re-exports', () => {
    const cst = cstOf("import { x } from './b';\nimport 'side-effect';\nexport { y } from './c';");
    const edges = extractImports(cst, 'src/a.ts', (spec) => spec);
    expect(edges).toEqual([
      { from: 'src/a.ts', to: './b', type: 'imports', provenance: 'inferred' },
      { from: 'src/a.ts', to: 'side-effect', type: 'imports', provenance: 'inferred' },
      { from: 'src/a.ts', to: './c', type: 'imports', provenance: 'inferred' },
    ]);
  });

  it('resolves specifiers through the provided resolver', () => {
    const cst = cstOf("import { x } from './b';");
    const edges = extractImports(cst, 'src/a.ts', (spec, from) => `resolved:${from}:${spec}`);
    expect(edges[0]?.to).toBe('resolved:src/a.ts:./b');
  });

  it('returns nothing for a file with no imports', () => {
    expect(extractImports(cstOf('const x = 1;'), 'a.ts', (s) => s)).toEqual([]);
  });
});

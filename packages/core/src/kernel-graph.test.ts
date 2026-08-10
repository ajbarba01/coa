import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChangeKernel } from './kernel.js';
import type { ConventionExtractor } from './graph/conventions.js';

let dir: string;
let kernel: ChangeKernel;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-kg-'));
  kernel = new ChangeKernel({ walPath: join(dir, 'log.ndjson'), worktree: 'main' });
});
afterEach(() => {
  kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ChangeKernel graph views', () => {
  it('builds the inferred import graph and detects a cycle', () => {
    kernel.indexFile('a.ts', 'typescript', "import './b';");
    kernel.indexFile('b.ts', 'typescript', "import './a';");
    const cycles = kernel.graph.cycles();
    expect(cycles[0]?.members).toEqual(['a.ts', 'b.ts']);
    expect(cycles[0]?.backEdges).toHaveLength(1);
  });

  it('serves the coupling fan over weighted calls edges', () => {
    // weight is a derived health-only signal (it has no WAL edge-frame field), so
    // it rides a convention extractor, not a declared assertEdge.
    kernel.registerExtractor({
      id: 'calls',
      ecosystem: 'test',
      extract: () => ({
        edges: [{ from: 'A', to: 'B', type: 'calls', provenance: 'convention', weight: 4 }],
        unresolved: [],
      }),
    });
    kernel.indexFile('c.ts', 'typescript', 'const x = 1;');
    const fan = kernel.graph.coupling('A');
    expect(fan.fanOut).toBe(1);
    expect(fan.outgoing[0]?.weight).toBe(4);
  });

  it('reports churn over the WAL', () => {
    kernel.emit(fileDraft('x.ts', 'h1'));
    kernel.emit({ ...fileDraft('x.ts', 'h2'), kind: 'modify', pre_hash: 'h1' });
    expect(kernel.temporal('x.ts').churn).toBe(2);
  });

  it('reports honest per-provenance coverage', () => {
    kernel.indexFile('a.ts', 'typescript', "import './b';\n// @generated\n");
    kernel.assertEdge({ from: 'a.ts', to: 'spec', type: 'documents', provenance: 'declared' });
    const coverage = kernel.coverage();
    expect(coverage.inferred).toBeGreaterThanOrEqual(1);
    expect(coverage.declared).toBeGreaterThanOrEqual(1);
    expect(coverage.unresolved).toBeGreaterThanOrEqual(1); // the bare @generated marker
  });

  it('runs a registered convention extractor on reparse', () => {
    const watches: ConventionExtractor = {
      id: 'watches',
      ecosystem: 'test',
      extract: (f) => ({
        edges: [{ from: f.path, to: 'observed', type: 'watches', provenance: 'convention' }],
        unresolved: [],
      }),
    };
    kernel.registerExtractor(watches);
    kernel.indexFile('w.ts', 'typescript', 'const x = 1;');
    expect(kernel.graph.outEdges('w.ts').some((e) => e.to === 'observed')).toBe(true);
  });

  it('connects NodeNext .js import specifiers to their .ts source (real-repo resolution)', () => {
    kernel.indexFile('src/a.ts', 'typescript', "import './b.js';");
    kernel.indexFile('src/b.ts', 'typescript', 'export const b = 1;');
    expect(kernel.graph.dependencies('src/a.ts')).toContain('src/b.ts');
  });

  it('clears a file’s stale derived edges on reparse', () => {
    kernel.indexFile('a.ts', 'typescript', "import './b';");
    kernel.indexFile('a.ts', 'typescript', 'const x = 1;'); // import removed
    expect(kernel.graph.outEdges('a.ts')).toEqual([]);
  });
});

const fileDraft = (path: string, postHash: string) => ({
  worktree: 'main',
  actor: 'reconciler' as const,
  op_id: null,
  provenance: 'inferred' as const,
  cause: null,
  kind: 'create' as const,
  path,
  pre_hash: null,
  post_hash: postHash,
  generated: false,
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeEvent, Piece } from '@coa/shared';
import { ChangeKernel } from './kernel.js';

let dir: string;
let walPath: string;
const kernels: ChangeKernel[] = [];
const open = (): ChangeKernel => {
  const k = new ChangeKernel({ walPath, worktree: 'main' });
  kernels.push(k);
  return k;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-kernel-'));
  walPath = join(dir, 'log.ndjson');
  kernels.length = 0;
});
afterEach(() => {
  for (const k of kernels) k.close();
  rmSync(dir, { recursive: true, force: true });
});

const piece = (name: string): Piece => ({
  name,
  description: '',
  body: name,
  axes: { delivery: 'pull', salience: 'never', provenance: 'authored' },
});

describe('ChangeKernel', () => {
  it('funnels every write through emit and assigns monotonic seqs', () => {
    const k = open();
    const s0 = k.emit({
      worktree: 'main',
      actor: 'reconciler',
      op_id: null,
      provenance: 'inferred',
      cause: null,
      kind: 'create',
      path: 'a.ts',
      pre_hash: null,
      post_hash: 'h1',
      generated: false,
    });
    const s1 = k.assertEdge({
      from: 'a.ts',
      to: 'b.ts',
      type: 'depends-on',
      provenance: 'declared',
    });
    expect(s0).toBe(0);
    expect(s1).toBe(1);
  });

  it('reports a WAL position that advances past the last applied seq (the freshness stamp)', () => {
    const k = open();
    expect(k.walPosition()).toBe(0);
    const seq = k.emit(fileDraft('a.ts', 'h1'));
    expect(k.walPosition()).toBe(seq + 1);
  });

  it('rejects a declared edge that would cycle the graph (no WAL write)', () => {
    const k = open();
    k.assertEdge({ from: 'a', to: 'b', type: 'depends-on', provenance: 'declared' });
    k.assertEdge({ from: 'b', to: 'c', type: 'depends-on', provenance: 'declared' });
    const before = k.read().length;
    expect(() =>
      k.assertEdge({ from: 'c', to: 'a', type: 'depends-on', provenance: 'declared' }),
    ).toThrow();
    expect(k.read().length).toBe(before); // the rejected edge never reached the log
    expect(k.graph.dependencies('c')).toEqual([]);
  });

  it('delivers replayed + live events to a subscriber from its cursor', () => {
    const k = open();
    k.emit(fileDraft('a.ts', 'h1'));
    const seen: ChangeEvent[] = [];
    k.subscribe(0, (e) => seen.push(e));
    k.emit(fileDraft('b.ts', 'h2'));
    expect(seen.map((e) => ('path' in e ? e.path : null))).toEqual(['a.ts', 'b.ts']);
  });

  it('indexes file symbols and serves lookup + fuzzy-on-miss', () => {
    const k = open();
    k.indexFile('src/charge.ts', 'typescript', 'export function capturePayment(id: string) {}');
    expect(k.lookup('capturePayment')?.definedIn).toContain('src/charge.ts');
    expect(k.lookup('capturePaymont')).toBeUndefined();
    expect(k.fuzzyMatch('capturePaymont')[0]?.symbol.name).toBe('capturePayment');
  });

  it('resolves a registered piece with its graph authority edges', () => {
    const k = open();
    k.registerPiece(piece('guide'));
    k.assertEdge({ from: 'guide', to: 'no-secrets', type: 'governed-by', provenance: 'declared' });
    expect(k.resolvePiece('guide').governedBy).toContain('no-secrets');
  });

  it('rebuilds graph + symbol projections from the WAL on restart', () => {
    const first = open();
    first.assertEdge({ from: 'a', to: 'b', type: 'depends-on', provenance: 'declared' });
    first.declareSymbols([{ name: 'genSym', definedIn: 'gen.ts:1:1' }], 'gen.ts');
    first.close();
    kernels.length = 0;

    const reopened = open();
    expect(reopened.graph.dependencies('a')).toEqual(['b']);
    expect(reopened.lookup('genSym')?.name).toBe('genSym');
  });

  it('records checkpoints on the timeline', () => {
    const k = open();
    k.emit(fileDraft('a.ts', 'h1'));
    const cp = k.checkpoint();
    expect(k.listTimeline().map((c) => c.id)).toContain(cp.id);
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

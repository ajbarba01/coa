import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '@coa/shared';
import type { ChangeEventDraft } from '../event.js';
import { applyPatch, editSymbol, type WorkbenchDeps } from './mutate.js';

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

interface Recorded {
  written: Record<string, string>;
  emitted: ChangeEventDraft[];
  reindexed: Record<string, string>;
  confirmed: string[];
}

function makeDeps(files: Record<string, string>): { deps: WorkbenchDeps; rec: Recorded } {
  const written: Record<string, string> = {};
  const emitted: ChangeEventDraft[] = [];
  const reindexed: Record<string, string> = {};
  const confirmed: string[] = [];
  let seq = 0;
  const deps: WorkbenchDeps = {
    worktreeRoot: '/repo',
    worktree: 'main',
    readFile: (abs) => {
      const rel = abs.replace('/repo/', '');
      const body = files[rel];
      if (body === undefined) throw new Error(`no such file: ${abs}`);
      return body;
    },
    writeFile: (abs, bytes) => {
      written[abs.replace('/repo/', '')] = bytes;
    },
    emit: (draft) => {
      emitted.push(draft);
      return seq++;
    },
    reindex: (rel, bytes) => {
      reindexed[rel] = bytes;
    },
    expectPrecise: (rel) => confirmed.push(rel),
  };
  return { deps, rec: { written, emitted, reindexed, confirmed } };
}

describe('editSymbol — producer ①', () => {
  it('applies the diff, writes the new bytes, and emits one modify change-event', () => {
    const { deps, rec } = makeDeps({ 'src/a.ts': 'export const x = 1;\n' });
    const response = editSymbol(
      {
        ref: { path: 'src/a.ts', symbol: 'x' },
        diff: { form: 'search-replace', hunks: [{ find: 'const x = 1', replace: 'const x = 2' }] },
      },
      deps,
    );

    expect(response.result).toEqual({ applied: true, path: 'src/a.ts', seq: 0 });
    expect(rec.written['src/a.ts']).toBe('export const x = 2;\n');
    expect(rec.emitted).toHaveLength(1);
    const event = rec.emitted[0] as Extract<ChangeEvent, { kind: 'modify' }>;
    expect(event.kind).toBe('modify');
    expect(event.path).toBe('src/a.ts');
    expect(event.actor).toBe('session');
    expect(event.pre_hash).toBe(sha256('export const x = 1;\n'));
    expect(event.post_hash).toBe(sha256('export const x = 2;\n'));
  });

  it('reindexes the new bytes and registers the precise op for confirm-dedup', () => {
    const { deps, rec } = makeDeps({ 'src/a.ts': 'export const x = 1;\n' });
    editSymbol(
      {
        ref: { path: 'src/a.ts' },
        diff: { form: 'search-replace', hunks: [{ find: 'const x = 1', replace: 'const x = 2' }] },
      },
      deps,
    );
    expect(rec.reindexed['src/a.ts']).toBe('export const x = 2;\n');
    expect(rec.confirmed).toEqual(['src/a.ts']);
  });

  it('rejects a ref that escapes the worktree without writing or emitting', () => {
    const { deps, rec } = makeDeps({ 'src/a.ts': 'export const x = 1;\n' });
    const response = editSymbol(
      {
        ref: { path: '../../etc/passwd' },
        diff: { form: 'whole-file', body: 'pwned\n' },
      },
      deps,
    );
    expect(response.result).toEqual({
      applied: false,
      error: { code: 'path-escape', message: expect.any(String) },
    });
    expect(rec.written).toEqual({});
    expect(rec.emitted).toEqual([]);
  });

  it('rejects an unmatched diff without writing or emitting', () => {
    const { deps, rec } = makeDeps({ 'src/a.ts': 'export const x = 1;\n' });
    const response = editSymbol(
      {
        ref: { path: 'src/a.ts' },
        diff: { form: 'search-replace', hunks: [{ find: 'const z = 9', replace: 'const z = 8' }] },
      },
      deps,
    );
    expect(response.result).toMatchObject({ applied: false, error: { code: 'diff-not-found' } });
    expect(rec.written).toEqual({});
    expect(rec.emitted).toEqual([]);
  });
});

describe('applyPatch — the whole-file / multi-hunk escape', () => {
  it('writes a whole-file body to the target and emits one modify change-event', () => {
    const { deps, rec } = makeDeps({ 'src/a.ts': 'old\n' });
    const response = applyPatch(
      { target: 'src/a.ts', diff: { form: 'whole-file', body: 'brand new\n' } },
      deps,
    );
    expect(response.result).toEqual({ applied: true, path: 'src/a.ts', seq: 0 });
    expect(rec.written['src/a.ts']).toBe('brand new\n');
    expect(rec.emitted).toHaveLength(1);
    expect((rec.emitted[0] as { kind: string }).kind).toBe('modify');
  });
});

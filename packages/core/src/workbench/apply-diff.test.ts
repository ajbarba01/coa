import { describe, expect, it } from 'vitest';
import type { DiffSpec } from '@coa/shared';
import { applyDiff } from './apply-diff.js';

describe('applyDiff — whole-file form', () => {
  it('replaces the entire source with the body verbatim', () => {
    const diff: DiffSpec = { form: 'whole-file', body: 'export const x = 2;\n' };
    const result = applyDiff('export const x = 1;\n', diff);
    expect(result).toEqual({ ok: true, bytes: 'export const x = 2;\n' });
  });
});

describe('applyDiff — search-replace form', () => {
  it('replaces an exactly-matched single hunk', () => {
    const diff: DiffSpec = {
      form: 'search-replace',
      hunks: [{ find: 'const x = 1', replace: 'const x = 2' }],
    };
    const result = applyDiff('export const x = 1;\n', diff);
    expect(result).toEqual({ ok: true, bytes: 'export const x = 2;\n' });
  });

  it('fails (never silently no-ops) when the find text is absent', () => {
    const diff: DiffSpec = {
      form: 'search-replace',
      hunks: [{ find: 'const y = 9', replace: 'const y = 10' }],
    };
    const result = applyDiff('export const x = 1;\n', diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('diff-not-found');
  });

  it('fails (never silently edits the first) when the find text is ambiguous', () => {
    const diff: DiffSpec = {
      form: 'search-replace',
      hunks: [{ find: 'a', replace: 'b' }],
    };
    const result = applyDiff('a = a;\n', diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('diff-ambiguous');
  });

  it('matches leniently despite indentation drift, preserving the source indentation', () => {
    const source = 'function f() {\n    return 1;\n}\n';
    const diff: DiffSpec = {
      form: 'search-replace',
      hunks: [{ find: 'return 1;', replace: 'return 2;' }],
    };
    const result = applyDiff(source, diff);
    expect(result).toEqual({ ok: true, bytes: 'function f() {\n    return 2;\n}\n' });
  });

  it('matches a multi-line block leniently and re-indents the replacement to the block', () => {
    const source = 'class C {\n  m() {\n    a();\n    b();\n  }\n}\n';
    const diff: DiffSpec = {
      form: 'search-replace',
      hunks: [{ find: 'a();\nb();', replace: 'a();\nc();' }],
    };
    const result = applyDiff(source, diff);
    expect(result).toEqual({ ok: true, bytes: 'class C {\n  m() {\n    a();\n    c();\n  }\n}\n' });
  });
});

describe('applyDiff — unified form (deferred)', () => {
  it('degrades to a typed unsupported-form error so the agent falls back', () => {
    const diff: DiffSpec = { form: 'unified', patch: '@@ -1 +1 @@\n-a\n+b\n' };
    const result = applyDiff('a\n', diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('diff-unsupported-form');
  });
});

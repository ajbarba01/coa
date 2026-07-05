import { describe, expect, it } from 'vitest';
import { parseEdit } from './ToolCard.js';

describe('parseEdit — Claude/base edits', () => {
  it('derives before/after from old_string/new_string', () => {
    expect(
      parseEdit('Edit', '{"file_path":"a.ts","old_string":"x","new_string":"y"}'),
    ).toEqual({ before: 'x', after: 'y' });
  });

  it('treats a Write content as an all-added diff (before empty)', () => {
    expect(parseEdit('Write', '{"file_path":"a.ts","content":"line1\\nline2"}')).toEqual({
      before: '',
      after: 'line1\nline2',
    });
  });

  it('is undefined for a non-edit / malformed input', () => {
    expect(parseEdit('Read', '{"file_path":"a.ts"}')).toBeUndefined();
    expect(parseEdit('Edit', 'not json')).toBeUndefined();
  });
});

describe('parseEdit — DiffSpec (edit_symbol / apply_patch)', () => {
  it('search-replace: joins hunk finds as before, replaces as after (verbatim, per hunk)', () => {
    const input = JSON.stringify({
      ref: { path: 'src/auth.ts', symbol: 'mint' },
      diff: {
        form: 'search-replace',
        hunks: [
          { find: 'const a = 1;', replace: 'const a = 2;' },
          { find: 'return a;', replace: 'return a + 1;' },
        ],
      },
    });
    expect(parseEdit('edit_symbol', input)).toEqual({
      before: 'const a = 1;\nreturn a;',
      after: 'const a = 2;\nreturn a + 1;',
    });
  });

  it('whole-file: before is empty, after is the body (all-added)', () => {
    const input = JSON.stringify({
      target: 'src/auth.ts',
      diff: { form: 'whole-file', body: 'export const x = 2;\n' },
    });
    expect(parseEdit('apply_patch', input)).toEqual({
      before: '',
      after: 'export const x = 2;\n',
    });
  });

  it('is undefined for the unified form (no clean before/after to derive)', () => {
    const input = JSON.stringify({
      target: 'a.ts',
      diff: { form: 'unified', patch: '@@ -1 +1 @@\n-a\n+b\n' },
    });
    expect(parseEdit('apply_patch', input)).toBeUndefined();
  });

  it('never throws and is undefined for a malformed diff', () => {
    expect(parseEdit('edit_symbol', '{"ref":{},"diff":42}')).toBeUndefined();
    expect(parseEdit('edit_symbol', 'not json')).toBeUndefined();
    expect(
      parseEdit('edit_symbol', '{"ref":{},"diff":{"form":"search-replace","hunks":"nope"}}'),
    ).toBeUndefined();
  });
});

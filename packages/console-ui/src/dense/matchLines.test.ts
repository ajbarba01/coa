import { describe, expect, it } from 'vitest';
import { parseMatchLine } from './matchLines.js';

describe('parseMatchLine — Grep', () => {
  it('parses path:line:text into a path, line and trailing text (verbatim)', () => {
    expect(parseMatchLine('Grep', 'src/auth.ts:31:  const next = mint(id);')).toEqual({
      path: 'src/auth.ts',
      line: 31,
      text: '  const next = mint(id);',
    });
  });

  it('parses path:line with no text', () => {
    expect(parseMatchLine('Grep', 'src/auth.ts:12')).toEqual({ path: 'src/auth.ts', line: 12 });
  });

  it('keeps colons that appear inside the match text', () => {
    expect(parseMatchLine('Grep', 'src/a.ts:9:key: value: more')).toEqual({
      path: 'src/a.ts',
      line: 9,
      text: 'key: value: more',
    });
  });

  it('handles a Windows drive-letter path (the first colon is not the separator)', () => {
    expect(parseMatchLine('Grep', 'C:\\repo\\a.ts:5:x')).toEqual({
      path: 'C:\\repo\\a.ts',
      line: 5,
      text: 'x',
    });
  });

  it('returns undefined for a Grep line with no line number', () => {
    expect(parseMatchLine('Grep', 'src/auth.ts')).toBeUndefined();
    expect(parseMatchLine('Grep', '')).toBeUndefined();
  });
});

describe('parseMatchLine — Glob', () => {
  it('parses a bare path (no line)', () => {
    expect(parseMatchLine('Glob', 'src/auth.test.ts')).toEqual({ path: 'src/auth.test.ts' });
  });

  it('returns undefined for an empty Glob line', () => {
    expect(parseMatchLine('Glob', '')).toBeUndefined();
    expect(parseMatchLine('Glob', '   ')).toBeUndefined();
  });
});

describe('parseMatchLine — robustness', () => {
  it('returns undefined for a non-search tool', () => {
    expect(parseMatchLine('Bash', 'src/a.ts:1:x')).toBeUndefined();
  });

  it('never throws', () => {
    expect(() => parseMatchLine('Grep', '::::')).not.toThrow();
  });
});

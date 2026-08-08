import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRipgrepOutput, ripgrepArgs, searchWithRipgrep } from './ripgrep.js';

describe('parseRipgrepOutput', () => {
  it('reads one path per line in files mode', () => {
    expect(parseRipgrepOutput('a.ts\nb.ts\n', 'files')).toEqual([
      { file: 'a.ts' },
      { file: 'b.ts' },
    ]);
  });

  it('splits file, line and text in content mode', () => {
    expect(parseRipgrepOutput('src/a.ts:12:const x = 1;\n', 'content')).toEqual([
      { file: 'src/a.ts', line: 12, text: 'const x = 1;' },
    ]);
  });

  it('keeps colons that belong to the matched text', () => {
    expect(parseRipgrepOutput('a.ts:3:url: https://x\n', 'content')).toEqual([
      { file: 'a.ts', line: 3, text: 'url: https://x' },
    ]);
  });

  it('normalizes Windows separators to POSIX', () => {
    expect(parseRipgrepOutput('src\\a.ts:1:x\n', 'content')).toEqual([
      { file: 'src/a.ts', line: 1, text: 'x' },
    ]);
    expect(parseRipgrepOutput('src\\a.ts\n', 'files')).toEqual([{ file: 'src/a.ts' }]);
  });

  it('degrades a line that does not carry a location to a file-only hit', () => {
    expect(parseRipgrepOutput('binary file matches\n', 'content')).toEqual([
      { file: 'binary file matches' },
    ]);
  });

  it('yields no hits for empty output (a spawn failure reads as "found nothing")', () => {
    expect(parseRipgrepOutput('', 'content')).toEqual([]);
    expect(parseRipgrepOutput('', 'files')).toEqual([]);
  });
});

describe('ripgrepArgs', () => {
  it('asks for line numbers in content mode and passes the pattern after --', () => {
    expect(ripgrepArgs({ pattern: '-x', baseAbsolute: '/w', mode: 'content' })).toEqual([
      '--line-number',
      '--',
      '-x',
      '/w',
    ]);
  });

  it('asks for file names only in files mode and forwards a glob filter', () => {
    expect(ripgrepArgs({ pattern: 'x', baseAbsolute: '/w', glob: '*.ts', mode: 'files' })).toEqual([
      '--files-with-matches',
      '--glob',
      '*.ts',
      '--',
      'x',
      '/w',
    ]);
  });
});

describe('searchWithRipgrep — the bundled binary', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coa-ripgrep-'));
    writeFileSync(join(root, 'a.ts'), 'const needle = 1;\n');
    writeFileSync(join(root, 'b.md'), 'needle\n');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns located hits in content mode', () => {
    const hits = searchWithRipgrep({ pattern: 'needle', baseAbsolute: root, mode: 'content' });
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.line === 1)).toBe(true);
    expect(hits.some((h) => h.file.endsWith('a.ts') && h.text === 'const needle = 1;')).toBe(true);
  });

  it('honors the glob filter in files mode', () => {
    const hits = searchWithRipgrep({
      pattern: 'needle',
      baseAbsolute: root,
      glob: '*.ts',
      mode: 'files',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file.endsWith('a.ts')).toBe(true);
    expect(hits[0]?.line).toBeUndefined();
  });

  it('returns no hits rather than throwing when nothing matches', () => {
    expect(searchWithRipgrep({ pattern: 'nope', baseAbsolute: root, mode: 'content' })).toEqual([]);
  });
});

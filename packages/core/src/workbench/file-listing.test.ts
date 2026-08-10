import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitignoreToIgnoreGlobs, listFilesFor } from './file-listing.js';

describe('gitignoreToIgnoreGlobs', () => {
  it('drops comments and blank lines', () => {
    expect(gitignoreToIgnoreGlobs(['# a comment', '', '   '])).toEqual([]);
  });

  it('translates a bare directory name to a recursive ignore', () => {
    expect(gitignoreToIgnoreGlobs(['node_modules'])).toEqual(['**/node_modules/**']);
  });

  it('translates a trailing-slash directory name to a recursive ignore', () => {
    expect(gitignoreToIgnoreGlobs(['dist/'])).toEqual(['**/dist/**']);
  });

  it('translates a leading-slash (root-anchored) entry to a root-relative glob', () => {
    expect(gitignoreToIgnoreGlobs(['/build'])).toEqual(['build/**']);
  });

  it('leaves an extension-style pattern as-is', () => {
    expect(gitignoreToIgnoreGlobs(['*.log'])).toEqual(['*.log']);
  });
});

describe('listFilesFor', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'coa-listfiles-'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), '');
    mkdirSync(join(root, '.git'), { recursive: true });
    writeFileSync(join(root, '.git', 'HEAD'), '');
    writeFileSync(join(root, 'a.ts'), '');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('always excludes node_modules and .git even with no .gitignore', () => {
    const matches = listFilesFor('**/*', root);
    expect(matches.some((m) => m.includes('node_modules'))).toBe(false);
    expect(matches.some((m) => m.includes('.git'))).toBe(false);
    expect(matches.some((m) => m.endsWith('a.ts'))).toBe(true);
  });

  it('also excludes paths matched by the worktree .gitignore', () => {
    writeFileSync(join(root, '.gitignore'), 'dist\n');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'out.js'), '');
    const matches = listFilesFor('**/*', root);
    expect(matches.some((m) => m.includes('dist'))).toBe(false);
    expect(matches.some((m) => m.endsWith('a.ts'))).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { importCandidates, resolveImportSpecifier } from './resolve-import.js';

const none = (): boolean => false;
const known =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p);

describe('resolveImportSpecifier (floor module resolution)', () => {
  it('leaves a bare specifier as an external node', () => {
    expect(resolveImportSpecifier('react', 'src/a.ts', none)).toBe('react');
    expect(resolveImportSpecifier('@coa/shared', 'src/a.ts', none)).toBe('@coa/shared');
  });

  it('rewrites a NodeNext .js specifier to its .ts source by default', () => {
    expect(resolveImportSpecifier('./b.js', 'src/a.ts', none)).toBe('src/b.ts');
    expect(resolveImportSpecifier('./b.mjs', 'src/a.ts', none)).toBe('src/b.mts');
  });

  it('prefers an actually-indexed candidate over the default guess', () => {
    expect(resolveImportSpecifier('./b.js', 'src/a.ts', known('src/b.tsx'))).toBe('src/b.tsx');
    expect(resolveImportSpecifier('./widget.jsx', 'src/a.ts', known('src/widget.tsx'))).toBe(
      'src/widget.tsx',
    );
  });

  it('completes an extensionless specifier to .ts by default, matching index files when present', () => {
    expect(resolveImportSpecifier('./b', 'src/a.ts', none)).toBe('src/b.ts');
    expect(resolveImportSpecifier('./b', 'src/a.ts', known('src/b/index.ts'))).toBe(
      'src/b/index.ts',
    );
  });

  it('keeps a real .js file when one is indexed', () => {
    expect(resolveImportSpecifier('./legacy.js', 'src/a.ts', known('src/legacy.js'))).toBe(
      'src/legacy.js',
    );
  });

  it('orders candidates with the best guess first', () => {
    expect(importCandidates('src/b.js')[0]).toBe('src/b.ts');
    expect(importCandidates('src/b')[0]).toBe('src/b.ts');
  });
});

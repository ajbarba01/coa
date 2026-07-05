import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeInvocation, confineToWorktree, safeForWindowsShell } from './openPath.js';

describe('confineToWorktree', () => {
  const root = resolve('/repo/worktree');

  it('resolves a worktree-relative path to an absolute path under the root', () => {
    expect(confineToWorktree(root, 'src/auth.ts')).toBe(resolve(root, 'src/auth.ts'));
  });

  it('accepts the worktree root itself', () => {
    expect(confineToWorktree(root, '.')).toBe(root);
  });

  it('rejects a path that climbs above the root', () => {
    expect(confineToWorktree(root, '../secrets.txt')).toBeUndefined();
    expect(confineToWorktree(root, 'src/../../secrets.txt')).toBeUndefined();
  });

  it('rejects an absolute path outside the root', () => {
    expect(confineToWorktree(root, resolve('/etc/passwd'))).toBeUndefined();
  });

  it('accepts an absolute path that is inside the root', () => {
    const inside = resolve(root, 'pkg/x.ts');
    expect(confineToWorktree(root, inside)).toBe(inside);
  });

  it('rejects everything when the root is empty (no active worktree)', () => {
    expect(confineToWorktree('', 'src/x.ts')).toBeUndefined();
  });
});

describe('codeInvocation', () => {
  it('routes through cmd.exe /c on Windows (code.cmd cannot be spawned shell-free)', () => {
    expect(codeInvocation('win32', 'C:\\repo\\x.ts', 42)).toEqual({
      command: 'cmd.exe',
      args: ['/c', 'code', '-g', 'C:\\repo\\x.ts:42'],
    });
  });

  it('spawns code directly on POSIX', () => {
    expect(codeInvocation('linux', '/repo/x.ts', 42)).toEqual({
      command: 'code',
      args: ['-g', '/repo/x.ts:42'],
    });
    expect(codeInvocation('darwin', '/repo/x.ts', undefined)).toEqual({
      command: 'code',
      args: ['-g', '/repo/x.ts'],
    });
  });

  it('keeps a path with a space as a SINGLE argument (the reveal split-at-space bug)', () => {
    // The whole `<path>:<line>` is one array element — with shell:false, Node quotes it for
    // CreateProcess, so cmd.exe never word-splits "Side Projects" into two files.
    const { args } = codeInvocation('win32', 'C:\\Users\\Zander\\Documents\\Side Projects\\a.ts', 3);
    expect(args).toContain('C:\\Users\\Zander\\Documents\\Side Projects\\a.ts:3');
    expect(args).toHaveLength(4);
  });

  it('omits the :line suffix when no line is given', () => {
    expect(codeInvocation('win32', 'C:\\repo\\x.ts', undefined).args).toEqual([
      '/c',
      'code',
      '-g',
      'C:\\repo\\x.ts',
    ]);
  });
});

describe('safeForWindowsShell', () => {
  it('accepts ordinary worktree paths', () => {
    expect(safeForWindowsShell('C:\\repo\\src\\auth.ts')).toBe(true);
    expect(safeForWindowsShell('/repo/src/some file.ts')).toBe(true);
  });

  it('rejects a path carrying cmd.exe metacharacters (agent-named file)', () => {
    expect(safeForWindowsShell('C:\\repo\\a & calc.exe')).toBe(false);
    expect(safeForWindowsShell('C:\\repo\\x|y.ts')).toBe(false);
    expect(safeForWindowsShell('C:\\repo\\%PATH%.ts')).toBe(false);
    expect(safeForWindowsShell('C:\\repo\\a^b.ts')).toBe(false);
    expect(safeForWindowsShell('C:\\repo\\a\nb.ts')).toBe(false);
  });
});

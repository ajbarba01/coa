import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { confinePath, type ConfinementPolicy } from './confine.js';

const policy = (over: Partial<ConfinementPolicy> = {}): ConfinementPolicy => ({
  worktreeRoot: '/repo',
  ...over,
});

describe('confinePath', () => {
  it('accepts an in-worktree relative path and returns the resolved absolute path', () => {
    const result = confinePath('src/a.ts', policy());
    expect(result).toEqual({ ok: true, path: '/repo/src/a.ts' });
  });

  it('accepts the worktree root itself ("."), which is in-bounds', () => {
    const result = confinePath('.', policy());
    expect(result).toEqual({ ok: true, path: '/repo' });
  });

  it('still rejects a genuine escape above the root', () => {
    const result = confinePath('../secrets', policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  it('rejects a "../" traversal that escapes the worktree', () => {
    const result = confinePath('../../etc/passwd', policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  it('rejects an absolute path outside the worktree', () => {
    const result = confinePath('/etc/passwd', policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  it('rejects a symlink whose target resolves outside the worktree', () => {
    const realpath = (p: string): string => (p === '/repo/link' ? '/etc/secret' : p);
    const result = confinePath('link', policy({ realpath }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  it('rejects an in-worktree path that matches the forbidden set (the kernel home)', () => {
    const result = confinePath('.coa/local/wal.log', policy());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-denied');
  });

  // A Windows worktree root is a drive-letter path (e.g. `C:/Users/.../coa`), which
  // is NOT POSIX-absolute — the confined path must still be a clean, root-prefixed
  // path the OS fs can open, not a cwd-mangled `/…/C:/…` string.
  it('returns a clean root-prefixed path for a drive-letter (Windows) root', () => {
    const result = confinePath('AGENTS.md', policy({ worktreeRoot: 'C:/proj/coa' }));
    expect(result).toEqual({ ok: true, path: 'C:/proj/coa/AGENTS.md' });
  });

  it('still rejects a traversal escape under a drive-letter root', () => {
    const result = confinePath('../../etc/passwd', policy({ worktreeRoot: 'C:/proj/coa' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('path-escape');
  });

  // The load-bearing regression: the returned path must be openable by the real fs
  // when the root is a real, OS-native absolute path (as the daemon supplies).
  it('returns an OS-openable absolute path for a real filesystem root', () => {
    const dir = mkdtempSync(nodePath.join(tmpdir(), 'coa-confine-'));
    const root = dir.replace(/\\/g, '/'); // mirror the daemon's forward-slashing
    try {
      writeFileSync(nodePath.join(dir, 'AGENTS.md'), 'hello');
      const result = confinePath('AGENTS.md', policy({ worktreeRoot: root }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(readFileSync(result.path, 'utf8')).toBe('hello');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

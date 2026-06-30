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
});

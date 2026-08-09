import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decideBind, WorktreeManager } from './worktree-manager.js';

/**
 * A throwaway git repo with one committed file — mirrors `daemon.test.ts`'s `makeRepo`
 * fixture (same committer-identity-per-command trick, so no repo-level git config is
 * ever written).
 */
function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'coa-wt-'));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=probe@example.com', '-c', 'user.name=probe', ...args], {
      cwd: repo,
      encoding: 'utf8',
    });
  };
  git('init', '-q');
  writeFileSync(join(repo, 'app.ts'), 'export const answer = 41;\n');
  git('add', 'app.ts');
  git('commit', '-qm', 'baseline');
  return repo;
}

describe('decideBind (pure scope→path decision, no I/O)', () => {
  const base = {
    sessionId: 'sess-1',
    repoRoot: '/repo',
    worktreesDir: '.coa/worktrees',
    existingPath: undefined,
  };

  it('reuses an existing bind verbatim, ignoring every other input', () => {
    const action = decideBind({
      ...base,
      isolateRequested: true,
      isGitRepo: false,
      existingPath: '/repo/.coa/worktrees/sess-1',
    });
    expect(action).toEqual({ kind: 'reuse', path: '/repo/.coa/worktrees/sess-1' });
  });

  it('resolves to the shared root when isolation was not requested', () => {
    const action = decideBind({ ...base, isolateRequested: false, isGitRepo: true });
    expect(action).toEqual({ kind: 'shared', path: '/repo' });
  });

  it('degrades a non-git project to the shared root even when isolation was requested', () => {
    const action = decideBind({ ...base, isolateRequested: true, isGitRepo: false });
    expect(action).toEqual({ kind: 'shared', path: '/repo' });
  });

  it('resolves an isolated path under the coa-managed worktrees directory when git-backed', () => {
    const action = decideBind({ ...base, isolateRequested: true, isGitRepo: true });
    expect(action).toEqual({ kind: 'isolate', path: '/repo/.coa/worktrees/sess-1' });
  });

  it('returns a Windows-style shared root VERBATIM — never normalized', () => {
    // The regression this pins: the non-isolated floor must stay byte-identical to
    // the pre-isolation `bindWorktree` stub, which returned its input untouched.
    const action = decideBind({
      ...base,
      repoRoot: 'C:\\Users\\dev\\coa',
      isolateRequested: false,
      isGitRepo: true,
    });
    expect(action).toEqual({ kind: 'shared', path: 'C:\\Users\\dev\\coa' });
  });

  it('normalizes a Windows-style repo root to forward slashes in the isolated path', () => {
    const action = decideBind({
      ...base,
      repoRoot: 'C:\\Users\\dev\\coa',
      isolateRequested: true,
      isGitRepo: true,
    });
    expect(action).toEqual({ kind: 'isolate', path: 'C:/Users/dev/coa/.coa/worktrees/sess-1' });
  });
});

describe('WorktreeManager (lifecycle, against a real fixture git repo)', () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('bind() with no isolation request returns the shared repo root VERBATIM and creates nothing', () => {
    // Verbatim, not merely equal-modulo-slashes: this is the byte-identical floor
    // every non-isolated session (the overwhelming common case) must keep.
    const manager = new WorktreeManager({ repoRoot: repo });
    const path = manager.bind('sess-1', 'src');
    expect(path).toBe(repo);
    expect(manager.get('sess-1')).toBeUndefined();
    expect(manager.list()).toEqual([]);
  });

  it('bind({isolate:true}) creates a real git worktree checked out from HEAD', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    const path = manager.bind('sess-1', 'src', { isolate: true });
    expect(path).not.toBe(repo);
    expect(existsSync(path)).toBe(true);
    // `.replace` tolerates a local git config that checks files out with CRLF
    // (Windows' `core.autocrlf`) — irrelevant to what this test is pinning.
    expect(readFileSync(join(path, 'app.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      'export const answer = 41;\n',
    );
    const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(registered).toContain(path);
  });

  it('bind() is idempotent per session — a second call reuses the same worktree', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    const first = manager.bind('sess-1', 'src', { isolate: true });
    const second = manager.bind('sess-1', 'src', { isolate: true });
    expect(second).toBe(first);
    const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
    });
    // Exactly one isolated entry, not two — a second `git worktree add` into the
    // same path would have thrown (the path already exists) if this regressed.
    expect(registered.split('worktree ').filter((l) => l.includes('sess-1'))).toHaveLength(1);
  });

  it("a later call with isolate unset still returns the session's already-decided isolated path", () => {
    // Mirrors what happens on a child session's SECOND turn: only the founding
    // turn carries `isolate`, so a later per-turn `bind()` call must not silently
    // downgrade an already-isolated session back to the shared root.
    const manager = new WorktreeManager({ repoRoot: repo });
    const first = manager.bind('sess-1', 'src', { isolate: true });
    const second = manager.bind('sess-1', 'src');
    expect(second).toBe(first);
  });

  it('degrades to the shared root on a non-git directory, honestly and without throwing', () => {
    const plain = mkdtempSync(join(tmpdir(), 'coa-wt-nogit-'));
    try {
      const manager = new WorktreeManager({ repoRoot: plain });
      expect(() => manager.bind('sess-1', 'src', { isolate: true })).not.toThrow();
      const path = manager.bind('sess-1', 'src', { isolate: true });
      expect(path).toBe(plain);
      expect(manager.list()).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it('list() reports every isolated session this process has bound', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    manager.bind('sess-1', 'src', { isolate: true });
    manager.bind('sess-2', 'src');
    manager.bind('sess-3', 'src', { isolate: true });
    expect(
      manager
        .list()
        .map((r) => r.sessionId)
        .sort(),
    ).toEqual(['sess-1', 'sess-3']);
    expect(manager.list().every((r) => r.isolated)).toBe(true);
  });

  it('status() is clean immediately after creation, then reflects an uncommitted write', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    const path = manager.bind('sess-1', 'src', { isolate: true });
    expect(manager.status('sess-1')).toEqual({ dirty: false, filesChanged: 0 });

    writeFileSync(join(path, 'new-file.ts'), 'export const x = 1;\n');
    expect(manager.status('sess-1')).toEqual({ dirty: true, filesChanged: 1 });
  });

  it('status() is undefined for a session with no isolated worktree', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    manager.bind('sess-1', 'src');
    expect(manager.status('sess-1')).toBeUndefined();
    expect(manager.status('never-bound')).toBeUndefined();
  });

  it('reap() removes the worktree on disk and deregisters it from git', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    const path = manager.bind('sess-1', 'src', { isolate: true });
    expect(manager.reap('sess-1')).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(manager.get('sess-1')).toBeUndefined();
    const registered = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(registered).not.toContain(path);
  });

  it('reap() is a harmless no-op for an unknown or non-isolated session', () => {
    const manager = new WorktreeManager({ repoRoot: repo });
    manager.bind('sess-1', 'src');
    expect(manager.reap('sess-1')).toBe(false);
    expect(manager.reap('never-bound')).toBe(false);
  });

  it('sweepStale() reaps a worktree left behind by a prior process once past staleAfterMs', () => {
    // Simulate the prior (crashed) daemon run: a first manager creates an isolated
    // worktree and is then discarded WITHOUT reaping it — exactly what a crash leaves
    // behind, since nothing runs `close()`/`reap()` on an unclean exit.
    const priorRun = new WorktreeManager({ repoRoot: repo });
    const orphanPath = priorRun.bind('orphan-1', 'src', { isolate: true });

    const clock = Date.now() + 1000 * 60 * 60; // an hour after creation
    const freshRun = new WorktreeManager({
      repoRoot: repo,
      staleAfterMs: 1000 * 60 * 30, // 30 minutes
      now: () => clock,
    });
    const reaped = freshRun.sweepStale();
    expect(reaped).toEqual(['orphan-1']);
    expect(existsSync(orphanPath)).toBe(false);
  });

  it('sweepStale() leaves a recent orphan alone (still inside the idle window)', () => {
    const priorRun = new WorktreeManager({ repoRoot: repo });
    const orphanPath = priorRun.bind('orphan-1', 'src', { isolate: true });

    const freshRun = new WorktreeManager({
      repoRoot: repo,
      staleAfterMs: 1000 * 60 * 60 * 24,
      now: () => Date.now(),
    });
    const reaped = freshRun.sweepStale();
    expect(reaped).toEqual([]);
    expect(existsSync(orphanPath)).toBe(true);
  });

  it('sweepStale() never reaps a worktree THIS process already bound, however old', () => {
    let clock = Date.now();
    const manager = new WorktreeManager({
      repoRoot: repo,
      staleAfterMs: 1,
      now: () => clock,
    });
    const path = manager.bind('sess-1', 'src', { isolate: true });
    clock += 1000 * 60 * 60;
    const reaped = manager.sweepStale();
    expect(reaped).toEqual([]);
    expect(existsSync(path)).toBe(true);
  });

  it('sweepStale() is a no-op outside a git repo', () => {
    const plain = mkdtempSync(join(tmpdir(), 'coa-wt-nogit-'));
    try {
      const manager = new WorktreeManager({ repoRoot: plain });
      expect(manager.sweepStale()).toEqual([]);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

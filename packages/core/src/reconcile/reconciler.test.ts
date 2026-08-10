import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeEventDraft } from '../event.js';
import { Reconciler } from './reconciler.js';

/**
 * Reproduces the scan-vs-delete race that a real `rm` or build cleanup hits: a path
 * that is on disk when the scan lists it and gone by the moment the hash reads it.
 * Arming a path makes it disappear for real at exactly that instant, so the failure
 * is a genuine OS ENOENT rather than a synthetic error. Unarmed reads go straight
 * through to the real filesystem, so every other test here is untouched.
 */
const race = vi.hoisted(() => ({ armed: new Set<string>() }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  const readFileSync = ((path: unknown, options: unknown) => {
    if (typeof path === 'string' && race.armed.has(path)) {
      race.armed.delete(path);
      actual.rmSync(path, { force: true });
    }
    return (actual.readFileSync as (p: unknown, o: unknown) => unknown)(path, options);
  }) as typeof actual.readFileSync;
  return { ...actual, default: { ...actual, readFileSync }, readFileSync };
});

let root: string;
const git = (...args: string[]): void => {
  execFileSync('git', args, { cwd: root });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'coa-recon-'));
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
});
afterEach(() => {
  race.armed.clear();
  rmSync(root, { recursive: true, force: true });
});

const captureReconciler = (): { recon: Reconciler; drafts: ChangeEventDraft[] } => {
  const drafts: ChangeEventDraft[] = [];
  const recon = new Reconciler({ worktree: 'main', root, emit: (d) => drafts.push(d) });
  return { recon, drafts };
};

describe('Reconciler (git-centric producer)', () => {
  it('emits an inferred create for a new file, then nothing on a no-op rescan', () => {
    writeFileSync(join(root, 'a.ts'), 'export const x = 1;\n');
    const { recon, drafts } = captureReconciler();

    recon.reconcile();
    const created = drafts.find((d) => d.kind === 'create');
    expect(created?.path).toBe('a.ts');
    expect(created?.provenance).toBe('inferred');

    drafts.length = 0;
    recon.reconcile();
    expect(drafts).toEqual([]); // content-hash dedup: unchanged file produces no event
  });

  it('emits modify then delete as the tracked file changes', () => {
    writeFileSync(join(root, 'a.ts'), 'one\n');
    git('add', 'a.ts');
    git('commit', '-q', '-m', 'add');
    const { recon, drafts } = captureReconciler();
    recon.reconcile(); // seed prior state from a clean tree (no change yet)
    drafts.length = 0;

    writeFileSync(join(root, 'a.ts'), 'two\n');
    recon.reconcile();
    expect(drafts.at(-1)?.kind).toBe('modify');

    rmSync(join(root, 'a.ts'));
    drafts.length = 0;
    recon.reconcile();
    expect(drafts.at(-1)?.kind).toBe('delete');
  });

  it('finishes the scan when a listed file is deleted before it can be hashed', () => {
    // A file vanishing mid-scan used to throw out of reconcile(), and the daemon reads a
    // throw here as the producer being dead — so one concurrent `rm` ended file-change
    // observation for the rest of the process. A gone file has no content to hash, which
    // is the same answer as a file that was never there; the rest of the scan continues.
    writeFileSync(join(root, 'a-vanishes.ts'), 'one\n');
    writeFileSync(join(root, 'b-survives.ts'), 'two\n');
    const { recon, drafts } = captureReconciler();
    race.armed.add(join(root, 'a-vanishes.ts'));

    expect(() => recon.reconcile()).not.toThrow();
    expect(drafts.map((d) => ('path' in d ? d.path : ''))).toEqual(['b-survives.ts']);
  });

  it('respects .gitignore — an ignored file never produces an event', () => {
    writeFileSync(join(root, '.gitignore'), 'secret.txt\n');
    writeFileSync(join(root, 'secret.txt'), 'hunter2\n');
    const { recon, drafts } = captureReconciler();
    recon.reconcile();
    expect(drafts.some((d) => d.kind !== 'confirm' && 'path' in d && d.path === 'secret.txt')).toBe(
      false,
    );
  });
});

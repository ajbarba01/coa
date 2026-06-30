import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangeEventDraft } from '../event.js';
import { Reconciler } from './reconciler.js';

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
afterEach(() => rmSync(root, { recursive: true, force: true }));

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

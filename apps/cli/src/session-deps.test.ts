import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountsRegistry, type ChangeEventDraft } from '@coa/core';
import { buildSessionDeps, type BuiltSession } from './session-deps.js';

let dir: string;
let built: BuiltSession | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-cli-'));
  built = undefined;
});
afterEach(() => {
  built?.handle.kernel.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('buildSessionDeps', () => {
  it('wires the real daemon core and the Claude adapter factory into runnable session deps', () => {
    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.catalogue.length).toBeGreaterThan(0);
    expect(built.deps.gate()).toEqual({ allow: true });
    expect(typeof built.deps.createAdapter).toBe('function');
  });

  it('binds the worktree to the configured root', () => {
    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.bindWorktree('s1', 'src')).toBe(dir);
  });

  it('honors an injected home instead of the ambient homedir()', () => {
    const home = mkdtempSync(join(tmpdir(), 'coa-sd-home-'));
    // A decoy homedir() DIFFERENT from `home` — a call site that regressed to reading it
    // directly would resolve the active account from here instead, i.e. ambient.
    const decoyHome = mkdtempSync(join(tmpdir(), 'coa-sd-decoy-'));
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = decoyHome;
    process.env.USERPROFILE = decoyHome;
    try {
      const accounts = new AccountsRegistry(home);
      accounts.add('work', { type: 'config-dir', dir: 'D:\\claude-work' }, 'claude');
      accounts.setActive('work');

      built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir, home });

      expect(built.deps.activeAccount?.('claude')).toMatchObject({ label: 'work' });
      expect(readdirSync(decoyHome)).toEqual([]);
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = originalUserProfile;
      rmSync(home, { recursive: true, force: true });
      rmSync(decoyHome, { recursive: true, force: true });
    }
  });

  it('drives the committed generation registry: a drifted target makes the close-gate live', () => {
    mkdirSync(join(dir, '.coa'), { recursive: true });
    writeFileSync(
      join(dir, '.coa', 'generate.yaml'),
      [
        'relations:',
        '  gen:',
        '    source: src/a.ts',
        '    target: gen/a.ts',
        '    lang: typescript',
        '    command: node gen.js',
        "    version: '1'",
      ].join('\n'),
      'utf8',
    );
    writeFileSync(join(dir, 'gen.js'), "process.stdout.write('export const x = 1;');", 'utf8');
    mkdirSync(join(dir, 'gen'), { recursive: true });
    writeFileSync(join(dir, 'gen', 'a.ts'), 'export const x = 2;', 'utf8');

    built = buildSessionDeps({ walPath: join(dir, 'log.ndjson'), root: dir });
    expect(built.deps.gate()).toEqual({ allow: true });

    const modify: ChangeEventDraft = {
      worktree: 'main',
      actor: 'session',
      op_id: 'op-1',
      provenance: 'declared',
      cause: null,
      kind: 'modify',
      path: 'src/a.ts',
      pre_hash: 'a',
      post_hash: 'b',
      generated: false,
    };
    built.handle.kernel.emit(modify);

    expect(built.deps.gate().allow).toBe(false);
  });
});

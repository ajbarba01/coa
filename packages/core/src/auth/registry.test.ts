import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry, accountsPath } from './registry.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-auth-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('AccountsRegistry', () => {
  it('is ambient with an empty list when no file exists (strict-superset)', () => {
    const reg = new AccountsRegistry(home);
    expect(reg.list()).toEqual([]);
    expect(reg.getActive('claude')).toEqual({ kind: 'ambient' });
    expect(reg.getActive('deepseek')).toEqual({ kind: 'ambient' });
    expect(existsSync(accountsPath(home))).toBe(false);
  });

  it('add + setActive persists and resolves the active account for its provider', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/home/u/.claude-work' });
    reg.setActive('work');
    const fresh = new AccountsRegistry(home);
    expect(fresh.getActive('claude')).toEqual({
      kind: 'account',
      account: {
        label: 'work',
        provider: 'claude',
        locator: { type: 'config-dir', dir: '/home/u/.claude-work' },
        disabled: false,
      },
    });
  });

  it('tracks the active account independently per provider', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' }, 'claude');
    reg.add('personal', { type: 'config-dir', dir: '/p' }, 'claude');
    reg.add('ds', { type: 'key-file', path: '/k' }, 'deepseek');
    reg.setActive('work');
    reg.setActive('ds');

    expect(reg.getActive('claude')).toMatchObject({ account: { label: 'work' } });
    expect(reg.getActive('deepseek')).toMatchObject({ account: { label: 'ds' } });

    // Switching the Claude account leaves DeepSeek untouched.
    reg.setActive('personal');
    expect(reg.getActive('claude')).toMatchObject({ account: { label: 'personal' } });
    expect(reg.getActive('deepseek')).toMatchObject({ account: { label: 'ds' } });
  });

  it('listByProvider filters to a provider', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' }, 'claude');
    reg.add('ds', { type: 'key-file', path: '/k' }, 'deepseek');
    expect(reg.listByProvider('deepseek').map((a) => a.label)).toEqual(['ds']);
    expect(reg.listByProvider('claude').map((a) => a.label)).toEqual(['work']);
  });

  it('rejects a duplicate label and an unknown setActive', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/p' });
    expect(() => reg.add('work', { type: 'ambient' })).toThrow(/already exists/);
    expect(() => reg.setActive('ghost')).toThrow(/unknown account/);
  });

  it('removing the active account resets that provider to ambient', () => {
    const reg = new AccountsRegistry(home);
    reg.add('ds', { type: 'key-file', path: '/k' }, 'deepseek');
    reg.setActive('ds');
    reg.remove('ds');
    expect(reg.getActive('deepseek')).toEqual({ kind: 'ambient' });
    expect(reg.list()).toEqual([]);
  });

  it('setAmbient resets a provider without touching others', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' }, 'claude');
    reg.add('ds', { type: 'key-file', path: '/k' }, 'deepseek');
    reg.setActive('work');
    reg.setActive('ds');
    reg.setAmbient('deepseek');
    expect(reg.getActive('deepseek')).toEqual({ kind: 'ambient' });
    expect(reg.getActive('claude')).toMatchObject({ account: { label: 'work' } });
  });

  it('migrates a legacy single-string active to the per-provider map', () => {
    const path = accountsPath(home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      'active: personal\naccounts:\n  - label: personal\n    provider: claude\n    locator:\n      type: config-dir\n      dir: /p\n',
      'utf8',
    );
    const reg = new AccountsRegistry(home);
    expect(reg.getActive('claude')).toMatchObject({ account: { label: 'personal' } });
  });
});

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
        id: expect.stringMatching(/^[0-9a-f]{12}$/),
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

  it('setDisabled flips the flag without touching the locator or active status', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' }, 'claude');
    reg.setActive('work');
    reg.setDisabled('work', true);
    expect(reg.list()).toEqual([
      {
        label: 'work',
        provider: 'claude',
        locator: { type: 'config-dir', dir: '/d' },
        disabled: true,
        id: expect.stringMatching(/^[0-9a-f]{12}$/),
      },
    ]);
    expect(reg.getActive('claude')).toMatchObject({ account: { label: 'work', disabled: true } });

    reg.setDisabled('work', false);
    expect(reg.list()).toMatchObject([{ disabled: false }]);
  });

  it('setDisabled on an unknown label throws', () => {
    const reg = new AccountsRegistry(home);
    expect(() => reg.setDisabled('ghost', true)).toThrow(/unknown account/);
  });

  it('add stores the declared email; setEmail backfills one later', () => {
    const registry = new AccountsRegistry(home);
    registry.add('work', { type: 'config-dir', dir: '/w' }, 'claude', 'work@barba.org');
    expect(registry.list()[0]?.email).toBe('work@barba.org');
    registry.add('old', { type: 'config-dir', dir: '/o' });
    registry.setEmail('old', 'old@barba.org');
    expect(registry.list().find((a) => a.label === 'old')?.email).toBe('old@barba.org');
  });

  it('setEmail on an unknown label throws (same contract as setDisabled)', () => {
    const registry = new AccountsRegistry(home);
    expect(() => registry.setEmail('ghost', 'x@y.z')).toThrow('unknown account');
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

describe('account ids', () => {
  it('mints an id for every account it registers', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' });
    const id = registry.list()[0]?.id;
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('accepts an id minted by the caller (a login flow keys its profile before it lands)', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' }, 'claude', 'a@b.org', 'deadbeef0000');
    expect(registry.list()[0]?.id).toBe('deadbeef0000');
  });

  it('gives every account its OWN id', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' });
    registry.add('c@d.org', { type: 'ambient' });
    const [first, second] = registry.list();
    expect(first?.id).not.toBe(second?.id);
  });

  it('backfills an id onto a legacy account, once, and persists it', () => {
    mkdirSync(dirname(accountsPath(home)), { recursive: true });
    writeFileSync(
      accountsPath(home),
      'active: {}\naccounts:\n  - label: legacy\n    provider: claude\n    locator: {type: ambient}\n',
    );
    const registry = new AccountsRegistry(home);
    const id = registry.ensureId('legacy');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(registry.ensureId('legacy')).toBe(id);
    expect(new AccountsRegistry(home).list()[0]?.id).toBe(id);
  });

  it('has no id to ensure for an account that is not there', () => {
    expect(new AccountsRegistry(home).ensureId('ghost')).toBeUndefined();
  });
});

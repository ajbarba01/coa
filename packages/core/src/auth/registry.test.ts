import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
    expect(existsSync(accountsPath(home))).toBe(false);
  });

  it('add + setActive persists and resolves the active account', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/home/u/.claude-work' });
    reg.setActive('work');
    const fresh = new AccountsRegistry(home);
    expect(fresh.list().map((a) => a.label)).toEqual(['work']);
    expect(fresh.getActive()).toEqual({
      kind: 'account',
      account: {
        label: 'work',
        provider: 'claude',
        locator: { type: 'config-dir', dir: '/home/u/.claude-work' },
      },
    });
  });

  it('rejects a duplicate label', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'ant-profile', profile: 'p' });
    expect(() => reg.add('work', { type: 'ambient' })).toThrow(/already exists/);
  });

  it('setActive rejects an unknown label', () => {
    const reg = new AccountsRegistry(home);
    expect(() => reg.setActive('ghost')).toThrow(/unknown account/);
  });

  it('removing the active account resets active to ambient', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' });
    reg.setActive('work');
    reg.remove('work');
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
    expect(reg.list()).toEqual([]);
  });

  it('setActive ambient is always allowed', () => {
    const reg = new AccountsRegistry(home);
    reg.setActive('ambient');
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
  });
});

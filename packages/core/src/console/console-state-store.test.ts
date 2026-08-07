import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleStateStore } from './console-state-store.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-console-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ConsoleStateStore', () => {
  it('reads a missing file as empty (never throws)', () => {
    expect(new ConsoleStateStore(home).read()).toEqual({
      version: 1,
      addedProviders: [],
      disabledProviders: [],
      isolatedBrowserLogins: false,
    });
  });

  it('adds a provider once (idempotent) and removes it', () => {
    const s = new ConsoleStateStore(home);
    s.addProvider('claude');
    s.addProvider('claude');
    expect(s.read().addedProviders).toEqual(['claude']);
    s.removeProvider('claude');
    expect(s.read().addedProviders).toEqual([]);
  });

  it('benches and unbenches a provider', () => {
    const s = new ConsoleStateStore(home);
    s.setProviderDisabled('longcat', true);
    expect(s.read().disabledProviders).toEqual(['longcat']);
    s.setProviderDisabled('longcat', false);
    expect(s.read().disabledProviders).toEqual([]);
  });

  it('removeProvider also clears its bench (no orphan)', () => {
    const s = new ConsoleStateStore(home);
    s.addProvider('longcat');
    s.setProviderDisabled('longcat', true);
    s.removeProvider('longcat');
    expect(s.read().disabledProviders).toEqual([]);
  });
});

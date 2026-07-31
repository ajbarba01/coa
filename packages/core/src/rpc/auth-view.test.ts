import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry } from '../auth/registry.js';
import { WebConfigStore, webKeyFilePath } from '../workbench/web/web-config-store.js';
import { KeyStateStore } from '../workbench/web/key-state-store.js';
import { ConsoleStateStore } from '../console/console-state-store.js';
import { assembleAuthView, credentialId } from './auth-view.js';

let home: string;
const deps = () => ({
  accounts: new AccountsRegistry(home),
  web: new WebConfigStore(home),
  keys: new KeyStateStore(home),
  console: new ConsoleStateStore(home),
});
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authview-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('assembleAuthView', () => {
  it('shows a config-dir pointer verbatim and a key-file secret as ••••', () => {
    const d = deps();
    d.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
    d.accounts.add('ds', { type: 'key-file', path: '/x' }, 'deepseek');
    const view = assembleAuthView(d);
    const worm = view.credentials.find((c) => c.label === 'worm');
    const ds = view.credentials.find((c) => c.label === 'ds');
    expect(worm?.masked).toBe('~/.claude');
    expect(ds?.masked).toBe('••••');
  });

  it('reports the active backend login as a credential id', () => {
    const d = deps();
    d.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
    d.accounts.setActive('worm');
    expect(assembleAuthView(d).activeByProvider['claude']).toBe(credentialId('claude', 'worm'));
  });

  it('marks a benched account disabled and reports provider enabled', () => {
    const d = deps();
    d.console.addProvider('longcat');
    d.console.setProviderDisabled('longcat', true);
    expect(assembleAuthView(d).enabled['longcat']).toBe(false);
  });

  it('carries a service key cooldown from the breaker', () => {
    const d = deps();
    const path = webKeyFilePath(home, 'tavily-1');
    d.web.addCredential('search', 'tavily', { type: 'key-file', path });
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);
    const view = assembleAuthView(d);
    const key = view.credentials.find((c) => c.providerId === 'tavily');
    expect(key?.coolingSec).toBeGreaterThan(0);
  });

  it('threads declared email + probe health/identity onto claude credentials', () => {
    const d = deps();
    d.accounts.add('work', { type: 'config-dir', dir: '~/.claude' }, 'claude', 'w@x.org');
    const view = assembleAuthView(
      {
        ...d,
        login: {
          healthOf: (id) => (id === 'claude:work' ? 'needs-relogin' : undefined),
          identityOf: (id) => (id === 'claude:work' ? { email: 'w@x.org', plan: 'pro' } : undefined),
        },
      },
    );
    const cred = view.credentials.find((c) => c.id === 'claude:work');
    expect(cred).toMatchObject({ email: 'w@x.org', health: 'needs-relogin', identity: 'w@x.org · pro', plan: 'pro' });
  });

  it('without the login dep the view is unchanged (additive)', () => {
    const d = deps();
    d.accounts.add('work', { type: 'config-dir', dir: '~/.claude' }, 'claude', 'w@x.org');
    const view = assembleAuthView(d);
    expect(view.credentials.every((c) => c.health === undefined && c.identity === undefined)).toBe(true);
  });
});

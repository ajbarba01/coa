import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry } from '../auth/registry.js';
import { WebConfigStore } from '../workbench/web/web-config-store.js';
import { KeyStateStore } from '../workbench/web/key-state-store.js';
import { ConsoleStateStore } from '../console/console-state-store.js';
import type { AuthView } from './auth-view.js';
import { dispatch } from './router.js';
import { buildAuthHandlers, type AuthHandlerDeps } from './auth-handlers.js';

let home: string;
const call = (handlers: ReturnType<typeof buildAuthHandlers>, method: string, params?: unknown) =>
  dispatch({ jsonrpc: '2.0', id: 1, method, params }, handlers);

/** A fresh four-store deps object rooted at a temp home, mirroring the daemon composition. */
function freshDeps(home: string): AuthHandlerDeps {
  return {
    accounts: new AccountsRegistry(home),
    web: new WebConfigStore(home),
    keys: new KeyStateStore(home),
    console: new ConsoleStateStore(home),
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authrpc-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('buildAuthHandlers', () => {
  it('currentAccount is empty initially, then reflects a per-provider use', async () => {
    const handlers = buildAuthHandlers(freshDeps(home));
    let res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: {} } });

    await call(handlers, 'addAccount', {
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    await call(handlers, 'useAccount', { label: 'work' });
    res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: { claude: 'work' } } });
  });

  it('tracks the active account per provider and resets one to ambient', async () => {
    const handlers = buildAuthHandlers(freshDeps(home));
    await call(handlers, 'addAccount', {
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
      provider: 'claude',
    });
    await call(handlers, 'addAccount', {
      label: 'ds',
      locator: { type: 'key-file', path: '/k' },
      provider: 'deepseek',
    });
    await call(handlers, 'useAccount', { label: 'work' });
    await call(handlers, 'useAccount', { label: 'ds' });
    let res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: { claude: 'work', deepseek: 'ds' } } });

    // Reset only DeepSeek to ambient; Claude stays.
    await call(handlers, 'useAccount', { label: 'ambient', provider: 'deepseek' });
    res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: { claude: 'work' } } });
  });

  it('listAccounts returns the registered accounts with their provider + active map', async () => {
    const handlers = buildAuthHandlers(freshDeps(home));
    await call(handlers, 'addAccount', {
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    const res = await call(handlers, 'listAccounts');
    expect(res).toMatchObject({
      result: { accounts: [{ label: 'work', provider: 'claude' }], active: {} },
    });
  });

  it('removeAccount drops it', async () => {
    const handlers = buildAuthHandlers(freshDeps(home));
    await call(handlers, 'addAccount', {
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    await call(handlers, 'removeAccount', { label: 'work' });
    const res = await call(handlers, 'listAccounts');
    expect(res).toMatchObject({ result: { accounts: [] } });
  });

  it('addAccount with a bad locator is an invalid-params error', async () => {
    const handlers = buildAuthHandlers(freshDeps(home));
    const res = await call(handlers, 'addAccount', { label: 'x', locator: { type: 'api-key' } });
    expect(res).toMatchObject({ error: { code: -32602 } });
  });

  it('authView projects a registered backend login', async () => {
    const deps = freshDeps(home);
    deps.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
    const handlers = buildAuthHandlers(deps);
    const view = (await handlers.authView!.handle(undefined)) as AuthView;
    expect(view.credentials.map((c) => c.label)).toContain('worm');
  });
});

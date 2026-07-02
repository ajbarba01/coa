import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry } from '../auth/registry.js';
import { dispatch } from './router.js';
import { buildAuthHandlers } from './auth-handlers.js';

let home: string;
const call = (handlers: ReturnType<typeof buildAuthHandlers>, method: string, params?: unknown) =>
  dispatch({ jsonrpc: '2.0', id: 1, method, params }, handlers);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authrpc-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('buildAuthHandlers', () => {
  it('currentAccount is empty initially, then reflects a per-provider use', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
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
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
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
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
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
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    await call(handlers, 'addAccount', {
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    await call(handlers, 'removeAccount', { label: 'work' });
    const res = await call(handlers, 'listAccounts');
    expect(res).toMatchObject({ result: { accounts: [] } });
  });

  it('addAccount with a bad locator is an invalid-params error', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    const res = await call(handlers, 'addAccount', { label: 'x', locator: { type: 'api-key' } });
    expect(res).toMatchObject({ error: { code: -32602 } });
  });
});

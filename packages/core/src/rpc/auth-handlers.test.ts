import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry, accountsPath } from '../auth/registry.js';
import {
  WebConfigStore,
  webConfigPath,
  webKeyFilePath,
} from '../workbench/web/web-config-store.js';
import { KeyStateStore } from '../workbench/web/key-state-store.js';
import { ConsoleStateStore } from '../console/console-state-store.js';
import { credentialId, type AuthView } from './auth-view.js';
import { dispatch } from './router.js';
import { buildAuthHandlers, type AuthHandlerDeps } from './auth-handlers.js';
import { LoginManager, type LoginDriverPort } from '../auth/login-manager.js';
import type { BrowserSessionView } from '../auth/browser-session.js';

let home: string;
let originalHome: string | undefined;
let originalUserProfile: string | undefined;
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

/** A hand-cranked driver (Task-4 pattern): tests script the probe queue; no real spawn/pty. */
function fakeLoginDriver(home: string): LoginDriverPort & {
  probeQueue: ({ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined)[];
} {
  const self = {
    home,
    probeQueue: [] as (
      | { loggedIn: boolean; email?: string; subscriptionType?: string }
      | undefined
    )[],
    dirFor: (email: string) => join(home, '.coa', 'logins', email.replace(/[^a-z0-9]+/gi, '-')),
    start: () => ({
      onUrl: () => {},
      onExit: () => {},
      writeCode: () => {},
      kill: () => {},
      ptyCaptured: true,
    }),
    probe: () => Promise.resolve(self.probeQueue.shift()),
  };
  return self;
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authrpc-'));
  // The write verbs (addCredential/renameCredential/etc.) key their web-service file
  // writes off `os.homedir()`, exactly like the real daemon composition (session/daemon.ts
  // roots all four stores at homedir()). Point homedir() at the same temp dir the stores
  // above are rooted at, so the handler and the test observe the same files.
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
});

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

describe('auth write verbs', () => {
  // --- write-first: the highest-care unit ------------------------------------------
  it('renameCredential (service) moves the key file on disk and re-points the locator', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'old', secret: 'tv-secret' });
    const oldPath = webKeyFilePath(home, 'old');
    const newPath = webKeyFilePath(home, 'new');
    expect(existsSync(oldPath)).toBe(true);

    const view = (await h.renameCredential!.handle({
      id: credentialId('tavily', 'old'),
      label: 'new',
    })) as AuthView;

    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(newPath)).toBe(true);
    expect(view.credentials.find((c) => c.label === 'new')?.providerId).toBe('tavily');
    expect(view.credentials.find((c) => c.label === 'old')).toBeUndefined();
    // the secret content itself survived the move, unread and unmodified
    expect(readFileSync(newPath, 'utf8')).toBe('tv-secret');
    // both chains re-point (tavily serves both search and fetch)
    expect(view.chains['search']).toContain('tavily');
    expect(view.chains['fetch']).toContain('tavily');
  });

  it("renameCredential (service) preserves a benched credential's disabled state", async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'old', secret: 'tv-secret' });
    await h.setCredentialDisabled!.handle({ id: credentialId('tavily', 'old'), disabled: true });

    const view = (await h.renameCredential!.handle({
      id: credentialId('tavily', 'old'),
      label: 'new',
    })) as AuthView;

    expect(view.credentials.find((c) => c.label === 'new')?.disabled).toBe(true);
  });

  it("renameCredential (service) clears the OLD path's breaker cooldown, so a re-added same-label key is not cooling", async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'old', secret: 'tv-secret' });
    const oldPath = webKeyFilePath(home, 'old');
    d.keys.markCooldown(`tavily:${oldPath}`, Date.now() + 60_000);

    await h.renameCredential!.handle({ id: credentialId('tavily', 'old'), label: 'new' });
    const view = (await h.addCredential!.handle({
      providerId: 'tavily',
      label: 'old',
      secret: 'tv-secret-2',
    })) as AuthView;

    expect(view.credentials.find((c) => c.label === 'old')?.coolingSec).toBeUndefined();
    expect(d.keys.isCoolingDown(`tavily:${oldPath}`, Date.now())).toBe(false);
  });

  it('renameCredential (backend) re-keys the registry, preserving locator + active status', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.setActive('a');
    const idBefore = d.accounts.list().find((a) => a.label === 'a')?.id;
    const h = buildAuthHandlers(d);

    const view = (await h.renameCredential!.handle({
      id: credentialId('claude', 'a'),
      label: 'b',
    })) as AuthView;

    expect(view.credentials.map((c) => c.label)).toEqual(['b']);
    expect(view.activeByProvider['claude']).toBe(credentialId('claude', 'b'));
    // the id keys the account's browser profile dir (docs/adr/0018) — a rename must not
    // re-mint it, or the renamed account orphans its existing profile
    expect(d.accounts.list().find((a) => a.label === 'b')?.id).toBe(idBefore);
  });

  // --- brief cases --------------------------------------------------------------------
  it('addCredential writes a 0600 key file for a key-file backend and registers a pointer', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'ds', secret: 'sk-secret' });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.credentials.find((c) => c.label === 'ds')?.masked).toBe('••••');
    expect(readFileSync(accountsPath(home), 'utf8')).not.toContain('sk-secret');
  });

  it('addCredential for claude registers a config-dir pointer (secret IS the directory, not a secret)', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const view = (await h.addCredential!.handle({
      providerId: 'claude',
      label: 'work',
      secret: '/home/u/.claude-work',
    })) as AuthView;
    expect(view.credentials.find((c) => c.label === 'work')?.masked).toBe('/home/u/.claude-work');
  });

  it('addCredential for a service writes ONE key file shared across every chain it serves', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'tv-key' });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.chains['search']).toEqual(['tavily']);
    expect(view.chains['fetch']).toEqual(['tavily']);
    expect(view.credentials.filter((c) => c.label === 'k1')).toHaveLength(1); // shared, appears once
    expect(readFileSync(webConfigPath(home), 'utf8')).not.toContain('tv-key');
  });

  it('addCredential is a no-op for an unsupported provider (never crashes)', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const before = (await h.authView!.handle(undefined)) as AuthView;
    const after = (await h.addCredential!.handle({
      providerId: 'exa',
      label: 'x',
      secret: 'whatever',
    })) as AuthView;
    expect(after).toEqual(before);
  });

  it('benching the active login promotes an heir and never leaves disabled-but-active', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.add('b', { type: 'config-dir', dir: '~/.b' }, 'claude');
    d.accounts.setActive('a');
    const h = buildAuthHandlers(d);
    const view = (await h.setCredentialDisabled!.handle({
      id: credentialId('claude', 'a'),
      disabled: true,
    })) as AuthView;
    expect(view.activeByProvider['claude']).toBe(credentialId('claude', 'b'));
    expect(view.credentials.find((c) => c.label === 'a')?.disabled).toBe(true);
  });

  it('benching the active login with no heir falls back to ambient', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.setActive('a');
    const h = buildAuthHandlers(d);
    const view = (await h.setCredentialDisabled!.handle({
      id: credentialId('claude', 'a'),
      disabled: true,
    })) as AuthView;
    expect(view.activeByProvider['claude']).toBeUndefined();
  });

  it('setCredentialDisabled (backend) is a graceful no-op for an unknown label', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    const h = buildAuthHandlers(d);
    const before = (await h.authView!.handle(undefined)) as AuthView;
    const after = (await h.setCredentialDisabled!.handle({
      id: credentialId('claude', 'nonexistent'),
      disabled: true,
    })) as AuthView;
    expect(after).toEqual(before);
  });

  it('setCredentialDisabled (service) benches a service key without touching the file', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'firecrawl', label: 'fc', secret: 'fc-key' });
    const view = (await h.setCredentialDisabled!.handle({
      id: credentialId('firecrawl', 'fc'),
      disabled: true,
    })) as AuthView;
    expect(view.credentials.find((c) => c.label === 'fc')?.disabled).toBe(true);
    expect(existsSync(webKeyFilePath(home, 'fc'))).toBe(true);
  });

  it('makeActive rejects a disabled login', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.add('b', { type: 'config-dir', dir: '~/.b' }, 'claude');
    d.accounts.setActive('b');
    const h = buildAuthHandlers(d);
    await h.setCredentialDisabled!.handle({ id: credentialId('claude', 'a'), disabled: true });
    const view = (await h.makeActive!.handle({ id: credentialId('claude', 'a') })) as AuthView;
    expect(view.activeByProvider['claude']).toBe(credentialId('claude', 'b'));
  });

  it('makeActive switches to an enabled login', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.add('b', { type: 'config-dir', dir: '~/.b' }, 'claude');
    d.accounts.setActive('a');
    const h = buildAuthHandlers(d);
    const view = (await h.makeActive!.handle({ id: credentialId('claude', 'b') })) as AuthView;
    expect(view.activeByProvider['claude']).toBe(credentialId('claude', 'b'));
  });

  it('clearCooldown clears a service key breaker cooldown', async () => {
    const d = freshDeps(home);
    const path = webKeyFilePath(home, 'tavily-1');
    d.web.addCredential('search', 'tavily', { type: 'key-file', path });
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);
    const h = buildAuthHandlers(d);
    await h.clearCooldown!.handle({ id: credentialId('tavily', 'tavily-1') });
    expect(d.keys.isCoolingDown(`tavily:${path}`, Date.now())).toBe(false);
  });

  it('removeCredential (backend) removes the account, unlinks its key file, and promotes an heir', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'a', secret: 'k-a' });
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'b', secret: 'k-b' });
    d.accounts.setActive('a');
    const aPath = d.accounts.listByProvider('deepseek').find((x) => x.label === 'a')?.locator;
    const view = (await h.removeCredential!.handle({
      id: credentialId('deepseek', 'a'),
    })) as AuthView;
    expect(view.credentials.map((c) => c.label)).toEqual(['b']);
    expect(view.activeByProvider['deepseek']).toBe(credentialId('deepseek', 'b'));
    if (aPath !== undefined && aPath.type === 'key-file')
      expect(existsSync(aPath.path)).toBe(false);
  });

  it('removeCredential (service) unlinks the key file when no chain references it anymore', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'tv-key' });
    const path = webKeyFilePath(home, 'k1');
    expect(existsSync(path)).toBe(true);
    const view = (await h.removeCredential!.handle({
      id: credentialId('tavily', 'k1'),
    })) as AuthView;
    expect(view.credentials.find((c) => c.label === 'k1')).toBeUndefined();
    expect(existsSync(path)).toBe(false);
  });

  it("removeCredential (service) clears the label's breaker cooldown, so a re-added same-label key is not cooling", async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'tv-key' });
    const path = webKeyFilePath(home, 'k1');
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);

    await h.removeCredential!.handle({ id: credentialId('tavily', 'k1') });
    const view = (await h.addCredential!.handle({
      providerId: 'tavily',
      label: 'k1',
      secret: 'tv-key-2',
    })) as AuthView;

    expect(view.credentials.find((c) => c.label === 'k1')?.coolingSec).toBeUndefined();
    expect(d.keys.isCoolingDown(`tavily:${path}`, Date.now())).toBe(false);
  });

  it('removeCredential is a no-op for an unsupported provider', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const before = (await h.authView!.handle(undefined)) as AuthView;
    const after = (await h.removeCredential!.handle({ id: credentialId('exa', 'x') })) as AuthView;
    expect(after).toEqual(before);
  });

  it('replaceSecret (backend key-file) rewrites the same path and clears its cooldown', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'ds', secret: 'old-secret' });
    const path = (d.accounts.listByProvider('deepseek')[0]?.locator as { path: string }).path;
    d.keys.markCooldown(`deepseek:${path}`, Date.now() + 60_000);

    await h.replaceSecret!.handle({ id: credentialId('deepseek', 'ds'), secret: 'new-secret' });

    expect(readFileSync(path, 'utf8')).toBe('new-secret');
    expect(d.keys.isCoolingDown(`deepseek:${path}`, Date.now())).toBe(false);
    expect(readFileSync(accountsPath(home), 'utf8')).not.toContain('new-secret');
  });

  it('replaceSecret (service) rewrites the same key file and clears its cooldown', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'old-key' });
    const path = webKeyFilePath(home, 'k1');
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);

    await h.replaceSecret!.handle({ id: credentialId('tavily', 'k1'), secret: 'new-key' });

    expect(readFileSync(path, 'utf8')).toBe('new-key');
    expect(d.keys.isCoolingDown(`tavily:${path}`, Date.now())).toBe(false);
  });

  it('replaceSecret is a no-op for a pointer credential (config-dir)', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    const h = buildAuthHandlers(d);
    const view = (await h.replaceSecret!.handle({
      id: credentialId('claude', 'a'),
      secret: 'ignored',
    })) as AuthView;
    expect(view.credentials.find((c) => c.label === 'a')?.masked).toBe('~/.a');
  });

  it('addProvider records the provider as added', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const view = (await h.addProvider!.handle({ providerId: 'longcat' })) as AuthView;
    expect(view.added).toContain('longcat');
  });

  it('removeProvider (backend) cascades: drops every credential and unlinks its key files', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addProvider!.handle({ providerId: 'deepseek' });
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'a', secret: 'k-a' });
    const path = (d.accounts.listByProvider('deepseek')[0]?.locator as { path: string }).path;

    const view = (await h.removeProvider!.handle({ providerId: 'deepseek' })) as AuthView;

    expect(view.added).not.toContain('deepseek');
    expect(view.credentials.some((c) => c.providerId === 'deepseek')).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('removeProvider (service) cascades across every chain it serves and unlinks the shared key', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'tv-key' });
    const path = webKeyFilePath(home, 'k1');

    const view = (await h.removeProvider!.handle({ providerId: 'tavily' })) as AuthView;

    expect(view.chains['search']).not.toContain('tavily');
    expect(view.chains['fetch']).not.toContain('tavily');
    expect(existsSync(path)).toBe(false);
  });

  it('setProviderEnabled (backend) benches the whole provider via console state', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addProvider!.handle({ providerId: 'deepseek' });
    const view = (await h.setProviderEnabled!.handle({
      providerId: 'deepseek',
      on: false,
    })) as AuthView;
    expect(view.enabled['deepseek']).toBe(false);
  });

  // REQUIRED (carried from Task 5's review): locks in the assembler's service-bench branch.
  it('setProviderEnabled (service) round-trips: benching tavily reports enabled === false', async () => {
    const d = freshDeps(home);
    const h = buildAuthHandlers(d);
    await h.addCredential!.handle({ providerId: 'tavily', label: 'k1', secret: 'tv-key' });
    const view = (await h.setProviderEnabled!.handle({
      providerId: 'tavily',
      on: false,
    })) as AuthView;
    expect(view.enabled['tavily']).toBe(false);
  });

  it('setProviderEnabled is a no-op for an unsupported provider', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const before = (await h.authView!.handle(undefined)) as AuthView;
    const after = (await h.setProviderEnabled!.handle({
      providerId: 'exa',
      on: false,
    })) as AuthView;
    expect(after).toEqual(before);
  });

  it('refresh just re-projects the current view', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    const h = buildAuthHandlers(d);
    const view = (await h.refresh!.handle(undefined)) as AuthView;
    expect(view.credentials.map((c) => c.label)).toContain('a');
  });
});

describe('login verbs', () => {
  it('startLogin → loginState reflects the flow; cancelLogin returns idle', async () => {
    const d = freshDeps(home);
    const loginManager = new LoginManager(d.accounts, fakeLoginDriver(home));
    const h = buildAuthHandlers({ ...d, loginManager });

    const started = await h.startLogin!.handle({ email: 'a@x.org' });
    expect(started).toMatchObject({ phase: 'launching', email: 'a@x.org' });
    expect(await h.loginState!.handle(undefined)).toMatchObject({ phase: 'launching' });
    expect(await h.cancelLogin!.handle(undefined)).toEqual({ phase: 'idle' });
  });

  it('probeHealth probes every claude dir and returns the health-threaded view', async () => {
    const d = freshDeps(home);
    d.accounts.add('work', { type: 'config-dir', dir: join(home, 'claude-work') }, 'claude');
    const driver = fakeLoginDriver(home);
    driver.probeQueue.push({ loggedIn: false }); // scripted: needs a fresh login
    const loginManager = new LoginManager(d.accounts, driver);
    const h = buildAuthHandlers({ ...d, loginManager });

    const view = (await h.probeHealth!.handle(undefined)) as AuthView;
    expect(view.credentials.find((c) => c.id === 'claude:work')?.health).toBe('needs-relogin');
  });

  it('reportAuthFailure flips the account and returns the fresh view', async () => {
    const d = freshDeps(home);
    d.accounts.add('work', { type: 'config-dir', dir: join(home, 'claude-work') }, 'claude');
    const loginManager = new LoginManager(d.accounts, fakeLoginDriver(home));
    const h = buildAuthHandlers({ ...d, loginManager });

    const view = (await h.reportAuthFailure!.handle({ credentialId: 'claude:work' })) as AuthView;
    expect(view.credentials.find((c) => c.id === 'claude:work')?.health).toBe('needs-relogin');
  });

  it('without a manager every login verb degrades to idle, never throws', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    expect(await h.startLogin!.handle({ email: 'a@x.org' })).toEqual({ phase: 'idle' });
    expect(await h.loginState!.handle(undefined)).toEqual({ phase: 'idle' });
    expect(await h.submitLoginCode!.handle({ code: '123456' })).toEqual({ phase: 'idle' });
    expect(await h.cancelLogin!.handle(undefined)).toEqual({ phase: 'idle' });
    expect(await h.resolveLoginMismatch!.handle({ action: 'keep' })).toEqual({ phase: 'idle' });
    const view = (await h.probeHealth!.handle(undefined)) as AuthView;
    expect(view.credentials).toEqual(expect.any(Array));
  });

  it('bad params on a login verb are an invalid-params error over the router', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const res = await call(h, 'startLogin', { email: 'ab' });
    expect(res).toMatchObject({ error: { code: -32602 } });
  });
});

describe('browser session over the auth verbs', () => {
  function browserStub(reclaimable: string[] = []): {
    removed: string[];
    reclaimed: string[];
    view: BrowserSessionView;
  } {
    const removed: string[] = [];
    const reclaimed: string[] = [];
    const jars = [...reclaimable];
    return {
      removed,
      reclaimed,
      view: {
        enabled: () => true,
        available: () => true,
        detected: () => 'C:\\chrome.exe',
        override: () => undefined,
        hasProfile: () => true,
        removeProfile: (email: string) => void removed.push(email),
        listReclaimable: () => [...jars],
        reclaimProfile: (key: string) => {
          reclaimed.push(key);
          jars.splice(jars.indexOf(key), 1);
        },
      },
    };
  }

  it('reports the browser session on the view', async () => {
    const h = buildAuthHandlers({ ...freshDeps(home), browser: browserStub().view });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.browserSession).toEqual({
      enabled: true,
      available: true,
      detectedPath: 'C:\\chrome.exe',
      reclaimable: [],
    });
  });

  it('surfaces jars no account resolves to, and deletes the ones asked for', async () => {
    const stub = browserStub(['ghost-a-1a2b3c', 'ghost-b-4d5e6f']);
    const h = buildAuthHandlers({ ...freshDeps(home), browser: stub.view });
    const before = (await h.authView!.handle(undefined)) as AuthView;
    expect(before.browserSession.reclaimable).toEqual(['ghost-a-1a2b3c', 'ghost-b-4d5e6f']);

    const after = (await h.reclaimBrowserProfiles!.handle({
      names: ['ghost-a-1a2b3c'],
    })) as AuthView;
    expect(stub.reclaimed).toEqual(['ghost-a-1a2b3c']);
    expect(after.browserSession.reclaimable).toEqual(['ghost-b-4d5e6f']);
  });

  /** The verb only ever acts on something the view itself offered, so a name from a stale
   *  renderer — or a hand-written request naming a live account's jar — reaches nothing. */
  it('ignores a name the view never offered', async () => {
    const stub = browserStub(['ghost-a-1a2b3c']);
    const h = buildAuthHandlers({ ...freshDeps(home), browser: stub.view });
    await h.reclaimBrowserProfiles!.handle({ names: ['some-live-jar-9z8y7x'] });
    expect(stub.reclaimed).toEqual([]);
  });

  it('has nothing to reclaim when no browser session is wired at all', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const view = (await h.reclaimBrowserProfiles!.handle({ names: ['anything'] })) as AuthView;
    expect(view.browserSession.reclaimable).toEqual([]);
  });

  it('floors the browser session when the daemon has none', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.browserSession).toEqual({ enabled: false, available: false, reclaimable: [] });
  });

  it('persists the toggle and reads it back', async () => {
    const deps = freshDeps(home);
    const h = buildAuthHandlers(deps);
    await h.setIsolatedBrowserLogins!.handle({ on: true });
    expect(deps.console.read().isolatedBrowserLogins).toBe(true);
    await h.setIsolatedBrowserLogins!.handle({ on: false });
    expect(deps.console.read().isolatedBrowserLogins).toBe(false);
  });

  it('stores a browser override and clears it on empty', async () => {
    const deps = freshDeps(home);
    const h = buildAuthHandlers(deps);
    await h.setBrowserPath!.handle({ path: 'D:\\brave.exe' });
    expect(deps.console.read().browserPath).toBe('D:\\brave.exe');
    await h.setBrowserPath!.handle({ path: '' });
    expect(deps.console.read().browserPath).toBeUndefined();
  });

  it('marks a credential whose account has a profile', async () => {
    const deps = freshDeps(home);
    deps.accounts.add(
      'a@b.org',
      { type: 'config-dir', dir: 'D' },
      'claude',
      'a@b.org',
      'abc123abc123',
    );
    const h = buildAuthHandlers({ ...deps, browser: browserStub().view });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.credentials.find((c) => c.label === 'a@b.org')?.hasProfile).toBe(true);
  });

  it('deletes the profile with the credential only when asked', async () => {
    const deps = freshDeps(home);
    deps.accounts.add(
      'a@b.org',
      { type: 'config-dir', dir: 'D' },
      'claude',
      'a@b.org',
      'abc123abc123',
    );
    deps.accounts.add(
      'c@d.org',
      { type: 'config-dir', dir: 'E' },
      'claude',
      'c@d.org',
      'def456def456',
    );
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });

    await h.removeCredential!.handle({ id: credentialId('claude', 'a@b.org') });
    expect(browser.removed).toEqual([]);

    await h.removeCredential!.handle({
      id: credentialId('claude', 'c@d.org'),
      removeProfile: true,
    });
    expect(browser.removed).toEqual(['c@d.org']);
  });

  /** Removal means removal for what coa created: leaving the sign-in behind is what let a
   *  re-added account silently resurrect a session the user thought they had removed
   *  (docs/adr/0023). */
  it('deletes the login dir coa created, along with the row', async () => {
    const deps = freshDeps(home);
    const dir = join(home, '.coa', 'logins', 'a-b-org');
    mkdirSync(dir, { recursive: true });
    deps.accounts.add('a@b.org', { type: 'config-dir', dir }, 'claude', 'a@b.org', 'aaa111aaa111');
    const h = buildAuthHandlers(deps);
    await h.removeCredential!.handle({ id: credentialId('claude', 'a@b.org') });
    expect(existsSync(dir)).toBe(false);
  });

  /** The boundary: an account added by pointing at an existing config dir is the user's own
   *  data. coa forgets the row and touches nothing on disk. */
  it('never deletes a config dir the user pointed at', async () => {
    const deps = freshDeps(home);
    const dir = join(home, 'my-own-claude');
    mkdirSync(dir, { recursive: true });
    deps.accounts.add('mine', { type: 'config-dir', dir }, 'claude', 'm@b.org', 'bbb222bbb222');
    const h = buildAuthHandlers(deps);
    await h.removeCredential!.handle({ id: credentialId('claude', 'mine') });
    expect(existsSync(dir)).toBe(true);
  });

  it('takes managed login dirs with a removed provider too', async () => {
    const deps = freshDeps(home);
    const dir = join(home, '.coa', 'logins', 'c-d-org');
    mkdirSync(dir, { recursive: true });
    deps.accounts.add('c@d.org', { type: 'config-dir', dir }, 'claude', 'c@d.org', 'ccc333ccc333');
    const h = buildAuthHandlers(deps);
    await h.removeProvider!.handle({ providerId: 'claude' });
    expect(existsSync(dir)).toBe(false);
  });

  /** One jar can back several rows once it is keyed by identity — a Claude and a Codex login
   *  as the same person. Removing one must not sign the other out (docs/adr/0021). */
  it('keeps a profile another account still signs in with', async () => {
    const deps = freshDeps(home);
    deps.accounts.add(
      'mine',
      { type: 'config-dir', dir: 'D' },
      'claude',
      'same@b.org',
      'aaa111aaa111',
    );
    deps.accounts.add(
      'theirs',
      { type: 'config-dir', dir: 'E' },
      'deepseek',
      'same@b.org',
      'bbb222bbb222',
    );
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });
    await h.removeCredential!.handle({ id: credentialId('claude', 'mine'), removeProfile: true });
    expect(browser.removed).toEqual([]);
  });

  it('deletes every profile a removed provider owned when asked', async () => {
    const deps = freshDeps(home);
    deps.accounts.add(
      'a@b.org',
      { type: 'config-dir', dir: 'D' },
      'claude',
      'a@b.org',
      'abc123abc123',
    );
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });
    await h.removeProvider!.handle({ providerId: 'claude', removeProfiles: true });
    expect(browser.removed).toEqual(['a@b.org']);
  });

  it('deletes no profile a removed provider owned when not asked', async () => {
    const deps = freshDeps(home);
    deps.accounts.add(
      'a@b.org',
      { type: 'config-dir', dir: 'D' },
      'claude',
      'a@b.org',
      'abc123abc123',
    );
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });
    await h.removeProvider!.handle({ providerId: 'claude' });
    expect(browser.removed).toEqual([]);
  });
});

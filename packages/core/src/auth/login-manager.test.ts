import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsRegistry } from './registry.js';
import { LoginManager, type LoginDriverPort } from './login-manager.js';

/** A hand-cranked driver: tests fire url/exit and script the probe queue. */
function fakeDriver(
  home: string,
  opts?: { ptyCaptured?: boolean },
): LoginDriverPort & {
  fireUrl: (u: string) => void;
  fireExit: (code?: number) => void;
  probeQueue: (ReturnType<LoginDriverPort['probe']> extends Promise<infer T> ? T : never)[];
  killed: boolean;
  killCount: number;
  startDirs: string[];
  probeDirs: string[];
  starts: Array<{ dir: string; email: string; browserLauncher?: string }>;
} {
  let urlFn: (u: string) => void = () => {};
  let exitFn: (c: number | undefined) => void = () => {};
  const ptyCaptured = opts?.ptyCaptured ?? true;
  const self = {
    home,
    killed: false,
    killCount: 0,
    startDirs: [] as string[],
    probeDirs: [] as string[],
    starts: [] as Array<{ dir: string; email: string; browserLauncher?: string }>,
    probeQueue: [] as (
      | { loggedIn: boolean; email?: string; subscriptionType?: string }
      | undefined
    )[],
    dirFor: (email: string) => join(home, '.coa', 'logins', email.replace(/[^a-z0-9]+/gi, '-')),
    start: (o: { dir: string; email: string; browserLauncher?: string }) => {
      self.startDirs.push(o.dir);
      self.starts.push(o);
      return {
        onUrl: (fn: (u: string) => void) => (urlFn = fn),
        onExit: (fn: (c: number | undefined) => void) => (exitFn = fn),
        writeCode: () => {},
        kill: () => {
          self.killed = true;
          self.killCount += 1;
        },
        ptyCaptured,
      };
    },
    probe: (dir: string) => {
      self.probeDirs.push(dir);
      return Promise.resolve(self.probeQueue.shift());
    },
    fireUrl: (u: string) => urlFn(u),
    fireExit: (c?: number) => exitFn(c),
  };
  return self;
}

let home: string;
let registry: AccountsRegistry;
let driver: ReturnType<typeof fakeDriver>;
let manager: LoginManager;

beforeEach(() => {
  vi.useFakeTimers();
  home = mkdtempSync(join(tmpdir(), 'coa-lm-'));
  registry = new AccountsRegistry(home);
  driver = fakeDriver(home);
  manager = new LoginManager(registry, driver, { pollMs: 100 });
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

describe('LoginManager — the driven flow', () => {
  it('launching → awaiting on the captured url → registered on a matching probe', async () => {
    manager.startLogin({ email: 'alex@barba.org' });
    expect(manager.snapshot()?.phase).toBe('launching');
    driver.fireUrl('https://claude.com/cai/oauth/x');
    expect(manager.snapshot()).toMatchObject({
      phase: 'awaiting',
      oauthUrl: 'https://claude.com/cai/oauth/x',
    });
    driver.probeQueue.push({ loggedIn: true, email: 'alex@barba.org', subscriptionType: 'pro' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()).toMatchObject({
      phase: 'registered',
      identity: 'alex@barba.org · pro',
    });
    const account = registry.list()[0];
    expect(account).toMatchObject({
      label: 'alex@barba.org',
      email: 'alex@barba.org',
      provider: 'claude',
    });
    expect(registry.getActive('claude')).toMatchObject({ kind: 'account' });
  });

  it('a different landed email flags mismatch; keep registers under the landed one', async () => {
    manager.startLogin({ email: 'a@x.org' });
    driver.probeQueue.push({ loggedIn: true, email: 'b@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()).toMatchObject({ phase: 'mismatch', landedEmail: 'b@x.org' });
    expect(registry.list()).toEqual([]); // nothing registered while flagged
    manager.resolveMismatch('keep');
    expect(registry.list()[0]?.email).toBe('b@x.org');
  });

  it('relogin flips health back and backfills a missing declared email', async () => {
    registry.add('old', { type: 'config-dir', dir: '/somewhere' });
    manager.reportAuthFailure('claude:old');
    expect(manager.healthOf('claude:old')).toBe('needs-relogin');
    manager.startLogin({ email: 'old@x.org', credentialId: 'claude:old' });
    driver.probeQueue.push({ loggedIn: true, email: 'old@x.org', subscriptionType: 'pro' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.healthOf('claude:old')).toBe('healthy');
    expect(registry.list()[0]?.email).toBe('old@x.org');
  });

  it("a relogin targets the credential's OWN config dir, not dirFor(email)", async () => {
    registry.add(
      'label-x',
      { type: 'config-dir', dir: '/custom/claude-dir' },
      'claude',
      'old@x.org',
    );
    manager.startLogin({ email: 'old@x.org', credentialId: 'claude:label-x' });
    expect(driver.startDirs).toContain('/custom/claude-dir');
    driver.probeQueue.push({ loggedIn: true, email: 'old@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(driver.probeDirs).toContain('/custom/claude-dir');
  });

  it('a relogin for an account missing/without a config-dir locator falls back to dirFor(email)', async () => {
    manager.startLogin({ email: 'ghost@x.org', credentialId: 'claude:ghost' });
    expect(driver.startDirs).toContain(driver.dirFor('ghost@x.org'));
  });

  it('a mismatch resolved "keep" on a relogin unconditionally updates the declared email', async () => {
    registry.add('old', { type: 'config-dir', dir: '/somewhere' }, 'claude', 'old@x.org');
    manager.startLogin({ email: 'old@x.org', credentialId: 'claude:old' });
    driver.probeQueue.push({ loggedIn: true, email: 'new@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).toBe('mismatch');
    manager.resolveMismatch('keep');
    expect(registry.list().find((a) => a.label === 'old')?.email).toBe('new@x.org');
  });

  it('driver exit + a still-logged-out probe fails the flow; cancel kills and clears', async () => {
    manager.startLogin({ email: 'a@x.org' });
    driver.fireExit(1);
    driver.probeQueue.push({ loggedIn: false });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).toBe('failed');
    manager.cancelLogin();
    expect(manager.snapshot()).toBeUndefined();
    expect(driver.killed).toBe(true);
  });

  it('a duplicate label lands with a numeric suffix', async () => {
    registry.add('a@x.org', { type: 'config-dir', dir: '/pre' }, 'claude', 'a@x.org');
    manager.startLogin({ email: 'a@x.org' });
    driver.probeQueue.push({ loggedIn: true, email: 'a@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(registry.list().map((a) => a.label)).toContain('a@x.org-2');
  });

  it('a non-duplicate registry.add failure fails the flow instead of retrying forever', async () => {
    vi.spyOn(registry, 'add').mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    manager.startLogin({ email: 'a@x.org' });
    driver.probeQueue.push({ loggedIn: true, email: 'a@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()).toMatchObject({
      phase: 'failed',
      error: 'EACCES: permission denied',
    });
  });

  it('an unknown grace probe after exit does not fail the flow; a later probe still registers', async () => {
    manager.startLogin({ email: 'a@x.org' });
    driver.fireExit(1);
    driver.probeQueue.push(undefined); // grace probe: CLI unreachable — not a verdict
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).not.toBe('failed');
    driver.probeQueue.push({ loggedIn: true, email: 'a@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).toBe('registered');
  });

  it('a degraded driver (no pty) advances launching → awaiting on the first poll tick, with no url', async () => {
    const degradedDriver = fakeDriver(home, { ptyCaptured: false });
    const degradedManager = new LoginManager(registry, degradedDriver, { pollMs: 100 });
    degradedManager.startLogin({ email: 'alex@barba.org' });
    expect(degradedManager.snapshot()?.phase).toBe('launching');
    degradedDriver.probeQueue.push({ loggedIn: false });
    await vi.advanceTimersByTimeAsync(150);
    expect(degradedManager.snapshot()).toMatchObject({ phase: 'awaiting', ptyCaptured: false });
    expect(degradedManager.snapshot()?.oauthUrl).toBeUndefined();
    degradedDriver.probeQueue.push({ loggedIn: true, email: 'alex@barba.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(degradedManager.snapshot()?.phase).toBe('registered');
  });

  it('a non-degraded driver stays launching on a not-logged-in poll tick (no url yet)', async () => {
    manager.startLogin({ email: 'alex@barba.org' });
    driver.probeQueue.push({ loggedIn: false });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).toBe('launching');
  });

  it('resolveMismatch("retry") kills the driver exactly once and restarts a fresh flow at the same email', async () => {
    manager.startLogin({ email: 'a@x.org' });
    driver.probeQueue.push({ loggedIn: true, email: 'b@x.org' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()?.phase).toBe('mismatch');
    manager.resolveMismatch('retry');
    expect(manager.snapshot()).toMatchObject({ phase: 'launching', email: 'a@x.org' });
    expect(driver.killCount).toBe(1);
  });
});

describe('LoginManager — probeAll', () => {
  it('maps loggedIn to health, caches identity, backfills email, and leaves unknown untouched', async () => {
    registry.add('one', { type: 'config-dir', dir: '/1' });
    registry.add('two', { type: 'config-dir', dir: '/2' });
    registry.add('key', { type: 'key-file', path: '/k' }, 'deepseek'); // never probed
    driver.probeQueue.push({ loggedIn: true, email: 'one@x.org', subscriptionType: 'pro' });
    driver.probeQueue.push({ loggedIn: false });
    await manager.probeAll();
    expect(manager.healthOf('claude:one')).toBe('healthy');
    expect(manager.identityOf('claude:one')).toEqual({ email: 'one@x.org', plan: 'pro' });
    expect(registry.list().find((a) => a.label === 'one')?.email).toBe('one@x.org');
    expect(manager.healthOf('claude:two')).toBe('needs-relogin');

    driver.probeQueue.push(undefined); // CLI unreachable on the next sweep
    driver.probeQueue.push(undefined);
    await manager.probeAll();
    expect(manager.healthOf('claude:two')).toBe('needs-relogin'); // unknown ≠ a verdict
  });
});

describe('isolated browser sessions', () => {
  it('hands the driver the launcher the browser session gives it', () => {
    const driver = fakeDriver(home);
    const seen: string[] = [];
    const manager = new LoginManager(new AccountsRegistry(home), driver, {
      browserSession: {
        launcherFor: (accountId) => {
          seen.push(accountId);
          return `L:${accountId}`;
        },
      },
    });
    manager.startLogin({ email: 'a@b.org' });
    expect(seen).toHaveLength(1);
    expect(driver.starts[0]?.browserLauncher).toBe(`L:${seen[0]}`);
  });

  it('starts a plain login when there is no browser session at all', () => {
    const driver = fakeDriver(home);
    const manager = new LoginManager(new AccountsRegistry(home), driver);
    manager.startLogin({ email: 'a@b.org' });
    expect(driver.starts[0] && 'browserLauncher' in driver.starts[0]).toBe(false);
  });

  it('starts a plain login when the session declines to isolate', () => {
    const driver = fakeDriver(home);
    const manager = new LoginManager(new AccountsRegistry(home), driver, {
      browserSession: { launcherFor: () => undefined },
    });
    manager.startLogin({ email: 'a@b.org' });
    expect(driver.starts[0] && 'browserLauncher' in driver.starts[0]).toBe(false);
  });

  it('registers the new account under the SAME id its profile was keyed by', async () => {
    const driver = fakeDriver(home);
    const registry = new AccountsRegistry(home);
    let keyed: string | undefined;
    const manager = new LoginManager(registry, driver, {
      pollMs: 1,
      browserSession: {
        launcherFor: (accountId) => {
          keyed = accountId;
          return undefined;
        },
      },
    });
    manager.startLogin({ email: 'a@b.org' });
    driver.probeQueue.push({ loggedIn: true, email: 'a@b.org', subscriptionType: 'pro' });
    await vi.waitFor(() => expect(manager.snapshot()?.phase).toBe('registered'));
    expect(registry.list()[0]?.id).toBe(keyed);
  });

  it('reuses the existing account id on a relogin', () => {
    const driver = fakeDriver(home);
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'config-dir', dir: 'D' }, 'claude', 'a@b.org', 'feedface0001');
    const seen: string[] = [];
    const manager = new LoginManager(registry, driver, {
      browserSession: {
        launcherFor: (accountId) => {
          seen.push(accountId);
          return undefined;
        },
      },
    });
    manager.startLogin({ email: 'a@b.org', credentialId: 'claude:a@b.org' });
    expect(seen).toEqual(['feedface0001']);
  });
});

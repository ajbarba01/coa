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
} {
  let urlFn: (u: string) => void = () => {};
  let exitFn: (c: number | undefined) => void = () => {};
  const ptyCaptured = opts?.ptyCaptured ?? true;
  const self = {
    home,
    killed: false,
    killCount: 0,
    probeQueue: [] as ({ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined)[],
    dirFor: (email: string) => join(home, '.coa', 'logins', email.replace(/[^a-z0-9]+/gi, '-')),
    start: () => ({
      onUrl: (fn: (u: string) => void) => (urlFn = fn),
      onExit: (fn: (c: number | undefined) => void) => (exitFn = fn),
      writeCode: () => {},
      kill: () => {
        self.killed = true;
        self.killCount += 1;
      },
      ptyCaptured,
    }),
    probe: () => Promise.resolve(self.probeQueue.shift()),
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
    expect(manager.snapshot()).toMatchObject({ phase: 'awaiting', oauthUrl: 'https://claude.com/cai/oauth/x' });
    driver.probeQueue.push({ loggedIn: true, email: 'alex@barba.org', subscriptionType: 'pro' });
    await vi.advanceTimersByTimeAsync(150);
    expect(manager.snapshot()).toMatchObject({ phase: 'registered', identity: 'alex@barba.org · pro' });
    const account = registry.list()[0];
    expect(account).toMatchObject({ label: 'alex@barba.org', email: 'alex@barba.org', provider: 'claude' });
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

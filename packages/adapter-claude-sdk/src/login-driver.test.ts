import { describe, expect, it, vi } from 'vitest';
import { emailSlug, extractOauthUrl, managedLoginDir } from './login-driver.js';

/** Forces `spawnLogin`'s `import('node-pty')` to fail deterministically (regardless of
 *  whether the optional dep happens to be installed in this environment), so every test
 *  below exercises the degraded plain-pipe branch — never a real pty, never a real
 *  `claude` process. */
vi.mock('node-pty', () => {
  throw new Error('node-pty unavailable in tests');
});

/** A fake `child_process.spawn()` result: enough surface for `spawnLogin`'s pipe branch
 *  (`stdin.write`, `stdout`/`stderr.on`, `on('close'|'error')`, `kill`) without ever
 *  actually spawning a process. */
const fakeChild = vi.hoisted(() => ({
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
}));
const spawnMock = vi.hoisted(() => vi.fn(() => fakeChild));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

/** Flush the microtask queue past the `try { await import(...) } catch { spawn(...) }`
 *  chain inside `spawnLogin`'s fire-and-forget IIFE. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('emailSlug', () => {
  it('flattens an email to a filesystem-safe slug', () => {
    expect(emailSlug('Alex@Barba.org')).toBe('alex-barba-org');
    expect(emailSlug('a+test@b.co')).toBe('a-test-b-co');
  });
  it('collapses runs and trims edge dashes', () => {
    expect(emailSlug('--a..b@c--')).toBe('a-b-c');
  });
});

describe('managedLoginDir', () => {
  it('derives ~/.coa/logins/<slug>', () => {
    expect(managedLoginDir('/home/z', 'alex@barba.org').replaceAll('\\', '/')).toBe(
      '/home/z/.coa/logins/alex-barba-org',
    );
  });
});

describe('extractOauthUrl', () => {
  it('captures the printed authorize URL from CLI output', () => {
    const chunk =
      'If the browser didn\'t open, visit:\r\n  https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&scope=user%3Ainference\r\n';
    expect(extractOauthUrl(chunk)).toBe(
      'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&scope=user%3Ainference',
    );
  });
  it('sees through ANSI escapes and ignores non-oauth urls', () => {
    expect(extractOauthUrl('\x1b[1mvisit https://claude.ai/cai/oauth/x?y=1\x1b[0m')).toBe(
      'https://claude.ai/cai/oauth/x?y=1',
    );
    expect(extractOauthUrl('see https://docs.claude.com/help')).toBeUndefined();
  });
});

describe('spawnLogin — kill-before-spawn race', () => {
  it('kills the just-spawned child when kill() fired before the async import/spawn settled', async () => {
    const { spawnLogin } = await import('./login-driver.js');
    const proc = spawnLogin({ dir: '/tmp/coa-login', email: 'a@x.org' });
    // Synchronous — fires in the same tick, well before the `await import('node-pty')`
    // (forced to reject above) and the subsequent `spawn()` fallback have resolved.
    proc.kill();
    await flush();
    await flush();
    expect(spawnMock).toHaveBeenCalled();
    expect(fakeChild.kill).toHaveBeenCalled();
  });
});

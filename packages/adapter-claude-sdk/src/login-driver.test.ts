import { describe, expect, it, vi } from 'vitest';
import {
  emailSlug,
  extractOauthUrl,
  loginEnv,
  managedLoginDir,
  resolveClaudeCommand,
} from './login-driver.js';

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
      "If the browser didn't open, visit:\r\n  https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&scope=user%3Ainference\r\n";
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
  /** On a TTY — which the PTY branch always is — the CLI prints the url as an OSC 8
   *  hyperlink (`ESC]8;;URL ESC\ URL ESC]8;;ESC\`), so the url arrives TWICE with only a
   *  non-whitespace terminator between the copies. Stripping SGR alone left that intact and
   *  `\S*` swallowed all of it, splicing the second copy into the first url's `login_hint`
   *  and prefilling the sign-in page's email box with `<email>\https://…`. Invisible to the
   *  pipe branch, which gets no hyperlinks. */
  it('captures one url from an OSC 8 hyperlink, not both copies', () => {
    const url = 'https://claude.com/cai/oauth/authorize?code=true&state=ab&login_hint=z%40e.com';
    expect(extractOauthUrl(`visit: \x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\\r\n`)).toBe(url);
  });
  it('handles a BEL-terminated hyperlink too', () => {
    const url = 'https://claude.ai/cai/oauth/authorize?code=true&state=cd';
    expect(extractOauthUrl(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`)).toBe(url);
  });
});

describe('resolveClaudeCommand', () => {
  /** The native installer ships `claude.exe` and NO `.cmd` shim. Assuming the shim made
   *  node-pty's spawn throw, silently degrading every native install to the pipe branch —
   *  so the OAuth URL was never captured and the in-app copy-link was permanently dark. */
  it('finds the native exe on win32 when no shim exists', () => {
    const exists = (p: string): boolean => p === 'C:\\Users\\z\\.local\\bin\\claude.exe';
    expect(resolveClaudeCommand('win32', ['C:\\Users\\z\\.local\\bin'], exists)).toBe(
      'C:\\Users\\z\\.local\\bin\\claude.exe',
    );
  });

  it('still finds the npm shim on win32 when that is what is installed', () => {
    const exists = (p: string): boolean => p === 'C:\\npm\\claude.cmd';
    expect(resolveClaudeCommand('win32', ['C:\\npm'], exists)).toBe('C:\\npm\\claude.cmd');
  });

  it('scans PATH entries in order', () => {
    const exists = (p: string): boolean => p === 'C:\\second\\claude.exe';
    expect(resolveClaudeCommand('win32', ['C:\\first', 'C:\\second'], exists)).toBe(
      'C:\\second\\claude.exe',
    );
  });

  it('resolves the bare name on posix', () => {
    const exists = (p: string): boolean => p === '/usr/local/bin/claude';
    expect(resolveClaudeCommand('linux', ['/usr/local/bin'], exists)).toBe('/usr/local/bin/claude');
  });

  /** Never throw and never block: an unresolvable binary degrades to the bare name so the
   *  pipe branch's shell resolution still gets its chance (SC-1 — help, never cage). */
  it('falls back to the bare name when nothing is found', () => {
    expect(resolveClaudeCommand('win32', ['C:\\nowhere'], () => false)).toBe('claude');
    expect(resolveClaudeCommand('linux', ['/nowhere'], () => false)).toBe('claude');
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

describe('loginEnv', () => {
  it('points the CLI at the managed config dir', () => {
    const env = loginEnv({ PATH: '/bin' }, { dir: 'D' });
    expect(env['CLAUDE_CONFIG_DIR']).toBe('D');
    expect(env['PATH']).toBe('/bin');
  });

  it('leaves BROWSER exactly as the environment had it when no launcher is given', () => {
    expect(loginEnv({ BROWSER: 'firefox' }, { dir: 'D' })['BROWSER']).toBe('firefox');
    expect(loginEnv({}, { dir: 'D' })).not.toHaveProperty('BROWSER');
  });

  it('redirects the browser-open to the launcher when one is given', () => {
    const env = loginEnv({ BROWSER: 'firefox' }, { dir: 'D', browserLauncher: 'C:\\l.cmd' });
    expect(env['BROWSER']).toBe('C:\\l.cmd');
  });
});

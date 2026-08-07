import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BrowserSession,
  browserArgs,
  browserCandidates,
  browserProfileDir,
  browserUserDataDir,
  courierPath,
  courierScript,
  detectBrowser,
  isSafeBrowserPath,
  isSafeProfileKey,
  launcherPath,
  profileKey,
  unwrapCourierUrl,
  type BrowserSessionSettings,
} from './browser-session.js';

const WIN_ENV = {
  LOCALAPPDATA: 'C:\\Users\\z\\AppData\\Local',
  PROGRAMFILES: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

describe('browser detection', () => {
  it('offers chrome before edge, across every install root', () => {
    const candidates = browserCandidates('win32', WIN_ENV);
    expect(candidates[0]).toBe(
      'C:\\Users\\z\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    );
    expect(candidates).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain(
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
    const firstEdge = candidates.findIndex((c) => c.endsWith('msedge.exe'));
    const lastChrome = candidates.map((c) => c.endsWith('chrome.exe')).lastIndexOf(true);
    expect(lastChrome).toBeLessThan(firstEdge);
  });

  it('has no candidates off win32 — detection there is a later platform', () => {
    expect(browserCandidates('darwin', WIN_ENV)).toEqual([]);
    expect(browserCandidates('linux', WIN_ENV)).toEqual([]);
  });

  it('skips install roots the environment does not define', () => {
    expect(browserCandidates('win32', { PROGRAMFILES: 'C:\\Program Files' })).toEqual([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]);
  });

  it('detects the first candidate that exists', () => {
    const edge = 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(detectBrowser('win32', WIN_ENV, (p) => p === edge)).toBe(edge);
  });

  it('detects nothing when no candidate exists', () => {
    expect(detectBrowser('win32', WIN_ENV, () => false)).toBeUndefined();
    expect(detectBrowser('darwin', WIN_ENV, () => true)).toBeUndefined();
  });
});

describe('profile keying', () => {
  it('accepts a derived key and rejects anything that could escape the profile root', () => {
    expect(isSafeProfileKey('a-b-c-com-4f9a2c')).toBe(true);
    expect(isSafeProfileKey('9f2c1ab30d44')).toBe(true);
    expect(isSafeProfileKey('')).toBe(false);
    expect(isSafeProfileKey('..')).toBe(false);
    expect(isSafeProfileKey('a/b')).toBe(false);
    expect(isSafeProfileKey('a\\b')).toBe(false);
    expect(isSafeProfileKey('a@b.org')).toBe(false);
  });

  /** The jar belongs to an IDENTITY, not to an account row (docs/adr/0021). Keying it by
   *  email is what lets a relogin reuse a signed-in session, lets Claude and a future Codex
   *  account share one jar, and stops a deleted row from stranding its directory. */
  it('derives the same key for the same identity however it was typed', () => {
    expect(profileKey('  Wormsegment1000@Gmail.COM ')).toBe(
      profileKey('wormsegment1000@gmail.com'),
    );
  });

  /** The reason a bare slug could not be the key: `emailSlug` collapses every non-alphanumeric
   *  run to `-`, so these three collapse together and would have shared one cookie jar. */
  it('separates identities a slug alone would collide', () => {
    const keys = [profileKey('a.b@c.com'), profileKey('a-b@c.com'), profileKey('a+b@c.com')];
    expect(new Set(keys).size).toBe(3);
  });

  it('stays readable, so the profile root can be inspected by a human', () => {
    expect(profileKey('wormsegment1000@gmail.com')).toMatch(
      /^wormsegment1000-gmail-com-[0-9a-f]+$/,
    );
  });

  it('has no key for an identity that is not one', () => {
    expect(profileKey('')).toBeUndefined();
    expect(profileKey('   ')).toBeUndefined();
  });

  it('keys the profile dir by that key inside the shared user-data-dir', () => {
    expect(browserProfileDir('/home/z', '9f2c')).toBe(
      ['', 'home', 'z', '.coa', 'browser-session', 'profiles', '9f2c'].join(sep),
    );
  });

  it('holds every jar in ONE user-data-dir, so the heavy half is paid once', () => {
    expect(browserProfileDir('/home/z', 'a')).toContain(browserUserDataDir('/home/z'));
    expect(browserProfileDir('/home/z', 'b')).toContain(browserUserDataDir('/home/z'));
  });

  it('parks the launcher outside the user-data-dir, so coa files never mix with chrome ones', () => {
    expect(launcherPath('/home/z', '9f2c', 'win32').endsWith('9f2c.cmd')).toBe(true);
    expect(launcherPath('/home/z', '9f2c', 'linux').endsWith('9f2c.sh')).toBe(true);
    expect(launcherPath('/home/z', '9f2c', 'win32').startsWith(browserUserDataDir('/home/z'))).toBe(
      false,
    );
  });
});

describe('override path safety', () => {
  it('accepts an ordinary install path', () => {
    expect(isSafeBrowserPath('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe(
      true,
    );
  });

  it('rejects a quote, a percent sign, and a newline — each breaks the shim differently', () => {
    expect(isSafeBrowserPath('C:\\evil".exe')).toBe(false);
    expect(isSafeBrowserPath('C:\\evil%CD%.exe')).toBe(false);
    expect(isSafeBrowserPath('C:\\evil\r\n.exe')).toBe(false);
  });
});

describe('courier script', () => {
  const FILE = 'C:\\home\\.coa\\browser-profiles\\9f2c.url';

  /** `%1` splits on `=`, so it arrives truncated at the url's first one; `%*` is the raw
   *  remainder of the command line and survives whole. Delayed expansion is what keeps the
   *  url's `&` from being reparsed as a command separator when the variable is read back. */
  it('relays the whole command line on win32, not the first token', () => {
    const script = courierScript('win32', FILE);
    expect(script).toBe(
      '@echo off\r\nsetlocal enabledelayedexpansion\r\nset "u=%*"\r\n' +
        `>"${FILE}" echo(!u!\r\nexit /b 0\r\n`,
    );
    expect(script).not.toContain('%1');
  });

  it('writes the argument verbatim on posix, where tokenization was never the problem', () => {
    expect(courierScript('linux', '/home/z/.coa/browser-profiles/9f2c.url')).toBe(
      '#!/bin/sh\nprintf \'%s\' "$1" > "/home/z/.coa/browser-profiles/9f2c.url"\nexit 0\n',
    );
  });

  it('parks the relayed url beside the launcher it belongs to', () => {
    expect(courierPath('/home/z', '9f2c')).toBe(
      ['', 'home', 'z', '.coa', 'browser-session', '9f2c.url'].join(sep),
    );
  });
});

describe('unwrapCourierUrl', () => {
  const URL = 'https://claude.com/cai/oauth/authorize?code=true&state=2&login_hint=a%40b.com';

  /** win32 hands the shim the url already escaped POSIX-style, so what lands in the file is
   *  the url wrapped in `"` and `\"`. POSIX writes it bare. One reader handles both. */
  it('unwraps the quoted form win32 produces', () => {
    expect(unwrapCourierUrl(`"\\"${URL}\\""`)).toBe(URL);
  });

  it('accepts the bare form posix produces, trailing newline and all', () => {
    expect(unwrapCourierUrl(`${URL}\r\n`)).toBe(URL);
  });

  it('treats anything that is not an authorize url as no url at all', () => {
    expect(unwrapCourierUrl('')).toBeUndefined();
    expect(unwrapCourierUrl('   \r\n')).toBeUndefined();
    expect(unwrapCourierUrl('ECHO is off.')).toBeUndefined();
    expect(unwrapCourierUrl('https://evil.example/oauth/authorize?x=1')).toBeUndefined();
  });
});

describe('browser args', () => {
  it('builds one argv element per flag, url last — nothing for a shell to mis-split', () => {
    expect(browserArgs('C:\\p', '9f2c', 'https://x/y?a=1&b=2')).toEqual([
      '--user-data-dir=C:\\p',
      '--profile-directory=9f2c',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-features=OptimizationHints,OptimizationGuideModelDownloading',
      '--disable-gpu-shader-disk-cache',
      'https://x/y?a=1&b=2',
    ]);
  });

  /** The disk lever: the root every identity shares, the profile-directory that isolates
   *  them (docs/adr/0024). Same root, different jar. */
  it('isolates by profile-directory while sharing the user-data-dir', () => {
    const alice = browserArgs('/root', 'alice', 'https://x');
    const bob = browserArgs('/root', 'bob', 'https://x');
    expect(alice).toContain('--user-data-dir=/root');
    expect(bob).toContain('--user-data-dir=/root');
    expect(alice).toContain('--profile-directory=alice');
    expect(bob).toContain('--profile-directory=bob');
  });

  /** Safe Browsing is the second-largest thing on disk AND the phishing database guarding a
   *  window where a password is typed. The shared root makes it cheap; disabling it would
   *  trade the wrong thing for megabytes. */
  it('never disables safe browsing', () => {
    expect(browserArgs('/root', 'k', 'https://x').join(' ')).not.toMatch(/safe.?browsing/i);
  });
});

const CHROME = 'C:\\Users\\z\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

function harness(
  settings: BrowserSessionSettings,
  installed: string[] = [CHROME],
  files: Map<string, string> = new Map(),
) {
  const written = new Map<string, string>();
  const removed: string[] = [];
  const launched: { command: string; args: string[] }[] = [];
  const renamed: { from: string; to: string }[] = [];
  const session = new BrowserSession({
    home: 'C:\\home',
    platform: 'win32',
    env: WIN_ENV,
    settings: () => settings,
    exists: (path) => installed.includes(path) || written.has(path),
    write: (path, contents) => void written.set(path, contents),
    remove: (path) => {
      removed.push(path);
      files.delete(path);
    },
    launch: (command, args) => void launched.push({ command, args }),
    read: (path) => files.get(path),
    rename: (from, to) => void renamed.push({ from, to }),
    // Tests must not spend real time waiting for a file that will never appear.
    delay: () => Promise.resolve(),
  });
  return { session, written, removed, launched, files, renamed };
}

const EMAIL = 'a.b@c.com';
const KEY = profileKey(EMAIL)!;
const ROOT = 'C:\\home\\.coa\\browser-session';
/** The jar sits inside the shared user-data-dir; the shim and url beside it (docs/adr/0024). */
const PROFILE = `${ROOT}\\profiles\\${KEY}`;
const SHIM = `${ROOT}\\${KEY}.cmd`;
const COURIER = `${ROOT}\\${KEY}.url`;
/** A directory from the layout before the shared root — reclaim's business, not the launcher's. */
const LEGACY_DIR = 'C:\\home\\.coa\\browser-profiles\\9f2c1ab30d44';

describe('BrowserSession', () => {
  it('writes a courier launcher for a capable provider when the setting is on', () => {
    const { session, written } = harness({ enabled: true });
    const launcher = session.launcherFor('claude', EMAIL);
    expect(launcher).toBe(SHIM);
    expect(written.get(launcher!)).toBe(courierScript('win32', COURIER));
  });

  /** A url left by an earlier attempt points at a localhost port that died with it. Reading
   *  it would send the sign-in to a dead callback, so every login starts from no file. */
  it('clears a stale relayed url when it writes the launcher', () => {
    const files = new Map([[COURIER, 'https://claude.com/cai/oauth/authorize?code=true&old=1']]);
    const { session, removed } = harness({ enabled: true }, [CHROME], files);
    session.launcherFor('claude', EMAIL);
    expect(removed).toContain(COURIER);
    expect(files.has(COURIER)).toBe(false);
  });

  /** Jars from before the shared root are NOT carried over (docs/adr/0024). Adopting one
   *  would import the old layout into the new, which the clean break rejects — a pre-shared-
   *  root directory is the reclaim surface's business now, not the launcher's. */
  it('never renames a legacy jar into place when issuing a launcher', () => {
    const { session, renamed } = harness({ enabled: true }, [CHROME, LEGACY_DIR]);
    session.launcherFor('claude', EMAIL);
    expect(renamed).toEqual([]);
  });

  it('honors an override browser over detection when deciding availability', () => {
    const { session, written } = harness({ enabled: true, browserPath: 'D:\\brave.exe' }, [
      CHROME,
      'D:\\brave.exe',
    ]);
    const launcher = session.launcherFor('claude', EMAIL);
    expect(session.browser()).toBe('D:\\brave.exe');
    expect(written.get(launcher!)).toBe(courierScript('win32', COURIER));
  });

  it('treats an override that does not exist as unavailable, never substituting the detected browser', () => {
    const { session, written } = harness({ enabled: true, browserPath: 'D:\\ghost.exe' });
    expect(session.override()).toBeUndefined();
    expect(session.browser()).toBeUndefined();
    expect(session.available()).toBe(false);
    expect(session.launcherFor('claude', EMAIL)).toBeUndefined();
    expect(written.size).toBe(0);
  });

  it('trims a padded override before checking and using it', () => {
    const { session } = harness({ enabled: true, browserPath: `  ${CHROME}  ` });
    expect(session.override()).toBe(CHROME);
    expect(session.browser()).toBe(CHROME);
  });

  it('rejects an override carrying shell metacharacters even when the path exists, never substituting detection', () => {
    const evil = 'D:\\evil".exe';
    const { session, written } = harness({ enabled: true, browserPath: evil }, [CHROME, evil]);
    expect(session.override()).toBeUndefined();
    expect(session.available()).toBe(false);
    expect(session.launcherFor('claude', EMAIL)).toBeUndefined();
    expect(written.size).toBe(0);
  });

  it('offers no launcher when the setting is off — today\u2019s spawn, byte for byte', () => {
    const { session, written } = harness({ enabled: false });
    expect(session.launcherFor('claude', EMAIL)).toBeUndefined();
    expect(written.size).toBe(0);
  });

  it('offers no launcher to a provider that never declared the capability', () => {
    const { session } = harness({ enabled: true });
    expect(session.launcherFor('deepseek', EMAIL)).toBeUndefined();
  });

  it('offers no launcher when no browser is installed', () => {
    const { session } = harness({ enabled: true }, []);
    expect(session.launcherFor('claude', EMAIL)).toBeUndefined();
    expect(session.available()).toBe(false);
  });

  /** No identity, no jar to key — an account that never declared an email simply gets the
   *  unisolated path rather than a directory nothing can find again. */
  it('offers no launcher without an identity to key the jar by', () => {
    const { session } = harness({ enabled: true });
    expect(session.launcherFor('claude', '  ')).toBeUndefined();
  });

  it('degrades instead of throwing when the launcher cannot be written', () => {
    const session = new BrowserSession({
      home: 'C:\\home',
      platform: 'win32',
      env: WIN_ENV,
      settings: () => ({ enabled: true }),
      exists: (path) => path === CHROME,
      write: () => {
        throw new Error('EACCES');
      },
      remove: () => {},
    });
    expect(session.launcherFor('claude', EMAIL)).toBeUndefined();
  });

  it('reports detection and the override separately, so the UI can prefill', () => {
    const { session } = harness({ enabled: true, browserPath: 'D:\\brave.exe' }, [
      CHROME,
      'D:\\brave.exe',
    ]);
    expect(session.detected()).toBe(CHROME);
    expect(session.override()).toBe('D:\\brave.exe');
    expect(session.browser()).toBe('D:\\brave.exe');
    expect(session.enabled()).toBe(true);
  });

  it('removes a profile dir, its launcher, and any relayed url together', () => {
    const { session, removed } = harness({ enabled: true });
    session.removeProfile(EMAIL);
    expect(removed).toEqual([PROFILE, SHIM, COURIER]);
  });

  it('removes nothing for an identity that is not one', () => {
    const { session, removed } = harness({ enabled: true });
    session.removeProfile('   ');
    expect(removed).toEqual([]);
  });

  it('reports whether an identity has a profile', () => {
    const { session } = harness({ enabled: true }, [PROFILE]);
    expect(session.hasProfile(EMAIL)).toBe(true);
    expect(session.hasProfile('nobody@nowhere.org')).toBe(false);
    expect(session.hasProfile('')).toBe(false);
  });

  /** The point of identity keying: two providers signed in as the same person share one jar,
   *  so signing into the second does not mean signing in again. */
  it('gives the same jar to the same identity regardless of provider', () => {
    const { session } = harness({ enabled: true }, [CHROME, PROFILE]);
    expect(session.launcherFor('claude', EMAIL)).toBe(SHIM);
    expect(session.hasProfile(EMAIL.toUpperCase())).toBe(true);
  });
});

describe('BrowserSession.openUrl', () => {
  /** What the CLI prints for a human to copy: the callback is remote, so finishing there
   *  hands back a code to paste. The fallback, not the preferred url. */
  const PRINTED = 'https://claude.com/cai/oauth/authorize?code=true&redirect_uri=platform&state=2';
  /** What the CLI hands `BROWSER`: same handshake, localhost callback, so it completes
   *  itself and no code is ever shown. */
  const RELAYED = 'https://claude.com/cai/oauth/authorize?code=true&redirect_uri=localhost&state=2';
  const argsFor = (url: string): string[] => browserArgs(`${ROOT}\\profiles`, KEY, url);

  it('prefers the relayed url, so the sign-in completes without a pasted code', async () => {
    const files = new Map([[COURIER, `"\\"${RELAYED}\\""`]]);
    const { session, launched } = harness({ enabled: true }, [CHROME], files);
    await session.openUrl('claude', EMAIL, PRINTED);
    expect(launched).toEqual([{ command: CHROME, args: argsFor(RELAYED) }]);
  });

  it('falls back to the printed url when no relay ever lands', async () => {
    const { session, launched } = harness({ enabled: true });
    await session.openUrl('claude', EMAIL, PRINTED);
    expect(launched).toEqual([{ command: CHROME, args: argsFor(PRINTED) }]);
  });

  it('falls back to the printed url when the relayed file is unusable', async () => {
    const files = new Map([[COURIER, 'ECHO is off.']]);
    const { session, launched } = harness({ enabled: true }, [CHROME], files);
    await session.openUrl('claude', EMAIL, PRINTED);
    expect(launched).toEqual([{ command: CHROME, args: argsFor(PRINTED) }]);
  });

  it('does nothing when the setting is off — today\u2019s spawn, byte for byte', async () => {
    const { session, launched } = harness({ enabled: false });
    await session.openUrl('claude', EMAIL, PRINTED);
    expect(launched).toEqual([]);
  });

  it('does nothing for a provider that never declared the capability', async () => {
    const { session, launched } = harness({ enabled: true });
    await session.openUrl('deepseek', '9f2c', PRINTED);
    expect(launched).toEqual([]);
  });

  it('does nothing without an identity to key the jar by', async () => {
    const { session, launched } = harness({ enabled: true });
    await session.openUrl('claude', '  ', PRINTED);
    expect(launched).toEqual([]);
  });

  it('does nothing when no browser is available', async () => {
    const { session, launched } = harness({ enabled: true }, []);
    await session.openUrl('claude', EMAIL, PRINTED);
    expect(launched).toEqual([]);
  });

  it('swallows a launch failure instead of throwing into the login flow', async () => {
    const session = new BrowserSession({
      home: 'C:\\home',
      platform: 'win32',
      env: WIN_ENV,
      settings: () => ({ enabled: true }),
      exists: (path) => path === CHROME,
      delay: () => Promise.resolve(),
      launch: () => {
        throw new Error('ENOENT');
      },
    });
    await expect(session.openUrl('claude', '9f2c', PRINTED)).resolves.toBeUndefined();
  });

  it('swallows a read failure and still opens the printed url', async () => {
    const session = new BrowserSession({
      home: 'C:\\home',
      platform: 'win32',
      env: WIN_ENV,
      settings: () => ({ enabled: true }),
      exists: (path) => path === CHROME,
      delay: () => Promise.resolve(),
      read: () => {
        throw new Error('EACCES');
      },
      launch: () => {},
    });
    await expect(session.openUrl('claude', '9f2c', PRINTED)).resolves.toBeUndefined();
  });
});

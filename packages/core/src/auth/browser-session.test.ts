import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BrowserSession,
  browserArgs,
  browserCandidates,
  browserProfileDir,
  detectBrowser,
  isSafeAccountId,
  isSafeBrowserPath,
  launcherPath,
  suppressorScript,
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
  it('accepts a minted id and rejects anything that could escape the profile root', () => {
    expect(isSafeAccountId('9f2c1ab30d44')).toBe(true);
    expect(isSafeAccountId('a-b_C9')).toBe(true);
    expect(isSafeAccountId('')).toBe(false);
    expect(isSafeAccountId('..')).toBe(false);
    expect(isSafeAccountId('a/b')).toBe(false);
    expect(isSafeAccountId('a\\b')).toBe(false);
    expect(isSafeAccountId('a@b.org')).toBe(false);
  });

  it('keys the profile dir by account id under the coa home', () => {
    expect(browserProfileDir('/home/z', '9f2c')).toBe(
      ['', 'home', 'z', '.coa', 'browser-profiles', '9f2c'].join(sep),
    );
  });

  it('parks the launcher beside the profile dir it opens', () => {
    expect(launcherPath('/home/z', '9f2c', 'win32').endsWith('9f2c.cmd')).toBe(true);
    expect(launcherPath('/home/z', '9f2c', 'linux').endsWith('9f2c.sh')).toBe(true);
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

describe('suppressor script', () => {
  it('opens nothing and exits clean on win32 — coa performs the real open itself', () => {
    const script = suppressorScript('win32');
    expect(script).toBe('@echo off\r\nexit /b 0\r\n');
  });

  it('opens nothing and exits clean on posix', () => {
    const script = suppressorScript('linux');
    expect(script).toBe('#!/bin/sh\nexit 0\n');
  });
});

describe('browser args', () => {
  it('builds one argv element per flag, url last — nothing for a shell to mis-split', () => {
    expect(browserArgs('C:\\p\\9f2c', 'https://x/y?a=1&b=2')).toEqual([
      '--user-data-dir=C:\\p\\9f2c',
      '--no-first-run',
      '--no-default-browser-check',
      'https://x/y?a=1&b=2',
    ]);
  });
});

const CHROME = 'C:\\Users\\z\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

function harness(settings: BrowserSessionSettings, installed: string[] = [CHROME]) {
  const written = new Map<string, string>();
  const removed: string[] = [];
  const launched: { command: string; args: string[] }[] = [];
  const session = new BrowserSession({
    home: 'C:\\home',
    platform: 'win32',
    env: WIN_ENV,
    settings: () => settings,
    exists: (path) => installed.includes(path) || written.has(path),
    write: (path, contents) => void written.set(path, contents),
    remove: (path) => void removed.push(path),
    launch: (command, args) => void launched.push({ command, args }),
  });
  return { session, written, removed, launched };
}

describe('BrowserSession', () => {
  it('writes a suppressor launcher for a capable provider when the setting is on', () => {
    const { session, written } = harness({ enabled: true });
    const launcher = session.launcherFor('claude', '9f2c');
    expect(launcher).toBe('C:\\home\\.coa\\browser-profiles\\9f2c.cmd');
    expect(written.get(launcher!)).toBe(suppressorScript('win32'));
  });

  it('honors an override browser over detection when deciding availability', () => {
    const { session, written } = harness({ enabled: true, browserPath: 'D:\\brave.exe' }, [
      CHROME,
      'D:\\brave.exe',
    ]);
    const launcher = session.launcherFor('claude', '9f2c');
    expect(session.browser()).toBe('D:\\brave.exe');
    expect(written.get(launcher!)).toBe(suppressorScript('win32'));
  });

  it('treats an override that does not exist as unavailable, never substituting the detected browser', () => {
    const { session, written } = harness({ enabled: true, browserPath: 'D:\\ghost.exe' });
    expect(session.override()).toBeUndefined();
    expect(session.browser()).toBeUndefined();
    expect(session.available()).toBe(false);
    expect(session.launcherFor('claude', '9f2c')).toBeUndefined();
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
    expect(session.launcherFor('claude', '9f2c')).toBeUndefined();
    expect(written.size).toBe(0);
  });

  it('offers no launcher when the setting is off — today\u2019s spawn, byte for byte', () => {
    const { session, written } = harness({ enabled: false });
    expect(session.launcherFor('claude', '9f2c')).toBeUndefined();
    expect(written.size).toBe(0);
  });

  it('offers no launcher to a provider that never declared the capability', () => {
    const { session } = harness({ enabled: true });
    expect(session.launcherFor('deepseek', '9f2c')).toBeUndefined();
  });

  it('offers no launcher when no browser is installed', () => {
    const { session } = harness({ enabled: true }, []);
    expect(session.launcherFor('claude', '9f2c')).toBeUndefined();
    expect(session.available()).toBe(false);
  });

  it('offers no launcher for an id that could escape the profile root', () => {
    const { session } = harness({ enabled: true });
    expect(session.launcherFor('claude', '../../etc')).toBeUndefined();
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
    expect(session.launcherFor('claude', '9f2c')).toBeUndefined();
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

  it('removes a profile dir and its launcher together', () => {
    const { session, removed } = harness({ enabled: true });
    session.removeProfile('9f2c');
    expect(removed).toEqual([
      'C:\\home\\.coa\\browser-profiles\\9f2c',
      'C:\\home\\.coa\\browser-profiles\\9f2c.cmd',
    ]);
  });

  it('reports whether an account has a profile, and never for an unsafe id', () => {
    const { session } = harness({ enabled: true }, ['C:\\home\\.coa\\browser-profiles\\9f2c']);
    expect(session.hasProfile('9f2c')).toBe(true);
    expect(session.hasProfile('beef')).toBe(false);
    expect(session.hasProfile('../../etc')).toBe(false);
  });
});

describe('BrowserSession.openUrl', () => {
  const URL = 'https://claude.com/oauth/authorize?code=1&state=2';

  it('launches the profiled browser directly with the captured url intact', () => {
    const { session, launched } = harness({ enabled: true });
    session.openUrl('claude', '9f2c', URL);
    expect(launched).toEqual([
      {
        command: CHROME,
        args: [
          '--user-data-dir=C:\\home\\.coa\\browser-profiles\\9f2c',
          '--no-first-run',
          '--no-default-browser-check',
          URL,
        ],
      },
    ]);
  });

  it('does nothing when the setting is off — today\u2019s spawn, byte for byte', () => {
    const { session, launched } = harness({ enabled: false });
    session.openUrl('claude', '9f2c', URL);
    expect(launched).toEqual([]);
  });

  it('does nothing for a provider that never declared the capability', () => {
    const { session, launched } = harness({ enabled: true });
    session.openUrl('deepseek', '9f2c', URL);
    expect(launched).toEqual([]);
  });

  it('does nothing for an id that could escape the profile root', () => {
    const { session, launched } = harness({ enabled: true });
    session.openUrl('claude', '../../etc', URL);
    expect(launched).toEqual([]);
  });

  it('does nothing when no browser is available', () => {
    const { session, launched } = harness({ enabled: true }, []);
    session.openUrl('claude', '9f2c', URL);
    expect(launched).toEqual([]);
  });

  it('swallows a launch failure instead of throwing into the login flow', () => {
    const session = new BrowserSession({
      home: 'C:\\home',
      platform: 'win32',
      env: WIN_ENV,
      settings: () => ({ enabled: true }),
      exists: (path) => path === CHROME,
      launch: () => {
        throw new Error('ENOENT');
      },
    });
    expect(() => session.openUrl('claude', '9f2c', URL)).not.toThrow();
  });
});

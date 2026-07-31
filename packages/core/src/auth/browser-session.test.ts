import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BrowserSession,
  browserCandidates,
  browserProfileDir,
  detectBrowser,
  isSafeAccountId,
  launcherPath,
  launcherScript,
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

describe('launcher script', () => {
  const opts = { browserPath: 'C:\\b\\chrome.exe', profileDir: 'C:\\p\\9f2c' };

  it('opens the profiled browser and re-quotes the url on win32', () => {
    const script = launcherScript({ platform: 'win32', ...opts });
    expect(script).toContain('"C:\\b\\chrome.exe"');
    expect(script).toContain('--user-data-dir="C:\\p\\9f2c"');
    expect(script).toContain('--no-first-run');
    expect(script).toContain('--no-default-browser-check');
    // The authorize URL carries `&`, which cmd would otherwise read as a command
    // separator, and `start ""` is what keeps the shim from blocking on the window.
    expect(script).toContain('"%~1"');
    expect(script).toContain('start ""');
  });

  it('backgrounds the profiled browser on a posix shell', () => {
    const script = launcherScript({ platform: 'linux', ...opts });
    expect(script.startsWith('#!/bin/sh')).toBe(true);
    expect(script).toContain('"$1"');
    expect(script.trimEnd().endsWith('&')).toBe(true);
  });
});

const CHROME = 'C:\\Users\\z\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';

function harness(settings: BrowserSessionSettings, installed: string[] = [CHROME]) {
  const written = new Map<string, string>();
  const removed: string[] = [];
  const session = new BrowserSession({
    home: 'C:\\home',
    platform: 'win32',
    env: WIN_ENV,
    settings: () => settings,
    exists: (path) => installed.includes(path) || written.has(path),
    write: (path, contents) => void written.set(path, contents),
    remove: (path) => void removed.push(path),
  });
  return { session, written, removed };
}

describe('BrowserSession', () => {
  it('writes a launcher for a capable provider when the setting is on', () => {
    const { session, written } = harness({ enabled: true });
    const launcher = session.launcherFor('claude', '9f2c');
    expect(launcher).toBe('C:\\home\\.coa\\browser-profiles\\9f2c.cmd');
    expect(written.get(launcher!)).toContain(
      '--user-data-dir="C:\\home\\.coa\\browser-profiles\\9f2c"',
    );
    expect(written.get(launcher!)).toContain(CHROME);
  });

  it('honors an override browser over detection', () => {
    const { session, written } = harness({ enabled: true, browserPath: 'D:\\brave.exe' });
    const launcher = session.launcherFor('claude', '9f2c');
    expect(written.get(launcher!)).toContain('D:\\brave.exe');
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
    const { session } = harness({ enabled: true, browserPath: 'D:\\brave.exe' });
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

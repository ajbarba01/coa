import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, win32 } from 'node:path';
import { supportsIsolatedBrowserSession } from '@coa/shared';

/**
 * Isolated browser sessions for driven logins (docs/adr/0018). coa cannot own the
 * browser's cookie jar, so a declared `--email` is only a prefill hint — the handshake
 * lands as whoever the browser is already signed in as. Launching a real browser with a
 * per-account `--user-data-dir` gives each account its own jar, which is what makes an
 * email-defined account real. Neutral by construction: a provider DECLARES the need
 * (`isolatedBrowserSession`), this module owns the mechanism, and the Claude adapter is
 * one consumer.
 *
 * Everything here is an affordance (SC-1): every failure path returns "no launcher", and
 * the login falls back to the copy-link + paste-code flow that already works.
 */

/** Flags shared by every Chromium: a throwaway profile must not run first-run or
 *  default-browser prompts over the sign-in the user came for. */
const CHROMIUM_FLAGS = ['--no-first-run', '--no-default-browser-check'];

/** Install locations, most-likely first. Chrome outranks Edge everywhere: the browser a
 *  person signs into outranks the one Windows ships with. Env keys are read as Windows
 *  spells them — `process.env` is case-insensitive there, and tests pass the same keys. */
const WIN32_ROOT_KEYS = ['LOCALAPPDATA', 'PROGRAMFILES', 'ProgramFiles(x86)'];
const WIN32_RELATIVE = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
];

/** Pure: every path a supported browser might live at, best-first. Empty off win32 —
 *  mac/Linux have no detection in v1 and degrade to the fallback. */
export function browserCandidates(
  platform: string,
  env: Record<string, string | undefined>,
): string[] {
  if (platform !== 'win32') return [];
  const roots = WIN32_ROOT_KEYS.map((key) => env[key]).filter(
    (root): root is string => root !== undefined && root !== '',
  );
  return WIN32_RELATIVE.flatMap((parts) => roots.map((root) => win32.join(root, ...parts)));
}

/** Pure: the first candidate that is actually installed. */
export function detectBrowser(
  platform: string,
  env: Record<string, string | undefined>,
  exists: (path: string) => boolean,
): string | undefined {
  return browserCandidates(platform, env).find(exists);
}

/** Pure: an id safe to spend as ONE path segment. Ids are minted (hex), so this is a
 *  guard against a hand-edited `accounts.yaml`, not a normalizer — an id that could
 *  escape the profile root simply gets no isolation. */
export function isSafeAccountId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Pure: guards a path about to be embedded verbatim in a generated shell script. A `"`
 *  breaks the shim's own quoting, a `%` on win32 triggers cmd variable expansion, and a
 *  newline lets one settings value smuggle in a second command. Detection never produces
 *  any of these (real chrome.exe/msedge.exe install paths) — only a hand-edited override
 *  can, so this is a guard against that input, not a normalizer. */
export function isSafeBrowserPath(path: string): boolean {
  return !/["%\r\n]/.test(path);
}

/** Pure: an account's browser profile (its own cookie jar), keyed by account id — never
 *  by email or label, both of which change and whose slugs collide. */
export function browserProfileDir(home: string, accountId: string): string {
  return join(home, '.coa', 'browser-profiles', accountId);
}

/** Pure: the shim `BROWSER` points at. Beside the profile dir, not inside it, so removing
 *  an account's profile takes its launcher with it. */
export function launcherPath(home: string, accountId: string, platform: string): string {
  const ext = platform === 'win32' ? '.cmd' : '.sh';
  return join(home, '.coa', 'browser-profiles', `${accountId}${ext}`);
}

/**
 * Pure: the shim's contents. It is run as `<launcher> <authorize-url>` by the rented CLI,
 * and it re-launches that URL in the profiled browser.
 *
 * Two details are load-bearing on win32: `start ""` returns immediately (a fresh profile
 * keeps `chrome.exe` in the foreground until the window closes, and the CLI may be waiting
 * on this process), and `"%~1"` re-quotes the URL (an authorize URL carries `&`, which cmd
 * would otherwise read as a command separator).
 */
export function launcherScript(opts: {
  platform: string;
  browserPath: string;
  profileDir: string;
}): string {
  const flags = `--user-data-dir="${opts.profileDir}" ${CHROMIUM_FLAGS.join(' ')}`;
  if (opts.platform === 'win32') {
    return ['@echo off', `start "" "${opts.browserPath}" ${flags} "%~1"`, ''].join('\r\n');
  }
  return ['#!/bin/sh', `"${opts.browserPath}" ${flags} "$1" >/dev/null 2>&1 &`, ''].join('\n');
}

/** The global toggle plus the optional binary override, read fresh on every use so a
 *  settings change takes effect on the next login without a daemon restart. */
export interface BrowserSessionSettings {
  enabled: boolean;
  browserPath?: string;
}

export interface BrowserSessionDeps {
  home: string;
  platform: string;
  env: Record<string, string | undefined>;
  settings(): BrowserSessionSettings;
  /** Injected so the whole module is testable without a filesystem. */
  exists?(path: string): boolean;
  write?(path: string, contents: string): void;
  remove?(path: string): void;
}

/** What a READER of browser sessions needs (the auth view, the remove verbs) — no
 *  launcher construction, so a read surface can never start one. */
export interface BrowserSessionView {
  enabled(): boolean;
  available(): boolean;
  detected(): string | undefined;
  override(): string | undefined;
  hasProfile(accountId: string): boolean;
  removeProfile(accountId: string): void;
}

/** A shim is executable in its own right on POSIX; 0700 keeps it to its owner. */
function writeExecutable(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o700 });
}

export class BrowserSession implements BrowserSessionView {
  readonly #deps: BrowserSessionDeps;

  constructor(deps: BrowserSessionDeps) {
    this.#deps = deps;
  }

  #exists(path: string): boolean {
    return (this.#deps.exists ?? existsSync)(path);
  }

  enabled(): boolean {
    return this.#deps.settings().enabled;
  }

  detected(): string | undefined {
    return detectBrowser(this.#deps.platform, this.#deps.env, (path) => this.#exists(path));
  }

  /** The settings field, trimmed, iff it holds something. Blank is not a choice — kept
   *  separate from {@link override} because a choice that fails validation must still
   *  block the fallback to detection in {@link browser}, not be treated as no choice. */
  #rawOverride(): string | undefined {
    const path = this.#deps.settings().browserPath;
    if (path === undefined) return undefined;
    const trimmed = path.trim();
    return trimmed === '' ? undefined : trimmed;
  }

  /** The user's explicit choice, narrowed to one a launch could actually use: it exists
   *  on disk and carries none of the characters {@link isSafeBrowserPath} rejects.
   *  Trimmed, so a hand-edited `console.yaml` with padding can't reach the shim verbatim.
   *  An override that fails either check reports as no override here — {@link browser}
   *  is what keeps that distinct from never having set one. */
  override(): string | undefined {
    const raw = this.#rawOverride();
    if (raw === undefined || !isSafeBrowserPath(raw)) return undefined;
    return this.#exists(raw) ? raw : undefined;
  }

  /** The binary a launch would actually use. An override that exists in the settings but
   *  fails validation makes this — and `available()` — `undefined` rather than quietly
   *  substituting the detected browser: the user asked for a specific binary, and
   *  launching a different one instead would be its own dishonesty (docs/adr/0018). */
  browser(): string | undefined {
    return this.#rawOverride() === undefined ? this.detected() : this.override();
  }

  available(): boolean {
    return this.browser() !== undefined;
  }

  hasProfile(accountId: string): boolean {
    if (!isSafeAccountId(accountId)) return false;
    return this.#exists(browserProfileDir(this.#deps.home, accountId));
  }

  /**
   * The launcher `BROWSER` should point at for this login, or `undefined` when isolation
   * does not apply — setting off, provider without the capability, no browser, an id that
   * could escape the profile root, or an unwritable launcher. Every one of those is a
   * plain fallback to the copy-link + paste-code path, never an error (SC-1).
   */
  launcherFor(provider: string, accountId: string): string | undefined {
    try {
      if (!this.enabled()) return undefined;
      if (!supportsIsolatedBrowserSession(provider)) return undefined;
      if (!isSafeAccountId(accountId)) return undefined;
      const browserPath = this.browser();
      if (browserPath === undefined) return undefined;
      const path = launcherPath(this.#deps.home, accountId, this.#deps.platform);
      (this.#deps.write ?? writeExecutable)(
        path,
        launcherScript({
          platform: this.#deps.platform,
          browserPath,
          profileDir: browserProfileDir(this.#deps.home, accountId),
        }),
      );
      return path;
    } catch {
      return undefined;
    }
  }

  /** Delete an account's cookie jar and its shim. Tolerant of either being gone already. */
  removeProfile(accountId: string): void {
    if (!isSafeAccountId(accountId)) return;
    const remove =
      this.#deps.remove ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
    for (const path of [
      browserProfileDir(this.#deps.home, accountId),
      launcherPath(this.#deps.home, accountId, this.#deps.platform),
    ]) {
      try {
        remove(path);
      } catch {
        // A profile we cannot delete is a disk-space problem, never a failed removal.
      }
    }
  }
}

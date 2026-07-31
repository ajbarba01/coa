import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
 * The open is two pieces, not one (docs/adr/0020). `BROWSER` points the rented CLI at a shim
 * ({@link courierScript}) whose only job is to WRITE DOWN the url it is handed and exit — it
 * launches nothing. coa then performs the real open itself ({@link BrowserSession.openUrl}),
 * as argv with no shell in the path, which is immune to the quoting failures that sank the
 * original relay design. Splitting courier from launcher keeps the one proven piece proven:
 * a batch file is trusted only to copy a string to disk, never to build a command line.
 *
 * Why the shim is worth having at all: the url the CLI PRINTS and the url it hands `BROWSER`
 * are different. They share a handshake but not a `redirect_uri` — the printed one points at
 * a remote callback and ends in a code the user must paste back, while the relayed one points
 * at a localhost callback inside the CLI process and completes itself. Only the shim can see
 * the good one, so coa reads it from the file and prefers it, falling back to the printed url
 * whenever the relay does not arrive.
 *
 * Everything here is an affordance (SC-1): every failure path returns "no launcher" (or,
 * for `openUrl`, simply launches nothing), and the login falls back to the copy-link +
 * paste-code flow that already works.
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

/** Pure: a key safe to spend as ONE path segment. {@link profileKey} produces these by
 *  construction, so this guards the legacy account ids migration still reads out of a
 *  hand-editable `accounts.yaml` — anything that could escape the profile root gets no
 *  isolation rather than a sanitized approximation. */
export function isSafeProfileKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(key);
}

/** Pure: whether any of `otherEmails` resolves to the same jar as `email`. Keying by identity
 *  means one jar can back several account rows — a Claude and a Codex login as the same
 *  person, say — so deleting it on one row's removal would sign the others out too
 *  (docs/adr/0021). Callers pass every OTHER account's email. */
export function isProfileShared(
  email: string | undefined,
  otherEmails: (string | undefined)[],
): boolean {
  const key = email === undefined ? undefined : profileKey(email);
  if (key === undefined) return false;
  return otherEmails.some((other) => other !== undefined && profileKey(other) === key);
}

/** Keeps the readable half of a key bounded so a long address cannot produce a path no
 *  filesystem will take. */
const KEY_SLUG_MAX = 48;
const KEY_HASH_LENGTH = 6;

/**
 * Pure: the profile key for an identity — a readable slug plus a short digest of the
 * normalized address, e.g. `wormsegment1000-gmail-com-4f9a2c`.
 *
 * Keyed by IDENTITY rather than by account row (docs/adr/0021). The consequences are the
 * point: a relogin reuses the jar it already signed into, two providers signed in as the
 * same person share one jar, and removing an account row no longer strands a directory
 * nothing can name again.
 *
 * The digest is what makes this safe where a bare slug was not — slugging collapses every
 * non-alphanumeric run, so `a.b@c.com`, `a-b@c.com`, and `a+b@c.com` would otherwise share
 * one cookie jar. The slug survives only so the profile root stays inspectable by a human.
 */
export function profileKey(email: string): string | undefined {
  const normalized = email.trim().toLowerCase();
  if (normalized === '') return undefined;
  const slug = normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, KEY_SLUG_MAX)
    .replace(/-+$/, '');
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, KEY_HASH_LENGTH);
  return slug === '' ? digest : `${slug}-${digest}`;
}

/** Pure: guards a path before it is trusted as something to launch. A `"`, a `%`, or a
 *  newline in a hand-edited override is copy-paste damage or tampering, not a real install
 *  path — real chrome.exe/msedge.exe locations never contain them (docs/adr/0018) — so
 *  this refuses it rather than launch something unexpected. Detection never produces any
 *  of these; only a hand-edited override can, so this is a guard against that input, not a
 *  normalizer. */
export function isSafeBrowserPath(path: string): boolean {
  return !/["%\r\n]/.test(path);
}

/** Pure: an identity's browser profile (its own cookie jar), keyed by {@link profileKey}. */
export function browserProfileDir(home: string, key: string): string {
  return join(home, '.coa', 'browser-profiles', key);
}

/** Pure: the shim `BROWSER` points at. Beside the profile dir, not inside it, so removing
 *  an identity's profile takes its launcher with it. */
export function launcherPath(home: string, key: string, platform: string): string {
  const ext = platform === 'win32' ? '.cmd' : '.sh';
  return join(home, '.coa', 'browser-profiles', `${key}${ext}`);
}

/** Pure: where the shim writes the url it was handed. Beside the profile dir, keyed the same
 *  way, so removing an identity takes its relayed url with it. */
export function courierPath(home: string, key: string): string {
  return join(home, '.coa', 'browser-profiles', `${key}.url`);
}

/**
 * Pure: the shim's contents — write the argument to `urlFile`, exit, launch nothing.
 *
 * On win32 the idiom is load-bearing. `%1` is NOT usable: `cmd`'s batch argument tokenizer
 * treats `=` as a delimiter, so `%1` arrives truncated at the url's first one (`…/authorize?code`).
 * `%*` is the raw remainder of the command line and survives whole. Reading it back needs
 * delayed expansion — with normal expansion the url's `&` would be substituted into the line
 * before parsing and reparsed as a command separator. POSIX never had either problem, so `$1`
 * is written straight out.
 */
export function courierScript(platform: string, urlFile: string): string {
  if (platform === 'win32') {
    return [
      '@echo off',
      'setlocal enabledelayedexpansion',
      'set "u=%*"',
      `>"${urlFile}" echo(!u!`,
      'exit /b 0',
      '',
    ].join('\r\n');
  }
  return ['#!/bin/sh', `printf '%s' "$1" > "${urlFile}"`, 'exit 0', ''].join('\n');
}

/** The relayed url as it appears in the file: win32 hands the shim a POSIX-escaped url, so
 *  what lands is wrapped in `"` and `\"`; POSIX writes it bare. Excluding `"` and `\` from the
 *  match unwraps both without a separate stripping pass, and refuses anything that is not an
 *  authorize url on a Claude host. */
const RELAYED_URL = /https:\/\/claude\.(?:com|ai)\/[^\s"\\]*oauth[^\s"\\]*/;

/** Pure: the authorize url inside a courier file's contents, or `undefined` for an empty,
 *  partial, or unrecognized file — every one of which is treated as "no relay arrived". */
export function unwrapCourierUrl(raw: string): string | undefined {
  return RELAYED_URL.exec(raw)?.[0];
}

/** How long `openUrl` will wait for the relay before opening the printed url instead. The
 *  shim runs when the CLI opens the browser, which is observably before it prints the
 *  fallback url — but that is the CLI's ordering, not one coa controls, so the wait is
 *  bounded and its expiry is a normal outcome rather than a failure. */
const COURIER_ATTEMPTS = 6;
const COURIER_INTERVAL_MS = 120;

/** Pure: the argv for a direct browser launch — one element per flag, url last. No shell
 *  sits between this array and the OS, so there is no quoting step for an authorize url's
 *  `&` to be lost in (the failure mode {@link suppressorScript} exists to route around). */
export function browserArgs(profileDir: string, url: string): string[] {
  return [`--user-data-dir=${profileDir}`, ...CHROMIUM_FLAGS, url];
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
  /** Injected so the whole module is testable without a filesystem or a real process. */
  exists?(path: string): boolean;
  write?(path: string, contents: string): void;
  remove?(path: string): void;
  launch?(command: string, args: string[]): void;
  /** Contents of a file, or `undefined` when it is not there yet. */
  read?(path: string): string | undefined;
  rename?(from: string, to: string): void;
  /** Injected so the bounded wait for the relayed url costs tests no real time. */
  delay?(ms: number): Promise<void>;
}

/** What a READER of browser sessions needs (the auth view, the remove verbs) — no
 *  launcher construction, so a read surface can never start one. */
export interface BrowserSessionView {
  enabled(): boolean;
  available(): boolean;
  detected(): string | undefined;
  override(): string | undefined;
  /** Keyed by identity, so both take the account's declared email (docs/adr/0021). */
  hasProfile(email: string): boolean;
  removeProfile(email: string): void;
}

/** A shim is executable in its own right on POSIX; 0700 keeps it to its owner. */
function writeExecutable(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { encoding: 'utf8', mode: 0o700 });
}

function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

/** A file that is not there yet is the normal case here, not an error. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

/** Detached and stdio-ignored: a login flow must never block on the browser window
 *  closing, mirroring why the old shim needed `start ""` for the same reason one level
 *  down. No `shell: true` — argv reaching the OS untouched is the entire point
 *  (docs/adr/0019). */
function launchBrowser(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.unref();
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

  hasProfile(email: string): boolean {
    const key = profileKey(email);
    if (key === undefined || !isSafeProfileKey(key)) return false;
    return this.#exists(browserProfileDir(this.#deps.home, key));
  }

  /** Best-effort adoption of a jar built before the key became the identity: rename it into
   *  place rather than strand it and make the user sign in again (docs/adr/0021). Skipped
   *  entirely once the identity has its own jar; a failure here is silently a fresh jar. */
  #adoptLegacyProfile(key: string, legacyAccountId: string | undefined): void {
    if (legacyAccountId === undefined || !isSafeProfileKey(legacyAccountId)) return;
    const target = browserProfileDir(this.#deps.home, key);
    if (this.#exists(target)) return;
    const legacy = browserProfileDir(this.#deps.home, legacyAccountId);
    if (!this.#exists(legacy)) return;
    try {
      (this.#deps.rename ?? renameSync)(legacy, target);
    } catch {
      // A jar we cannot adopt costs one sign-in, never the login.
    }
  }

  /**
   * The launcher `BROWSER` should point at for this login, or `undefined` when isolation
   * does not apply — setting off, provider without the capability, no browser, an id that
   * could escape the profile root, or an unwritable launcher. Every one of those is a
   * plain fallback to the copy-link + paste-code path, never an error (SC-1).
   */
  launcherFor(provider: string, email: string, legacyAccountId?: string): string | undefined {
    try {
      if (!this.enabled()) return undefined;
      if (!supportsIsolatedBrowserSession(provider)) return undefined;
      const key = profileKey(email);
      if (key === undefined || !isSafeProfileKey(key)) return undefined;
      const browserPath = this.browser();
      if (browserPath === undefined) return undefined;
      this.#adoptLegacyProfile(key, legacyAccountId);
      const path = launcherPath(this.#deps.home, key, this.#deps.platform);
      const courier = courierPath(this.#deps.home, key);
      // A url left by an earlier attempt names a localhost port that died with it. Clearing
      // it here — the one moment a login is known to be starting — is what keeps `openUrl`
      // from relaying a dead callback. Best-effort: if it cannot be cleared, the sign-in
      // still reaches the browser and the copy-link path still works (SC-1).
      try {
        (this.#deps.remove ?? removePath)(courier);
      } catch {
        // An unremovable stale file costs a dead link, never the login.
      }
      (this.#deps.write ?? writeExecutable)(path, courierScript(this.#deps.platform, courier));
      return path;
    } catch {
      return undefined;
    }
  }

  /** The url the shim relayed, waited for on a bounded poll. `undefined` means it never
   *  arrived in time, or arrived unusable — both are ordinary, and both mean "use the
   *  printed url instead". */
  async #relayedUrl(key: string): Promise<string | undefined> {
    const path = courierPath(this.#deps.home, key);
    const read = this.#deps.read ?? readIfPresent;
    const delay =
      this.#deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; attempt < COURIER_ATTEMPTS; attempt += 1) {
      try {
        const raw = read(path);
        if (raw !== undefined) {
          const url = unwrapCourierUrl(raw);
          if (url !== undefined) return url;
        }
      } catch {
        // Unreadable reads the same as absent — keep waiting, then fall back.
      }
      if (attempt < COURIER_ATTEMPTS - 1) await delay(COURIER_INTERVAL_MS);
    }
    return undefined;
  }

  /**
   * Opens the profiled browser at the authorize url — preferring the one the shim relayed
   * (localhost callback, completes itself) over `printedUrl`, the human-fallback the CLI
   * printed (remote callback, ends in a code to paste). See the module doc for why they
   * differ. Same guards as {@link launcherFor}, and the same SC-1 contract: any failure is
   * silent and the copy-link + paste-code path is what the user sees instead.
   */
  async openUrl(provider: string, email: string, printedUrl: string): Promise<void> {
    try {
      if (!this.enabled()) return;
      if (!supportsIsolatedBrowserSession(provider)) return;
      const key = profileKey(email);
      if (key === undefined || !isSafeProfileKey(key)) return;
      const browserPath = this.browser();
      if (browserPath === undefined) return;
      const relayed = await this.#relayedUrl(key);
      (this.#deps.launch ?? launchBrowser)(
        browserPath,
        browserArgs(browserProfileDir(this.#deps.home, key), relayed ?? printedUrl),
      );
    } catch {
      // SC-1: a failed open is a no-op, never an error into the login flow.
    }
  }

  /** Delete an account's cookie jar, its shim, and any url the shim relayed. Tolerant of any
   *  of them being gone already. */
  removeProfile(email: string): void {
    const key = profileKey(email);
    if (key === undefined || !isSafeProfileKey(key)) return;
    const remove = this.#deps.remove ?? removePath;
    for (const path of [
      browserProfileDir(this.#deps.home, key),
      launcherPath(this.#deps.home, key, this.#deps.platform),
      courierPath(this.#deps.home, key),
    ]) {
      try {
        remove(path);
      } catch {
        // A profile we cannot delete is a disk-space problem, never a failed removal.
      }
    }
  }
}

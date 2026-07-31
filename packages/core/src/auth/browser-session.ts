import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, win32 } from 'node:path';
import { supportsIsolatedBrowserSession } from '@coa/shared';
import {
  browserProfileDir,
  browserUserDataDir,
  courierPath,
  isSafeProfileKey,
  launcherPath,
  profileKey,
} from './browser-paths.js';
import {
  listReclaimable,
  nodeReclaimDeps,
  reclaimProfile,
  type ReclaimDeps,
} from './browser-reclaim.js';

export {
  browserProfileDir,
  browserSessionRoot,
  browserUserDataDir,
  courierPath,
  isSafeProfileKey,
  launcherPath,
  profileKey,
} from './browser-paths.js';

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

/**
 * Flags that keep a single-purpose OAuth window from downloading a browser's worth of
 * machine learning. Component updates bring the text-to-speech engine, the omnibox suggest
 * model and the component extension cache; the optimization guide brings a ~49 MB model
 * store; the shader cache is pure GPU warm-up. None of them serve a window whose only job
 * is one sign-in, and each one measurably occupied the profile root (docs/adr/0024).
 *
 * Safe Browsing is deliberately NOT disabled. It is the second-largest item on disk and
 * also the phishing database guarding a window where a password gets typed — the wrong
 * thing to trade for megabytes, and the shared root already pays for it only once.
 */
const DISK_FLAGS = [
  '--disable-component-update',
  '--disable-features=OptimizationHints,OptimizationGuideModelDownloading',
  '--disable-gpu-shader-disk-cache',
];

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

/** Pure: guards a path before it is trusted as something to launch. A `"`, a `%`, or a
 *  newline in a hand-edited override is copy-paste damage or tampering, not a real install
 *  path — real chrome.exe/msedge.exe locations never contain them (docs/adr/0018) — so
 *  this refuses it rather than launch something unexpected. Detection never produces any
 *  of these; only a hand-edited override can, so this is a guard against that input, not a
 *  normalizer. */
export function isSafeBrowserPath(path: string): boolean {
  return !/["%\r\n]/.test(path);
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
 *  `&` to be lost in (the failure mode the courier shim exists to route around).
 *
 *  The root/key split is the isolation: one user-data-dir shared by every identity, one
 *  profile-directory per identity (docs/adr/0024). */
export function browserArgs(userDataDir: string, key: string, url: string): string[] {
  return [
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${key}`,
    ...CHROMIUM_FLAGS,
    ...DISK_FLAGS,
    url,
  ];
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
  /** Subdirectory names of a path — the reclaim enumeration's one filesystem read. */
  listDirs?(path: string): string[];
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
  /** Jars no account resolves to, and the door that deletes one. Reads and deletes only —
   *  still launcher-free, so the seam's guarantee holds (docs/adr/0024). */
  listReclaimable(knownEmails: readonly (string | undefined)[]): string[];
  reclaimProfile(key: string): void;
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

  /**
   * The launcher `BROWSER` should point at for this login, or `undefined` when isolation
   * does not apply — setting off, provider without the capability, no browser, an id that
   * could escape the profile root, or an unwritable launcher. Every one of those is a
   * plain fallback to the copy-link + paste-code path, never an error (SC-1).
   *
   * No legacy adoption: jars from before the shared root are not carried over. Adopting one
   * would import the old layout into the new, which the clean break rejects — they are the
   * reclaim surface's business now, not this one's (docs/adr/0024).
   */
  launcherFor(provider: string, email: string): string | undefined {
    try {
      if (!this.enabled()) return undefined;
      if (!supportsIsolatedBrowserSession(provider)) return undefined;
      const key = profileKey(email);
      if (key === undefined || !isSafeProfileKey(key)) return undefined;
      const browserPath = this.browser();
      if (browserPath === undefined) return undefined;
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
        browserArgs(browserUserDataDir(this.#deps.home), key, relayed ?? printedUrl),
      );
    } catch {
      // SC-1: a failed open is a no-op, never an error into the login flow.
    }
  }

  /** The reclaim module's deps, built from this session's own injected ones so a test that
   *  fakes the filesystem here fakes it there too. */
  #reclaimDeps(): ReclaimDeps {
    const node = nodeReclaimDeps(this.#deps.home, this.#deps.platform);
    return {
      ...node,
      exists: (path) => this.#exists(path),
      ...(this.#deps.rename !== undefined ? { rename: this.#deps.rename } : {}),
      ...(this.#deps.remove !== undefined ? { remove: this.#deps.remove } : {}),
      ...(this.#deps.listDirs !== undefined ? { listDirs: this.#deps.listDirs } : {}),
    };
  }

  listReclaimable(knownEmails: readonly (string | undefined)[]): string[] {
    try {
      return listReclaimable(this.#reclaimDeps(), knownEmails);
    } catch {
      // A profile root that cannot be read reports nothing to reclaim, never an error.
      return [];
    }
  }

  reclaimProfile(key: string): void {
    try {
      reclaimProfile(this.#reclaimDeps(), key);
    } catch {
      // A jar we cannot delete is a disk-space problem, never a failed action.
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

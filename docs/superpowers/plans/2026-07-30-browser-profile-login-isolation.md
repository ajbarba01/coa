# Browser-profile login isolation — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** sign each account in through a real browser launched with a per-account profile
directory, so the declared email genuinely selects the identity that lands.

**Architecture:** A neutral `browser-session` module at the auth layer (core) owns browser-binary
detection, per-account profile dirs, and building a launcher shim. A provider declares
`isolatedBrowserSession` in the M0 capability table; when the global setting is on and the
provider declares the capability, the login spawn sets `BROWSER=<launcher>` so Claude's CLI
delegates the browser-open to coa's profiled launcher. Everything degrades to today's copy-link +
paste-code path.

**Tech Stack:** TypeScript (strict) · Zod (M0 schemas) · Vitest · pnpm workspaces · Electron
(console) · JSON-RPC over a named pipe (daemon ↔ console).

**Source of truth:** `docs/superpowers/specs/2026-07-30-browser-profile-login-isolation-design.md`
(approved) and `docs/adr/0018-isolated-browser-login-sessions.md` (proposed → accepted when this
lands). Do not re-open the design or re-run the spike.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **TypeScript `strict`, no `any`, `exactOptionalPropertyTypes`** — rebuild optional fields by
  **omission** (`...(x !== undefined ? { x } : {})`), never `field: undefined`.
- **Typed boundaries** — validate/parse external data at the edges with Zod; M0
  (`packages/shared`) owns the schemas.
- **SC-1 (help, never cage)** — isolation is an affordance. Setting off, no browser, provider
  without the capability, an unwritable launcher, `BROWSER` not honored ⇒ **degrade to the
  existing copy-link + paste-code path**. Nothing here may ever block or throw into a login.
- **D85 (strict-superset)** — with the setting off, the login spawn is byte-identical to today.
- **D84 (credential-blind)** — coa never reads or writes a token; nothing in this work touches
  credentials.
- **Tests:** `corepack pnpm exec vitest run <path>` (this repo needs the `corepack pnpm` prefix).
- **Commits:** subject-only Conventional Commits — **no body, no `Co-Authored-By`, no "Generated
  with" trailer, no module IDs / plan codenames / phase numbers in the subject.** Stage files **by
  name**; never `git add -A`.
- **Comment hygiene:** comments state **why**, never what; no ticket/plan references; durable
  rationale links an ADR (`// see docs/adr/0018`).
- **Same-commit doc rule:** a change that adds/moves/deletes files updates the owning doc in the
  same commit.
- **Baseline is NOT clean** (verified by stashing at `28447e0`): a clean tree already has **8
  eslint errors + 2 warnings**, **~44 prettier-dirty files**, **10 failing adapter-deepseek /
  adapter-longcat tests** (streaming-body mocks), and **5 depcruise `no-circular` violations**.
  Confirm your changes add none of these; do not "fix" the baseline here.
- **`dist` is what runs.** `@coa/core`, `@coa/adapter-claude-sdk` and `@coa/console-viewmodel`
  ship from `dist`; a source edit changes nothing live until `corepack pnpm build` + a daemon
  restart. `console-kit` has no build step (consumed as source).
- **jsdom green ≠ visual proof.** UI tasks are verified in the running app (the `run` skill; on
  win32 `apps/desktop/scripts/dev.mjs` handles the `ELECTRON_RUN_AS_NODE` gotcha).

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `packages/core/src/auth/browser-session.ts` | The neutral capability: win32 browser detection, per-account profile dirs, launcher-shim construction, and the `BrowserSession` assembly that answers "isolate this login?" |
| `packages/core/src/auth/browser-session.test.ts` | Unit tests for all of the above (pure + injected IO). |
| `packages/core/src/auth/browser-launcher.live.test.ts` | `COA_LIVE`-gated round trip: the generated shim really forwards an `&`-carrying URL to a fake browser. |
| `packages/shared/src/console-state.test.ts` | The console-state schema's defaults/drop-unknown behavior (no test file exists today). |

**Modified**

| File | Change |
| --- | --- |
| `packages/shared/src/auth.ts` | `Account.id`; the provider-capability table + `supportsIsolatedBrowserSession`. |
| `packages/shared/src/console-state.ts` | `isolatedBrowserLogins` (default false) + `browserPath` override. |
| `packages/core/src/auth/registry.ts` | Mint/backfill account ids (`mintAccountId`, `add(..., id?)`, `ensureId`). |
| `packages/core/src/auth/login-manager.ts` | Resolve the account id per flow, ask the browser-session port for a launcher, thread it into the driver, persist the id on registration. |
| `packages/core/src/console/console-state-store.ts` | `setIsolatedBrowserLogins` / `setBrowserPath`. |
| `packages/core/src/rpc/auth-view.ts` | `AuthView.browserSession`, `CredentialView.hasProfile`, the `browser` read port. |
| `packages/core/src/rpc/auth-handlers.ts` | `setIsolatedBrowserLogins` / `setBrowserPath` verbs; profile removal on `removeCredential` / `removeProvider`. |
| `packages/core/src/session/daemon.ts` | Composition root: build `BrowserSession`, bind it to the login manager and the auth handlers. |
| `packages/core/src/index.ts` | Export the new browser-session surface. |
| `packages/adapter-claude-sdk/src/login-driver.ts` | `spawnLogin({ …, browserLauncher })` → `BROWSER` on the spawn env (pure `loginEnv`). |
| `packages/console-viewmodel/src/reads.ts` | Edge schema for the new `AuthView` fields. |
| `apps/desktop/src/shared/methods.ts` | Two new IPC verbs + the widened remove params. |
| `apps/desktop/src/main/index.ts` | Proxy the two new verbs to the daemon. |
| `apps/desktop/src/preload/api.d.ts` | Types for the two new verbs + widened remove params. |
| `apps/desktop/src/renderer/console.ts` | RPC helpers. |
| `apps/desktop/src/renderer/panels/mockAuth.ts` | `browserSession` state, `hasProfile` on `Credential`, the new actions. |
| `apps/desktop/src/renderer/shell/Settings.tsx` | A `logins` section: the toggle + the browser override. |
| `apps/desktop/src/renderer/shell/store.ts` | `confirmRemoveCredential` dialog slot. |
| `apps/desktop/src/renderer/panels/AuthPanel.tsx` | The remove-profile prompts. |
| `apps/desktop/src/renderer/panels/LoginFlow.tsx` | Honest copy when a login is isolated. |
| `docs/adr/0018-isolated-browser-login-sessions.md`, the design spec, `ROADMAP.md`, `.superpowers/sdd/attended-run-handoff.md` | Doc close-out. |

**Planning decisions the spec left to implementation** (flagged for the reviewer):

1. **"Keyed by account id" needs an account id.** Accounts are keyed today by `label` only, and a
   slug of the label carries the *same* collision the spec wants closed (labels are emails). So
   `Account` gains a stable opaque `id` (minted on registration, lazily backfilled), and profile
   dirs are keyed by it. Additive and drop-safe, exactly like `email`/`disabled`.
2. **A new login has no account yet** (the account is created after the handshake lands), so the
   id is minted at flow start and handed to `registry.add` on completion.
3. **The setting lives in `~/.coa/console.yaml`, not the desktop's `settings.json`** — the login
   spawn happens in the daemon, so the daemon has to be able to read it. The console renders it
   through the existing `authView` read.
4. **Provider removal prompts too.** Cascading a provider removal would otherwise orphan profile
   dirs with no surface left to reach them; the existing remove-provider dialog carries the same
   opt-in.

**Out of scope** (do not touch): macOS/Linux detection; localhost-callback interception; the
pipe-branch `spawn('claude', …)` in `login-driver.ts` that ignores `resolveClaudeCommand` (a
pre-existing inconsistency, not this work); anything in `docs/design/handoff/OPEN.md`.

---

### Task 1: M0 — account id, provider capability, the setting

**Files:**
- Modify: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/console-state.ts`
- Test: `packages/shared/src/auth.test.ts` (existing), `packages/shared/src/console-state.test.ts` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Account.id?: string`; `ProviderCapabilities { isolatedBrowserSession: boolean }`;
  `PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities>`;
  `supportsIsolatedBrowserSession(provider: string): boolean`;
  `ConsoleState.isolatedBrowserLogins: boolean`; `ConsoleState.browserPath?: string`.
  All re-exported by `@coa/shared` through the existing `export * from './auth.js'` /
  `export { consoleStateSchema, type ConsoleState } from './console-state.js'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/auth.test.ts`:

```ts
describe('account id + provider capabilities', () => {
  it('parses an account without an id (legacy rows stay valid)', () => {
    const account = accountSchema.parse({ label: 'a@b.org', locator: { type: 'ambient' } });
    expect(account.id).toBeUndefined();
  });

  it('keeps an explicit id', () => {
    const account = accountSchema.parse({
      label: 'a@b.org',
      locator: { type: 'ambient' },
      id: '9f2c1ab30d44',
    });
    expect(account.id).toBe('9f2c1ab30d44');
  });

  it('declares isolated browser sessions for claude only', () => {
    expect(supportsIsolatedBrowserSession('claude')).toBe(true);
    expect(supportsIsolatedBrowserSession('deepseek')).toBe(false);
    expect(supportsIsolatedBrowserSession('longcat')).toBe(false);
  });

  it('says no for a provider it has never heard of', () => {
    expect(supportsIsolatedBrowserSession('gemini')).toBe(false);
  });
});
```

Add the imports the file needs (`accountSchema`, `supportsIsolatedBrowserSession`) to its existing
import block from `./auth.js`.

Create `packages/shared/src/console-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { consoleStateSchema } from './console-state.js';

describe('console state schema', () => {
  it('defaults isolated browser logins OFF and leaves the browser override unset', () => {
    const state = consoleStateSchema.parse({});
    expect(state.isolatedBrowserLogins).toBe(false);
    expect(state.browserPath).toBeUndefined();
  });

  it('round-trips an enabled toggle with an explicit browser path', () => {
    const state = consoleStateSchema.parse({
      isolatedBrowserLogins: true,
      browserPath: 'C:\\browsers\\chrome.exe',
    });
    expect(state).toMatchObject({
      isolatedBrowserLogins: true,
      browserPath: 'C:\\browsers\\chrome.exe',
    });
  });

  it('drops unknown keys instead of throwing', () => {
    expect(consoleStateSchema.parse({ bogus: 1 })).not.toHaveProperty('bogus');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run packages/shared/src/auth.test.ts packages/shared/src/console-state.test.ts`
Expected: FAIL — `supportsIsolatedBrowserSession is not a function`, and
`state.isolatedBrowserLogins` is `undefined`.

- [ ] **Step 3: Add the id field and the capability table**

In `packages/shared/src/auth.ts`, add to `accountSchema` (after `email`):

```ts
  /** A stable, opaque account id. Minted at registration and never derived from the
   *  email or label: both change, and a slug of either collides. It is what per-account
   *  side state (a browser profile dir) is keyed by — see docs/adr/0018. Absent on rows
   *  written before ids existed; the registry backfills lazily. Additive, drop-safe. */
  id: z.string().optional(),
```

And at the end of the file:

```ts
/** What a backend's sign-in NEEDS at the auth layer. `isolatedBrowserSession` says the
 *  sign-in is a browser cookie-session flow, so a dedicated browser profile is what makes
 *  the declared identity actually select the account. Claude is the first consumer, not
 *  the owner: a future provider is a row here, never new machinery (docs/adr/0018). */
export interface ProviderCapabilities {
  isolatedBrowserSession: boolean;
}

export const PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  claude: { isolatedBrowserSession: true },
  deepseek: { isolatedBrowserSession: false },
  longcat: { isolatedBrowserSession: false },
};

/** Capability lookup for an unvalidated provider id — an id no backend claims is a `false`,
 *  never a throw (SC-1: an unknown provider just takes the plain path). */
export function supportsIsolatedBrowserSession(provider: string): boolean {
  const parsed = providerSchema.safeParse(provider);
  return parsed.success && PROVIDER_CAPABILITIES[parsed.data].isolatedBrowserSession;
}
```

- [ ] **Step 4: Add the setting to the console state schema**

In `packages/shared/src/console-state.ts`, inside the `z.object({ … })`, after
`disabledProviders`:

```ts
    /** The global "sign logins in through a dedicated browser profile" toggle. OFF by
     *  default: with it off, a login spawn is byte-identical to today (D85). */
    isolatedBrowserLogins: z.boolean().default(false),
    /** The user's browser-binary override. Absent ⇒ auto-detection decides. */
    browserPath: z.string().optional(),
```

Extend the file's doc comment's last sentence to mention the two new fields.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/shared/src/auth.test.ts packages/shared/src/console-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `corepack pnpm typecheck`
Expected: clean (no new errors).

```bash
git add packages/shared/src/auth.ts packages/shared/src/auth.test.ts packages/shared/src/console-state.ts packages/shared/src/console-state.test.ts
git commit -m "feat: model account ids and the dedicated-browser-login setting"
```

---

### Task 2: The browser-session module — detection, profile dirs, launcher text

**Files:**
- Create: `packages/core/src/auth/browser-session.ts`
- Test: `packages/core/src/auth/browser-session.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 yet (pure functions only).
- Produces:
  - `browserCandidates(platform: string, env: Record<string, string | undefined>): string[]`
  - `detectBrowser(platform: string, env: Record<string, string | undefined>, exists: (path: string) => boolean): string | undefined`
  - `isSafeAccountId(id: string): boolean`
  - `browserProfileDir(home: string, accountId: string): string`
  - `launcherPath(home: string, accountId: string, platform: string): string`
  - `launcherScript(opts: { platform: string; browserPath: string; profileDir: string }): string`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/auth/browser-session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  browserCandidates,
  browserProfileDir,
  detectBrowser,
  isSafeAccountId,
  launcherPath,
  launcherScript,
} from './browser-session.js';

const WIN_ENV = {
  LOCALAPPDATA: 'C:\\Users\\z\\AppData\\Local',
  PROGRAMFILES: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
};

describe('browser detection', () => {
  it('offers chrome before edge, across every install root', () => {
    const candidates = browserCandidates('win32', WIN_ENV);
    expect(candidates[0]).toBe('C:\\Users\\z\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    expect(candidates).toContain('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
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
```

Add `import { sep } from 'node:path';` to the test's imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/auth/browser-session.test.ts`
Expected: FAIL — cannot resolve `./browser-session.js`.

- [ ] **Step 3: Write the module**

Create `packages/core/src/auth/browser-session.ts`:

```ts
import { join, win32 } from 'node:path';

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/auth/browser-session.test.ts`
Expected: PASS (all 11 assertions green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/browser-session.ts packages/core/src/auth/browser-session.test.ts
git commit -m "feat: detect a browser and build a profiled launcher command"
```

---

### Task 3: The `BrowserSession` assembly — write the launcher, own the profile

**Files:**
- Modify: `packages/core/src/auth/browser-session.ts`
- Modify: `packages/core/src/auth/browser-session.test.ts`
- Create: `packages/core/src/auth/browser-launcher.live.test.ts`

**Interfaces:**
- Consumes: `supportsIsolatedBrowserSession` (Task 1); the pure functions from Task 2.
- Produces:
  - `BrowserSessionSettings { enabled: boolean; browserPath?: string }`
  - `BrowserSessionDeps { home; platform; env; settings(): BrowserSessionSettings; exists?; write?; remove? }`
  - `BrowserSessionView` — the read port `auth-view.ts` consumes:
    `enabled(): boolean; available(): boolean; detected(): string | undefined; override(): string | undefined; hasProfile(accountId: string): boolean; removeProfile(accountId: string): void`
  - `class BrowserSession implements BrowserSessionView` with additionally
    `browser(): string | undefined` and
    `launcherFor(provider: string, accountId: string): string | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/auth/browser-session.test.ts`:

```ts
import { BrowserSession, type BrowserSessionSettings } from './browser-session.js';

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
    expect(written.get(launcher!)).toContain('--user-data-dir="C:\\home\\.coa\\browser-profiles\\9f2c"');
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
```

`WIN_ENV` comes from the block added in Task 2 (same file, module scope).

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/auth/browser-session.test.ts`
Expected: FAIL — `BrowserSession is not a constructor` / not exported.

- [ ] **Step 3: Implement the assembly**

Append to `packages/core/src/auth/browser-session.ts` (and add
`import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';`,
`import { dirname } from 'node:path';` and
`import { supportsIsolatedBrowserSession } from '@coa/shared';` at the top):

```ts
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

  /** The user's explicit choice, if they made one. Blank is not a choice. */
  override(): string | undefined {
    const path = this.#deps.settings().browserPath;
    return path === undefined || path.trim() === '' ? undefined : path;
  }

  /** The binary a launch would actually use. */
  browser(): string | undefined {
    return this.override() ?? this.detected();
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
    const remove = this.#deps.remove ?? ((path: string) => rmSync(path, { recursive: true, force: true }));
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/auth/browser-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the live round-trip test**

The one thing units cannot prove is that the generated shim survives a real shell with an
`&`-carrying URL. Create `packages/core/src/auth/browser-launcher.live.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { launcherScript } from './browser-session.js';

/**
 * The quoting gate. An authorize URL carries `&`, and the rented CLI hands it to
 * `BROWSER` through a shell — so the shim's quoting is the one thing that decides whether
 * the profiled window opens on the right URL. Real processes and a visible console flash,
 * so it is gated like the other live smokes:
 *
 *   COA_LIVE=1 corepack pnpm exec vitest run packages/core/src/auth/browser-launcher.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'] || process.platform !== 'win32')(
  'launcher shim round trip (win32)',
  () => {
    it('forwards an ampersand-carrying url to the browser intact', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'coa-launcher-'));
      const record = join(dir, 'argv.txt');
      const fakeBrowser = join(dir, 'fake-browser.cmd');
      // The recorder stands in for chrome.exe: it writes the URL it was handed and exits.
      writeFileSync(fakeBrowser, ['@echo off', `echo %* > "${record}"`, ''].join('\r\n'));

      const launcher = join(dir, 'launch.cmd');
      writeFileSync(
        launcher,
        launcherScript({
          platform: 'win32',
          browserPath: fakeBrowser,
          profileDir: join(dir, 'profile'),
        }),
      );

      const url = 'https://claude.ai/oauth/authorize?code=1&state=abc&scope=user';
      const run = spawnSync(launcher, [url], { shell: true });
      expect(run.status).toBe(0);

      // `start ""` detaches on purpose (the CLI may be waiting on the shim), so the
      // recorder lands a beat later.
      await vi.waitFor(() => expect(readFileSync(record, 'utf8')).toContain('state=abc'), {
        timeout: 5000,
        interval: 50,
      });
      expect(readFileSync(record, 'utf8')).toContain(url);
    });
  },
);
```

- [ ] **Step 6: Run the live test once and record the result**

Run: `COA_LIVE=1 corepack pnpm exec vitest run packages/core/src/auth/browser-launcher.live.test.ts`
(from the Bash tool; PowerShell needs `$env:COA_LIVE = '1'` first.)
Expected: PASS — the recorded argv contains the full URL including `&state=abc`.
**If it fails**, the shim's quoting is wrong: fix `launcherScript` (Task 2) and re-run both this
and the unit suite before continuing. Do not proceed on a red round trip.

- [ ] **Step 7: Run the default suite to confirm the live test stays skipped**

Run: `corepack pnpm exec vitest run packages/core/src/auth/`
Expected: PASS, with the live file reported as skipped.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/auth/browser-session.ts packages/core/src/auth/browser-session.test.ts packages/core/src/auth/browser-launcher.live.test.ts
git commit -m "feat: own per-account browser profiles behind one session gate"
```

---

### Task 4: Stable account ids in the registry

**Files:**
- Modify: `packages/core/src/auth/registry.ts`
- Test: `packages/core/src/auth/registry.test.ts`

**Interfaces:**
- Consumes: `Account.id` (Task 1).
- Produces: `mintAccountId(): string`;
  `AccountsRegistry.add(label, locator, provider?, email?, id?)`;
  `AccountsRegistry.ensureId(label): string | undefined`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/auth/registry.test.ts` (reuse the file's existing temp-home helper —
match whatever it already calls to build a registry over a temp dir):

```ts
describe('account ids', () => {
  it('mints an id for every account it registers', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' });
    const id = registry.list()[0]?.id;
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('accepts an id minted by the caller (a login flow keys its profile before it lands)', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' }, 'claude', 'a@b.org', 'deadbeef0000');
    expect(registry.list()[0]?.id).toBe('deadbeef0000');
  });

  it('gives every account its OWN id', () => {
    const registry = new AccountsRegistry(home);
    registry.add('a@b.org', { type: 'ambient' });
    registry.add('c@d.org', { type: 'ambient' });
    const [first, second] = registry.list();
    expect(first?.id).not.toBe(second?.id);
  });

  it('backfills an id onto a legacy account, once, and persists it', () => {
    writeFileSync(
      accountsPath(home),
      'active: {}\naccounts:\n  - label: legacy\n    provider: claude\n    locator: {type: ambient}\n',
    );
    const registry = new AccountsRegistry(home);
    const id = registry.ensureId('legacy');
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    expect(registry.ensureId('legacy')).toBe(id);
    expect(new AccountsRegistry(home).list()[0]?.id).toBe(id);
  });

  it('has no id to ensure for an account that is not there', () => {
    expect(new AccountsRegistry(home).ensureId('ghost')).toBeUndefined();
  });
});
```

(The legacy-row test needs `mkdirSync(dirname(accountsPath(home)), { recursive: true })` before
the write if the file's helper does not already create `~/.coa`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/auth/registry.test.ts`
Expected: FAIL — `id` is `undefined`; `ensureId is not a function`.

- [ ] **Step 3: Implement**

In `packages/core/src/auth/registry.ts` add `import { randomBytes } from 'node:crypto';` and:

```ts
/** A stable, opaque account id. Random rather than derived: an id derived from the email
 *  or label inherits their collisions and dies on a rename, and per-account side state
 *  (a browser profile) is keyed by this. */
export function mintAccountId(): string {
  return randomBytes(6).toString('hex');
}
```

Change `add` to accept and store an id:

```ts
  add(
    label: string,
    locator: Locator,
    provider: Provider = 'claude',
    email?: string,
    id: string = mintAccountId(),
  ): void {
    const file = this.#read();
    if (file.accounts.some((a) => a.label === label)) {
      throw new Error(`account already exists: ${label}`);
    }
    file.accounts.push({
      label,
      provider,
      locator,
      disabled: false,
      id,
      ...(email !== undefined ? { email } : {}),
    });
    this.#write(file);
  }
```

And add, beside `setEmail`:

```ts
  /** The account's id, minting and persisting one if it predates ids. `undefined` only
   *  when there is no such account. Lazy on purpose: a registry read stays a read, and
   *  an untouched legacy row is never rewritten just for being looked at. */
  ensureId(label: string): string | undefined {
    const file = this.#read();
    const index = file.accounts.findIndex((a) => a.label === label);
    const account = file.accounts[index];
    if (account === undefined) return undefined;
    if (account.id !== undefined) return account.id;
    const id = mintAccountId();
    file.accounts[index] = { ...account, id };
    this.#write(file);
    return id;
  }
```

Note `renameBackendCredential` in `auth-handlers.ts` calls `remove` + `add` — it will mint a NEW
id, orphaning the renamed account's profile. Fix it in the same edit by preserving the id:

```ts
  accounts.add(newLabel, account.locator, providerId, undefined, account.id);
```

`add`'s `email` argument stays `undefined` there, matching today's behavior. `account.id` may be
`undefined` on a legacy row — passing `undefined` for a defaulted parameter takes the default, so
that case mints a fresh id with no extra branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/core/src/auth/registry.test.ts packages/core/src/rpc/`
Expected: PASS — including the existing rename/remove handler tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/registry.ts packages/core/src/auth/registry.test.ts packages/core/src/rpc/auth-handlers.ts
git commit -m "feat: give every account a stable opaque id"
```

---

### Task 5: The login flow asks for a launcher

**Files:**
- Modify: `packages/core/src/auth/login-manager.ts`
- Test: `packages/core/src/auth/login-manager.test.ts`

**Interfaces:**
- Consumes: `mintAccountId`, `AccountsRegistry.ensureId` (Task 4).
- Produces:
  - `BrowserSessionPort { launcherFor(accountId: string): string | undefined }`
  - `LoginDriverPort.start(opts: { dir: string; email: string; browserLauncher?: string })`
  - `new LoginManager(registry, driver, { pollMs?, browserSession? })`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/auth/login-manager.test.ts`. The file already has a `fakeDriver`
helper; extend it to record the options it was started with (add
`starts: Array<{ dir: string; email: string; browserLauncher?: string }>` and push in `start`), then:

```ts
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
```

Match the existing file's helpers for `home`, `fakeDriver`, and its probe-queue idiom rather than
inventing new ones; the four-line `probeQueue`/`waitFor` shape above mirrors the tests already
there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/auth/login-manager.test.ts`
Expected: FAIL — `browserSession` is not an accepted option; `driver.starts[0].browserLauncher` is
`undefined`.

- [ ] **Step 3: Implement**

In `packages/core/src/auth/login-manager.ts`:

```ts
import { AccountsRegistry, mintAccountId } from './registry.js';
```

(the existing `import type { AccountsRegistry }` becomes a value import for `mintAccountId`; keep
`AccountsRegistry` type-only if the linter prefers — `import type { AccountsRegistry } from './registry.js';`
plus `import { mintAccountId } from './registry.js';` is fine.)

Widen the driver port and add the browser port:

```ts
export interface LoginDriverPort {
  /** `browserLauncher`, when present, is a command the rented CLI should open the
   *  authorize URL with instead of the default browser (docs/adr/0018). Absent ⇒ the
   *  spawn is exactly today's. */
  start(opts: { dir: string; email: string; browserLauncher?: string }): LoginDriverHandle;
  probe(dir: string): Promise<{ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined>;
  home: string;
  dirFor(email: string): string; // managedLoginDir(home, email)
}

/** The isolation seam. Core asks; the composition root decides (setting, provider
 *  capability, detected browser) and never explains itself here. */
export interface BrowserSessionPort {
  launcherFor(accountId: string): string | undefined;
}
```

Add `accountId: string` to the private `Flow` interface, store the port, and use both:

```ts
  readonly #browser: BrowserSessionPort | undefined;

  constructor(
    registry: AccountsRegistry,
    driver: LoginDriverPort,
    opts?: { pollMs?: number; browserSession?: BrowserSessionPort },
  ) {
    this.#registry = registry;
    this.#driver = driver;
    this.#pollMs = opts?.pollMs ?? 2000;
    this.#browser = opts?.browserSession;
  }
```

In `startLogin`, after `const dir = …`:

```ts
    // The account's id has to exist BEFORE the handshake: the browser profile is keyed by
    // it, and a new account is only registered once the login lands. A new flow mints one
    // and carries it to registration; a relogin reuses (or backfills) the account's own.
    const accountId = this.#resolveAccountId(args.credentialId);
    const launcher = this.#browser?.launcherFor(accountId);
    const handle = this.#driver.start({
      dir,
      email: args.email,
      ...(launcher !== undefined ? { browserLauncher: launcher } : {}),
    });
```

Add `accountId` to the `Flow` literal, and add the resolver beside `#resolveDir`:

```ts
  #resolveAccountId(credentialId: string | undefined): string {
    if (credentialId !== undefined) {
      const existing = this.#registry.ensureId(labelOf(credentialId));
      if (existing !== undefined) return existing;
    }
    return mintAccountId();
  }
```

In `#complete`, the `new` branch passes the id through:

```ts
          this.#registry.add(label, { type: 'config-dir', dir: flow.dir }, 'claude', email, flow.accountId);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/core/src/auth/`
Expected: PASS — the new block plus every existing login-manager test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/login-manager.ts packages/core/src/auth/login-manager.test.ts
git commit -m "feat: key a login flow to its account and request an isolated browser"
```

---

### Task 6: The Claude adapter sets `BROWSER` on the login spawn

**Files:**
- Modify: `packages/adapter-claude-sdk/src/login-driver.ts`
- Modify: `packages/adapter-claude-sdk/src/index.ts`
- Test: `packages/adapter-claude-sdk/src/login-driver.test.ts`

**Interfaces:**
- Consumes: the `browserLauncher` option shape (Task 5).
- Produces: `loginEnv(base: NodeJS.ProcessEnv, opts: { dir: string; browserLauncher?: string }): NodeJS.ProcessEnv`;
  `spawnLogin(opts: { dir: string; email: string; browserLauncher?: string })`.

- [ ] **Step 1: Write the failing test**

Append to `packages/adapter-claude-sdk/src/login-driver.test.ts`:

```ts
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
```

Add `loginEnv` to the file's import from `./login-driver.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/login-driver.test.ts`
Expected: FAIL — `loginEnv is not a function`.

- [ ] **Step 3: Implement**

In `packages/adapter-claude-sdk/src/login-driver.ts`, add above `spawnLogin`:

```ts
/**
 * Pure: the environment the login spawn runs under. `CLAUDE_CONFIG_DIR` is what keeps the
 * login inside coa's managed dir; `BROWSER` is how the CLI is told to hand the authorize
 * URL to coa's profiled launcher instead of opening the default browser (docs/adr/0018).
 * No launcher ⇒ the variable is not touched at all, so an unisolated login is byte-for-byte
 * today's (D85).
 */
export function loginEnv(
  base: NodeJS.ProcessEnv,
  opts: { dir: string; browserLauncher?: string },
): NodeJS.ProcessEnv {
  return {
    ...base,
    CLAUDE_CONFIG_DIR: opts.dir,
    ...(opts.browserLauncher !== undefined ? { BROWSER: opts.browserLauncher } : {}),
  };
}
```

Then in `spawnLogin`, widen the signature and use it:

```ts
export function spawnLogin(opts: {
  dir: string;
  email: string;
  browserLauncher?: string;
}): LoginProcess {
  const env = loginEnv(process.env, opts);
```

Extend the file's header comment with one sentence: the spawn may redirect the browser-open
through `BROWSER` when the login is isolated, and that this changes nothing when it is not.

In `packages/adapter-claude-sdk/src/index.ts`, add `loginEnv` to the existing login-driver export
list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/login-driver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/login-driver.ts packages/adapter-claude-sdk/src/login-driver.test.ts packages/adapter-claude-sdk/src/index.ts
git commit -m "feat: redirect the driven login's browser open through a launcher"
```

---

### Task 7: Daemon wiring, the setting's store, and the auth verbs

**Files:**
- Modify: `packages/core/src/console/console-state-store.ts`
- Modify: `packages/core/src/rpc/auth-view.ts`
- Modify: `packages/core/src/rpc/auth-handlers.ts`
- Modify: `packages/core/src/session/daemon.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/rpc/auth-handlers.test.ts`, `packages/core/src/rpc/auth-view.test.ts`
  (use whichever of these exist; add the block to the file that owns the surface)

**Interfaces:**
- Consumes: `BrowserSessionView`, `BrowserSession` (Task 3); `Account.id` (Task 1).
- Produces:
  - `ConsoleStateStore.setIsolatedBrowserLogins(on: boolean): void`,
    `ConsoleStateStore.setBrowserPath(path: string | undefined): void`
  - `AuthView.browserSession: { enabled: boolean; available: boolean; detectedPath?: string; path?: string }`
  - `CredentialView.hasProfile?: boolean`
  - `AuthViewDeps.browser?: BrowserSessionView`, `AuthHandlerDeps.browser?: BrowserSessionView`
  - RPC verbs `setIsolatedBrowserLogins { on: boolean }`, `setBrowserPath { path: string }`;
    `removeCredential { id: string; removeProfile?: boolean }`;
    `removeProvider { providerId: string; removeProfiles?: boolean }` — all returning `AuthView`.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/rpc/auth-handlers.test.ts`, using the file's existing `freshDeps(home)`
builder and its `h.<verb>!.handle(params)` call idiom (the file's `home` is a temp dir per test):

```ts
describe('browser session over the auth verbs', () => {
  function browserStub(): { removed: string[]; view: BrowserSessionView } {
    const removed: string[] = [];
    return {
      removed,
      view: {
        enabled: () => true,
        available: () => true,
        detected: () => 'C:\\chrome.exe',
        override: () => undefined,
        hasProfile: () => true,
        removeProfile: (accountId: string) => void removed.push(accountId),
      },
    };
  }

  it('reports the browser session on the view', async () => {
    const h = buildAuthHandlers({ ...freshDeps(home), browser: browserStub().view });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.browserSession).toEqual({
      enabled: true,
      available: true,
      detectedPath: 'C:\\chrome.exe',
    });
  });

  it('floors the browser session when the daemon has none', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.browserSession).toEqual({ enabled: false, available: false });
  });

  it('persists the toggle and reads it back', async () => {
    const deps = freshDeps(home);
    const h = buildAuthHandlers(deps);
    await h.setIsolatedBrowserLogins!.handle({ on: true });
    expect(deps.console.read().isolatedBrowserLogins).toBe(true);
    await h.setIsolatedBrowserLogins!.handle({ on: false });
    expect(deps.console.read().isolatedBrowserLogins).toBe(false);
  });

  it('stores a browser override and clears it on empty', async () => {
    const deps = freshDeps(home);
    const h = buildAuthHandlers(deps);
    await h.setBrowserPath!.handle({ path: 'D:\\brave.exe' });
    expect(deps.console.read().browserPath).toBe('D:\\brave.exe');
    await h.setBrowserPath!.handle({ path: '' });
    expect(deps.console.read().browserPath).toBeUndefined();
  });

  it('marks a credential whose account has a profile', async () => {
    const deps = freshDeps(home);
    deps.accounts.add('a@b.org', { type: 'config-dir', dir: 'D' }, 'claude', 'a@b.org', 'abc123abc123');
    const h = buildAuthHandlers({ ...deps, browser: browserStub().view });
    const view = (await h.authView!.handle(undefined)) as AuthView;
    expect(view.credentials.find((c) => c.label === 'a@b.org')?.hasProfile).toBe(true);
  });

  it('deletes the profile with the credential only when asked', async () => {
    const deps = freshDeps(home);
    deps.accounts.add('a@b.org', { type: 'config-dir', dir: 'D' }, 'claude', 'a@b.org', 'abc123abc123');
    deps.accounts.add('c@d.org', { type: 'config-dir', dir: 'E' }, 'claude', 'c@d.org', 'def456def456');
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });

    await h.removeCredential!.handle({ id: credentialId('claude', 'a@b.org') });
    expect(browser.removed).toEqual([]);

    await h.removeCredential!.handle({ id: credentialId('claude', 'c@d.org'), removeProfile: true });
    expect(browser.removed).toEqual(['def456def456']);
  });

  it('deletes every profile a removed provider owned when asked', async () => {
    const deps = freshDeps(home);
    deps.accounts.add('a@b.org', { type: 'config-dir', dir: 'D' }, 'claude', 'a@b.org', 'abc123abc123');
    const browser = browserStub();
    const h = buildAuthHandlers({ ...deps, browser: browser.view });
    await h.removeProvider!.handle({ providerId: 'claude', removeProfiles: true });
    expect(browser.removed).toEqual(['abc123abc123']);
  });
});
```

Add `import type { BrowserSessionView } from '../auth/browser-session.js';` to the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/rpc/`
Expected: FAIL — `view.browserSession` is `undefined`; `setIsolatedBrowserLogins` is not a handler.

- [ ] **Step 3: Extend the console-state store**

In `packages/core/src/console/console-state-store.ts`:

```ts
  setIsolatedBrowserLogins(on: boolean): void {
    const s = this.read();
    if (s.isolatedBrowserLogins === on) return;
    s.isolatedBrowserLogins = on;
    this.#write(s);
  }

  /** An empty override is not an override — it is deleted rather than written blank, so
   *  the field is either a real choice or absent (exactOptionalPropertyTypes). */
  setBrowserPath(path: string | undefined): void {
    const s = this.read();
    if (path === undefined || path.trim() === '') delete s.browserPath;
    else s.browserPath = path.trim();
    this.#write(s);
  }
```

- [ ] **Step 4: Extend the auth view**

In `packages/core/src/rpc/auth-view.ts`:

```ts
import type { BrowserSessionView } from '../auth/browser-session.js';
```

Add to `CredentialView`:

```ts
  /** A dedicated browser profile exists for this account — the fact the removal prompt
   *  needs. Absent/false ⇒ nothing extra to delete. */
  hasProfile?: boolean;
```

Add to `AuthView`:

```ts
  /** The isolated-browser-login capability as it stands right now: whether it is on,
   *  whether a browser was actually found, what detection saw (the override's prefill),
   *  and the override in force. */
  browserSession: {
    enabled: boolean;
    available: boolean;
    detectedPath?: string;
    path?: string;
  };
```

Add to `AuthViewDeps`: `browser?: BrowserSessionView;`

In `assembleAuthView`, inside the backend credential loop add to the pushed object:

```ts
        ...(account.id !== undefined && deps.browser?.hasProfile(account.id) === true
          ? { hasProfile: true }
          : {}),
```

and before the `return`:

```ts
  // Absent browser session = the floor: off and unavailable. A read never starts one.
  const detectedPath = deps.browser?.detected();
  const overridePath = deps.browser?.override();
  const browserSession = {
    enabled: deps.browser?.enabled() ?? false,
    available: deps.browser?.available() ?? false,
    ...(detectedPath !== undefined ? { detectedPath } : {}),
    ...(overridePath !== undefined ? { path: overridePath } : {}),
  };
```

and include `browserSession` in the returned object.

- [ ] **Step 5: Add the verbs**

In `packages/core/src/rpc/auth-handlers.ts`:

```ts
const browserToggleParams = z.object({ on: z.boolean() });
const browserPathParams = z.object({ path: z.string() });
const removeCredParams = z.object({ id: z.string().min(1), removeProfile: z.boolean().optional() });
const removeProviderParams = z.object({
  providerId: z.string().min(1),
  removeProfiles: z.boolean().optional(),
});
```

`AuthHandlerDeps` gains `browser?: BrowserSessionView` (imported from `../auth/browser-session.js`),
and `viewDeps` forwards it (it already spreads `deps`, so no change is needed once the field is on
the type — verify the spread carries it).

New handlers:

```ts
    setIsolatedBrowserLogins: rpcMethod(browserToggleParams, (p) => {
      deps.console.setIsolatedBrowserLogins(p.on);
      return assembleAuthView(viewDeps);
    }),

    setBrowserPath: rpcMethod(browserPathParams, (p) => {
      deps.console.setBrowserPath(p.path);
      return assembleAuthView(viewDeps);
    }),
```

`removeCredential` switches to `removeCredParams` and captures the id before the removal:

```ts
    removeCredential: rpcMethod(removeCredParams, (p) => {
      const { providerId, label } = splitId(p.id);
      const group = providerGroup(providerId);
      if (group === 'backend') {
        const provider = providerId as Provider;
        const account = deps.accounts.listByProvider(provider).find((a) => a.label === label);
        if (account !== undefined) {
          const activeBefore = deps.accounts.getActive(provider);
          const wasActive = activeBefore.kind === 'account' && activeBefore.account.label === label;
          if (account.locator.type === 'key-file') safeUnlink(account.locator.path);
          deps.accounts.remove(label);
          // The id has to be read BEFORE the removal — afterwards there is no row to ask.
          if (p.removeProfile === true && account.id !== undefined) {
            deps.browser?.removeProfile(account.id);
          }
          applyHeirIfWasActive(deps.accounts, provider, label, wasActive);
        }
      } else if (group === 'service') {
        …unchanged…
      }
      return assembleAuthView(viewDeps);
    }),
```

`removeProvider` switches to `removeProviderParams`; in its backend branch, inside the existing
loop over `listByProvider`:

```ts
          if (p.removeProfiles === true && account.id !== undefined) {
            deps.browser?.removeProfile(account.id);
          }
```

(placed before `deps.accounts.remove(account.label)`).

- [ ] **Step 6: Wire the composition root**

In `packages/core/src/session/daemon.ts`, inside `buildDaemonConsoleHandlers`, replace the inline
store construction and thread the session through:

```ts
  const accounts = new AccountsRegistry(homedir());
  const consoleState = new ConsoleStateStore(homedir());
  // The one place the three isolation facts meet: the user's setting, the provider's
  // declared capability, and what browser this machine actually has (docs/adr/0018).
  const browser = new BrowserSession({
    home: homedir(),
    platform: process.platform,
    env: process.env,
    settings: () => {
      const state = consoleState.read();
      return {
        enabled: state.isolatedBrowserLogins,
        ...(state.browserPath !== undefined ? { browserPath: state.browserPath } : {}),
      };
    },
  });
  const loginManager = new LoginManager(
    accounts,
    {
      home: homedir(),
      dirFor: (email) => managedLoginDir(homedir(), email),
      probe: async (dir) => { …unchanged… },
      start: ({ dir, email, browserLauncher }) => {
        const proc = spawnLogin({
          dir,
          email,
          ...(browserLauncher !== undefined ? { browserLauncher } : {}),
        });
        return { …unchanged… };
      },
    },
    { browserSession: { launcherFor: (accountId) => browser.launcherFor('claude', accountId) } },
  );
```

and in the `buildAuthHandlers({ … })` call, use `console: consoleState` and add `browser`.

Export the new surface from `packages/core/src/index.ts` beside the other auth exports:

```ts
export {
  BrowserSession,
  browserProfileDir,
  detectBrowser,
  type BrowserSessionDeps,
  type BrowserSessionSettings,
  type BrowserSessionView,
} from './auth/browser-session.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/core/src/`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: clean.

Run: `corepack pnpm exec depcruise --config .dependency-cruiser.cjs packages apps` (or the repo's
`pnpm lint:deps` script if one exists — check `package.json`)
Expected: the same **5** pre-existing `no-circular` violations and no more.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/console/console-state-store.ts packages/core/src/rpc/auth-view.ts packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/session/daemon.ts packages/core/src/index.ts
git commit -m "feat: serve and switch isolated browser logins over the auth verbs"
```

---

### Task 8: The console edge — schema, IPC, store

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts`
- Modify: `packages/console-viewmodel/src/reads.test.ts`
- Modify: `apps/desktop/src/shared/methods.ts`
- Modify: `apps/desktop/src/shared/methods.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/api.d.ts`
- Modify: `apps/desktop/src/renderer/console.ts`
- Modify: `apps/desktop/src/renderer/panels/mockAuth.ts`
- Test: `apps/desktop/src/renderer/panels/mockAuth.test.ts` (create if absent — check first)

**Interfaces:**
- Consumes: the `AuthView` shape from Task 7.
- Produces:
  - `AuthViewSchema.browserSession`, `CredentialViewSchema.hasProfile`
  - `window.coa.setIsolatedBrowserLogins({ on })`, `window.coa.setBrowserPath({ path })`,
    widened `removeCredential` / `removeProvider` params
  - `rpcSetIsolatedBrowserLogins(on)`, `rpcSetBrowserPath(path)`,
    `rpcRemoveCredential(id, removeProfile?)`, `rpcRemoveProvider(providerId, removeProfiles?)`
  - `MockAuthState.browserSession`, `.setIsolatedBrowserLogins(on)`, `.setBrowserPath(path)`;
    `Credential.hasProfile?: boolean`; widened `removeCredential` / `removeProvider` actions.

- [ ] **Step 1: Write the failing tests**

In `packages/console-viewmodel/src/reads.test.ts`, extend the existing well-formed `AuthViewSchema`
case with `browserSession: { enabled: false, available: false }` and add:

```ts
  it('carries the browser-session block and a credential profile flag', () => {
    const view = AuthViewSchema.parse({
      added: ['claude'],
      credentials: [
        {
          id: 'claude:worm',
          providerId: 'claude',
          label: 'worm',
          masked: '~/.claude',
          disabled: false,
          hasProfile: true,
        },
      ],
      activeByProvider: {},
      enabled: { claude: true },
      chains: {},
      browserSession: { enabled: true, available: true, detectedPath: 'C:\\chrome.exe' },
    });
    expect(view.credentials[0]?.hasProfile).toBe(true);
    expect(view.browserSession.detectedPath).toBe('C:\\chrome.exe');
    expect(view.browserSession.path).toBeUndefined();
  });
```

In `apps/desktop/src/shared/methods.test.ts`, add the two names to the asserted verb list and:

```ts
    expect(METHODS.setIsolatedBrowserLogins.params?.parse({ on: true })).toBeTruthy();
    expect(METHODS.setBrowserPath.params?.parse({ path: 'C:\\chrome.exe' })).toBeTruthy();
    expect(METHODS.removeCredential.params?.parse({ id: 'x', removeProfile: true })).toBeTruthy();
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run packages/console-viewmodel/src/reads.test.ts apps/desktop/src/shared/methods.test.ts`
Expected: FAIL — `browserSession` required but missing / unknown method names.

- [ ] **Step 3: Extend the edge schema**

In `packages/console-viewmodel/src/reads.ts`, add to `CredentialViewSchema`:

```ts
    hasProfile: z.boolean().optional(),
```

and to `AuthViewSchema`:

```ts
    /** Defaulted, not required: an older daemon that predates isolation still parses. */
    browserSession: z
      .object({
        enabled: z.boolean(),
        available: z.boolean(),
        detectedPath: z.string().optional(),
        path: z.string().optional(),
      })
      .strip()
      .default({ enabled: false, available: false }),
```

**Expect fallout:** `.default(…)` makes `browserSession` *required on the inferred type*, so every
existing `AuthView` object literal in tests stops typechecking (at least `FIXTURE_VIEW` and
`EMPTY_VIEW` in `apps/desktop/src/renderer/panels/AuthPanel.test.tsx`). Run
`corepack pnpm typecheck` to enumerate them and add
`browserSession: { enabled: false, available: false }` to each — do not weaken the schema to avoid
the edit.

- [ ] **Step 4: Add the IPC verbs**

`apps/desktop/src/shared/methods.ts` — add to the `MethodName` union after `'clearCooldown'`:

```ts
  | 'setIsolatedBrowserLogins'
  | 'setBrowserPath'
```

and to `METHODS`:

```ts
  setIsolatedBrowserLogins: { params: z.object({ on: z.boolean() }), result: AuthViewSchema },
  setBrowserPath: { params: z.object({ path: z.string() }), result: AuthViewSchema },
```

and widen the two removals:

```ts
  removeCredential: {
    params: z.object({ id: z.string(), removeProfile: z.boolean().optional() }),
    result: AuthViewSchema,
  },
  removeProvider: {
    params: z.object({ providerId: z.string(), removeProfiles: z.boolean().optional() }),
    result: AuthViewSchema,
  },
```

`apps/desktop/src/main/index.ts` — beside the `clearCooldown` case:

```ts
    case 'setIsolatedBrowserLogins':
      return proxyDaemon('setIsolatedBrowserLogins', params);
    case 'setBrowserPath':
      return proxyDaemon('setBrowserPath', params);
```

`apps/desktop/src/preload/api.d.ts` — widen the two removals and add:

```ts
      removeCredential(params: { id: string; removeProfile?: boolean }): Promise<AuthView>;
      removeProvider(params: { providerId: string; removeProfiles?: boolean }): Promise<AuthView>;
      /** The global "sign logins in through a dedicated browser profile" toggle. */
      setIsolatedBrowserLogins(params: { on: boolean }): Promise<AuthView>;
      /** The browser-binary override; an empty path clears it back to auto-detection. */
      setBrowserPath(params: { path: string }): Promise<AuthView>;
```

`apps/desktop/src/renderer/console.ts`:

```ts
export const rpcRemoveCredential = (id: string, removeProfile?: boolean): Promise<AuthView> =>
  window.coa.removeCredential({ id, ...(removeProfile !== undefined ? { removeProfile } : {}) });
export const rpcRemoveProvider = (providerId: string, removeProfiles?: boolean): Promise<AuthView> =>
  window.coa.removeProvider({ providerId, ...(removeProfiles !== undefined ? { removeProfiles } : {}) });
export const rpcSetIsolatedBrowserLogins = (on: boolean): Promise<AuthView> =>
  window.coa.setIsolatedBrowserLogins({ on });
export const rpcSetBrowserPath = (path: string): Promise<AuthView> =>
  window.coa.setBrowserPath({ path });
```

(replacing the existing `rpcRemoveCredential` / `rpcRemoveProvider` definitions).

- [ ] **Step 5: Extend the renderer store**

In `apps/desktop/src/renderer/panels/mockAuth.ts`:

- `Credential` gains:

```ts
  /** A dedicated browser profile exists for this login — what the removal prompt asks about. */
  hasProfile?: boolean;
```

- `toCredential` gains `if (c.hasProfile !== undefined) cred.hasProfile = c.hasProfile;`
- `MockAuthState` gains:

```ts
  /** The isolated-browser-login capability, daemon-owned: the global toggle, whether a
   *  browser was found, and the detected/overridden binary. */
  browserSession: { enabled: boolean; available: boolean; detectedPath?: string; path?: string };
  setIsolatedBrowserLogins: (on: boolean) => Promise<void>;
  /** An empty path clears the override back to auto-detection. */
  setBrowserPath: (path: string) => Promise<void>;
```

- `removeCredential` / `removeProvider` signatures gain the optional flag.
- `apply` gains `browserSession: view.browserSession,`
- the initial state gains `browserSession: { enabled: false, available: false },`
- the actions:

```ts
  removeCredential: async (credentialId, removeProfile) =>
    apply(set)(await rpcRemoveCredential(credentialId, removeProfile)),
  removeProvider: async (providerId, removeProfiles) =>
    apply(set)(await rpcRemoveProvider(providerId, removeProfiles)),
  setIsolatedBrowserLogins: async (on) => apply(set)(await rpcSetIsolatedBrowserLogins(on)),
  setBrowserPath: async (path) => apply(set)(await rpcSetBrowserPath(path)),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run packages/console-viewmodel/src apps/desktop/src`
Expected: PASS.

Run: `corepack pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/console-viewmodel/src/reads.ts packages/console-viewmodel/src/reads.test.ts apps/desktop/src/shared/methods.ts apps/desktop/src/shared/methods.test.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.d.ts apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/panels/mockAuth.ts apps/desktop/src/renderer/panels/AuthPanel.test.tsx
git commit -m "feat: carry the browser-session capability to the console"
```

---

### Task 9: The setting, in settings

**Files:**
- Modify: `apps/desktop/src/renderer/shell/Settings.tsx`
- Test: `apps/desktop/src/renderer/shell/Settings.test.tsx`

**Interfaces:**
- Consumes: `useMockAuth`'s `browserSession`, `setIsolatedBrowserLogins`, `setBrowserPath` (Task 8).
- Produces: exported `IsolatedBrowserRow`, `BrowserPathRow` (exported so they can be tested
  without standing up the whole dialog).

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/renderer/shell/Settings.test.tsx`:

```ts
describe('login settings rows', () => {
  it('reflects the daemon toggle and flips it', async () => {
    const setIsolated = vi.fn().mockResolvedValue(undefined);
    useMockAuth.setState({
      browserSession: { enabled: false, available: true },
      setIsolatedBrowserLogins: setIsolated,
    });
    render(<IsolatedBrowserRow />);
    await userEvent.click(screen.getByRole('switch'));
    expect(setIsolated).toHaveBeenCalledWith(true);
  });

  it('says so when no browser was found instead of hiding the control', () => {
    useMockAuth.setState({ browserSession: { enabled: true, available: false } });
    render(<IsolatedBrowserRow />);
    expect(screen.getByText(/no browser found/i)).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it('prefills the override from detection and commits an edit', async () => {
    const setPath = vi.fn().mockResolvedValue(undefined);
    useMockAuth.setState({
      browserSession: { enabled: true, available: true, detectedPath: 'C:\\chrome.exe' },
      setBrowserPath: setPath,
    });
    render(<BrowserPathRow />);
    const field = screen.getByLabelText('browser');
    expect((field as HTMLInputElement).value).toBe('C:\\chrome.exe');
    await userEvent.clear(field);
    await userEvent.type(field, 'D:\\brave.exe{Enter}');
    expect(setPath).toHaveBeenCalledWith('D:\\brave.exe');
  });
});
```

Match the file's existing imports (`render`, `screen`, `userEvent`, `vi`) and add
`import { useMockAuth } from '../panels/mockAuth.js';` plus the two row imports.
Check `Toggle`'s rendered role in `packages/console-kit/src/inputs/Toggle.tsx` before relying on
`getByRole('switch')` — use whatever role/aria-label it actually exposes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/shell/Settings.test.tsx`
Expected: FAIL — `IsolatedBrowserRow` is not exported.

- [ ] **Step 3: Implement**

In `apps/desktop/src/renderer/shell/Settings.tsx`, add imports (`useEffect`, `useMockAuth`,
`TextInput` from `../panels/fields.js`) and the two rows:

```tsx
/** The isolation toggle. Daemon-owned (the login spawn reads it, not the renderer), so it
 *  renders from the auth view rather than from `ConsoleSettings` — and it is never
 *  disabled: with no browser found it still says what it found and stays flippable, and
 *  the login just takes the copy-link path (SC-1). */
export function IsolatedBrowserRow(): React.JSX.Element {
  const session = useMockAuth((s) => s.browserSession);
  const setOn = useMockAuth((s) => s.setIsolatedBrowserLogins);
  // The dialog can open before the auth surface ever mounted; the read is idempotent.
  useEffect(() => {
    void useMockAuth.getState().hydrate().catch(() => {});
  }, []);
  return (
    <span className="flex flex-none items-center gap-2.5">
      {!session.available && <span className="font-mono text-meta text-s7">no browser found</span>}
      <Toggle
        on={session.enabled}
        onChange={(on) => void setOn(on).catch(() => {})}
        aria-label="dedicated browser profile"
      />
    </span>
  );
}

/** The binary override, prefilled from detection — an override is a correction, never a
 *  required setup step. Blank clears it back to auto-detection. */
export function BrowserPathRow(): React.JSX.Element {
  const session = useMockAuth((s) => s.browserSession);
  const setPath = useMockAuth((s) => s.setBrowserPath);
  const resolved = session.path ?? session.detectedPath ?? '';
  const [value, setValue] = useState(resolved);
  // Re-seed when detection or the stored override changes underneath the field.
  useEffect(() => setValue(resolved), [resolved]);
  return (
    <TextInput
      value={value}
      onChange={setValue}
      onCommit={() => void setPath(value.trim()).catch(() => {})}
      placeholder="auto-detect"
      aria-label="browser"
      className="w-64 flex-none"
    />
  );
}
```

Add the section to `SECTIONS` after `appearance`:

```ts
  {
    id: 'logins',
    title: 'logins',
    rows: [
      {
        id: 'isolated-browser',
        name: 'Dedicated browser profile',
        desc: 'Sign each account in through its own browser profile, so the account you name is the account that lands. Off keeps today’s browser.',
        render: () => <IsolatedBrowserRow />,
      },
      {
        id: 'browser-binary',
        name: 'Browser',
        desc: 'Which browser those profiles open in. Detected automatically — set a path only to correct it.',
        render: () => <BrowserPathRow />,
      },
    ],
  },
```

Check `TextInput`'s props in `apps/desktop/src/renderer/panels/fields.tsx` before wiring
`aria-label` / `className`; if it does not forward `aria-label`, wrap it in a `<label>` the test can
query instead and adjust the test's `getByLabelText` accordingly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/shell/Settings.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/shell/Settings.tsx apps/desktop/src/renderer/shell/Settings.test.tsx
git commit -m "feat: offer dedicated browser profiles from settings"
```

---

### Task 10: The removal prompts and the honest login copy

**Files:**
- Modify: `apps/desktop/src/renderer/shell/store.ts`
- Modify: `apps/desktop/src/renderer/panels/AuthPanel.tsx`
- Modify: `apps/desktop/src/renderer/panels/LoginFlow.tsx`
- Test: `apps/desktop/src/renderer/panels/AuthPanel.test.tsx` (create if absent),
  `apps/desktop/src/renderer/panels/LoginFlow.test.tsx`

**Interfaces:**
- Consumes: `Credential.hasProfile`, the widened `removeCredential`/`removeProvider` actions, and
  `browserSession` (Task 8).
- Produces: `ShellState.confirmRemoveCredential?: string`, `setConfirmRemoveCredential(id?)`;
  `RemoveCredentialDialog` mounted by `AuthSurface`.

- [ ] **Step 1: Write the failing test**

Append to `apps/desktop/src/renderer/panels/AuthPanel.test.tsx`, reusing its `renderAuth(view)`
helper and the `'<label> actions'` row-menu idiom already used throughout the file:

```tsx
/** One claude login, with the surface's provider list around it — the smallest view that
 *  can exercise a removal. */
const claudeOnly = (over: Partial<Credential> = {}): AuthView => ({
  added: ['claude'],
  credentials: [
    {
      id: 'claude:a@b.org',
      providerId: 'claude',
      label: 'a@b.org',
      masked: '~/.coa/logins/a-b-org',
      disabled: false,
      email: 'a@b.org',
      ...over,
    },
  ],
  activeByProvider: { claude: 'claude:a@b.org' },
  enabled: { claude: true },
  chains: {},
  browserSession: { enabled: true, available: true },
});

describe('removing a login with a browser profile', () => {
  it('removes straight away when there is no profile to think about', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    await renderAuth(claudeOnly());
    useMockAuth.setState({ removeCredential: remove });
    await user.click(screen.getByRole('button', { name: 'a@b.org actions' }));
    await user.click(await screen.findByText('remove'));
    expect(remove).toHaveBeenCalledWith('claude:a@b.org', undefined);
  });

  it('asks before deleting a profile, and keeps it by default', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    await renderAuth(claudeOnly({ hasProfile: true }));
    useMockAuth.setState({ removeCredential: remove });
    await user.click(screen.getByRole('button', { name: 'a@b.org actions' }));
    await user.click(await screen.findByText('remove'));
    expect(remove).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: /remove login/i }));
    expect(remove).toHaveBeenCalledWith('claude:a@b.org', false);
  });

  it('deletes the profile too when the prompt is opted into', async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue(undefined);
    await renderAuth(claudeOnly({ hasProfile: true }));
    useMockAuth.setState({ removeCredential: remove });
    await user.click(screen.getByRole('button', { name: 'a@b.org actions' }));
    await user.click(await screen.findByText('remove'));
    await user.click(screen.getByLabelText('also delete the browser profile'));
    await user.click(screen.getByRole('button', { name: /remove login/i }));
    expect(remove).toHaveBeenCalledWith('claude:a@b.org', true);
  });
});
```

Two notes for whoever pastes this: `useMockAuth.setState` must run **after** `renderAuth` (its
`hydrate()` reprojects the whole store), and the confirm button's accessible name must not collide
with the menu item — the menu closes on click, but prefer `findByRole('button', …)` over
`getByText` so the assertion cannot match a stale menu node.

In `apps/desktop/src/renderer/panels/LoginFlow.test.tsx`, add to the pre-step describe (matching
however that file already mounts `LoginDialog` with `useShell.setState({ loginEmailFor: … })`):

```tsx
  it('names the dedicated profile in the pre-step when isolation is live', () => {
    useMockAuth.setState({ browserSession: { enabled: true, available: true } });
    renderEmailStep();
    expect(screen.getByText(/its own browser profile/i)).toBeTruthy();
  });

  it('keeps today’s copy when isolation is off', () => {
    useMockAuth.setState({ browserSession: { enabled: false, available: false } });
    renderEmailStep();
    expect(screen.getByText(/opens in your browser/i)).toBeTruthy();
  });
```

where `renderEmailStep()` is the file's existing way of opening the pre-step (reuse it verbatim;
do not add a second mounting path).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/`
Expected: FAIL — removal fires immediately; the profile copy is absent.

- [ ] **Step 3: Add the dialog slot**

In `apps/desktop/src/renderer/shell/store.ts`, mirroring `confirmRemoveProvider` exactly:
add `confirmRemoveCredential?: string | undefined;` to `ShellState` (with the doc comment "The
login the remove-confirm dialog is asking about (undefined = closed)."), to `CLOSE_ALL_DIALOGS`,
to the initial state, and the setter:

```ts
  setConfirmRemoveCredential: (id) =>
    set(
      id !== undefined
        ? { ...CLOSE_ALL_DIALOGS, confirmRemoveCredential: id }
        : { confirmRemoveCredential: undefined },
    ),
```

- [ ] **Step 4: Prompt on removal**

In `apps/desktop/src/renderer/panels/AuthPanel.tsx`:

`CredentialRow`'s remove menu item routes through the prompt only when there is something to
prompt about (D85: a login that never used isolation removes exactly as it does today):

```tsx
          <MenuItem
            onClick={() => {
              if (credential.hasProfile === true) {
                useShell.getState().setConfirmRemoveCredential(credential.id);
              } else {
                void removeCredential(credential.id).catch(() => {});
              }
            }}
          >
            <span className="text-crit">remove</span>
          </MenuItem>
```

Mount `<RemoveCredentialDialog />` beside `<RemoveProviderDialog />` in `AuthSurface`, and add:

```tsx
/** Removing a login that has a dedicated browser profile asks about the profile too: it is
 *  tens of MB of cookie jar on disk, and deleting it is a filesystem act the user should
 *  see rather than inherit. Keeping it is the default — the cautious half of a destructive
 *  choice. */
function RemoveCredentialDialog(): React.JSX.Element {
  const id = useShell((s) => s.confirmRemoveCredential);
  const setConfirm = useShell((s) => s.setConfirmRemoveCredential);
  const removeCredential = useMockAuth((s) => s.removeCredential);
  const credential = useMockAuth((s) => s.credentials.find((c) => c.id === id));
  const [alsoProfile, setAlsoProfile] = useState(false);
  const close = (): void => {
    setConfirm(undefined);
    setAlsoProfile(false);
  };

  return (
    <ModalShell
      open={credential !== undefined}
      onClose={close}
      aria-label="remove login"
      className="w-96"
    >
      {credential !== undefined && (
        <>
          <div className="flex items-center gap-2.5 border-b border-s3 px-4 py-3">
            <span className="text-sec font-semibold text-s11">remove {credential.label}?</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4 text-code leading-relaxed text-s9">
            <span>
              coa forgets this login. The login itself stays where it lives — nothing is
              touched at the provider.
            </span>
            <label className="flex items-center gap-2.5">
              <Toggle
                on={alsoProfile}
                onChange={setAlsoProfile}
                aria-label="also delete the browser profile"
              />
              <span>also delete the browser profile (its cookies and cache, tens of MB)</span>
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-s3 px-4 py-3">
            <Button variant="outline" onClick={close}>
              cancel
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                void removeCredential(credential.id, alsoProfile).catch(() => {});
                close();
              }}
            >
              <span className="text-crit">remove login</span>
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
```

In `RemoveProviderDialog`, add the same opt-in when any of the provider's credentials has a
profile — a local `const [alsoProfiles, setAlsoProfiles] = useState(false);`, a
`const profiles = useMockAuth((s) => s.credentials.filter((c) => c.providerId === providerId && c.hasProfile === true).length);`,
the same `Toggle` row rendered only when `profiles > 0` (label: `also delete their ${profiles} browser profile(s)`),
and `removeProvider(provider.id, alsoProfiles)` on confirm.

- [ ] **Step 5: Tell the truth in the login flow**

In `apps/desktop/src/renderer/panels/LoginFlow.tsx`, import `useMockAuth` and in `EmailStep`:

```tsx
  const isolated = useMockAuth((s) => s.browserSession.enabled && s.browserSession.available);
```

and replace the hint span's text with:

```tsx
        <span className="text-meta leading-relaxed text-s7">
          {isolated
            ? 'Claude’s sign-in opens in its own browser profile for this account, pre-filled with this email — so the account you name is the account that lands.'
            : 'Claude’s sign-in opens in your browser, pre-filled with this email.'}
        </span>
```

Replace the stale comment above it (it refers to a spike that has since settled) with a one-liner
pointing at the ADR. In `FlowBody`'s `awaiting` step, keep the copy as-is: the copy-link fallback
must stay reachable whether or not a profile opened.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `corepack pnpm exec vitest run apps/desktop/src`
Expected: PASS.

- [ ] **Step 7: Verify in the real app (jsdom is not visual proof)**

```bash
corepack pnpm build
```

Launch the desktop app (the `run` skill / `apps/desktop/scripts/dev.mjs`) with the daemon
restarted, and confirm by screenshot:
1. settings → **logins** shows both rows; the browser field is prefilled with a real detected path.
2. flipping the toggle survives a restart of the app.
3. with the toggle on, the sign-in pre-step wears the dedicated-profile copy.
4. removing a login that has no profile still removes in one click (no new dialog).

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/renderer/shell/store.ts apps/desktop/src/renderer/panels/AuthPanel.tsx apps/desktop/src/renderer/panels/AuthPanel.test.tsx apps/desktop/src/renderer/panels/LoginFlow.tsx apps/desktop/src/renderer/panels/LoginFlow.test.tsx
git commit -m "feat: ask before deleting a login's browser profile"
```

---

### Task 11: Close the docs and hand the attended run its checklist

**Files:**
- Modify: `docs/adr/0018-isolated-browser-login-sessions.md`
- Modify: `docs/superpowers/specs/2026-07-30-browser-profile-login-isolation-design.md`
- Modify: `ROADMAP.md`
- Modify: `.superpowers/sdd/attended-run-handoff.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Flip the ADR**

In `docs/adr/0018-isolated-browser-login-sessions.md` change `- Status: proposed` to
`- Status: accepted`, and extend the **Follow-up** bullet to read:

```markdown
- **Follow-up:** confirm in the next attended run that `BROWSER` replaces rather than supplements
  the default open, end to end with a real CLI-generated authorize URL. The shim's URL quoting is
  covered by a `COA_LIVE`-gated round-trip test; the handshake itself is attended-only.
```

- [ ] **Step 2: Retire the spec's status line**

In the design spec, change the status line to:

```markdown
**Status:** implemented (2026-07-30 design; shipped on `main`). The attended `BROWSER`
replace-vs-supplement confirmation is the one open item — see ADR-0018's follow-up.
```

and update its `_Last reviewed:_` footer to the date the work lands.

- [ ] **Step 3: Record it on the ROADMAP**

Append to the auth paragraph that ends with the ADR-0017 link (around `ROADMAP.md:252`):

```markdown
  **Isolated browser logins shipped:** a global, off-by-default toggle signs each account in
  through a browser launched on its own profile dir (`~/.coa/browser-profiles/<account-id>`),
  redirected via `BROWSER` on the `claude auth login` spawn, so an email-defined account is
  enforced rather than declared; accounts gained a stable opaque id, and removing one prompts
  about its profile. win32 Chrome/Edge detection with an override; anything missing degrades to
  the copy-link + paste-code path —
  [ADR-0018](docs/adr/0018-isolated-browser-login-sessions.md).
```

- [ ] **Step 4: Add the attended-run items**

Append a section to `.superpowers/sdd/attended-run-handoff.md`:

```markdown
## Isolated browser logins (ADR-0018) — attended checks

1. Settings → logins: toggle ON; the browser field shows a real detected path.
2. Sign in a NEW account. Confirm: exactly ONE browser window opens, it is a fresh profile
   (signed out of Google), and **no** default-browser window appears alongside it — this is the
   `BROWSER` replace-vs-supplement confirmation the ADR is waiting on.
3. Complete the handshake there (paste-code path if the CLI asks). The account registers under
   the email you declared, with no mismatch phase.
4. Sign a SECOND account in. Confirm its window does not inherit the first account's session.
5. `~/.coa/browser-profiles/` holds one dir per account id plus one `.cmd` shim each.
6. Remove one account → the prompt offers the profile; opting in deletes the dir and its shim.
7. Toggle OFF and sign in once more: the old behavior returns exactly (default browser, no
   profile dir created).
```

- [ ] **Step 5: Verify the doc system**

Run: `corepack pnpm docs:check`
Expected: OK (the same count as at handoff, 43, unless a doc was added).

- [ ] **Step 6: Commit**

```bash
git add docs/adr/0018-isolated-browser-login-sessions.md docs/superpowers/specs/2026-07-30-browser-profile-login-isolation-design.md ROADMAP.md .superpowers/sdd/attended-run-handoff.md
git commit -m "docs: accept isolated browser logins and hand the run its checks"
```

---

## Final verification (before declaring the plan done)

- [ ] `corepack pnpm exec vitest run` — expect the pre-existing **10** adapter-deepseek/longcat
      failures and **nothing else** red; the total should be ~2393 + the ~45 tests this plan adds.
- [ ] `corepack pnpm typecheck` — clean.
- [ ] `corepack pnpm build` — green (the daemon and console ship from `dist`).
- [ ] `corepack pnpm docs:check` — OK.
- [ ] eslint / prettier / depcruise — **compare against a stash of the clean tree**; add no new
      errors, warnings, dirty files, or `no-circular` violations beyond the documented baseline
      (8 / 2 / ~44 / 5).
- [ ] `git log --oneline` — every subject is a plain Conventional Commit with no body, no trailer,
      and no module ids or plan codenames.
</content>
</invoke>

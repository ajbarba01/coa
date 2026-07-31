# In-app Claude Login, Email-defined Accounts + Attention Badges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drive `claude auth login` from inside coa against managed config dirs, define Claude accounts by email (pre-filled logins, probe-verified identity, mismatch flagging), detect stale logins via `claude auth status --json`, and surface needs-relogin with attention badges — then a polish pass over the touched surfaces.

**Architecture:** A login driver + status probe on the Claude-adapter seam (`packages/adapter-claude-sdk`), orchestrated by a `LoginManager` in core (pure state reducer, injectable driver/probe), exposed as RPC verbs beside `buildAuthHandlers`, with health/identity threaded onto `assembleAuthView` and the renderer polling `loginState` while its dialog is open. The mockup's `LoginFlow.tsx`/badge derivations (branch `mockups/model-list-and-login`, commit `a6436fb`) are the interaction reference.

**Tech Stack:** TypeScript strict, Zod, node-pty (optional dep, graceful degrade), child_process, Vitest, zustand, Electron IPC via `METHODS`.

**Spec:** `docs/superpowers/specs/2026-07-18-in-app-login-relogin-badges-design.md`
**Prereq:** the model-catalog plan (`2026-07-18-model-catalog-sot.md`) is independent; either order works.

## Global Constraints

- Credential-blind (D84): coa never reads a token file. Everything it learns comes from CLI stdout/exit codes (`claude auth login`, `claude auth status --json`).
- SC-1: mismatch and needs-relogin are **flagged, never blocked**; a broken active account is never auto-switched.
- Spike facts (verified live, `claude` 2.1.214 — do not re-derive): login = `claude auth login --claudeai` honoring `CLAUDE_CONFIG_DIR`; `--email <email>` pre-populates the login page; the OAuth URL prints to stdout **only on a TTY** (piped stdio prints nothing ⇒ PTY needed for capture; degrade gracefully); probe = `claude auth status --json` → `{loggedIn, authMethod, apiProvider, email, orgId, orgName, subscriptionType}`, empty dir ⇒ `loggedIn:false`.
- TypeScript `strict`, no `any`; `exactOptionalPropertyTypes` — rebuild optional fields by omission.
- Commits: subject-only Conventional Commits; stage by name. Tests: `corepack pnpm exec vitest run <path>`.
- The PTY spawn/OAuth handshake is **attended** — verified live in Task 11, never in CI. All state logic is pure and TDD'd.

---

### Task 1: `email` on the account entry + registry support

**Files:**
- Modify: `packages/shared/src/auth.ts` (accountSchema)
- Modify: `packages/core/src/auth/registry.ts` (`add` gains optional email; new `setEmail`)
- Test: `packages/shared/src/auth.test.ts`, `packages/core/src/auth/registry.test.ts` (extend both existing suites)

**Interfaces:**
- Produces: `Account` gains `email?: string` (the **declared** identity coa pre-fills logins with — distinct from the probe-derived live identity); `AccountsRegistry.add(label, locator, provider?, email?)`; `AccountsRegistry.setEmail(label: string, email: string): void`.

- [ ] **Step 1: Write the failing tests**

In `packages/shared/src/auth.test.ts` (follow the existing describe style):

```ts
it('accountSchema carries an optional declared email and drops none of the old fields', () => {
  const parsed = accountSchema.parse({
    label: 'a', locator: { type: 'config-dir', dir: '/x' }, email: 'a@b.org',
  });
  expect(parsed.email).toBe('a@b.org');
  expect(accountSchema.parse({ label: 'a', locator: { type: 'ambient' } }).email).toBeUndefined();
});
```

In `packages/core/src/auth/registry.test.ts` (reuse its temp-home harness):

```ts
it('add stores the declared email; setEmail backfills one later', () => {
  registry.add('work', { type: 'config-dir', dir: '/w' }, 'claude', 'work@barba.org');
  expect(registry.list()[0]?.email).toBe('work@barba.org');
  registry.add('old', { type: 'config-dir', dir: '/o' });
  registry.setEmail('old', 'old@barba.org');
  expect(registry.list().find((a) => a.label === 'old')?.email).toBe('old@barba.org');
});

it('setEmail on an unknown label throws (same contract as setDisabled)', () => {
  expect(() => registry.setEmail('ghost', 'x@y.z')).toThrow('unknown account');
});
```

- [ ] **Step 2: Run to verify both fail**

Run: `corepack pnpm exec vitest run packages/shared/src/auth.test.ts packages/core/src/auth/registry.test.ts`
Expected: FAIL — `email` undefined on parse / `setEmail` not a function.

- [ ] **Step 3: Implement**

`packages/shared/src/auth.ts`, inside `accountSchema` after `disabled`:

```ts
  /** The declared identity — what a driven login pre-fills (`--email`). The live
   *  identity is probe-derived and never stored here. Additive, drop-safe. */
  email: z.string().optional(),
```

`packages/core/src/auth/registry.ts` — extend `add` and append `setEmail` after `setDisabled`:

```ts
  add(label: string, locator: Locator, provider: Provider = 'claude', email?: string): void {
    const file = this.#read();
    if (file.accounts.some((a) => a.label === label)) {
      throw new Error(`account already exists: ${label}`);
    }
    file.accounts.push({ label, provider, locator, disabled: false, ...(email !== undefined ? { email } : {}) });
    this.#write(file);
  }

  /** Set/backfill the declared email (the driven login's `--email` value). */
  setEmail(label: string, email: string): void {
    const file = this.#read();
    const index = file.accounts.findIndex((a) => a.label === label);
    const account = file.accounts[index];
    if (account === undefined) throw new Error(`unknown account: ${label}`);
    file.accounts[index] = { ...account, email };
    this.#write(file);
  }
```

- [ ] **Step 4: Run both suites**

Run: `corepack pnpm exec vitest run packages/shared/src/auth.test.ts packages/core/src/auth/registry.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/auth.test.ts packages/core/src/auth/registry.ts packages/core/src/auth/registry.test.ts
git commit -m "feat: carry a declared email on the account entry"
```

---

### Task 2: The status probe (`claude auth status --json`)

**Files:**
- Create: `packages/adapter-claude-sdk/src/auth-status.ts`
- Modify: `packages/adapter-claude-sdk/src/index.ts` (export)
- Test: `packages/adapter-claude-sdk/src/auth-status.test.ts`

**Interfaces:**
- Produces: `authStatusSchema`/`AuthStatus` (`{loggedIn: boolean, email?, orgName?, subscriptionType?}` — unknown keys stripped); `parseAuthStatus(stdout: string): AuthStatus | undefined` (pure — undefined on unparseable); `probeAuthStatus(dir: string, run?: RunCommand): Promise<AuthStatus | undefined>` where `type RunCommand = (cmd: string, args: string[], env: Record<string, string | undefined>) => Promise<string>` (injectable; the default spawns `claude` with `CLAUDE_CONFIG_DIR: dir`, `shell: true` on win32, 15s timeout, resolves stdout, rejects on spawn error — a rejection maps to `undefined`: an unreachable CLI is *unknown*, never needs-relogin).

- [ ] **Step 1: Write the failing test**

```ts
// packages/adapter-claude-sdk/src/auth-status.test.ts
import { describe, expect, it, vi } from 'vitest';
import { parseAuthStatus, probeAuthStatus } from './auth-status.js';

const LIVE = JSON.stringify({
  loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
  email: 'alex@barba.org', orgId: 'b9d…', orgName: "alex@barba.org's Organization",
  subscriptionType: 'pro',
});

describe('parseAuthStatus', () => {
  it('parses the live shape, stripping fields coa does not consume', () => {
    expect(parseAuthStatus(LIVE)).toEqual({
      loggedIn: true, email: 'alex@barba.org',
      orgName: "alex@barba.org's Organization", subscriptionType: 'pro',
    });
  });

  it('parses the logged-out shape', () => {
    expect(parseAuthStatus(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false });
  });

  it('is undefined on garbage — unknown, never a verdict', () => {
    expect(parseAuthStatus('not json')).toBeUndefined();
    expect(parseAuthStatus(JSON.stringify({ nope: 1 }))).toBeUndefined();
  });
});

describe('probeAuthStatus', () => {
  it('runs claude auth status --json against the dir and parses stdout', async () => {
    const run = vi.fn().mockResolvedValue(LIVE);
    const status = await probeAuthStatus('/managed/dir', run);
    expect(run).toHaveBeenCalledWith(
      'claude', ['auth', 'status', '--json'],
      expect.objectContaining({ CLAUDE_CONFIG_DIR: '/managed/dir' }),
    );
    expect(status?.loggedIn).toBe(true);
  });

  it('a failed spawn resolves undefined (unreachable CLI ≠ needs-relogin)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ENOENT'));
    expect(await probeAuthStatus('/dir', run)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/auth-status.test.ts`
Expected: FAIL — cannot resolve `./auth-status.js`.

- [ ] **Step 3: Implement**

```ts
// packages/adapter-claude-sdk/src/auth-status.ts
import { spawn } from 'node:child_process';
import { z } from 'zod';

/**
 * The login-health probe — `claude auth status --json` against a config dir.
 * Purpose-built, non-interactive, honors CLAUDE_CONFIG_DIR (an empty dir reports
 * loggedIn:false). This is all coa ever learns about a login: CLI output, never
 * the token file (credential-blind, see the ADR added with this feature). One
 * probe feeds three consumers: health, the identity line, and the declared-email
 * backfill for manually-added accounts.
 */

export const authStatusSchema = z
  .object({
    loggedIn: z.boolean(),
    email: z.string().optional(),
    orgName: z.string().optional(),
    subscriptionType: z.string().optional(),
  })
  .strip();
export type AuthStatus = z.infer<typeof authStatusSchema>;

export type RunCommand = (
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
) => Promise<string>;

/** Pure: parse the probe's stdout. Undefined ⇒ unknown (no verdict), never a throw. */
export function parseAuthStatus(stdout: string): AuthStatus | undefined {
  try {
    const parsed = authStatusSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const PROBE_TIMEOUT_MS = 15_000;

/** Default runner: spawn the CLI, resolve its stdout. `shell` on win32 reaches the npm shim. */
const defaultRun: RunCommand = (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
  });

/** Probe one config dir. Resolves undefined when the CLI is unreachable/unparseable. */
export async function probeAuthStatus(dir: string, run: RunCommand = defaultRun): Promise<AuthStatus | undefined> {
  try {
    return parseAuthStatus(await run('claude', ['auth', 'status', '--json'], { CLAUDE_CONFIG_DIR: dir }));
  } catch {
    return undefined;
  }
}
```

Export from `packages/adapter-claude-sdk/src/index.ts` (matching its existing export lines):

```ts
export { authStatusSchema, parseAuthStatus, probeAuthStatus, type AuthStatus, type RunCommand } from './auth-status.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/auth-status.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/auth-status.ts packages/adapter-claude-sdk/src/auth-status.test.ts packages/adapter-claude-sdk/src/index.ts
git commit -m "feat: probe claude login health from cli status output"
```

---

### Task 3: The login driver (PTY spawn + URL capture) — pure parts TDD'd

**Files:**
- Create: `packages/adapter-claude-sdk/src/login-driver.ts`
- Modify: `packages/adapter-claude-sdk/src/index.ts` (export), `packages/adapter-claude-sdk/package.json` (add `"node-pty": "^1.0.0"` under `optionalDependencies`)
- Test: `packages/adapter-claude-sdk/src/login-driver.test.ts`

**Interfaces:**
- Produces:
  - `emailSlug(email: string): string` — lowercase, every non-alphanumeric run → `-`, trimmed of leading/trailing `-`.
  - `managedLoginDir(home: string, email: string): string` — `join(home, '.coa', 'logins', emailSlug(email))`.
  - `extractOauthUrl(chunk: string): string | undefined` — pure; finds the first `https://claude.{com,ai}/…oauth…` URL in (ANSI-stripped) terminal output.
  - `spawnLogin(opts: { dir: string; email: string }): LoginProcess` where `interface LoginProcess { onData(fn: (chunk: string) => void): void; onExit(fn: (code: number | undefined) => void): void; write(data: string): void; kill(): void; readonly ptyCaptured: boolean }` — tries `node-pty` via dynamic import (URL capture works), degrades to plain `child_process.spawn` (`ptyCaptured: false`, flow still completes via browser + probe-poll). Command: `claude auth login --claudeai --email <email>` with `CLAUDE_CONFIG_DIR` set; `claude.cmd` via shell on win32 for the plain path.
- The spawn itself is attended (Task 11); everything above it is pure and tested here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/adapter-claude-sdk/src/login-driver.test.ts
import { describe, expect, it } from 'vitest';
import { emailSlug, extractOauthUrl, managedLoginDir } from './login-driver.js';

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
    expect(extractOauthUrl('[1mvisit https://claude.ai/cai/oauth/x?y=1[0m')).toBe(
      'https://claude.ai/cai/oauth/x?y=1',
    );
    expect(extractOauthUrl('see https://docs.claude.com/help')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/login-driver.test.ts`
Expected: FAIL — cannot resolve `./login-driver.js`.

- [ ] **Step 3: Implement**

```ts
// packages/adapter-claude-sdk/src/login-driver.ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * The driven-login spawn on the Claude-adapter seam. coa runs Claude's OWN login
 * (`claude auth login --claudeai --email <email>`) against a managed config dir;
 * Claude opens the browser and writes the credentials itself — coa only watches
 * output and polls the status probe, staying credential-blind.
 *
 * The OAuth URL prints only on a TTY (spike fact), so the spawn prefers node-pty
 * (optional dep). Without it the flow DEGRADES, never breaks: the browser still
 * auto-opens and completion still lands via the probe poll — only the in-app
 * copy-link affordance goes dark (`ptyCaptured: false` tells the UI to say so).
 */

/** A filesystem-safe slug for an email: lowercase, non-alphanumeric runs → '-'. */
export function emailSlug(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The managed login dir an email's account lives in. */
export function managedLoginDir(home: string, email: string): string {
  return join(home, '.coa', 'logins', emailSlug(email));
}

// eslint-disable-next-line no-control-regex — ANSI escapes are control chars by definition
const ANSI = /\[[0-9;]*m/g;
const OAUTH_URL = /https:\/\/claude\.(?:com|ai)\/\S*oauth\S*/;

/** Pure: the first OAuth authorize URL in a chunk of terminal output. */
export function extractOauthUrl(chunk: string): string | undefined {
  const match = OAUTH_URL.exec(chunk.replace(ANSI, ''));
  return match?.[0];
}

export interface LoginProcess {
  onData(fn: (chunk: string) => void): void;
  onExit(fn: (code: number | undefined) => void): void;
  /** Forward the code-paste fallback to the CLI's "Paste code here if prompted >". */
  write(data: string): void;
  kill(): void;
  /** Whether output rides a PTY (URL capture possible) or a pipe (degraded). */
  readonly ptyCaptured: boolean;
}

const LOGIN_ARGS = (email: string): string[] => ['auth', 'login', '--claudeai', '--email', email];

/** Spawn the driven login. Prefers a PTY; degrades to a plain pipe. */
export function spawnLogin(opts: { dir: string; email: string }): LoginProcess {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: opts.dir };
  const dataFns: ((chunk: string) => void)[] = [];
  const exitFns: ((code: number | undefined) => void)[] = [];
  const emitData = (chunk: string): void => dataFns.forEach((fn) => fn(chunk));
  const emitExit = (code: number | undefined): void => exitFns.forEach((fn) => fn(code));

  const proc: {
    write: (d: string) => void;
    kill: () => void;
    ptyCaptured: boolean;
  } = { write: () => {}, kill: () => {}, ptyCaptured: false };

  void (async () => {
    try {
      const pty = await import('node-pty');
      const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
      const child = pty.spawn(cmd, LOGIN_ARGS(opts.email), { env: env as Record<string, string>, cols: 120, rows: 30 });
      proc.ptyCaptured = true;
      proc.write = (d) => child.write(d);
      proc.kill = () => child.kill();
      child.onData(emitData);
      child.onExit(({ exitCode }) => emitExit(exitCode));
    } catch {
      // node-pty unavailable (build failed / not installed) — degrade to a pipe.
      const child = spawn('claude', LOGIN_ARGS(opts.email), {
        env,
        shell: process.platform === 'win32',
        windowsHide: true,
      });
      proc.write = (d) => child.stdin.write(d);
      proc.kill = () => child.kill();
      child.stdout.on('data', (c: Buffer) => emitData(c.toString()));
      child.stderr.on('data', (c: Buffer) => emitData(c.toString()));
      child.on('close', (code) => emitExit(code ?? undefined));
      child.on('error', () => emitExit(undefined));
    }
  })();

  return {
    onData: (fn) => dataFns.push(fn),
    onExit: (fn) => exitFns.push(fn),
    write: (d) => proc.write(d),
    kill: () => proc.kill(),
    get ptyCaptured() {
      return proc.ptyCaptured;
    },
  };
}
```

Add to `packages/adapter-claude-sdk/package.json`:

```json
  "optionalDependencies": {
    "node-pty": "^1.0.0"
  }
```

Export from `index.ts`:

```ts
export {
  emailSlug, extractOauthUrl, managedLoginDir, spawnLogin, type LoginProcess,
} from './login-driver.js';
```

Run `corepack pnpm install` once after editing package.json (node-pty may compile; a failure is acceptable — it is optional and the driver degrades).

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/adapter-claude-sdk/src/login-driver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/login-driver.ts packages/adapter-claude-sdk/src/login-driver.test.ts packages/adapter-claude-sdk/src/index.ts packages/adapter-claude-sdk/package.json pnpm-lock.yaml
git commit -m "feat: drive claude login from a managed pty spawn"
```

---

### Task 4: `LoginManager` — the orchestrating state machine (core)

**Files:**
- Create: `packages/core/src/auth/login-manager.ts`
- Modify: `packages/core/src/index.ts` (export)
- Test: `packages/core/src/auth/login-manager.test.ts`

**Interfaces:**
- Consumes: `AccountsRegistry` (Task 1), `AuthStatus` shape (Task 2), `managedLoginDir` semantics (Task 3 — injected, not imported, to keep core's adapter import surface at the composition root).
- Produces:

```ts
export type LoginPhase = 'launching' | 'awaiting' | 'watching' | 'registered' | 'mismatch' | 'failed';
export type Health = 'healthy' | 'needs-relogin';
export interface LoginSnapshot {
  phase: LoginPhase;
  mode: 'new' | 'relogin';
  email: string;                    // the declared/requested email
  credentialId?: string;            // relogin target
  oauthUrl?: string;                // captured; absent while unknown or degraded
  ptyCaptured: boolean;             // false ⇒ show "link unavailable" copy
  landedEmail?: string;             // set on mismatch
  identity?: string;                // "email · plan" on registered
  error?: string;                   // set on failed
}
export interface LoginDriverPort {
  start(opts: { dir: string; email: string }): {
    onUrl(fn: (url: string) => void): void;
    onExit(fn: (code: number | undefined) => void): void;
    writeCode(code: string): void;
    kill(): void;
    readonly ptyCaptured: boolean;
  };
  probe(dir: string): Promise<{ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined>;
  home: string;
  dirFor(email: string): string;    // managedLoginDir(home, email)
}
export class LoginManager {
  constructor(registry: AccountsRegistry, driver: LoginDriverPort, opts?: { pollMs?: number });
  startLogin(args: { email: string; credentialId?: string }): LoginSnapshot;
  submitCode(code: string): void;
  cancelLogin(): void;
  resolveMismatch(action: 'keep' | 'retry'): LoginSnapshot | undefined;
  snapshot(): LoginSnapshot | undefined;
  // health — the generic attention channel
  healthOf(credentialId: string): Health | undefined;
  identityOf(credentialId: string): { email?: string; plan?: string } | undefined;
  reportAuthFailure(credentialId: string): void;
  probeAll(): Promise<void>;        // every claude config-dir account: health + identity + email backfill
}
```

Behavior locked here (each pinned by a test):
- `startLogin` (new mode): `phase:'launching'`, dir = `dirFor(email)`, driver started; the first URL flips to `awaiting` with `oauthUrl`; a poll (every `pollMs`, default 2000) of `probe(dir)` returning `loggedIn:true` finalizes.
- Finalize, email match (or probe returned no email): **new** → `registry.add(label = email, {type:'config-dir', dir}, 'claude', email)` (on duplicate-label throw, retry with `email-2`, `email-3`…), `registry.setActive(label)`, phase `registered`, identity `"email · plan"`; **relogin** → health flips `healthy`, `registry.setEmail` backfills if the account had none, phase `registered`.
- Finalize, landed ≠ requested: phase `mismatch`, `landedEmail` set, nothing registered yet. `resolveMismatch('keep')` finalizes under the landed email (and `setEmail`s a relogin target); `resolveMismatch('retry')` kills + restarts the driver at the same dir/email.
- Driver exit before `loggedIn` **and** a follow-up probe still `loggedIn:false` ⇒ `failed` (the exit itself is not failure — the browser handshake may still be pending, so exit only triggers one last probe after a grace poll).
- `cancelLogin` kills the driver, clears the flow, registers nothing.
- `probeAll`: for each claude `config-dir` account — probe its dir; `loggedIn:false` ⇒ health `needs-relogin`, `true` ⇒ `healthy` + identity cached + `setEmail` backfill when the account has none; probe `undefined` ⇒ **leave the previous health untouched** (unknown is not a verdict).
- `reportAuthFailure` sets `needs-relogin` (the live-session signal).

- [ ] **Step 1: Write the failing tests** — use a scripted fake driver:

```ts
// packages/core/src/auth/login-manager.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountsRegistry } from './registry.js';
import { LoginManager, type LoginDriverPort } from './login-manager.js';

/** A hand-cranked driver: tests fire url/exit and script the probe queue. */
function fakeDriver(home: string): LoginDriverPort & {
  fireUrl: (u: string) => void;
  fireExit: (code?: number) => void;
  probeQueue: (ReturnType<LoginDriverPort['probe']> extends Promise<infer T> ? T : never)[];
  killed: boolean;
} {
  let urlFn: (u: string) => void = () => {};
  let exitFn: (c: number | undefined) => void = () => {};
  const self = {
    home,
    killed: false,
    probeQueue: [] as ({ loggedIn: boolean; email?: string; subscriptionType?: string } | undefined)[],
    dirFor: (email: string) => join(home, '.coa', 'logins', email.replace(/[^a-z0-9]+/gi, '-')),
    start: () => ({
      onUrl: (fn: (u: string) => void) => (urlFn = fn),
      onExit: (fn: (c: number | undefined) => void) => (exitFn = fn),
      writeCode: () => {},
      kill: () => (self.killed = true),
      ptyCaptured: true,
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `corepack pnpm exec vitest run packages/core/src/auth/login-manager.test.ts`
Expected: FAIL — cannot resolve `./login-manager.js`.

- [ ] **Step 3: Implement `LoginManager`** — a single class holding `#flow` (the snapshot + driver handle + poll timer), `#health: Map<string, Health>`, `#identity: Map<string, {email?, plan?}>`. Implementation notes (write it straightforwardly; the tests above pin the contract):

- Poll loop: `setInterval(pollMs)`; each tick `await driver.probe(dir)`; `loggedIn:true` → clearInterval + `#finalize(status)`. Guard reentry with an in-flight flag.
- `#finalize(status)`: mismatch check (`status.email !== undefined && status.email !== flow.email` → phase `mismatch`, stash `landedEmail`/`status`), else `#complete(email = status.email ?? flow.email, plan = status.subscriptionType)`.
- `#complete`: new-mode → unique label via a `while (true) try { registry.add(label…) ; break } catch { label = \`${email}-${n++}\` }` loop, then `setActive`; relogin-mode → `#health.set(credentialId, 'healthy')`, `setEmail` backfill (wrap in try/catch — the account may have been removed mid-flow). Both: `#identity.set(credentialId | claude:label, {email, plan})`, snapshot → `registered` with `identity: plan === undefined ? email : \`${email} · ${plan}\``.
- On driver exit before completion: run one more probe after `pollMs` (grace), then `failed` if still logged out.
- `probeAll`: `registry.listByProvider('claude')` filtered to `locator.type === 'config-dir'`, probes run sequentially (the CLI is cheap and this avoids spawning N processes at once); credential id = `claude:${label}` (the `credentialId()` convention from `auth-view.ts`).
- Timers: `.unref()` where available so a daemon shutdown never hangs on a poll.

Export from `packages/core/src/index.ts`:

```ts
export { LoginManager, type Health, type LoginDriverPort, type LoginPhase, type LoginSnapshot } from './auth/login-manager.js';
```

- [ ] **Step 4: Run to verify it passes**

Run: `corepack pnpm exec vitest run packages/core/src/auth/login-manager.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/auth/login-manager.ts packages/core/src/auth/login-manager.test.ts packages/core/src/index.ts
git commit -m "feat: orchestrate the driven login and health state"
```

---

### Task 5: Health + identity on the assembled auth view

**Files:**
- Modify: `packages/core/src/rpc/auth-view.ts`
- Test: `packages/core/src/rpc/auth-view.test.ts` (extend)

**Interfaces:**
- Consumes: `LoginManager.healthOf/identityOf` via a narrow reader port.
- Produces: `AuthViewDeps` gains optional `login?: { healthOf(id: string): 'healthy' | 'needs-relogin' | undefined; identityOf(id: string): { email?: string; plan?: string } | undefined }`; `CredentialView` gains `email?: string` (declared, from the account entry), `health?: 'healthy' | 'needs-relogin'`, `identity?: string`, `plan?: string` (probe-derived). Absent `login` dep ⇒ views identical to today (additive).

- [ ] **Step 1: Extend the existing test suite** (reuse its store fakes):

```ts
it('threads declared email + probe health/identity onto claude credentials', () => {
  // registry fake holds: { label: 'work', provider: 'claude', locator: config-dir, email: 'w@x.org' }
  const view = assembleAuthView({
    ...deps,
    login: {
      healthOf: (id) => (id === 'claude:work' ? 'needs-relogin' : undefined),
      identityOf: (id) => (id === 'claude:work' ? { email: 'w@x.org', plan: 'pro' } : undefined),
    },
  });
  const cred = view.credentials.find((c) => c.id === 'claude:work');
  expect(cred).toMatchObject({ email: 'w@x.org', health: 'needs-relogin', identity: 'w@x.org · pro', plan: 'pro' });
});

it('without the login dep the view is unchanged (additive)', () => {
  const view = assembleAuthView(deps);
  expect(view.credentials.every((c) => c.health === undefined && c.identity === undefined)).toBe(true);
});
```

- [ ] **Step 2: Run to verify the new cases fail**, then implement: in the backend loop of `assembleAuthView`, build each claude credential as today plus:

```ts
      const id = credentialId(provider, account.label);
      const health = deps.login?.healthOf(id);
      const live = deps.login?.identityOf(id);
      const identity =
        live?.email !== undefined
          ? live.plan !== undefined ? `${live.email} · ${live.plan}` : live.email
          : undefined;
      credentials.push({
        id,
        providerId: provider,
        label: account.label,
        masked: maskFor(provider, account.locator),
        disabled: account.disabled,
        ...(account.email !== undefined ? { email: account.email } : {}),
        ...(health !== undefined ? { health } : {}),
        ...(identity !== undefined ? { identity } : {}),
        ...(live?.plan !== undefined ? { plan: live.plan } : {}),
      });
```

and extend the `CredentialView`/`AuthViewDeps` interfaces accordingly.

- [ ] **Step 3: Run the suite** — `corepack pnpm exec vitest run packages/core/src/rpc/auth-view.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/rpc/auth-view.ts packages/core/src/rpc/auth-view.test.ts
git commit -m "feat: thread login health and identity onto the auth view"
```

---

### Task 6: Login RPC verbs + daemon wiring

**Files:**
- Modify: `packages/core/src/rpc/auth-handlers.ts` (new verbs; deps gain the manager)
- Modify: `packages/core/src/session/daemon.ts` (`buildDaemonConsoleHandlers` constructs the manager once and passes it)
- Test: `packages/core/src/rpc/auth-handlers.test.ts` (extend)

**Interfaces:**
- Consumes: `LoginManager` (Task 4), the `login` view dep (Task 5), `spawnLogin`/`extractOauthUrl`/`managedLoginDir`/`probeAuthStatus` from `@coa/adapter-claude-sdk` (composition only — in `daemon.ts`, keeping `auth-handlers.ts` port-typed).
- Produces verbs (all M0-validated):
  - `startLogin {email, credentialId?}` → `LoginSnapshot`
  - `loginState` → `LoginSnapshot | { phase: 'idle' }` (a flow-less daemon answers `idle`, never an error)
  - `submitLoginCode {code}` → `LoginSnapshot | { phase: 'idle' }`
  - `cancelLogin` → `{ phase: 'idle' }`
  - `resolveLoginMismatch {action: 'keep' | 'retry'}` → `LoginSnapshot | { phase: 'idle' }`
  - `probeHealth` → `AuthView` (runs `probeAll()`, then assembles — the surface-mount/⟳ verb)
  - `reportAuthFailure {credentialId}` → `AuthView` (the live-session signal)
- `AuthHandlerDeps` becomes `AuthViewDeps & { loginManager?: LoginManager }` — every login verb no-ops to `{phase:'idle'}` / plain view when the manager is absent (SC-1, and existing tests keep passing unchanged).

- [ ] **Step 1: Extend the auth-handlers test suite** (its harness builds handlers over temp stores; add a `LoginManager` with the Task-4 fake driver):

```ts
describe('login verbs', () => {
  it('startLogin → loginState reflects the flow; cancelLogin returns idle', async () => {
    const started = await call('startLogin', { email: 'a@x.org' });
    expect(started).toMatchObject({ phase: 'launching', email: 'a@x.org' });
    expect(await call('loginState')).toMatchObject({ phase: 'launching' });
    expect(await call('cancelLogin')).toEqual({ phase: 'idle' });
  });

  it('probeHealth probes every claude dir and returns the health-threaded view', async () => {
    // seed one config-dir account + a scripted loggedIn:false probe
    const view = await call('probeHealth');
    expect(view.credentials.find((c) => c.id === 'claude:work')?.health).toBe('needs-relogin');
  });

  it('reportAuthFailure flips the account and returns the fresh view', async () => {
    const view = await call('reportAuthFailure', { credentialId: 'claude:work' });
    expect(view.credentials.find((c) => c.id === 'claude:work')?.health).toBe('needs-relogin');
  });

  it('without a manager every login verb degrades to idle, never throws', async () => {
    // handlers built with loginManager absent
    expect(await bare('startLogin', { email: 'a@x.org' })).toEqual({ phase: 'idle' });
    expect(await bare('probeHealth')).toMatchObject({ credentials: expect.any(Array) });
  });
});
```

- [ ] **Step 2: Run to verify the new cases fail**, then implement in `auth-handlers.ts`:

```ts
const IDLE = { phase: 'idle' } as const;
const startLoginParams = z.object({ email: z.string().min(3), credentialId: z.string().optional() });
const codeParams = z.object({ code: z.string().min(1) });
const mismatchParams = z.object({ action: z.enum(['keep', 'retry']) });
const failureParams = z.object({ credentialId: z.string().min(1) });

    // --- the driven-login verbs (SC-1: absent manager ⇒ idle, never a throw) --------
    startLogin: rpcMethod(startLoginParams, (p) =>
      deps.loginManager === undefined
        ? IDLE
        : deps.loginManager.startLogin({
            email: p.email,
            ...(p.credentialId !== undefined ? { credentialId: p.credentialId } : {}),
          }),
    ),
    loginState: rpcMethod(noParams, () => deps.loginManager?.snapshot() ?? IDLE),
    submitLoginCode: rpcMethod(codeParams, (p) => {
      deps.loginManager?.submitCode(p.code);
      return deps.loginManager?.snapshot() ?? IDLE;
    }),
    cancelLogin: rpcMethod(noParams, () => {
      deps.loginManager?.cancelLogin();
      return IDLE;
    }),
    resolveLoginMismatch: rpcMethod(mismatchParams, (p) =>
      deps.loginManager?.resolveMismatch(p.action) ?? IDLE,
    ),
    probeHealth: rpcMethod(noParams, async () => {
      await deps.loginManager?.probeAll();
      return assembleAuthView(deps);
    }),
    reportAuthFailure: rpcMethod(failureParams, (p) => {
      deps.loginManager?.reportAuthFailure(p.credentialId);
      return assembleAuthView(deps);
    }),
```

and pass `login: deps.loginManager` into every `assembleAuthView(deps)` call site by making the deps object itself carry it: `const viewDeps = { ...deps, ...(deps.loginManager !== undefined ? { login: deps.loginManager } : {}) };` at the top of `buildAuthHandlers`, using `viewDeps` for every `assembleAuthView` call (the manager already satisfies the `login` reader port structurally).

In `packages/core/src/session/daemon.ts` `buildDaemonConsoleHandlers`, construct the manager once (module composition — the one place core touches the adapter, exactly like `makeDeepSeekComplete`):

```ts
import { managedLoginDir, probeAuthStatus, spawnLogin, extractOauthUrl } from '@coa/adapter-claude-sdk';
import { LoginManager } from '../auth/login-manager.js';

const accounts = new AccountsRegistry(homedir());
const loginManager = new LoginManager(accounts, {
  home: homedir(),
  dirFor: (email) => managedLoginDir(homedir(), email),
  probe: (dir) => probeAuthStatus(dir),
  start: ({ dir, email }) => {
    const proc = spawnLogin({ dir, email });
    return {
      onUrl: (fn) =>
        proc.onData((chunk) => {
          const url = extractOauthUrl(chunk);
          if (url !== undefined) fn(url);
        }),
      onExit: (fn) => proc.onExit(fn),
      writeCode: (code) => proc.write(`${code}\r`),
      kill: () => proc.kill(),
      get ptyCaptured() {
        return proc.ptyCaptured;
      },
    };
  },
});
// …and in the buildAuthHandlers call:
    ...buildAuthHandlers({
      accounts,
      web: new WebConfigStore(homedir()),
      keys: new KeyStateStore(homedir()),
      console: new ConsoleStateStore(homedir()),
      loginManager,
    }),
```

- [ ] **Step 3: Run the full core suite** — `corepack pnpm exec vitest run packages/core` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/session/daemon.ts
git commit -m "feat: expose the driven login over rpc verbs"
```

---

### Task 7: Desktop IPC — login verbs + view fields cross the bridge

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts` (`CredentialViewSchema` + `LoginSnapshotSchema`)
- Modify: `apps/desktop/src/shared/methods.ts`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/api.d.ts`
- Test: compile + the Task 8 renderer tests.

- [ ] **Step 1: Edge schemas.** In `reads.ts`, extend `CredentialViewSchema` with:

```ts
    email: z.string().optional(),
    health: z.enum(['healthy', 'needs-relogin']).optional(),
```

(`identity`/`plan`/`expired`/`lastUsed` already exist.) Append:

```ts
/** The driven-login flow snapshot the renderer polls while its dialog is open.
 *  `idle` is the flow-less answer — a state, never an error. */
export const LoginSnapshotSchema = z
  .object({
    phase: z.enum(['idle', 'launching', 'awaiting', 'watching', 'registered', 'mismatch', 'failed']),
    mode: z.enum(['new', 'relogin']).optional(),
    email: z.string().optional(),
    credentialId: z.string().optional(),
    oauthUrl: z.string().optional(),
    ptyCaptured: z.boolean().optional(),
    landedEmail: z.string().optional(),
    identity: z.string().optional(),
    error: z.string().optional(),
  })
  .strip();
export type LoginSnapshot = z.infer<typeof LoginSnapshotSchema>;
```

- [ ] **Step 2: `methods.ts`** — add to the union: `'startLogin' | 'loginState' | 'submitLoginCode' | 'cancelLogin' | 'resolveLoginMismatch' | 'probeHealth' | 'reportAuthFailure'`; add entries:

```ts
  startLogin: {
    params: z.object({ email: z.string(), credentialId: z.string().optional() }),
    result: LoginSnapshotSchema,
  },
  loginState: { result: LoginSnapshotSchema },
  submitLoginCode: { params: z.object({ code: z.string() }), result: LoginSnapshotSchema },
  cancelLogin: { result: LoginSnapshotSchema },
  resolveLoginMismatch: { params: z.object({ action: z.enum(['keep', 'retry']) }), result: LoginSnapshotSchema },
  probeHealth: { result: AuthViewSchema },
  reportAuthFailure: { params: z.object({ credentialId: z.string() }), result: AuthViewSchema },
```

- [ ] **Step 3: `main/index.ts`** — seven pass-through cases in the switch, e.g. `case 'startLogin': return proxyDaemon('startLogin', params);` (same for `loginState` (no params), `submitLoginCode`, `cancelLogin` (no params), `resolveLoginMismatch`, `probeHealth` (no params), `reportAuthFailure`).

- [ ] **Step 4: `preload/api.d.ts`** — the seven method signatures using `LoginSnapshot`/`AuthView` from `@coa/console-viewmodel`, mirroring Step 2's params.

- [ ] **Step 5: Typecheck + desktop suite** — `corepack pnpm --filter <desktop-package-name> exec tsc -p tsconfig.json --noEmit` and `corepack pnpm exec vitest run apps/desktop/src` — Expected: clean/PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/console-viewmodel/src/reads.ts apps/desktop/src/shared/methods.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/api.d.ts
git commit -m "feat: bridge the login verbs across the ipc boundary"
```

---

### Task 8: Renderer — `loginStore` replaces the mock spine

**Files:**
- Create: `apps/desktop/src/renderer/panels/loginStore.ts`
- Delete: `apps/desktop/src/renderer/panels/mockLogin.ts` (Task 9 rewires consumers)
- Modify: `apps/desktop/src/renderer/console.ts` (rpc wrappers, next to the auth ones)
- Test: `apps/desktop/src/renderer/panels/loginStore.test.ts`

**Interfaces:**
- Produces: `useLogin` (zustand) with state `{ flow: LoginSnapshot | undefined }` and actions `startLogin({providerId, mode, email, credentialId?})`, `submitCode(code)`, `cancelLogin()`, `resolveMismatch(action)`, `poll()` (one `rpcLoginState` round: reprojects; on `phase:'idle'` clears; on a phase transition into `registered` fires `useMockAuth.getState().hydrate()` so the new/healed account row appears). The badge helpers move here **unchanged in signature but now reading `CredentialView.health`**: `providerAttention(credentials, providerId)`, `totalAttention(credentials)`, `activeNeedsRelogin(activeByProvider, providerId, credentials)` — pure over the view, unit-tested (the health map argument is gone; health rides each credential).
- `console.ts` gains: `rpcStartLogin`, `rpcLoginState`, `rpcSubmitLoginCode`, `rpcCancelLogin`, `rpcResolveLoginMismatch`, `rpcProbeHealth`, `rpcReportAuthFailure` — thin `window.coa.*` wrappers like the existing auth block.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/desktop/src/renderer/panels/loginStore.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = {
  rpcStartLogin: vi.fn(),
  rpcLoginState: vi.fn(),
  rpcSubmitLoginCode: vi.fn(),
  rpcCancelLogin: vi.fn().mockResolvedValue({ phase: 'idle' }),
  rpcResolveLoginMismatch: vi.fn(),
  rpcProbeHealth: vi.fn(),
  rpcReportAuthFailure: vi.fn(),
};
vi.mock('../console.js', () => rpc);
const hydrate = vi.fn().mockResolvedValue(undefined);
vi.mock('./mockAuth.js', () => ({ useMockAuth: { getState: () => ({ hydrate }) } }));

import { providerAttention, totalAttention, activeNeedsRelogin, useLogin } from './loginStore.js';

const cred = (id: string, providerId: string, health?: 'healthy' | 'needs-relogin') => ({
  id, providerId, label: id, masked: '', disabled: false, ...(health !== undefined ? { health } : {}),
});

describe('badge derivation over the view', () => {
  const creds = [cred('claude:a', 'claude', 'needs-relogin'), cred('claude:b', 'claude', 'healthy'), cred('deepseek:k', 'deepseek')];
  it('counts needs-relogin per provider and in total', () => {
    expect(providerAttention(creds, 'claude')).toBe(1);
    expect(providerAttention(creds, 'deepseek')).toBe(0);
    expect(totalAttention(creds)).toBe(1);
  });
  it('flags a broken ACTIVE account', () => {
    expect(activeNeedsRelogin({ claude: 'claude:a' }, 'claude', creds)).toBe(true);
    expect(activeNeedsRelogin({ claude: 'claude:b' }, 'claude', creds)).toBe(false);
  });
});

describe('useLogin', () => {
  beforeEach(() => {
    useLogin.setState({ flow: undefined });
    vi.clearAllMocks();
  });

  it('startLogin projects the returned snapshot', async () => {
    rpc.rpcStartLogin.mockResolvedValue({ phase: 'launching', mode: 'new', email: 'a@x.org' });
    await useLogin.getState().startLogin({ providerId: 'claude', mode: 'new', email: 'a@x.org' });
    expect(useLogin.getState().flow?.phase).toBe('launching');
  });

  it('poll reprojects; entering registered rehydrates the auth store; idle clears', async () => {
    useLogin.setState({ flow: { phase: 'watching', mode: 'new', email: 'a@x.org' } });
    rpc.rpcLoginState.mockResolvedValue({ phase: 'registered', identity: 'a@x.org · pro' });
    await useLogin.getState().poll();
    expect(useLogin.getState().flow?.phase).toBe('registered');
    expect(hydrate).toHaveBeenCalled();
    rpc.rpcLoginState.mockResolvedValue({ phase: 'idle' });
    await useLogin.getState().poll();
    expect(useLogin.getState().flow).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**, then implement `loginStore.ts`: the zustand store + the three pure helpers (ported from `mockLogin.ts` with health read off each credential: `credentials.filter((c) => c.providerId === providerId && c.health === 'needs-relogin').length` etc.), plus the `console.ts` wrappers. The `registered`-transition hook compares the previous phase before setting; `mismatch`→`keep` resolution also rehydrates.

- [ ] **Step 3: Run** — `corepack pnpm exec vitest run apps/desktop/src/renderer/panels/loginStore.test.ts` — Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/panels/loginStore.ts apps/desktop/src/renderer/panels/loginStore.test.ts apps/desktop/src/renderer/console.ts
git commit -m "feat: mirror the daemon login flow in the renderer"
```

---

### Task 9: Renderer — the email-first LoginFlow dialog + badge surfaces go live

**Files:**
- Modify: `apps/desktop/src/renderer/panels/LoginFlow.tsx` (real store; email step; copy affordance; mismatch state; poll loop)
- Modify: `apps/desktop/src/renderer/panels/AuthPanel.tsx` (email-primary credential rows; badges off `CredentialView.health`; probe-on-mount/⟳; sign-in passes email not label)
- Modify: `apps/desktop/src/renderer/shell/Nav.tsx` (auth-tab + AccountHud badges read the new helpers)
- Modify: `apps/desktop/src/renderer/console.ts` (the live-failure hook)
- Delete: `apps/desktop/src/renderer/panels/mockLogin.ts`
- Test: `apps/desktop/src/renderer/panels/LoginFlow.test.tsx` (new), existing `AuthPanel`/`Nav` suites extended where they assert these surfaces.

The mockup (commit `a6436fb`) is the interaction reference; the deltas:

1. **Email-first step.** `SignInButton` no longer starts the flow directly — it opens the dialog in a new `phase:'email'` local pre-step (renderer-only): an email field (autofocus, validated non-empty, Enter commits) + optional nickname later (YAGNI — label defaults to email daemon-side). Commit calls `useLogin.getState().startLogin({ providerId, mode: 'new', email })`. Relogin (`useStartRelogin`) pre-fills the email from the credential's `email ?? identity` and starts immediately (no pre-step — the email is known; the dialog opens straight into the driven flow).
2. **Poll loop.** `LoginDialog` mounts an effect while a flow exists: `setInterval(() => void useLogin.getState().poll().catch(() => {}), 1000)`, cleared on unmount/flow-end.
3. **Copy affordance.** In `awaiting`, the URL box gains a copy button (the VSCode pattern):

```tsx
function CopyLink({ url }: { url: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-r3 border border-s5 bg-s1 px-3 py-3">
      <span className="flex items-center font-mono text-meta text-s7">
        didn&apos;t open? paste this into the browser that knows your email
        <Button
          variant="text"
          className="ml-auto"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? 'copied ✓' : 'copy link'}
        </Button>
      </span>
      <span className="font-mono text-code break-all text-s10">{url}</span>
    </div>
  );
}
```

   When `flow.ptyCaptured === false` and no URL arrived, the box instead reads: "the browser opened with your email pre-filled — the copyable link isn't available on this system" (degraded, honest, never blocking). The code-paste fallback submits via `useLogin.getState().submitCode(code)`.
4. **Mismatch state** (new phase body in `FlowBody`): amber `StatusDot status="needs-you"`; heading `signed in as ${flow.landedEmail}`; body "you asked to sign in as `<expected>` — the browser finished as `<landed>`. Keep it, or try again with the right account?"; footer buttons `keep ${landedEmail}` (→ `resolveMismatch('keep')`) and `try again` (→ `resolveMismatch('retry')`). Flagged, never blocked — keep is a plain quiet button, not a warning-styled one.
5. **The mock stepper dies.** `simulate next step` / `simulate failure` buttons are removed; phases advance only from polling.
6. **Email-primary rows** in `AuthPanel.tsx`'s `CredentialRow` for config-dir providers: the row's first line shows `credential.email ?? credential.label`; when a nickname differs from the email (`credential.label !== credential.email`) show the label first and the email on the identity line; second line = `credential.identity ?? credential.masked` (probe identity outranks the raw pointer). `needsRelogin` now reads `credential.health === 'needs-relogin'` (the `useMockLogin` read is gone). `SignInButton` usage in the logins-section header drops its `label={…-${count+1}}` prop (labels are daemon-derived from email now).
7. **Probe on mount + ⟳.** `AuthSurface`'s mount effect calls `rpcProbeHealth` and reprojects (add a `probeHealth()` action on `mockAuth.ts`'s store applying the returned view — one line beside `refresh`); `AuthStrip`'s ⟳ calls it too (keep the existing `refresh` for non-claude re-reads: run both, sequenced). The `seedDemoHealth` mock effect is deleted.
8. **Badges.** `ProviderRow` computes `attention = providerAttention(all, provider.id)`; `Nav.tsx`'s auth tab shows a count chip/dot when `totalAttention(credentials) > 0`, and the AccountHud wears `StatusDot status="needs-you"` + a `re-login` affordance when `activeNeedsRelogin(activeByProvider, 'claude', credentials)` (port exactly what the mockup's Nav badge rendering did, minus the mock store reads).
9. **Live-failure hook** in `console.ts`: where pushed frames append to a session's turns (the `pushToViewFrames` consumer), when a frame has `kind: 'error'` and `/auth|401|unauthorized|oauth|logged? ?in|login/i.test(message)`, fire-and-forget `rpcReportAuthFailure({ credentialId: activeByProvider['claude'] })` when that active id exists, then reproject the returned view through the same `apply` path `mockAuth` uses (call `useMockAuth.getState().hydrate()`). Advisory only — mis-detection costs an amber dot, never a block.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/desktop/src/renderer/panels/LoginFlow.test.tsx — follow the directory's panel-test setup
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// …mock '../console.js' rpc stubs (rpcStartLogin etc.) and './mockAuth.js' hydrate as in loginStore.test.ts…
import { useLogin } from './loginStore.js';
import { LoginDialog, SignInButton } from './LoginFlow.js';
import { PROVIDERS } from './providers.js';

const claude = PROVIDERS.find((p) => p.id === 'claude')!;

describe('the driven login dialog', () => {
  beforeEach(() => useLogin.setState({ flow: undefined }));

  it('sign in opens the email-first step and starts the flow with the email', async () => {
    rpc.rpcStartLogin.mockResolvedValue({ phase: 'launching', mode: 'new', email: 'a@x.org' });
    render(<><SignInButton provider={claude} /><LoginDialog /></>);
    fireEvent.click(screen.getByText('sign in with claude'));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.org' } });
    fireEvent.click(screen.getByText(/continue/i));
    expect(rpc.rpcStartLogin).toHaveBeenCalledWith({ email: 'a@x.org' });
  });

  it('awaiting shows the captured url with a copy affordance', () => {
    useLogin.setState({ flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', oauthUrl: 'https://claude.com/cai/oauth/x', ptyCaptured: true } });
    render(<LoginDialog />);
    expect(screen.getByText('https://claude.com/cai/oauth/x')).toBeInTheDocument();
    expect(screen.getByText('copy link')).toBeInTheDocument();
  });

  it('degraded capture says so instead of showing an empty link box', () => {
    useLogin.setState({ flow: { phase: 'awaiting', mode: 'new', email: 'a@x.org', ptyCaptured: false } });
    render(<LoginDialog />);
    expect(screen.getByText(/isn't available on this system/)).toBeInTheDocument();
  });

  it('mismatch offers keep-landed and try-again, never a block', () => {
    useLogin.setState({ flow: { phase: 'mismatch', mode: 'new', email: 'a@x.org', landedEmail: 'b@x.org' } });
    render(<LoginDialog />);
    expect(screen.getByText(/signed in as b@x.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('keep b@x.org'));
    expect(rpc.rpcResolveLoginMismatch).toHaveBeenCalledWith({ action: 'keep' });
  });
});
```

Extend the existing `AuthPanel`/`Nav` test files where they cover these rows: a credential seeded with `health: 'needs-relogin'` renders the amber dot + `re-login` button; the nav auth tab renders its badge at `totalAttention > 0`.

- [ ] **Step 2: Run to verify the new assertions fail**, then implement deltas 1–9.

- [ ] **Step 3: Run the desktop suite + typecheck** — `corepack pnpm exec vitest run apps/desktop/src` and the desktop `tsc --noEmit` — Expected: PASS/clean.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/panels/LoginFlow.tsx apps/desktop/src/renderer/panels/LoginFlow.test.tsx apps/desktop/src/renderer/panels/AuthPanel.tsx apps/desktop/src/renderer/shell/Nav.tsx apps/desktop/src/renderer/console.ts
git rm apps/desktop/src/renderer/panels/mockLogin.ts
git commit -m "feat: wire the email-first login flow and attention badges live"
```

---

### Task 10: Polish pass (impeccable) over the touched surfaces

**Files:** `LoginFlow.tsx`, `ModelEditor.tsx`, `AuthPanel.tsx`, `Nav.tsx`, `Composer.tsx`, `AgentsPanel.tsx` (light), plus whatever the audit turns up.

- [ ] **Step 1: Invoke the `impeccable` design skill** (docs/UI.md mandates it for console work) and audit the surfaces this arc touched, against docs/UI.md's tokens, indicator law, and "every state ships". Concrete checklist to clear (add findings, fix inline, don't defer):
  - **LoginFlow:** phase transitions animate on the Slipstream curve (the mock's hard swaps → `AnimatePresence` cross-fades matching `RISE`); the status dot follows the indicator law per phase (running=blue, awaiting=amber needs-you, registered=green, failed=red); the copy button's `copied ✓` feedback; Escape/backdrop behavior during `watching` (cancel is safe — the CLI is killed, nothing registered); focus lands in the email field on open and on the code field when revealed.
  - **ModelEditor:** row rhythm/spacing against the credential rows above it (same pill inset `-mx-3`, same hover ground); hidden rows read dimmed but legible; the reasoning-mode chips' selected state uses the s-scale, not invented values; the add-from-defaults dialog's empty state; the count-carrying commit button disabled state.
  - **AuthPanel:** the email-primary row's two-line hierarchy (name `text-s10/12`, identity `text-meta text-s7`); `active · needs relogin` never wraps (truncation order: identity first); the re-login chip's warn tones match the token palette.
  - **Nav/AccountHud:** badge dot placement doesn't shift layout when it appears; the count chip uses `font-mono text-meta`; AccountHud's needs-relogin state offers re-login within one click.
  - **Composer chip + AgentsPanel picker:** both render user labels (displayName) from the effective list; an emptied provider degrades to "backend default" copy, not an empty menu; AgentsPanel gets consistency touches only (it stays on the legacy kit — full migration is out of scope, note any debt found in ROADMAP).
  - **Every state ships:** for each surface walk empty / loading / error / degraded (daemon down ⇒ stores hold their last projection; a failed RPC leaves state untouched — verify no surface renders a crash or a blank).

- [ ] **Step 2: Run the full desktop suite + typecheck after polishing** — Expected: PASS/clean. Add regression tests for any behavior the polish changed (not for pure styling).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer
git commit -m "style: polish the auth, login, and model-editor surfaces"
```

---

### Task 11: Attended verification, ADR, docs

**Files:**
- Create: `docs/adr/NNNN-probe-derived-login-health.md` (next free number)
- Modify: `ROADMAP.md`, `docs/DESIGN.md` (only if either names the auth surface's manual-login limitation — update the stale sentence, nothing more)

- [ ] **Step 1: Attended live run** (human at the browser — mirrors the spike):
  1. `corepack pnpm build` (or the repo's build script) then launch the app (`env -u ELECTRON_RUN_AS_NODE …`, one window).
  2. Auth → claude → **sign in with claude** → enter a real email → verify: browser opens **pre-filled with that email**; the dialog shows the captured URL (or the degraded copy if node-pty failed to build — note which); finish in the browser; the dialog reaches **registered**; the account row appears named by the email with `· pro` identity; it is active.
  3. Quit the app; verify `~/.coa/logins/<slug>/` exists and `~/.coa/accounts.yaml` holds the pointer + email (and **no token**).
  4. Break the login (`claude auth logout` against that `CLAUDE_CONFIG_DIR`, or temporarily move the dir's credentials file) → reopen the app → the row flags **needs relogin**, the nav tab and AccountHud badge light, nothing auto-switches.
  5. **Re-login** from the badge → the flow reuses the stored email → row heals to healthy.
  6. Mismatch path (if a second account is available): request email A, sign in as B → the dialog flags it; **keep** registers B.
  7. Record every deviation in the plan file before fixing it (systematic-debugging applies — no fix-by-vibes).

- [ ] **Step 2: Write the ADR**:

```markdown
# NNNN — Login health is probe-derived; a broken active account is flagged, never auto-switched

Status: accepted · Date: 2026-07-18

## Context
coa is credential-blind (D84): it stores pointers to Claude config dirs, never
tokens. Detecting a stale login by reading the token file's expiry would brush
that invariant and lie whenever OAuth silently refreshes. Meanwhile the CLI
ships a purpose-built probe: `claude auth status --json` (non-interactive,
honors CLAUDE_CONFIG_DIR, reports loggedIn + email + subscription).

## Decision
- Login health comes ONLY from the status probe (and, strongest, a real auth
  failure in a live session). Never from token files.
- A Claude account is defined by its email: the declared email pre-fills the
  driven login (`--email`); the probe's email is the truth — a mismatch is
  flagged with keep/retry, and identity lines render probe facts.
- A broken ACTIVE account is flagged (attention badge, re-login action), never
  auto-switched — silent rerouting would hide the problem (SC-1).
- The OAuth URL capture needs a TTY, so the driver prefers node-pty and
  degrades to browser-only + probe-poll when unavailable — capture is an
  affordance, never a dependency.

## Consequences
- The reserved identity fields on the auth view are populated by probe, so
  manually-added accounts converge to email-identity with no migration.
- Health is daemon-cached per run, refreshed on surface view / ⟳ / live
  failure — no background polling.
```

- [ ] **Step 3: `corepack pnpm docs:check`** — Expected: clean.

- [ ] **Step 4: Full-repo run** — `corepack pnpm exec vitest run` + repo typecheck — Expected: all PASS/clean.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/NNNN-probe-derived-login-health.md ROADMAP.md
git commit -m "docs: record the probe-derived login health decision"
```

---

## Attended run — deviations (2026-07-21)

Maintainer drove the live run. Recorded before any fix, per the handoff process. Nothing below is
fixed yet; each is triaged to a follow-up workstream at the end.

**D1 — the sign-in affordance is shaped wrong (cosmetic).** `SignInButton` renders its own
`sign in with {label}` affordance; it should look like the add-account button every other provider
gets, and read `sign in`. The provider name is already the context.

**D2 — the dialog copy is over-explained (cosmetic).** Flagged verbatim: *"Claude's own sign-in opens
in your browser, pre-filled with this email. coa keeps a pointer to the login — never the token."*
The same voice runs through the `launching`, `awaiting`, `watching`, and `registered` bodies, which
re-assert credential-blindness at four separate phases. Credential-blindness is an architecture
property, not a thing to keep telling the user. Wanted: professional, straightforward, no slop.
Whole-dialog copy pass.

**D3 — email-first does not actually define the account (design defect).** Nothing enforces the
declared email. `--email` reaches Claude's own CLI, but the OAuth handshake completes in the system
browser against whatever claude.ai session that browser already holds, so the landed identity is
whatever was signed in — the declaration is a wish, and the mismatch phase is the only thing making
it safe. Maintainer's real-world workaround today is **a different browser per account**, i.e.
hand-rolled session isolation.

*Root cause:* coa does not own the browser context. It scrapes the authorize URL out of CLI output
(`extractOauthUrl`) but never controls where that URL is opened, so it cannot influence which
identity the IdP sees. No param exists to add — `login_hint`-style prefill is advisory by
definition, and only the IdP could refuse a wrong identity, which it will not do for an
already-authenticated session.

*Candidate remedy (unverified — this is the spike):* coa is an Electron app and can open the
captured URL in a `BrowserWindow` on a per-account `session.fromPartition('persist:login-<id>')` —
a cookie jar per account, which is the automatic form of the maintainer's different-browsers trick.
The driver already has both hooks this needs: URL capture, and `write()` back to the CLI's stdin for
the code-paste path. **If it works, it reverses the obvious fix:** email-defined accounts become
genuinely true rather than needing to be abandoned for observe-then-name. Three unknowns, none
answerable without a live test — (a) whether Anthropic blocks OAuth in embedded user agents the way
Google does, (b) whether the CLI's own browser-open can be suppressed so it does not race the
embedded window (and how that differs on win32), (c) whether the handshake returns via a localhost
callback or code-paste. Must degrade to today's system-browser path (SC-1).

*SPIKE RESULT (2026-07-21) — the blocking question is answered: NOT blocked.* An Electron
`BrowserWindow` on `session.fromPartition('persist:…')` loads `https://claude.ai/login` and renders
the real sign-in (title "Sign in - Claude", email field + affordances present, no
`disallowed_useragent` / unsupported-browser copy) under a stock Electron UA
(`…Chrome/132.0.6834.210 Electron/34.5.8…`). Screenshot captured. So the per-account cookie-jar
approach is viable in principle.

*Three qualifications, none of them fatal but none of them resolved:*

1. **Google SSO is the likely blocker.** The login page offers "Continue with Google", and that hop
   lands on `accounts.google.com`, which is the canonical rejecter of embedded user agents. A
   Claude account reached via Google (or `--sso`) would probably fail inside the partition even
   though Claude's own page does not. **Mitigation is the existing escape hatch, not new
   machinery:** keep the copy-link + code-paste path (now proven working) as the always-available
   fallback, so a blocked provider degrades to today's behavior (SC-1).
2. **The URL tested was `claude.ai/login`, NOT the CLI's generated authorize URL.** Same origin,
   same product, so the same policy is *expected* — but that is inference. Confirming needs a live
   login to capture a real authorize URL and load THAT in the partition.
3. **A `did-fail-load` code -3 (ABORTED) fired during load** while the page rendered normally.
   Almost certainly a cancelled subresource/redirect, but it is recorded rather than filtered.

*What the earlier code-paste finding changes:* because copy-link → paste-code is now proven to work
end to end, a partitioned window does **not** need to intercept a localhost callback. It only has to
render the page and let the user complete; the code returns through the field that already works.
That removes the hardest piece of the original design.

*SPIKE PIVOT + RESOLUTION (2026-07-21): launched browser profile, NOT an embedded partition.*
The maintainer signs into Claude **with Google**, which makes the Electron-partition result above
moot for the actual path: the Claude page renders fine embedded, but "Continue with Google" leaves
for `accounts.google.com`, the canonical rejecter of embedded user agents
(`disallowed_useragent`). UA spoofing was considered and **rejected** — Google actively counters it,
it breaks unpredictably, and it means defeating a security control to reach one's own account.

**The mechanism instead: launch a REAL browser with a dedicated profile dir.** Chromium's
`--user-data-dir=<path>` yields a standalone browser with its own cookie jar, so Google's policy is
satisfied honestly rather than evaded, and per-account isolation still holds.

**Verified live 2026-07-21:** Chrome detected at the standard win32 path (Edge present too, same
flag); launched with `--user-data-dir=<dir> --no-first-run --no-default-browser-check` onto
`claude.ai/login`; a full profile tree with its own `Default/Network/Cookies` was created. The
maintainer confirmed both checks in the launched window: **it is signed out of Google (isolation
holds), and "Continue with Google" completes there (the blocked path is unblocked).** The
`--no-first-run` pair also removes the fresh-profile onboarding that was listed as a cost.

**Design that falls out** (build-time, not built here):
- **Setting** — "use a dedicated browser profile for logins", OFF by default: with it off, behavior
  is byte-identical to today (D85 strict-superset).
- **Binary** — auto-detected per platform with an optional override pre-filled from detection; never
  a required configuration step. Chrome/Edge/any Chromium share the flag.
- **Profile per account** — one dir keyed by **account id, not email**, which also sidesteps the
  ledgered `emailSlug` collision Minor. Removing an account should offer to remove its profile
  (a Chrome profile is tens of MB and they accumulate).
- **Fallback** — copy-link + paste-code stays as the always-available path, so a missing browser or
  an unsupported provider degrades to current behavior (SC-1).
- **Generality (maintainer constraint, satisfied by construction)** — this isolates ANY
  cookie-session sign-in, not just OAuth and not just Claude; it belongs at the auth /
  provider-descriptor layer, with Claude as its first consumer.

**Consequence for the email pre-step (the original D3 defect): it SURVIVES and becomes honest.**
With a per-account profile the declared email genuinely selects the session rather than inheriting
whatever the default browser held, so "email-defined accounts" stops being aspirational. The
observe-then-name inversion is therefore NOT needed. **This amends ADR-0017's premise and wants an
ADR at build time** — the mechanism, not just the flow, is the durable decision.

*Maintainer constraint on the remedy (2026-07-21):* **the partition mechanism must not be
Claude-specific.** Design it as a general "isolated, persistent browser session keyed by account"
capability that any provider needing session-scoped sign-in can use — Claude is its first consumer,
not its owner. That points the seam at the auth / provider-descriptor layer (where a provider
already declares its locator kind) rather than at the Claude adapter, so a future provider needing
an isolated session is a descriptor field and no new machinery.

**D4 — the model catalog is stale (data).** `default-catalog.ts` predates DeepSeek V4. Needs a
bounded refresh spike across providers: current model ids, context windows, pricing, reasoning
profiles. Folds in the already-ledgered Minor that DeepSeek prices are zero-floor placeholders.
Maintainer also wants a repeatable skill for this, plus a coa-app-copy skill that D2's pass would
use and a forthcoming capitalization pass would extend.

*Open call, deliberately not settled here:* both skills the maintainer described are
**repo-development** skills (for whoever works on coa), not runtime butler Pieces (what coa serves a
user). Placing the first should not decide where the second lives — that is the open ADR-0003
question (built-in package vs. seeded `.coa/` bundle) and deserves its own call.

**D5 — the code-paste field hides behind a button (cosmetic).** The "prompted for a code instead?
enter it →" disclosure puts a click in front of a field. Better than always-showing it: the CLI
prints its own paste prompt and we already read that stream — reveal the field when the CLI actually
asks, and fall back to always-visible on the degraded pipe path where the prompt cannot be seen.

**D6 — the win32 spawn targets a binary that does not exist here (confirmed bug).** The PTY branch
hardcodes `claude.cmd` on win32 (the npm shim). This machine's install is the **native installer**:
`C:\Users\Zander\.local\bin\claude.exe`, with no `.cmd` shim anywhere on PATH or under the npm
global dir. So `pty.spawn('claude.cmd', …)` throws, the catch degrades to the pipe path (whose
`spawn('claude', …, shell: true)` *does* resolve the exe), and the flow permanently reports
`ptyCaptured: false` — **the in-app copy-link is dark on this machine and on every native install.**
This is watchlist Minor #8, confirmed live rather than hypothetical. Fix by resolving the real
binary instead of assuming the shim, rather than by widening the catch.

*CORRECTION (2026-07-21, after the maintainer re-ran it):* the first write-up of this entry claimed
the copy-link was dark as a result. **It was not — the copy-link worked before the fix.** The
mechanism above is confirmed (`pty.spawn('claude.cmd')` throws `File not found`; `claude.exe`
spawns and exits 0 — probed directly), so the PTY branch genuinely never ran. But the predicted
symptom was wrong, because **the `LoginFlow` render gates the copy-link on `oauthUrl !== undefined`,
not on `ptyCaptured`** — and the URL is captured on the pipe path too.

*Which falsifies a load-bearing premise:* the driver's header comment asserts "the OAuth URL prints
only on a TTY (spike fact)". **That spike fact does not hold** — the CLI prints the URL on a plain
pipe as well. The entire node-pty preference was justified by it. What the PTY branch actually buys,
now that it runs: an honest `ptyCaptured` (permanently `false` before, while the affordance it
supposedly gated worked fine), and — the one plausible real breakage — a functioning **code-paste
fallback**, since `write()` into a pipe will not drive the CLI's interactive
`Paste code here if prompted >` prompt the way a terminal does. **Unverified:** whether code-paste
was in fact broken before and works now. Worth a targeted check in the next attended run, since D5
is about that same affordance.

*FIXED 2026-07-21 (TDD).* `resolveClaudeCommand(platform, pathDirs, exists)` — pure, injected
existence predicate, separators follow the platform ARGUMENT so it is testable for either host from
either — scans PATH for `claude.exe` → `claude.cmd` → `claude.bat` on win32 (bare `claude`
elsewhere) and falls back to the bare name rather than throwing, leaving the pipe branch's
`shell: true` resolution a last chance (SC-1). Verified against the real PATH on the maintainer's
machine: resolves `C:\Users\Zander\.local\bin\claude.exe`, where the old `claude.cmd` guess resolved
nothing. `auth-status.ts`'s probe was checked and is NOT affected — it spawns with `shell: true`, so
PATHEXT resolution already reaches the exe. See the CORRECTION above for what this does and does not
change at the surface: it does **not** restore the copy-link, which was never broken.

**Vendor-confirmed for D3:** `claude auth login --help` documents `--email` as *"Pre-populate email
address on the login page."* Prefill, by the vendor's own description — not account selection. D3's
root cause is no longer inference. (`--sso` also exists and is unexamined.)

**D7 — the copy-link affordance is a text button; it wants an icon (cosmetic).** `CopyLink` renders
a `variant="text"` Button reading `copy link` / `copied ✓`.

*Finding:* the app has **no icon system** — no icon dependency, no kit `Icon` member. But it does
have an unstated house convention, already used twice in `Composer.tsx` (the attach paperclip and
the mic): Lucide-geometry paths at `width/height 14`, `viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, `strokeWidth="2"`, round caps/joins, `aria-hidden`. Both are hand-inlined.
`BrandMark` and `Nav` carry their own unrelated one-off SVGs.

*Remedy:* graduate a small `Icon` into `packages/console-kit` with that convention baked in, seed it
with `copy` + `check` (the copied state), and replace the text button. Worth doing as a kit member
rather than a third inline copy — the D1/D2/D5 pass and the composer shelf will both want more
glyphs. Governed by `docs/UI.md`'s authoring rules, so it needs a design pass, not a drive-by edit.

### Not reported

The final-review watchlist (relogin into a manually-added dir; `claude.cmd` shim vs. native exe;
whether PTY capture worked or degraded; probe-vs-live-flag precedence; cancel-in-import-window;
grace path; probeHealth latency) and the Plan A model-editor drive-the-app checks were **not
reported back from this run** — treat them as unverified, not as passed.

### Triage

- D1 + D2 + D5 + the D3 outcome are one coherent workstream (the flow's shape decides its copy);
  D3's spike runs **first** because it determines whether the email pre-step survives at all.
- D3 amends ADR-0017, whose premise is email-defined accounts — either to "email-defined and now
  actually enforced" or to "observe-then-name". Not a silent edit.
- D4 is independent and can run any time.
- The unreported watchlist items still need a run.

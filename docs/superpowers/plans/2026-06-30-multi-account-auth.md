# Multi-Account Auth (Claude Subscription) Implementation Plan

> **STATUS (2026-06-30): COMPLETE.** All tasks built TDD (637 tests green). Post-spike change: `ant-profile`
> was dropped — `config-dir` + `ambient` only (it targets Console/API profiles, not Claude.ai subscriptions).
> Tasks 6–7 (live `Options.env` per session + per-account ledger attribution) were unblocked by the passing
> subscription-login spike and are done. Only the `coa run` entrypoint that invokes `createSession` remains
> (the deferred v0 spike).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a single user register pointers to their Claude **subscription** logins and select which one is active, so the governed loop runs under it — coa storing pointers only, never tokens.

**Architecture:** A new backend-blind `auth` core owns a user-global `~/.coa/accounts.yaml` of pointers. The Claude adapter maps the active account's neutral locator to an SDK env overlay (set `CLAUDE_CONFIG_DIR`/`ANTHROPIC_PROFILE`, clear the API-key + ambient-OAuth-token vars) delivered via the SDK `Options.env` field. Two surfaces (CLI `coa auth …`, RPC verbs) wrap the same core.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Zod (M0 schemas), `yaml` (already a core dep), Vitest, `@anthropic-ai/claude-agent-sdk`.

## Global Constraints

- **TypeScript `strict`, no `any`.** Validate all external data (the YAML file, RPC params) at the edge with Zod.
- **Determinism-first:** no model call on any path added here.
- **Strict-superset (D85):** missing `~/.coa/accounts.yaml` or `active: ambient` ⇒ byte-identical to today (adapter passes zero auth; ambient login wins).
- **Subscription, not API key:** non-ambient accounts MUST clear `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and the ambient OAuth-token var `CLAUDE_CODE_OAUTH_TOKEN` so the *selected subscription* login resolves.
- **Backend seam:** the `auth` core is backend-blind (no env-var names); the locator→env mapping lives only in `adapter-claude-sdk`.
- **Commits:** subject-only Conventional Commits — no body, no trailers, no internal identifiers (module IDs, decision codes) in the subject. Stage files by name, never `git add -A`.
- **Same-commit doc rule:** a commit that adds a package/file updates `docs/REPO_LAYOUT.md` in the same commit.
- **Gates (all must pass before each commit):** `corepack pnpm typecheck`, `lint`, `test`, `format`, `depcruise`. `format` is a check — fix with `corepack pnpm exec prettier --write <files>`.
- **Spike gate:** Tasks 6 and 7 are BLOCKED on the attended subscription-login spike (two real logins in the shell). Do not start them in this build pass; Tasks 1–5 are spike-invariant and land now.

---

### Task 1: M0 `Account` / `Locator` / `AccountsFile` schema

**Files:**
- Create: `packages/shared/src/auth.ts`
- Modify: `packages/shared/src/index.ts` (add barrel export)
- Test: `packages/shared/src/auth.test.ts`

**Interfaces:**
- Consumes: `zod`.
- Produces: `locatorSchema`, `accountSchema`, `accountsFileSchema` (Zod); types `Locator`, `Account`, `AccountsFile`; const `AMBIENT = 'ambient'`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/auth.test.ts
import { describe, expect, it } from 'vitest';
import { AMBIENT, accountSchema, accountsFileSchema, locatorSchema } from './auth.js';

describe('auth schema', () => {
  it('accepts each locator type', () => {
    expect(locatorSchema.parse({ type: 'config-dir', dir: '/home/u/.claude-work' }).type).toBe(
      'config-dir',
    );
    expect(locatorSchema.parse({ type: 'ant-profile', profile: 'work' }).type).toBe('ant-profile');
    expect(locatorSchema.parse({ type: 'ambient' }).type).toBe('ambient');
  });

  it('defaults provider to claude', () => {
    const account = accountSchema.parse({
      label: 'work',
      locator: { type: 'config-dir', dir: '/d' },
    });
    expect(account.provider).toBe('claude');
  });

  it('parses an accounts file with the ambient sentinel as active', () => {
    const file = accountsFileSchema.parse({ active: AMBIENT, accounts: [] });
    expect(file.active).toBe('ambient');
  });

  it('rejects an unknown locator type', () => {
    expect(() => locatorSchema.parse({ type: 'api-key', key: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @coa/shared exec vitest run src/auth.test.ts`
Expected: FAIL — cannot resolve `./auth.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/shared/src/auth.ts
import { z } from 'zod';

/**
 * M0 — the credential-blind multi-account types. coa stores POINTERS to Claude
 * subscription logins (a config dir or a named profile), never tokens. The
 * locator→env mapping that turns a locator into SDK auth lives in the Claude
 * adapter (the backend seam), not here. `ambient` = no override = today's behavior.
 */

/** Reserved `active` sentinel: run under whatever login the environment already resolves. */
export const AMBIENT = 'ambient';

/** A pointer to a subscription login — never a secret. */
export const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('config-dir'), dir: z.string().min(1) }),
  z.object({ type: z.literal('ant-profile'), profile: z.string().min(1) }),
  z.object({ type: z.literal('ambient') }),
]);
export type Locator = z.infer<typeof locatorSchema>;

/** A registered account: a user-facing label + the neutral pointer to its login. */
export const accountSchema = z.object({
  label: z.string().min(1),
  provider: z.literal('claude').default('claude'),
  locator: locatorSchema,
});
export type Account = z.infer<typeof accountSchema>;

/** The on-disk registry: the active label (or {@link AMBIENT}) + the registered accounts. */
export const accountsFileSchema = z.object({
  active: z.string().min(1),
  accounts: z.array(accountSchema),
});
export type AccountsFile = z.infer<typeof accountsFileSchema>;
```

```typescript
// packages/shared/src/index.ts — add after the existing rpc export line
export * from './auth.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @coa/shared exec vitest run src/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full gates**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check packages/shared/src/auth.ts packages/shared/src/auth.test.ts && corepack pnpm depcruise`
Expected: all pass. (If prettier flags, run `corepack pnpm exec prettier --write` on the two files.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/auth.test.ts packages/shared/src/index.ts
git commit -m "feat: add the account-pointer schema for login selection"
```

---

### Task 2: `auth` core registry over `~/.coa/accounts.yaml`

**Files:**
- Create: `packages/core/src/auth/registry.ts`
- Modify: `packages/core/src/index.ts` (add export), `docs/REPO_LAYOUT.md` (note the new `auth/` dir)
- Test: `packages/core/src/auth/registry.test.ts`

**Interfaces:**
- Consumes: `Account`, `Locator`, `AccountsFile`, `AMBIENT`, `accountsFileSchema` from `@coa/shared`; `node:fs`, `node:path`; `yaml`.
- Produces: `class AccountsRegistry` with `constructor(home: string)` and methods `list(): Account[]`, `getActive(): ActiveAccount`, `add(label: string, locator: Locator): void`, `remove(label: string): void`, `setActive(target: string): void`; type `ActiveAccount = { kind: 'ambient' } | { kind: 'account'; account: Account }`; function `accountsPath(home: string): string`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/auth/registry.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry, accountsPath } from './registry.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-auth-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('AccountsRegistry', () => {
  it('is ambient with an empty list when no file exists (strict-superset)', () => {
    const reg = new AccountsRegistry(home);
    expect(reg.list()).toEqual([]);
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
    expect(existsSync(accountsPath(home))).toBe(false);
  });

  it('add + setActive persists and resolves the active account', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/home/u/.claude-work' });
    reg.setActive('work');
    const fresh = new AccountsRegistry(home);
    expect(fresh.list().map((a) => a.label)).toEqual(['work']);
    expect(fresh.getActive()).toEqual({
      kind: 'account',
      account: { label: 'work', provider: 'claude', locator: { type: 'config-dir', dir: '/home/u/.claude-work' } },
    });
  });

  it('rejects a duplicate label', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'ant-profile', profile: 'p' });
    expect(() => reg.add('work', { type: 'ambient' })).toThrow(/already exists/);
  });

  it('setActive rejects an unknown label', () => {
    const reg = new AccountsRegistry(home);
    expect(() => reg.setActive('ghost')).toThrow(/unknown account/);
  });

  it('removing the active account resets active to ambient', () => {
    const reg = new AccountsRegistry(home);
    reg.add('work', { type: 'config-dir', dir: '/d' });
    reg.setActive('work');
    reg.remove('work');
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
    expect(reg.list()).toEqual([]);
  });

  it('setActive ambient is always allowed', () => {
    const reg = new AccountsRegistry(home);
    reg.setActive('ambient');
    expect(reg.getActive()).toEqual({ kind: 'ambient' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @coa/core exec vitest run src/auth/registry.test.ts`
Expected: FAIL — cannot resolve `./registry.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/auth/registry.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { AMBIENT, accountsFileSchema, type Account, type AccountsFile, type Locator } from '@coa/shared';

/**
 * The credential-blind account registry (auth core). Mostly-pure file ops over a
 * user-global `~/.coa/accounts.yaml` of POINTERS — never tokens. Backend-blind:
 * it knows nothing about env vars or the SDK (the locator→env mapping is the
 * Claude adapter's). The file is the source of truth; each mutation reads, edits,
 * and writes it. A missing file is the strict-superset case: ambient, empty list.
 */

export type ActiveAccount = { kind: 'ambient' } | { kind: 'account'; account: Account };

/** The user-global registry path. `home` is injectable so tests run over a temp dir. */
export function accountsPath(home: string): string {
  return join(home, '.coa', 'accounts.yaml');
}

const EMPTY: AccountsFile = { active: AMBIENT, accounts: [] };

export class AccountsRegistry {
  readonly #home: string;

  constructor(home: string) {
    this.#home = home;
  }

  list(): Account[] {
    return this.#read().accounts;
  }

  getActive(): ActiveAccount {
    const file = this.#read();
    if (file.active === AMBIENT) return { kind: 'ambient' };
    const account = file.accounts.find((a) => a.label === file.active);
    // A dangling active label degrades to ambient rather than throwing on read.
    return account ? { kind: 'account', account } : { kind: 'ambient' };
  }

  add(label: string, locator: Locator): void {
    const file = this.#read();
    if (file.accounts.some((a) => a.label === label)) {
      throw new Error(`account already exists: ${label}`);
    }
    file.accounts.push({ label, provider: 'claude', locator });
    this.#write(file);
  }

  remove(label: string): void {
    const file = this.#read();
    file.accounts = file.accounts.filter((a) => a.label !== label);
    if (file.active === label) file.active = AMBIENT;
    this.#write(file);
  }

  setActive(target: string): void {
    const file = this.#read();
    if (target !== AMBIENT && !file.accounts.some((a) => a.label === target)) {
      throw new Error(`unknown account: ${target}`);
    }
    file.active = target;
    this.#write(file);
  }

  #read(): AccountsFile {
    let raw: string;
    try {
      raw = readFileSync(accountsPath(this.#home), 'utf8');
    } catch {
      return structuredClone(EMPTY);
    }
    return accountsFileSchema.parse(parse(raw));
  }

  #write(file: AccountsFile): void {
    const path = accountsPath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(file), { encoding: 'utf8', mode: 0o600 });
  }
}
```

```typescript
// packages/core/src/index.ts — add at the end
export { AccountsRegistry, accountsPath, type ActiveAccount } from './auth/registry.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @coa/core exec vitest run src/auth/registry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Update REPO_LAYOUT.md**

Add a one-line entry under the core package's directory listing noting `packages/core/src/auth/` — "the credential-blind account registry (login pointers, no secrets)". Match the surrounding format.

- [ ] **Step 6: Run the full gates**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check packages/core/src/auth/registry.ts packages/core/src/auth/registry.test.ts && corepack pnpm depcruise`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/auth/registry.ts packages/core/src/auth/registry.test.ts packages/core/src/index.ts docs/REPO_LAYOUT.md
git commit -m "feat: store and select login pointers in a user-global registry"
```

---

### Task 3: `resolveAuthEnv` — locator → SDK env overlay (Claude adapter)

**Files:**
- Create: `packages/adapter-claude-sdk/src/auth-env.ts`
- Modify: `packages/adapter-claude-sdk/src/index.ts` (add export)
- Test: `packages/adapter-claude-sdk/src/auth-env.test.ts`

**Interfaces:**
- Consumes: `Locator` from `@coa/shared`.
- Produces: `const DEFAULT_CLEAR_VARS: readonly string[]`; `function resolveAuthEnv(locator: Locator, clearVars?: readonly string[]): Record<string, string | undefined> | undefined` (returns `undefined` for `ambient` = no overlay).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/adapter-claude-sdk/src/auth-env.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLEAR_VARS, resolveAuthEnv } from './auth-env.js';

describe('resolveAuthEnv', () => {
  it('returns no overlay for ambient (byte-identical to today)', () => {
    expect(resolveAuthEnv({ type: 'ambient' })).toBeUndefined();
  });

  it('sets CLAUDE_CONFIG_DIR and clears the api-key + ambient-token vars for config-dir', () => {
    const env = resolveAuthEnv({ type: 'config-dir', dir: '/home/u/.claude-work' });
    expect(env).toEqual({
      CLAUDE_CONFIG_DIR: '/home/u/.claude-work',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    });
  });

  it('sets ANTHROPIC_PROFILE and clears the same vars for ant-profile', () => {
    const env = resolveAuthEnv({ type: 'ant-profile', profile: 'work' });
    expect(env).toEqual({
      ANTHROPIC_PROFILE: 'work',
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
    });
  });

  it('takes the clear list as data (spike output)', () => {
    const env = resolveAuthEnv({ type: 'config-dir', dir: '/d' }, ['ANTHROPIC_API_KEY']);
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/d', ANTHROPIC_API_KEY: undefined });
  });

  it('DEFAULT_CLEAR_VARS covers the api-key and ambient-token vars', () => {
    expect(DEFAULT_CLEAR_VARS).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @coa/adapter-claude-sdk exec vitest run src/auth-env.test.ts`
Expected: FAIL — cannot resolve `./auth-env.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/adapter-claude-sdk/src/auth-env.ts
import type { Locator } from '@coa/shared';

/**
 * The locator → SDK env overlay (the backend seam, subscription-aware). coa's
 * neutral account locator becomes an environment overlay for the rented loop:
 * select the login (CLAUDE_CONFIG_DIR / ANTHROPIC_PROFILE) and CLEAR the vars
 * that would otherwise outrank a subscription OAuth login — the API-key vars
 * (which force API billing) and the ambient OAuth-token var that a headless
 * daemon shell may carry and would otherwise pin every session to one login.
 *
 * The overlay is applied per session via the SDK `Options.env` field, which
 * REPLACES the subprocess env — so the caller spreads `process.env` first, then
 * this overlay; setting a var to `undefined` removes it. `ambient` returns
 * `undefined` (no overlay) ⇒ the subprocess inherits `process.env` unchanged,
 * which is today's zero-auth behavior.
 *
 * The clear list is data so the attended subscription-login spike can finalize
 * the exact set without a code change.
 */
export const DEFAULT_CLEAR_VARS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];

export function resolveAuthEnv(
  locator: Locator,
  clearVars: readonly string[] = DEFAULT_CLEAR_VARS,
): Record<string, string | undefined> | undefined {
  if (locator.type === 'ambient') return undefined;

  const overlay: Record<string, string | undefined> = {};
  if (locator.type === 'config-dir') overlay.CLAUDE_CONFIG_DIR = locator.dir;
  else overlay.ANTHROPIC_PROFILE = locator.profile;

  for (const name of clearVars) overlay[name] = undefined;
  return overlay;
}
```

```typescript
// packages/adapter-claude-sdk/src/index.ts — add export
export { DEFAULT_CLEAR_VARS, resolveAuthEnv } from './auth-env.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @coa/adapter-claude-sdk exec vitest run src/auth-env.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full gates**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check packages/adapter-claude-sdk/src/auth-env.ts packages/adapter-claude-sdk/src/auth-env.test.ts && corepack pnpm depcruise`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/adapter-claude-sdk/src/auth-env.ts packages/adapter-claude-sdk/src/auth-env.test.ts packages/adapter-claude-sdk/src/index.ts
git commit -m "feat: map an account pointer to the loop's login environment"
```

---

### Task 4: CLI `coa auth list|current|add|use|remove`

**Files:**
- Create: `apps/cli/src/auth-cli.ts`
- Modify: `apps/cli/src/cli.ts` (route the `auth` command before the daemon-read dispatch)
- Test: `apps/cli/src/auth-cli.test.ts`

**Interfaces:**
- Consumes: `AccountsRegistry` from `@coa/core`; `CliIo` from `./cli.js`; `node:os` (`homedir`).
- Produces: `function runAuthCommand(args: string[], io: CliIo, home?: string): number` (sync; returns process exit code). The optional `home` is a test seam (defaults to `os.homedir()`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/cli/src/auth-cli.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAuthCommand } from './auth-cli.js';

let home: string;
let out: string[];
let err: string[];
const io = () => ({ out: (l: string) => out.push(l), err: (l: string) => err.push(l) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authcli-'));
  out = [];
  err = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('runAuthCommand', () => {
  it('current is ambient before anything is added', () => {
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toEqual(['ambient']);
  });

  it('add --config-dir then use then current', () => {
    expect(runAuthCommand(['add', 'work', '--config-dir', '/home/u/.claude-work'], io(), home)).toBe(0);
    expect(runAuthCommand(['use', 'work'], io(), home)).toBe(0);
    out = [];
    expect(runAuthCommand(['current'], io(), home)).toBe(0);
    expect(out).toEqual(['work']);
  });

  it('list prints registered accounts with the active marker', () => {
    runAuthCommand(['add', 'work', '--profile', 'work-profile'], io(), home);
    runAuthCommand(['use', 'work'], io(), home);
    out = [];
    expect(runAuthCommand(['list'], io(), home)).toBe(0);
    expect(out.join('\n')).toMatch(/\*\s+work\b.*ant-profile/);
  });

  it('add requires exactly one of --config-dir / --profile', () => {
    expect(runAuthCommand(['add', 'x'], io(), home)).toBe(1);
    expect(err.join('')).toMatch(/--config-dir|--profile/);
  });

  it('use ambient resets active', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    runAuthCommand(['use', 'work'], io(), home);
    expect(runAuthCommand(['use', 'ambient'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['current'], io(), home);
    expect(out).toEqual(['ambient']);
  });

  it('remove drops an account', () => {
    runAuthCommand(['add', 'work', '--config-dir', '/d'], io(), home);
    expect(runAuthCommand(['remove', 'work'], io(), home)).toBe(0);
    out = [];
    runAuthCommand(['list'], io(), home);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @coa/cli exec vitest run src/auth-cli.test.ts`
Expected: FAIL — cannot resolve `./auth-cli.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/cli/src/auth-cli.ts
import { homedir } from 'node:os';
import { AccountsRegistry } from '@coa/core';
import type { Locator } from '@coa/shared';
import type { CliIo } from './cli.js';

/**
 * `coa auth …` — local file ops over the credential-blind account registry (no
 * daemon). Selects which Claude SUBSCRIPTION login the governed loop runs under;
 * stores pointers only. `home` is a test seam (defaults to the user's home).
 */
export function runAuthCommand(args: string[], io: CliIo, home: string = homedir()): number {
  const [sub, ...rest] = args;
  const reg = new AccountsRegistry(home);

  try {
    switch (sub) {
      case 'list': {
        const active = reg.getActive();
        const activeLabel = active.kind === 'account' ? active.account.label : 'ambient';
        for (const a of reg.list()) {
          const mark = a.label === activeLabel ? '*' : ' ';
          io.out(`${mark} ${a.label}\t${a.provider}\t${describeLocator(a.locator)}`);
        }
        return 0;
      }
      case 'current': {
        const active = reg.getActive();
        io.out(active.kind === 'account' ? active.account.label : 'ambient');
        return 0;
      }
      case 'add': {
        const [label, flag, value] = rest;
        if (label === undefined) return fail(io, 'usage: coa auth add <label> --config-dir <dir> | --profile <name>');
        const locator = parseAddLocator(flag, value);
        if (locator === undefined) {
          return fail(io, 'coa auth add requires exactly one of --config-dir <dir> or --profile <name>');
        }
        reg.add(label, locator);
        return 0;
      }
      case 'use': {
        const [target] = rest;
        if (target === undefined) return fail(io, 'usage: coa auth use <label> | ambient');
        reg.setActive(target);
        return 0;
      }
      case 'remove': {
        const [label] = rest;
        if (label === undefined) return fail(io, 'usage: coa auth remove <label>');
        reg.remove(label);
        return 0;
      }
      default:
        return fail(io, 'usage: coa auth <list|current|add|use|remove>');
    }
  } catch (err) {
    return fail(io, err instanceof Error ? err.message : 'auth command failed');
  }
}

function parseAddLocator(flag: string | undefined, value: string | undefined): Locator | undefined {
  if (value === undefined) return undefined;
  if (flag === '--config-dir') return { type: 'config-dir', dir: value };
  if (flag === '--profile') return { type: 'ant-profile', profile: value };
  return undefined;
}

function describeLocator(locator: Locator): string {
  switch (locator.type) {
    case 'config-dir':
      return `config-dir ${locator.dir}`;
    case 'ant-profile':
      return `ant-profile ${locator.profile}`;
    case 'ambient':
      return 'ambient';
  }
}

function fail(io: CliIo, message: string): number {
  io.err(message);
  return 1;
}
```

```typescript
// apps/cli/src/cli.ts — inside runCli, immediately after destructuring `command`/`args`
// (before the READS lookup), add:
//
//   if (command === 'auth') return runAuthCommand(args, io);
//
// and add the import at the top:
//   import { runAuthCommand } from './auth-cli.js';
//
// Note: runCli is async; `return runAuthCommand(args, io);` returns a number, which
// the async function wraps in a resolved Promise — no await needed.
```

- [ ] **Step 4: Wire the route in `cli.ts`**

Open `apps/cli/src/cli.ts`. Add `import { runAuthCommand } from './auth-cli.js';` with the other imports. In `runCli`, after `const [command, ...args] = argv;` and the `command === undefined` guard, insert:

```typescript
  if (command === 'auth') return runAuthCommand(args, io);
```

Also update the usage string on the `command === undefined` branch to include `auth`:

```typescript
    io.err('usage: coa <auth|cap|flags|why|decision> [args]');
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `corepack pnpm --filter @coa/cli exec vitest run src/auth-cli.test.ts src/cli.test.ts`
Expected: PASS (auth-cli: 7; cli unchanged still green).

- [ ] **Step 6: Run the full gates**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check apps/cli/src/auth-cli.ts apps/cli/src/auth-cli.test.ts apps/cli/src/cli.ts && corepack pnpm depcruise`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/cli/src/auth-cli.ts apps/cli/src/auth-cli.test.ts apps/cli/src/cli.ts
git commit -m "feat: add a command to register and switch the active login"
```

---

### Task 5: RPC verbs over the same registry (GUI-ready)

**Files:**
- Create: `packages/core/src/rpc/auth-handlers.ts`
- Modify: `packages/core/src/index.ts` (export `buildAuthHandlers`), `packages/core/src/session/daemon.ts` (merge auth handlers into the daemon map)
- Test: `packages/core/src/rpc/auth-handlers.test.ts`

**Interfaces:**
- Consumes: `AccountsRegistry`, `ActiveAccount` from `../auth/registry.js`; `rpcMethod`, `RpcHandlers` from `./router.js`; `locatorSchema`, `AMBIENT` from `@coa/shared`; `zod`; `dispatch` from `./router.js` (test only).
- Produces: `function buildAuthHandlers(registry: AccountsRegistry): RpcHandlers` exposing methods `listAccounts`, `currentAccount`, `addAccount`, `useAccount`, `removeAccount`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/rpc/auth-handlers.test.ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry } from '../auth/registry.js';
import { dispatch } from './router.js';
import { buildAuthHandlers } from './auth-handlers.js';

let home: string;
const call = (handlers: ReturnType<typeof buildAuthHandlers>, method: string, params?: unknown) =>
  dispatch({ jsonrpc: '2.0', id: 1, method, params }, handlers);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'coa-authrpc-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('buildAuthHandlers', () => {
  it('currentAccount is ambient initially, then reflects use', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    let res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: 'ambient' } });

    await call(handlers, 'addAccount', { label: 'work', locator: { type: 'config-dir', dir: '/d' } });
    await call(handlers, 'useAccount', { label: 'work' });
    res = await call(handlers, 'currentAccount');
    expect(res).toMatchObject({ result: { active: 'work' } });
  });

  it('listAccounts returns the registered accounts', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    await call(handlers, 'addAccount', { label: 'work', locator: { type: 'ant-profile', profile: 'p' } });
    const res = await call(handlers, 'listAccounts');
    expect(res).toMatchObject({ result: { accounts: [{ label: 'work', provider: 'claude' }] } });
  });

  it('removeAccount drops it', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    await call(handlers, 'addAccount', { label: 'work', locator: { type: 'config-dir', dir: '/d' } });
    await call(handlers, 'removeAccount', { label: 'work' });
    const res = await call(handlers, 'listAccounts');
    expect(res).toMatchObject({ result: { accounts: [] } });
  });

  it('addAccount with a bad locator is an invalid-params error', async () => {
    const handlers = buildAuthHandlers(new AccountsRegistry(home));
    const res = await call(handlers, 'addAccount', { label: 'x', locator: { type: 'api-key' } });
    expect(res).toMatchObject({ error: { code: -32602 } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `corepack pnpm --filter @coa/core exec vitest run src/rpc/auth-handlers.test.ts`
Expected: FAIL — cannot resolve `./auth-handlers.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/rpc/auth-handlers.ts
import { AMBIENT, locatorSchema } from '@coa/shared';
import { z } from 'zod';
import type { AccountsRegistry } from '../auth/registry.js';
import { rpcMethod, type RpcHandlers } from './router.js';

/**
 * The CON-CAT account verbs — the GUI-ready twin of the `coa auth` CLI, over the
 * SAME registry core. Mutating-but-cheap local file ops; no model call. Params
 * are M0-validated (locator via the shared schema) so a malformed pointer is a
 * coded invalid-params error, never a thrown 500.
 */
const addParams = z.object({ label: z.string().min(1), locator: locatorSchema });
const labelParams = z.object({ label: z.string().min(1) });
const noParams = z.unknown().optional();

export function buildAuthHandlers(registry: AccountsRegistry): RpcHandlers {
  const activeLabel = (): string => {
    const active = registry.getActive();
    return active.kind === 'account' ? active.account.label : AMBIENT;
  };
  return {
    listAccounts: rpcMethod(noParams, () => ({ accounts: registry.list() })),
    currentAccount: rpcMethod(noParams, () => ({ active: activeLabel() })),
    addAccount: rpcMethod(addParams, (p) => {
      registry.add(p.label, p.locator);
      return { accounts: registry.list() };
    }),
    useAccount: rpcMethod(labelParams, (p) => {
      registry.setActive(p.label);
      return { active: activeLabel() };
    }),
    removeAccount: rpcMethod(labelParams, (p) => {
      registry.remove(p.label);
      return { accounts: registry.list() };
    }),
  };
}
```

```typescript
// packages/core/src/index.ts — add at the end
export { buildAuthHandlers } from './rpc/auth-handlers.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `corepack pnpm --filter @coa/core exec vitest run src/rpc/auth-handlers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Merge auth verbs into the daemon handler map**

In `packages/core/src/session/daemon.ts`: add `import { homedir } from 'node:os';`, `import { AccountsRegistry } from '../auth/registry.js';`, and `import { buildAuthHandlers } from '../rpc/auth-handlers.js';`. Change `buildDaemonConsoleHandlers` to merge the auth verbs into the returned map:

```typescript
export function buildDaemonConsoleHandlers(handle: DaemonCoreHandle): RpcHandlers {
  return {
    ...buildConsoleHandlers({
      // ...existing ConsoleReadPorts wiring unchanged...
    }),
    ...buildAuthHandlers(new AccountsRegistry(homedir())),
  };
}
```

(Keep the existing `buildConsoleHandlers({...})` argument exactly as-is; only wrap it in the spread object and add the auth spread.)

- [ ] **Step 6: Run the full gates**

Run: `corepack pnpm typecheck && corepack pnpm lint && corepack pnpm test && corepack pnpm exec prettier --check packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/session/daemon.ts && corepack pnpm depcruise`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/index.ts packages/core/src/session/daemon.ts
git commit -m "feat: expose login registration and selection over the daemon protocol"
```

---

### Task 6 — BLOCKED ON SPIKE: deliver `options.env` into the rented loop per session

> Do **not** start until the attended subscription-login spike (§7 of the spec) has confirmed which locator type(s) switch among real subscription logins and finalized the clear-list. This task wires the live session path.

**Files (anticipated):**
- Modify: the adapter session-construction point (`packages/adapter-claude-sdk/src/claude-sdk-adapter.ts`, the `runLoop` `query({ options })` call) to set `options.env = { ...process.env, ...resolveAuthEnv(activeLocator) }` when the overlay is defined; leave `options.env` unset when it is `undefined` (ambient).
- Modify: `ClaudeSdkAdapterInit` to carry the active `Locator` (injected by the daemon from `AccountsRegistry.getActive()`).
- Test: a unit asserting the assembled options carry the spread+overlay env for a config-dir locator and no `env` key for ambient.

**Outline (finalize against spike output):**
1. Add `locator?: Locator` to `ClaudeSdkAdapterInit`.
2. In `runLoop`, compute `const authEnv = init.locator ? resolveAuthEnv(init.locator) : undefined;` and pass `options: { ...options, cwd: …, ...(authEnv ? { env: { ...process.env, ...authEnv } } : {}) }`.
3. Daemon session wiring reads `registry.getActive()` and passes the locator into the adapter init.

---

### Task 7 — BLOCKED ON SPIKE: attribute session spend to the active account label

> Depends on Task 6 (the live session path must select the account before its spend can be attributed).

**Files (anticipated):**
- Modify: the session-start record that feeds the M7 ledger to carry the active account label (or `ambient`).
- Test: a unit asserting a session started under account `work` charges the ledger under label `work`, and an ambient session charges under `ambient`.

**Outline (finalize against the live session path):**
1. At session start, resolve `registry.getActive()` to a label.
2. Stamp the label on the session metadata the ledger already consumes; `M7.charge` attributes to it.
3. No new event type — the label rides existing session-start metadata.

---

## Self-Review

**Spec coverage:**
- §4.1 schema → Task 1. ✔
- §4.2 auth core → Task 2. ✔
- §4.3 resolveAuthEnv + `Options.env` delivery → Task 3 (pure mapping) + Task 6 (live wiring, spike-gated). ✔
- §4.4 CLI → Task 4; RPC → Task 5. ✔
- §4.5 ledger attribution → Task 7 (spike-gated). ✔
- §3 strict-superset → Task 2 (missing file = ambient) + Task 3 (ambient = no overlay) tests. ✔
- Subscription-not-API clearing incl. ambient-token trap → Task 3 (`DEFAULT_CLEAR_VARS` test). ✔
- Build order §8 maps 1:1 to Tasks 1–7. ✔

**Placeholder scan:** Tasks 1–5 contain complete code. Tasks 6–7 are intentionally outline-only because they are spike-gated (their exact shape is a spike output); they are not part of this build pass.

**Type consistency:** `AccountsRegistry` / `ActiveAccount` (`{ kind: 'ambient' } | { kind: 'account'; account }`) consistent across Tasks 2, 4, 5. `resolveAuthEnv(locator, clearVars?)` signature consistent Tasks 3, 6. `Locator`/`Account`/`AMBIENT`/`locatorSchema` from `@coa/shared` consistent throughout. RPC method names (`listAccounts`/`currentAccount`/`addAccount`/`useAccount`/`removeAccount`) consistent Task 5.

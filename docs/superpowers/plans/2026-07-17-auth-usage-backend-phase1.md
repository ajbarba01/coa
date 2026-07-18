# Auth Surface Backend Wiring (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the coa Auth surface from mock-fed to real daemon RPC — a projection over the existing account + web-key stores, plus write verbs, plus an industry-standard three-level bench.

**Architecture:** A new pure **auth-view assembler** reads four sources (`accounts.yaml`, `web.yaml`, `web-keys.json`, a new `console.yaml`) and emits the unified `AuthView` the renderer already expects. Bench status lives **on the entity** where one exists (backend login → `accountSchema.disabled`; service key/provider → `web.yaml`), and in the small credential-blind `console.yaml` store only for entity-less state (`addedProviders`, backend-provider bench). Write verbs route to the correct store by provider group.

**Tech Stack:** TypeScript (strict, no `any`), Zod, `better-sqlite3`-free plain-file stores (`yaml`/JSON), Vitest, pnpm workspaces. RPC via the existing `rpcMethod`/`dispatch` router. Renderer is React + zustand behind an Electron IPC bridge.

## Global Constraints

- **TypeScript `strict`, no `any`.** Validate all external data at the edge with Zod.
- **Determinism-first (P1):** every verb here is a local file op — **no model call.**
- **Credential-blind:** a read may return a `masked` (`••••` for secrets, the verbatim pointer for `config-dir`/`env-var`), **never** a secret. Secrets are 0600 files under `~/.coa/keys/`, written once, never read back.
- **Commit messages: subject-line only**, Conventional Commits, **no body, no trailers, no `Co-Authored-By`, no project-internal IDs** (no "Phase 1", no module codes).
- **Stage files by name** (never `git add -A`). Commit only after the step's test passes.
- **Same-commit doc rule:** a change that adds/moves/deletes files updates the relevant doc in the same commit.
- **Provider set in scope:** `claude`/`deepseek`/`longcat` (backends) + `tavily`/`firecrawl`/`parallel`/`exa` (services). `codex`/`gemini` are NOT wired (no adapter).
- **Test commands:** `pnpm --filter @coa/core test <path>`, `pnpm --filter @coa/shared test`, `pnpm --filter @coa/desktop test`. Typecheck: `pnpm typecheck`.
- **Pre-existing baseline:** 10 failing tests in `adapter-deepseek`/`adapter-longcat` are NOT yours — do not fix them.

---

## File Structure

- `packages/shared/src/auth.ts` — **modify:** `accountSchema` gains `disabled`.
- `packages/core/src/workbench/web/web-config.ts` — **modify:** `webCredentialSchema`, provider `disabled`, back-compat migration, egress skip-disabled.
- `packages/core/src/workbench/web/web-config-store.ts` — **modify:** CRUD under the new shape + `setDisabled`.
- `packages/core/src/console/console-state-store.ts` — **create:** the `console.yaml` store.
- `packages/shared/src/console-state.ts` — **create:** its schema. (M0 owns schemas.)
- `packages/core/src/rpc/auth-view.ts` — **create:** the assembler (read projection + id scheme + heir helper).
- `packages/core/src/rpc/auth-handlers.ts` — **modify:** `authView` + write verbs.
- `packages/core/src/session/daemon.ts:115-130` — **modify:** compose the new stores.
- `packages/console-viewmodel/src/reads.ts` — **modify:** `AuthViewSchema` (the edge contract).
- `apps/desktop/src/shared/methods.ts` — **modify:** register the verbs in `METHODS`.
- `apps/desktop/src/renderer/panels/mockAuth.ts` — **modify:** swap the data source to live RPC; keep every selector.
- `apps/cli/src/web-cli.ts:99` — **modify:** one `.locator` access under the new shape.
- Docs: `docs/design/handoff/spec/M10.md`, `ROADMAP.md` — **modify:** AUTH-* / W5 status.

---

## Task 1: `accountSchema.disabled` (backend login bench)

**Files:**
- Modify: `packages/shared/src/auth.ts:36-41`
- Test: `packages/shared/src/auth.test.ts`

**Interfaces:**
- Produces: `Account` gains `disabled: boolean` (default `false`).

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/auth.test.ts`:

```ts
import { accountSchema } from './auth.js';

it('defaults disabled to false when absent (drop-safe, additive)', () => {
  const a = accountSchema.parse({ label: 'worm', provider: 'claude', locator: { type: 'config-dir', dir: '~/.claude' } });
  expect(a.disabled).toBe(false);
});

it('round-trips an explicit disabled login', () => {
  const a = accountSchema.parse({ label: 'ds', provider: 'deepseek', disabled: true, locator: { type: 'key-file', path: '/x' } });
  expect(a.disabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/shared test auth.test`
Expected: FAIL — `a.disabled` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/shared/src/auth.ts`, edit `accountSchema`:

```ts
export const accountSchema = z.object({
  label: z.string().min(1),
  provider: providerSchema.default('claude'),
  locator: locatorSchema,
  /** Benched by the operator — still configured, just not used. Additive, drop-safe. */
  disabled: z.boolean().default(false),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/shared test auth.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/auth.ts packages/shared/src/auth.test.ts
git commit -m "feat: add a disabled flag to registered accounts"
```

---

## Task 2: `console.yaml` schema + store

**Files:**
- Create: `packages/shared/src/console-state.ts`
- Modify: `packages/shared/src/index.ts` (export the schema)
- Create: `packages/core/src/console/console-state-store.ts`
- Test: `packages/core/src/console/console-state-store.test.ts`

**Interfaces:**
- Produces:
  - `consoleStateSchema` → `{ version: 1, addedProviders: string[], disabledProviders: string[] }`.
  - `class ConsoleStateStore { constructor(home: string); read(): ConsoleState; addProvider(id: string): void; removeProvider(id: string): void; setProviderDisabled(id: string, disabled: boolean): void; }`

- [ ] **Step 1: Write the schema**

Create `packages/shared/src/console-state.ts`:

```ts
import { z } from 'zod';

/**
 * The console's entity-less UI/policy state (`~/.coa/console.yaml`). Credential-blind:
 * only provider ids. `addedProviders` models the "added, no credentials yet" empty state;
 * `disabledProviders` is BACKEND-provider bench (service-provider bench lives on the
 * web.yaml entry). `hiddenModels` is reserved for a later model-visibility pass.
 * Drop-unknown / never-throw, like the web-key store.
 */
export const consoleStateSchema = z
  .object({
    version: z.literal(1).default(1),
    addedProviders: z.array(z.string()).default([]),
    disabledProviders: z.array(z.string()).default([]),
  })
  .strip();
export type ConsoleState = z.infer<typeof consoleStateSchema>;
```

Add to `packages/shared/src/index.ts` (follow the existing export style):

```ts
export { consoleStateSchema, type ConsoleState } from './console-state.js';
```

- [ ] **Step 2: Write the failing store test**

Create `packages/core/src/console/console-state-store.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsoleStateStore } from './console-state-store.js';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'coa-console-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('ConsoleStateStore', () => {
  it('reads a missing file as empty (never throws)', () => {
    expect(new ConsoleStateStore(home).read()).toEqual({ version: 1, addedProviders: [], disabledProviders: [] });
  });

  it('adds a provider once (idempotent) and removes it', () => {
    const s = new ConsoleStateStore(home);
    s.addProvider('claude');
    s.addProvider('claude');
    expect(s.read().addedProviders).toEqual(['claude']);
    s.removeProvider('claude');
    expect(s.read().addedProviders).toEqual([]);
  });

  it('benches and unbenches a provider', () => {
    const s = new ConsoleStateStore(home);
    s.setProviderDisabled('longcat', true);
    expect(s.read().disabledProviders).toEqual(['longcat']);
    s.setProviderDisabled('longcat', false);
    expect(s.read().disabledProviders).toEqual([]);
  });

  it('removeProvider also clears its bench (no orphan)', () => {
    const s = new ConsoleStateStore(home);
    s.addProvider('longcat');
    s.setProviderDisabled('longcat', true);
    s.removeProvider('longcat');
    expect(s.read().disabledProviders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coa/core test console-state-store`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the store**

Create `packages/core/src/console/console-state-store.ts` (mirrors `KeyStateStore`):

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { consoleStateSchema, type ConsoleState } from '@coa/shared';

/** The user-global console-state path. `home` is injectable so tests run over a temp dir. */
export function consoleStatePath(home: string): string {
  return join(home, '.coa', 'console.yaml');
}

const EMPTY: ConsoleState = { version: 1, addedProviders: [], disabledProviders: [] };

export class ConsoleStateStore {
  readonly #home: string;
  constructor(home: string) { this.#home = home; }

  read(): ConsoleState {
    let raw: unknown;
    try { raw = parse(readFileSync(consoleStatePath(this.#home), 'utf8')); }
    catch { return structuredClone(EMPTY); }
    const parsed = consoleStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  addProvider(id: string): void {
    const s = this.read();
    if (!s.addedProviders.includes(id)) { s.addedProviders.push(id); this.#write(s); }
  }

  removeProvider(id: string): void {
    const s = this.read();
    s.addedProviders = s.addedProviders.filter((p) => p !== id);
    s.disabledProviders = s.disabledProviders.filter((p) => p !== id);
    this.#write(s);
  }

  setProviderDisabled(id: string, disabled: boolean): void {
    const s = this.read();
    const has = s.disabledProviders.includes(id);
    if (disabled && !has) s.disabledProviders.push(id);
    else if (!disabled && has) s.disabledProviders = s.disabledProviders.filter((p) => p !== id);
    else return;
    this.#write(s);
  }

  #write(s: ConsoleState): void {
    const path = consoleStatePath(this.#home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, stringify(s), { encoding: 'utf8', mode: 0o600 });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @coa/core test console-state-store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/console-state.ts packages/shared/src/index.ts packages/core/src/console/console-state-store.ts packages/core/src/console/console-state-store.test.ts
git commit -m "feat: add a console-state store for provider view state"
```

---

## Task 3: web.yaml restructure + back-compat migration

Change `credentials: Locator[]` → `credentials: { locator, disabled }[]` and add `disabled` to each provider entry. A per-element union wraps old bare-locator files so existing configs keep parsing. **This task keeps egress behavior identical** (it only reshapes + reads `.locator`); the skip-disabled behavior is Task 4.

**Files:**
- Modify: `packages/core/src/workbench/web/web-config.ts:32-77` (schemas), `:114-187` (egress loops)
- Modify: `packages/core/src/workbench/web/web-config-store.ts` (StoredEntry, addCredential, removeCredential)
- Modify: `apps/cli/src/web-cli.ts:99`
- Test: `packages/core/src/workbench/web/web-config.test.ts`, `web-config-store.test.ts`

**Interfaces:**
- Produces: `webCredentialSchema` → `{ locator: Locator, disabled: boolean }`. `WebConfig` search/fetch provider entries gain `disabled: boolean` and `credentials: WebCredential[]`.

- [ ] **Step 1: Write the failing migration test**

Add to `packages/core/src/workbench/web/web-config.test.ts`:

```ts
import { webConfigSchema } from './web-config.js';

it('migrates an old bare-locator credential to the structured shape', () => {
  const parsed = webConfigSchema.parse({
    search: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }] },
  });
  expect(parsed.search?.providers[0]).toEqual({
    kind: 'tavily',
    disabled: false,
    credentials: [{ locator: { type: 'env-var', name: 'TAVILY_KEY_1' }, disabled: false }],
  });
});

it('accepts the new structured shape verbatim', () => {
  const parsed = webConfigSchema.parse({
    search: { providers: [{ kind: 'tavily', disabled: true, credentials: [{ locator: { type: 'env-var', name: 'X' }, disabled: true }] }] },
  });
  expect(parsed.search?.providers[0]?.disabled).toBe(true);
  expect(parsed.search?.providers[0]?.credentials[0]?.disabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test web-config.test`
Expected: FAIL — result has bare locators, no `disabled`.

- [ ] **Step 3: Reshape the schema with a migration union**

In `packages/core/src/workbench/web/web-config.ts`, replace the two `credentials: z.array(locatorSchema)...` lines and add the credential schema above `fetchProviderSchema`:

```ts
/** A web credential: the shared account Locator + an operator bench flag. A per-element
 *  union migrates old bare-Locator files (wrap → {locator, disabled:false}), drop-safe. */
export const webCredentialSchema = z.union([
  z.object({ locator: locatorSchema, disabled: z.boolean().default(false) }),
  locatorSchema.transform((locator) => ({ locator, disabled: false })),
]);
export type WebCredential = z.infer<typeof webCredentialSchema>;
```

Then in `fetchProviderSchema` and `searchProviderSchema`, change the object body to:

```ts
const fetchProviderSchema = z.object({
  kind: z.enum(['firecrawl', 'tavily']),
  disabled: z.boolean().default(false),
  credentials: z.array(webCredentialSchema).default([]),
});
// ...
const searchProviderSchema = z.object({
  kind: z.enum(['tavily', 'firecrawl', 'parallel']),
  disabled: z.boolean().default(false),
  credentials: z.array(webCredentialSchema).default([]),
});
```

- [ ] **Step 4: Update the egress loops to read `.locator` (behavior unchanged)**

In `buildFetchChain` (line ~122) and `buildSearchChain` (line ~170), change each loop body from using `cred` as a locator to using `cred.locator`:

```ts
for (const cred of provider.credentials) {
  const apiKey = resolveKey(cred.locator, env);
  if (apiKey === undefined) continue;
  providers.push({
    provider: /* ...unchanged... */,
    keyStateId: `${provider.kind}:${locatorId(cred.locator)}`,
  });
}
```

(Do not add a `disabled` skip yet — Task 4.)

- [ ] **Step 5: Update `WebConfigStore` to the new shape**

In `packages/core/src/workbench/web/web-config-store.ts`:

```ts
type StoredCred = { locator: Locator; disabled: boolean };
type StoredEntry = { kind: string; disabled: boolean; credentials: StoredCred[] };
```

`addCredential` — create the entry with `disabled: false` and push a wrapped credential:

```ts
if (entry === undefined) {
  entry = { kind, disabled: false, credentials: [] };
  block.providers.push(entry);
}
entry.credentials.push({ locator, disabled: false });
```

`removeCredential` — match on `.locator` and read the type off it:

```ts
const isMatch = (c: StoredCred): boolean =>
  (c.locator.type === 'key-file' && c.locator.path === keyFilePath) ||
  (c.locator.type === 'env-var' && c.locator.name === id);
// ...
credentials: p.credentials.filter((c) => {
  const match = isMatch(c);
  if (match && c.locator.type === 'key-file') removedKeyFile = true;
  return !match;
}),
// ...
.some((c) => c.locator.type === 'key-file' && c.locator.path === keyFilePath);
```

- [ ] **Step 6: Update `web-cli.ts` and the affected store/config tests**

In `apps/cli/src/web-cli.ts:99`, change the loop to read `cred.locator` wherever it treated `cred` as a locator. Update `web-config-store.test.ts` assertions that inspect `.credentials` to the new shape, e.g. the search-lands test:

```ts
expect(cfg.search?.providers).toEqual([
  { kind: 'tavily', disabled: false, credentials: [{ locator: { type: 'env-var', name: 'TAVILY_KEY_1' }, disabled: false }] },
]);
```

Update the append-order and shared-key tests to the `{ locator, disabled }` element shape the same way. `daemon.test.ts:280,310` fixtures use bare locators — the migration keeps them parsing, so leave them unless an assertion inspects the stored credential shape.

- [ ] **Step 7: Run the full web + cli + shared suites**

Run: `pnpm --filter @coa/core test web-config && pnpm --filter @coa/cli test && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web/web-config-store.ts packages/core/src/workbench/web/web-config.test.ts packages/core/src/workbench/web/web-config-store.test.ts apps/cli/src/web-cli.ts
git commit -m "feat: give web credentials an operator bench flag"
```

---

## Task 4: egress skips a benched credential or provider

**Files:**
- Modify: `packages/core/src/workbench/web/web-config.ts` (both chain builders)
- Modify: `packages/core/src/workbench/web/web-config-store.ts` (add `setDisabled`)
- Test: `packages/core/src/workbench/web/web-config.test.ts`, `web-config-store.test.ts`

**Interfaces:**
- Produces: `WebConfigStore.setCredentialDisabled(chain, id, disabled): void` and `WebConfigStore.setProviderDisabled(chain, kind, disabled): void`.

- [ ] **Step 1: Write the failing egress test**

Add to `web-config.test.ts` (mirror the existing chain-building tests — set an env var, build deps, assert the disabled key is skipped). Use the existing test's helper pattern for `buildWebToolDeps` + a stub search provider; assert a benched credential produces an empty/exhausted chain and a benched provider is excluded entirely:

```ts
it('excludes a disabled credential from the search chain', () => {
  const config = webConfigSchema.parse({
    search: { providers: [{ kind: 'tavily', credentials: [{ locator: { type: 'env-var', name: 'K' }, disabled: true }] }] },
  });
  const deps = buildWebToolDeps(config, { K: 'secret' }, { home: '/tmp/x' });
  // a fully-disabled chain resolves to exhausted → empty results (SC-1/D85)
  return expect(deps.searchChain({ query: 'hi' })).resolves.toMatchObject({ hits: [] });
});

it('excludes a disabled provider even if its keys resolve', () => {
  const config = webConfigSchema.parse({
    search: { providers: [{ kind: 'tavily', disabled: true, credentials: [{ locator: { type: 'env-var', name: 'K' }, disabled: false }] }] },
  });
  const deps = buildWebToolDeps(config, { K: 'secret' }, { home: '/tmp/x' });
  return expect(deps.searchChain({ query: 'hi' })).resolves.toMatchObject({ hits: [] });
});
```

Adjust the exact result-shape assertion to match `runChain`'s exhausted return (check `web-tools.ts` `RoutedSearch` shape while writing this — mirror the empty-chain test already in the file at line ~66).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test web-config.test`
Expected: FAIL — disabled key still serves.

- [ ] **Step 3: Add the skips to both chain builders**

In `buildFetchChain` and `buildSearchChain`, guard both levels:

```ts
for (const provider of searchCfg?.providers ?? []) {
  if (provider.disabled) continue;
  for (const cred of provider.credentials) {
    if (cred.disabled) continue;
    const apiKey = resolveKey(cred.locator, env);
    // ...unchanged...
  }
}
```

- [ ] **Step 4: Add the store mutators**

In `WebConfigStore`, add (matching by chain + id/kind, then `#write`):

```ts
setProviderDisabled(chain: WebChain, kind: string, disabled: boolean): void {
  const config = this.#readStored();
  const block = config[chain];
  const entry = block?.providers.find((p) => p.kind === kind);
  if (block === undefined || entry === undefined) return;
  entry.disabled = disabled;
  config[chain] = block;
  this.#write(config);
}

setCredentialDisabled(chain: WebChain, id: string, disabled: boolean): void {
  const config = this.#readStored();
  const block = config[chain];
  if (block === undefined) return;
  const keyFilePath = webKeyFilePath(this.#home, id);
  for (const p of block.providers) {
    for (const c of p.credentials) {
      if ((c.locator.type === 'key-file' && c.locator.path === keyFilePath) ||
          (c.locator.type === 'env-var' && c.locator.name === id)) c.disabled = disabled;
    }
  }
  config[chain] = block;
  this.#write(config);
}
```

- [ ] **Step 5: Write + run the store mutator test**

Add to `web-config-store.test.ts` a test that adds a key, `setCredentialDisabled('search', <id>, true)`, and asserts `read().search?.providers[0]?.credentials[0]?.disabled === true`; same for `setProviderDisabled`.

Run: `pnpm --filter @coa/core test web-config`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web/web-config-store.ts packages/core/src/workbench/web/web-config.test.ts packages/core/src/workbench/web/web-config-store.test.ts
git commit -m "feat: skip benched web credentials and providers in egress"
```

---

## Task 5: the auth-view assembler

The pure read projection: reads all four sources → the `AuthView` the renderer expects. Owns the id scheme, `••••`/pointer masking, the enabled/added/chains derivation, service `coolingSec`, and the heir-promotion helper.

**Files:**
- Create: `packages/core/src/rpc/auth-view.ts`
- Test: `packages/core/src/rpc/auth-view.test.ts`

**Interfaces:**
- Consumes: `AccountsRegistry`, `WebConfigStore`, `KeyStateStore`, `ConsoleStateStore`; `providerById`-equivalent group/locator knowledge (define a small local table — see Step 3).
- Produces:
  ```ts
  interface CredentialView { id: string; providerId: string; label: string; masked: string; disabled: boolean; coolingSec?: number; }
  interface AuthView { added: string[]; credentials: CredentialView[]; activeByProvider: Record<string,string>; enabled: Record<string,boolean>; chains: Record<string,string[]>; }
  export function credentialId(providerId: string, label: string): string; // `${providerId}:${label}`
  export function assembleAuthView(deps: AuthViewDeps, now?: number): AuthView;
  export function heir(siblings: CredentialView[]): CredentialView | undefined; // first non-disabled
  ```
  where `AuthViewDeps = { accounts: AccountsRegistry; web: WebConfigStore; keys: KeyStateStore; console: ConsoleStateStore }`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/rpc/auth-view.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsRegistry } from '../auth/registry.js';
import { WebConfigStore, webKeyFilePath } from '../workbench/web/web-config-store.js';
import { KeyStateStore } from '../workbench/web/key-state-store.js';
import { ConsoleStateStore } from '../console/console-state-store.js';
import { assembleAuthView, credentialId } from './auth-view.js';

let home: string;
const deps = () => ({
  accounts: new AccountsRegistry(home),
  web: new WebConfigStore(home),
  keys: new KeyStateStore(home),
  console: new ConsoleStateStore(home),
});
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'coa-authview-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

describe('assembleAuthView', () => {
  it('shows a config-dir pointer verbatim and a key-file secret as ••••', () => {
    const d = deps();
    d.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
    d.accounts.add('ds', { type: 'key-file', path: '/x' }, 'deepseek');
    const view = assembleAuthView(d);
    const worm = view.credentials.find((c) => c.label === 'worm');
    const ds = view.credentials.find((c) => c.label === 'ds');
    expect(worm?.masked).toBe('~/.claude');
    expect(ds?.masked).toBe('••••');
  });

  it('reports the active backend login as a credential id', () => {
    const d = deps();
    d.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
    d.accounts.setActive('worm');
    expect(assembleAuthView(d).activeByProvider['claude']).toBe(credentialId('claude', 'worm'));
  });

  it('marks a benched account disabled and reports provider enabled', () => {
    const d = deps();
    d.console.addProvider('longcat');
    d.console.setProviderDisabled('longcat', true);
    expect(assembleAuthView(d).enabled['longcat']).toBe(false);
  });

  it('carries a service key cooldown from the breaker', () => {
    const d = deps();
    const path = webKeyFilePath(home, 'tavily-1');
    d.web.addCredential('search', 'tavily', { type: 'key-file', path });
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);
    const view = assembleAuthView(d);
    const key = view.credentials.find((c) => c.providerId === 'tavily');
    expect(key?.coolingSec).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test auth-view`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the assembler**

Create `packages/core/src/rpc/auth-view.ts`. Define a local group/locator table for the in-scope providers (core must not import the renderer's `providers.ts`):

```ts
import type { AccountsRegistry } from '../auth/registry.js';
import type { WebConfigStore, WebChain } from '../workbench/web/web-config-store.js';
import type { KeyStateStore } from '../workbench/web/key-state-store.js';
import type { ConsoleStateStore } from '../console/console-state-store.js';
import { locatorId } from '../workbench/web/key-state-store.js';

/** Server-side provider facts core owns (group + whether the locator is a readable pointer).
 *  The renderer's providers.ts owns presentation; this owns routing/display only. */
const BACKENDS = ['claude', 'deepseek', 'longcat'] as const;
const SERVICES = ['tavily', 'firecrawl', 'parallel', 'exa'] as const;
const POINTER_PROVIDERS = new Set<string>(['claude']); // config-dir; env-var providers would join here

export interface CredentialView {
  id: string; providerId: string; label: string; masked: string; disabled: boolean; coolingSec?: number;
}
export interface AuthView {
  added: string[]; credentials: CredentialView[];
  activeByProvider: Record<string, string>; enabled: Record<string, boolean>; chains: Record<string, string[]>;
}
export interface AuthViewDeps {
  accounts: AccountsRegistry; web: WebConfigStore; keys: KeyStateStore; console: ConsoleStateStore;
}

export function credentialId(providerId: string, label: string): string {
  return `${providerId}:${label}`;
}

/** A key-file secret can't be read back; a pointer provider shows its readable value. */
function maskFor(providerId: string, pointerValue: string | undefined): string {
  return POINTER_PROVIDERS.has(providerId) && pointerValue !== undefined ? pointerValue : '••••';
}

export function heir(siblings: CredentialView[]): CredentialView | undefined {
  return siblings.find((c) => !c.disabled);
}

export function assembleAuthView(deps: AuthViewDeps, now = Date.now()): AuthView {
  const state = deps.console.read();
  const credentials: CredentialView[] = [];
  const activeByProvider: Record<string, string> = {};

  // Backends — accounts.yaml
  for (const provider of BACKENDS) {
    for (const acct of deps.accounts.listByProvider(provider)) {
      const pointer = acct.locator.type === 'config-dir' ? acct.locator.dir
        : acct.locator.type === 'env-var' ? acct.locator.name : undefined;
      credentials.push({
        id: credentialId(provider, acct.label), providerId: provider, label: acct.label,
        masked: maskFor(provider, pointer), disabled: acct.disabled,
      });
    }
    const active = deps.accounts.getActive(provider);
    if (active.kind === 'account') activeByProvider[provider] = credentialId(provider, active.account.label);
  }

  // Services — web.yaml (+ breaker cooldown from web-keys.json)
  const web = deps.web.read();
  const chains: Record<string, string[]> = {};
  for (const chain of ['search', 'fetch'] as WebChain[]) {
    const providers = web[chain]?.providers ?? [];
    chains[chain] = providers.map((p) => p.kind);
    for (const p of providers) {
      for (const cred of p.credentials) {
        const label = labelOf(cred.locator);
        const cv: CredentialView = {
          id: credentialId(p.kind, label), providerId: p.kind, label,
          masked: '••••', disabled: cred.disabled,
        };
        const cool = coolingSec(deps.keys, p.kind, cred.locator, now);
        if (cool !== undefined) cv.coolingSec = cool;
        // de-dup a key shared by both chains (same id)
        if (!credentials.some((x) => x.id === cv.id)) credentials.push(cv);
      }
    }
  }

  // added = console-added ∪ providers that already have a credential
  const withCreds = new Set(credentials.map((c) => c.providerId));
  const added = [...new Set([...state.addedProviders, ...withCreds])];

  const enabled: Record<string, boolean> = {};
  for (const id of added) enabled[id] = !isDisabledProvider(id, state.disabledProviders, web);

  return { added, credentials, activeByProvider, enabled, chains };
}

/** A service key's label is the tail of its web-<label> key-file, or the env-var name. */
function labelOf(locator: { type: string; path?: string; name?: string }): string {
  if (locator.type === 'key-file' && locator.path !== undefined) {
    const base = locator.path.split(/[\\/]/).pop() ?? locator.path;
    return base.startsWith('web-') ? base.slice(4) : base;
  }
  return locator.name ?? locatorId(locator as never);
}

function coolingSec(keys: KeyStateStore, kind: string, locator: unknown, now: number): number | undefined {
  const id = `${kind}:${locatorId(locator as never)}`;
  // KeyStateStore exposes isCoolingDown; expose remaining via a small read (see note).
  return keys.isCoolingDown(id, now) ? remainingSec(keys, id, now) : undefined;
}
```

**Note on `coolingSec`:** `KeyStateStore` currently exposes only `isCoolingDown(id, now)`. Add a small `cooldownUntil(id): number | undefined` reader to `KeyStateStore` (returns `this.#read().cooldowns[id]`), then compute `remainingSec = Math.ceil((until - now)/1000)`. Include that one-line addition + a unit test in this task (it is part of the assembler's read need).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test auth-view`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rpc/auth-view.ts packages/core/src/rpc/auth-view.test.ts packages/core/src/workbench/web/key-state-store.ts packages/core/src/workbench/web/key-state-store.test.ts
git commit -m "feat: assemble the unified auth view from the credential stores"
```

---

## Task 6: the `authView` read verb + composition root

**Files:**
- Modify: `packages/core/src/rpc/auth-handlers.ts`
- Modify: `packages/core/src/session/daemon.ts:115-130`
- Test: `packages/core/src/rpc/auth-handlers.test.ts`

**Interfaces:**
- Consumes: `assembleAuthView`, the four stores.
- Produces: `buildAuthHandlers(deps: AuthHandlerDeps): RpcHandlers` where `AuthHandlerDeps = AuthViewDeps` — **signature change** from `(registry)` to `(deps)`. Adds the `authView` method returning `AuthView`.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/rpc/auth-handlers.test.ts` a test that builds handlers over a temp home with one claude account and asserts `authView` returns it:

```ts
it('authView projects a registered backend login', async () => {
  const deps = { accounts: new AccountsRegistry(home), web: new WebConfigStore(home), keys: new KeyStateStore(home), console: new ConsoleStateStore(home) };
  deps.accounts.add('worm', { type: 'config-dir', dir: '~/.claude' }, 'claude');
  const handlers = buildAuthHandlers(deps);
  const view = await handlers.authView!.handle(undefined) as AuthView;
  expect(view.credentials.map((c) => c.label)).toContain('worm');
});
```

(Update the existing `buildAuthHandlers(new AccountsRegistry(...))` call sites in this test file to the new `deps` object.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test auth-handlers`
Expected: FAIL — `buildAuthHandlers` takes a registry / no `authView`.

- [ ] **Step 3: Change the factory signature and add `authView`**

In `auth-handlers.ts`, change the factory to accept `AuthViewDeps`, keep the existing account verbs (they use `deps.accounts`), and add:

```ts
authView: rpcMethod(noParams, () => assembleAuthView(deps)),
```

- [ ] **Step 4: Update the composition root**

In `packages/core/src/session/daemon.ts` (~line 124), replace:

```ts
...buildAuthHandlers(new AccountsRegistry(homedir())),
```

with:

```ts
...buildAuthHandlers({
  accounts: new AccountsRegistry(homedir()),
  web: new WebConfigStore(homedir()),
  keys: new KeyStateStore(homedir()),
  console: new ConsoleStateStore(homedir()),
}),
```

Add the imports for `WebConfigStore`, `KeyStateStore`, `ConsoleStateStore` at the top of `daemon.ts`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @coa/core test auth-handlers && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/session/daemon.ts
git commit -m "feat: expose the auth view as an rpc read verb"
```

---

## Task 7: the auth write verbs

All the mutations, routed by provider group. Each is a thin store call; the assembler re-projects the result.

**Files:**
- Modify: `packages/core/src/rpc/auth-handlers.ts`
- Test: `packages/core/src/rpc/auth-handlers.test.ts`

**Interfaces:**
- Produces RPC methods (all return the fresh `AuthView`): `addProvider`, `removeProvider`, `addCredential`, `replaceSecret`, `renameCredential`, `removeCredential`, `setProviderEnabled`, `setCredentialDisabled`, `makeActive`, `clearCooldown`, `refresh`.
- Consumes: a server-side `providerGroup(id): 'backend' | 'service'` and `chainOf(serviceId): WebChain[]` helper (define alongside; backends = the M0 provider enum, services = SEARCH/FETCH kinds), plus `webKeyFilePath` for 0600 writes.

- [ ] **Step 1: Write the failing tests (one describe block, several cases)**

Add to `auth-handlers.test.ts`. Cover the load-bearing behaviors from the design's §8:

```ts
describe('auth write verbs', () => {
  it('addCredential writes a 0600 key file for a key-file backend and registers a pointer', async () => {
    const h = buildAuthHandlers(freshDeps(home));
    await h.addCredential!.handle({ providerId: 'deepseek', label: 'ds', secret: 'sk-secret' });
    // the secret is on disk 0600, the registry holds only the pointer
    const view = await h.authView!.handle(undefined) as AuthView;
    expect(view.credentials.find((c) => c.label === 'ds')?.masked).toBe('••••');
    // and the yaml never contains the secret
    expect(readFileSync(accountsPath(home), 'utf8')).not.toContain('sk-secret');
  });

  it('benching the active login promotes an heir and never leaves disabled-but-active', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude');
    d.accounts.add('b', { type: 'config-dir', dir: '~/.b' }, 'claude');
    d.accounts.setActive('a');
    const h = buildAuthHandlers(d);
    const view = await h.setCredentialDisabled!.handle({ id: credentialId('claude', 'a'), disabled: true }) as AuthView;
    expect(view.activeByProvider['claude']).toBe(credentialId('claude', 'b'));
    expect(view.credentials.find((c) => c.label === 'a')?.disabled).toBe(true);
  });

  it('makeActive rejects a disabled login', async () => {
    const d = freshDeps(home);
    d.accounts.add('a', { type: 'config-dir', dir: '~/.a' }, 'claude', /* disabled */);
    // ...set disabled via setCredentialDisabled, then makeActive is a no-op — assert active unchanged
  });

  it('clearCooldown clears a service key breaker cooldown', async () => {
    const d = freshDeps(home);
    const path = webKeyFilePath(home, 'tavily-1');
    d.web.addCredential('search', 'tavily', { type: 'key-file', path });
    d.keys.markCooldown(`tavily:${path}`, Date.now() + 60_000);
    const h = buildAuthHandlers(d);
    await h.clearCooldown!.handle({ id: credentialId('tavily', 'tavily-1') });
    expect(d.keys.isCoolingDown(`tavily:${path}`, Date.now())).toBe(false);
  });
});
```

Add a `freshDeps(home)` helper at the top of the test file returning the four-store deps object.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test auth-handlers`
Expected: FAIL — verbs undefined.

- [ ] **Step 3: Implement the verbs**

In `auth-handlers.ts`, add params schemas and methods. Route by `providerGroup(providerId)`. Backend key-file/env-var/config-dir add:

```ts
const idParams = z.object({ id: z.string().min(1) });
const addCredParams = z.object({ providerId: z.string().min(1), label: z.string().min(1), secret: z.string() });
const benchParams = z.object({ id: z.string().min(1), disabled: z.boolean() });
const enableParams = z.object({ providerId: z.string().min(1), on: z.boolean() });
const renameParams = z.object({ id: z.string().min(1), label: z.string().min(1) });

// helpers
function splitId(id: string): { providerId: string; label: string } {
  const at = id.indexOf(':'); return { providerId: id.slice(0, at), label: id.slice(at + 1) };
}
```

Then, for example, `addCredential`:

```ts
addCredential: rpcMethod(addCredParams, (p) => {
  if (providerGroup(p.providerId) === 'backend') {
    const locator = backendLocator(deps, p.providerId, p.label, p.secret); // writes 0600 for key-file
    deps.accounts.add(p.label, locator, p.providerId as Provider);
  } else {
    const [chain] = chainOf(p.providerId);
    const path = webKeyFilePath(homedir(), p.label);
    writeFileSync(path, p.secret, { mode: 0o600 }); mkdirSync(dirname(path), { recursive: true });
    deps.web.addCredential(chain, p.providerId, { type: 'key-file', path });
  }
  return assembleAuthView(deps);
}),
```

`setCredentialDisabled` (with heir promotion for backends):

```ts
setCredentialDisabled: rpcMethod(benchParams, (p) => {
  const { providerId, label } = splitId(p.id);
  if (providerGroup(providerId) === 'backend') {
    setAccountDisabled(deps.accounts, label, p.disabled); // re-writes the account with disabled
    if (p.disabled) promoteHeirIfActive(deps.accounts, providerId, label); // setActive(heir) or setAmbient
  } else {
    for (const chain of chainOf(providerId)) deps.web.setCredentialDisabled(chain, label, p.disabled);
  }
  return assembleAuthView(deps);
}),
```

Implement the remaining verbs the same way, each returning `assembleAuthView(deps)`:
- `addProvider`/`removeProvider` → `deps.console.addProvider/removeProvider`; remove also deletes the provider's credentials (registry.remove per account / web.removeCredential per key) and unlinks returned key-file paths.
- `replaceSecret` → backend key-file: rewrite the same 0600 path + `deps.keys.clear`; service: rewrite `webKeyFilePath(label)` + clear its cooldowns.
- `renameCredential` → backend: `registry.remove(old)` + `registry.add(new, sameLocator)` (re-key); service: rename the `web-<label>` file (fs.rename) + `web.removeCredential(old)` + `web.addCredential(new key-file)`. **Highest-care unit — write its test first and assert the file moved and the locator re-points.**
- `setProviderEnabled` → backend: `deps.console.setProviderDisabled(id, !on)`; service: `deps.web.setProviderDisabled(chain, id, !on)` for each chain.
- `makeActive` → backend only: guard `!disabled`, then `deps.accounts.setActive(label)`.
- `clearCooldown` → service: `deps.keys.clear(\`${providerId}:${locatorPath}\`)`.
- `refresh` → `assembleAuthView(deps)` (Phase 2 re-reads pointers; here it just re-projects).

`setAccountDisabled` and `promoteHeirIfActive` are small helpers over the registry (the registry has no `disabled` mutator yet — add `AccountsRegistry.setDisabled(label, disabled)` that re-writes the account, with a unit test in `registry.test.ts`, folded into this task).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @coa/core test auth-handlers && pnpm --filter @coa/core test registry && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rpc/auth-handlers.ts packages/core/src/rpc/auth-handlers.test.ts packages/core/src/auth/registry.ts packages/core/src/auth/registry.test.ts
git commit -m "feat: add the auth surface write verbs"
```

---

## Task 8: the renderer edge schema

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts`
- Test: `packages/console-viewmodel/src/reads.test.ts` (or the package's existing schema test)

**Interfaces:**
- Produces: `AuthViewSchema` / `AuthView` mirroring the core `AuthView`, with the Phase-2 fields present-but-optional so the renderer's `Credential` interface is satisfied.

- [ ] **Step 1: Write the failing test**

Add a test that `AuthViewSchema.parse` accepts a minimal view and strips unknown fields:

```ts
import { AuthViewSchema } from './reads.js';
it('parses an auth view and keeps optional phase-2 fields absent', () => {
  const v = AuthViewSchema.parse({ added: ['claude'], credentials: [{ id: 'claude:worm', providerId: 'claude', label: 'worm', masked: '~/.claude', disabled: false }], activeByProvider: { claude: 'claude:worm' }, enabled: { claude: true }, chains: { search: ['tavily'], fetch: [] } });
  expect(v.credentials[0]?.identity).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/console-viewmodel test reads`
Expected: FAIL — `AuthViewSchema` not exported.

- [ ] **Step 3: Add the schema**

In `reads.ts`:

```ts
/** A credential as the Auth surface needs it — matches the renderer's `Credential` interface.
 *  Phase-2 fields (identity/plan/expired/lastUsed) are optional and unset until the usage read. */
export const CredentialViewSchema = z.object({
  id: z.string(), providerId: z.string(), label: z.string(), masked: z.string(), disabled: z.boolean(),
  coolingSec: z.number().optional(),
  identity: z.string().optional(), plan: z.string().optional(),
  expired: z.boolean().optional(), lastUsed: z.string().optional(),
}).strip();

export const AuthViewSchema = z.object({
  added: z.array(z.string()),
  credentials: z.array(CredentialViewSchema),
  activeByProvider: z.record(z.string(), z.string()),
  enabled: z.record(z.string(), z.boolean()),
  chains: z.record(z.string(), z.array(z.string())),
}).strip();
export type AuthView = z.infer<typeof AuthViewSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/console-viewmodel test reads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/console-viewmodel/src/reads.ts packages/console-viewmodel/src/reads.test.ts
git commit -m "feat: add the auth view edge schema"
```

---

## Task 9: register the verbs on the IPC bridge

**Files:**
- Modify: `apps/desktop/src/shared/methods.ts`
- Test: `apps/desktop/src/shared/methods.test.ts`

**Interfaces:**
- Produces: `MethodName` gains `authView` + the eleven write verbs; `METHODS` maps each to its params/result Zod (results = `AuthViewSchema`).

- [ ] **Step 1: Write the failing test**

Add to `methods.test.ts` an assertion that `METHODS.authView.result === AuthViewSchema` and that each write verb is present with `result: AuthViewSchema`. Follow the file's existing test style.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/desktop test methods`
Expected: FAIL.

- [ ] **Step 3: Register the verbs**

Import `AuthViewSchema` from `@coa/console-viewmodel`. Add the names to the `MethodName` union and the entries to `METHODS`, e.g.:

```ts
authView: { result: AuthViewSchema },
addProvider: { params: z.object({ providerId: z.string() }), result: AuthViewSchema },
removeProvider: { params: z.object({ providerId: z.string() }), result: AuthViewSchema },
addCredential: { params: z.object({ providerId: z.string(), label: z.string(), secret: z.string() }), result: AuthViewSchema },
replaceSecret: { params: z.object({ id: z.string(), secret: z.string() }), result: AuthViewSchema },
renameCredential: { params: z.object({ id: z.string(), label: z.string() }), result: AuthViewSchema },
removeCredential: { params: z.object({ id: z.string() }), result: AuthViewSchema },
setProviderEnabled: { params: z.object({ providerId: z.string(), on: z.boolean() }), result: AuthViewSchema },
setCredentialDisabled: { params: z.object({ id: z.string(), disabled: z.boolean() }), result: AuthViewSchema },
makeActive: { params: z.object({ id: z.string() }), result: AuthViewSchema },
clearCooldown: { params: z.object({ id: z.string() }), result: AuthViewSchema },
refresh: { result: AuthViewSchema },
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @coa/desktop test methods && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/shared/methods.ts apps/desktop/src/shared/methods.test.ts
git commit -m "feat: bridge the auth verbs across the ipc boundary"
```

---

## Task 10: swap the renderer store to live RPC

Replace `mockAuth`'s seeded data + local actions with a store hydrated from `authView` whose actions call the RPC verbs and reproject the returned view. **Every pure selector at the bottom of `mockAuth.ts` stays byte-for-byte unchanged** — that is the frozen contract paying off.

**Files:**
- Modify: `apps/desktop/src/renderer/panels/mockAuth.ts`
- Modify: `apps/desktop/src/renderer/console.ts` (add the verb callers, mirroring the existing `listAccounts`/`useAccount` callers)
- Test: `apps/desktop/src/renderer/panels/AuthPanel.test.tsx` (adjust the store seam), plus a hydration unit test.

**Interfaces:**
- Consumes: `METHODS`/`channel` bridge + the preload `invoke` (as `listAccounts`/`useAccount` already do in `console.ts`).
- Produces: `useAuth` store with the same state shape + selectors; actions become async RPC calls that `set` the returned `AuthView`.

- [ ] **Step 1: Add the verb callers to `console.ts`**

For each verb, add a caller mirroring the existing account callers (find `listAccounts`/`useAccount` in `console.ts` and copy the shape). Example:

```ts
export const rpcAuthView = () => invoke('authView');
export const rpcAddCredential = (providerId: string, label: string, secret: string) =>
  invoke('addCredential', { providerId, label, secret });
// ...one per verb, returning the parsed AuthView (invoke already validates via METHODS)
```

- [ ] **Step 2: Write the failing hydration test**

In a new `apps/desktop/src/renderer/panels/auth.test.tsx` (or extend `AuthPanel.test.tsx`), mock `console.ts`'s `rpcAuthView` to return a fixture `AuthView` and assert the store's `credentials` selector reflects it after `hydrate()`:

```ts
it('hydrates the store from authView and keeps selectors working', async () => {
  vi.mocked(rpcAuthView).mockResolvedValue(FIXTURE_VIEW);
  await useAuth.getState().hydrate();
  expect(credentialsOf(useAuth.getState().credentials, 'claude').map((c) => c.label)).toEqual(['worm']);
});
```

- [ ] **Step 3: Rewrite the store head, keep the selectors**

In `mockAuth.ts`, replace the `create<MockAuthState>(...)` body (the seeded data + local action bodies) with a live store. Keep the `Credential` interface and **all pure selectors below the store**. Rename the export to `useAuth` (leave a `useMockAuth = useAuth` alias if any panel still imports the old name, then update imports):

```ts
interface AuthState {
  added: string[]; credentials: Credential[];
  activeByProvider: Record<string, string>; enabled: Record<string, boolean>; chains: Record<string, string[]>;
  hydrate: () => Promise<void>;
  addProvider: (id: string) => Promise<void>;
  addCredential: (providerId: string, label: string, secret: string) => Promise<void>;
  // ...one per verb, all async, all `set(view)` on return
}

const apply = (set: (s: Partial<AuthState>) => void) => (view: AuthView) =>
  set({ added: view.added, credentials: view.credentials, activeByProvider: view.activeByProvider, enabled: view.enabled, chains: view.chains });

export const useAuth = create<AuthState>((set) => ({
  added: [], credentials: [], activeByProvider: {}, enabled: {}, chains: {},
  hydrate: async () => apply(set)(await rpcAuthView()),
  addCredential: async (providerId, label, secret) => apply(set)(await rpcAddCredential(providerId, label, secret)),
  // ...
}));
```

Delete `SEED_CREDENTIALS`, `mask`, `stored`, `nextId`, `cred`, `uncooled` and any other mock-only helpers **only if unused** after the swap (the selectors `credentialStatus`, `addedProviders`, `credentialsOf`, `poolHealth`, `chainPositions` stay).

- [ ] **Step 4: Call `hydrate()` when the surface mounts**

In `AuthPanel.tsx` (and the usage HUD if it reads the same store), call `useAuth.getState().hydrate()` on mount (a `useEffect`), mirroring how the account selector triggers `listAccounts`.

- [ ] **Step 5: Run the renderer suite + typecheck**

Run: `pnpm --filter @coa/desktop test && pnpm typecheck`
Expected: PASS, clean. Fix any `AuthPanel.test.tsx` cases that assumed seeded data — they should now drive the mocked store.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/panels/mockAuth.ts apps/desktop/src/renderer/console.ts apps/desktop/src/renderer/panels/AuthPanel.tsx apps/desktop/src/renderer/panels/auth.test.tsx apps/desktop/src/renderer/panels/AuthPanel.test.tsx
git commit -m "feat: drive the auth surface from live daemon reads"
```

---

## Task 11: drive the app + update the docs

**Files:**
- Modify: `docs/design/handoff/spec/M10.md` (AUTH-* status), `ROADMAP.md` (W5)

- [ ] **Step 1: Launch and drive the running app**

Run: `pnpm --filter @coa/desktop dev` (the launcher clears `ELECTRON_RUN_AS_NODE`; a second launch silently no-ops if the app is already open — restart the dev server after any `console-kit` change). Then, in the window:
- add a claude login (config-dir) → row shows the pointer verbatim;
- add a deepseek key → row shows `••••`; confirm `~/.coa/keys/` holds a 0600 file and `accounts.yaml` holds only the pointer;
- bench a tavily key → confirm it leaves the pool (pool-health count drops) and, if you can, that a web search no longer uses it;
- switch the active claude login → the filled marker moves; bench the active one → an heir is promoted, never "disabled but active";
- ⟳ refresh → the view re-reads without error.

Record what you observed (the handoff mandates verify-by-driving, not just tests).

- [ ] **Step 2: Update the docs (same-commit rule)**

In `docs/design/handoff/spec/M10.md`, mark the AUTH-* verbs as wired (leaving USAGE-* as Phase 2). In `ROADMAP.md` W5, move the auth backend from "missing RPC" to done, and note Usage (Phase 2) + model reads (Phase 3) remain.

- [ ] **Step 3: Full verification**

Run: `pnpm typecheck && pnpm --filter @coa/core test && pnpm --filter @coa/desktop test && pnpm depcruise`
Expected: green except the 10 known-pre-existing adapter failures.

- [ ] **Step 4: Commit**

```bash
git add docs/design/handoff/spec/M10.md ROADMAP.md
git commit -m "docs: record the auth surface as wired to real reads"
```

---

## Self-Review

**Spec coverage:**
- §1 projection over two stores → Tasks 5–6. ✅
- §2 bench split (backend login on entity, service on web.yaml, provider/added in console.yaml) → Tasks 1, 2, 3, 4, 7. ✅
- §3 `••••` vs pointer → Task 5 (`maskFor`) + test. ✅
- §4 Phase-1 vs Phase-2 fields → Task 8 (optional Phase-2 fields). ✅
- §5 schema changes → Tasks 1, 2, 3. ✅
- §6 all verbs incl. heir promotion + service-rename care → Tasks 6, 7. ✅
- §7 files → all listed tasks. ✅
- §8 tests (id scheme, join-against-live/orphan drop, heir, mask, cascade delete + unlink, egress skip, migration, coolingSec) → Tasks 2–7. ✅
- §9 out of scope (usage, model reads, codex/gemini) → not built. ✅

**Placeholder scan:** the service-rename verb and a couple of write verbs are described as "same pattern, returning `assembleAuthView(deps)`" with the shape shown for the representative cases (`addCredential`, `setCredentialDisabled`) — the implementer has the concrete pattern + the exact store methods (Tasks 2–4 defined them) for each. `renameCredential` is explicitly flagged test-first as the highest-care unit.

**Type consistency:** `credentialId(providerId,label)` (Task 5) is the id everywhere; `AuthView`/`CredentialView` shape is identical in core (Task 5), the edge schema (Task 8), and the bridge results (Task 9); `buildAuthHandlers(deps)` signature change is applied at its one call site (Task 6, daemon.ts) and its test (Tasks 6–7). `WebConfigStore.setCredentialDisabled`/`setProviderDisabled` (Task 4) are the methods Task 7 calls. Consistent.

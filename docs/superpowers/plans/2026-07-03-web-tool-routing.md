# Cooldown-Aware Multi-Key Web-Fetch Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `WebFetch` through an ordered, cooldown-aware chain of provider keys (all Firecrawl keys → a free plain-fetch floor) with a persisted circuit-breaker, and compose the DeepSeek-V4-flash summarizer at the daemon root.

**Architecture:** A generic, pure routing core (`ProviderOutcome` + `runChain`) walks an ordered list of `{ run, keyStateId }` entries, skipping any key still cooling down in a persisted `KeyStateStore` (`~/.coa/web-keys.json`), marking a cooldown on a `limit` outcome, and returning the first `ok` value with its `clean` flag. Two `FetchProvider` adapters — `firecrawl` (clean markdown) and `plainFetch` (free floor, turndown, never `limit`) — feed the chain. The `WebFetch` handler is refactored from `fetch + htmlToMarkdown + summarizer` deps to a single routed `fetchChain`: clean content is returned as-is; non-clean content runs the optional summarizer.

**Tech Stack:** TypeScript (strict), Zod (edge validation), `turndown` (HTML→markdown), Vitest (mock-first), `@coa/loop-driver` + `@coa/adapter-deepseek` (the summarizer's `complete()` primitive), `better-sqlite3`/`node:fs` (JSON state file).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec + constitution.

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is ON — spread-guard optional fields: `...(x !== undefined ? { x } : {})`. Never assign `undefined` to an optional property.
- **SC-1** — tools never throw and never deny. Provider failures become classified `ProviderOutcome`s the router handles; a fully-exhausted chain returns an unapplied result, never a throw.
- **Strict-superset (D85)** — the free plain-fetch floor is always the last hop. Absent `web.fetch` config ⇒ `WebFetch` behaves exactly as today (plain fetch + turndown + optional summarizer).
- **Credential-blind** — config stores locator *pointers* (env-var NAME / file path), never secrets; the cooldown store keys on the pointer identity `` `${providerKind}:${locatorId}` ``, never the secret. Resolve secrets at runtime.
- **Determinism-first (P1)** — `runChain` and the cooldown logic are pure/deterministic; the only model call is the optional summarizer, off the critical path.
- Web tools emit **NO M1 change-event** (egress, not worktree mutation) — `wrap(...)` with no `emit()`.
- **Reuse** the shared `locatorSchema`/`Locator` from `@coa/shared` — never duplicate it.
- **Firecrawl API (verified against docs 2026-07-03):** `POST https://api.firecrawl.dev/v2/scrape`, header `Authorization: Bearer <key>`, body `{ "url": <url>, "formats": ["markdown"] }`. Success `200` → `{ success: true, data: { markdown, metadata } }` (markdown at `data.markdown`). `429` = rate-limit; `402` = credits/quota exhausted. A `Retry-After` header is not documented — parse it if present, otherwise treat the limit as ambiguous (next-midnight cooldown).
- **DeepSeek V4 flash model id stays config-driven** — the user supplies it; never hardcode a model id.
- Commits: **subject-only Conventional Commits** — no body, no `Co-Authored-By`/"Generated with" trailer, no project-internal identifiers (no phase/module codes) in the subject.
- **Stage files BY NAME** (`git add <path> ...`) — NEVER `git add -A` / `git add .`. The branch carries ~29 modified + ~12 untracked UNRELATED WIP files (mostly `apps/desktop/`, `packages/console-ui/`) — never touch, stage, or revert them.
- Tests: `pnpm --filter @coa/core test -- <pattern>`. Before committing an integration task (Tasks 5–6), run the full `@coa/core` suite (`pnpm --filter @coa/core test`) **and** `pnpm --filter @coa/core exec tsc -b` once. Two pre-existing failing tests in `apps/desktop/src/renderer/console.test.tsx` belong to unrelated WIP — ignore them; they are not `@coa/core`.

---

## File Structure

**New files (all under `packages/core/src/workbench/web/`):**
- `routing.ts` — the generic routing core: `ProviderOutcome<T>`, `CooldownStore`, `ChainEntry<T>`, `ChainResult<T>`, `runChain`, `nextLocalMidnight`. Pure; reused by search in increment 2.
- `key-state-store.ts` — `KeyStateStore` (persisted `~/.coa/web-keys.json`, implements `CooldownStore`), `webKeysPath`, `locatorId`.
- `firecrawl.ts` — `makeFirecrawlFetch` → `FetchProvider` (clean markdown).
- `plain-fetch.ts` — `makePlainFetch` → `FetchProvider` (free floor; turndown; never `limit`).

**Modified files:**
- `packages/core/src/workbench/web-tools.ts` — add `FetchProvider` + `RoutedFetch` ports; refactor the `webFetch` handler and `WebToolDeps`/`webToolSpecs` from `fetch`/`htmlToMarkdown` to a routed `fetchChain`; delete the now-dead `FetchLike`/`HtmlToMarkdown` types.
- `packages/core/src/workbench/web/web-config.ts` — extend the schema with the `fetch` block; assemble the routed chain + `KeyStateStore`; decouple the web-tool offering from the search key (search degrades to an inert null provider without a key).
- `packages/core/src/session/daemon.ts` — compose the DeepSeek summarizer from `web.fetch.summarizer` and bind its cost to the ledger.
- `packages/core/package.json` — add `@coa/adapter-deepseek` (workspace dep for the summarizer's `complete()` primitive).
- `docs/REPO_LAYOUT.md` — note the fetch-routing files + the new `@coa/core → @coa/adapter-deepseek` dependency.

**Test files (created/modified):** `routing.test.ts`, `key-state-store.test.ts`, `firecrawl.test.ts`, `plain-fetch.test.ts` (new); `web-tools.test.ts`, `web/web-config.test.ts`, `governed-tools.test.ts`, `session/daemon.test.ts`, `web/web-tools.smoke.test.ts` (modified).

---

## Task 1: Routing core (`ProviderOutcome` + `runChain`)

**Files:**
- Create: `packages/core/src/workbench/web/routing.ts`
- Test: `packages/core/src/workbench/web/routing.test.ts`

**Interfaces:**
- Consumes: nothing (pure; leaf module).
- Produces:
  - `type ProviderOutcome<T> = { status: 'ok'; value: T; clean: boolean } | { status: 'limit'; kind: 'rate-limit' | 'quota'; retryAfterMs?: number } | { status: 'error'; reason: string }`
  - `interface CooldownStore { isCoolingDown(id: string, now: number): boolean; markCooldown(id: string, until: number): void; clear(id: string): void }`
  - `interface ChainEntry<T> { run: () => Promise<ProviderOutcome<T>>; keyStateId: string }`
  - `type ChainResult<T> = { status: 'ok'; value: T; clean: boolean } | { status: 'exhausted'; lastReason?: string }`
  - `function nextLocalMidnight(now: number): number`
  - `function runChain<T>(entries: readonly ChainEntry<T>[], store: CooldownStore, now: number, quotaCooldownUntil: (now: number) => number): Promise<ChainResult<T>>`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/web/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  runChain,
  nextLocalMidnight,
  type ChainEntry,
  type CooldownStore,
  type ProviderOutcome,
} from './routing.js';

/** An in-memory CooldownStore that records calls, for deterministic routing tests. */
function fakeStore(seed: Record<string, number> = {}): CooldownStore & {
  marks: Array<{ id: string; until: number }>;
  cleared: string[];
} {
  const cooldowns = { ...seed };
  const marks: Array<{ id: string; until: number }> = [];
  const cleared: string[] = [];
  return {
    marks,
    cleared,
    isCoolingDown: (id, now) => cooldowns[id] !== undefined && cooldowns[id]! > now,
    markCooldown: (id, until) => {
      cooldowns[id] = until;
      marks.push({ id, until });
    },
    clear: (id) => {
      delete cooldowns[id];
      cleared.push(id);
    },
  };
}

const entry = (keyStateId: string, outcome: ProviderOutcome<string>): ChainEntry<string> => ({
  keyStateId,
  run: async () => outcome,
});

const MIDNIGHT = (now: number) => now + 1_000_000; // deterministic stand-in for the quota cooldown

describe('runChain', () => {
  it('returns the first ok value with its clean flag and clears its prior cooldown', async () => {
    const store = fakeStore();
    const res = await runChain(
      [entry('a', { status: 'ok', value: 'first', clean: true })],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toEqual({ status: 'ok', value: 'first', clean: true });
    expect(store.cleared).toEqual(['a']);
  });

  it('falls through in order to the next live entry', async () => {
    const store = fakeStore();
    const res = await runChain(
      [
        entry('a', { status: 'error', reason: 'boom' }),
        entry('b', { status: 'ok', value: 'second', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toMatchObject({ status: 'ok', value: 'second', clean: false });
  });

  it('skips an entry that is still cooling down', async () => {
    const store = fakeStore({ a: 100 });
    let ran = false;
    const res = await runChain(
      [
        { keyStateId: 'a', run: async () => { ran = true; return { status: 'ok', value: 'x', clean: true }; } },
        entry('b', { status: 'ok', value: 'floor', clean: false }),
      ],
      store,
      50, // now < 100 ⇒ 'a' is cooling down
      MIDNIGHT,
    );
    expect(ran).toBe(false);
    expect(res).toMatchObject({ status: 'ok', value: 'floor' });
  });

  it('on a rate-limit with retryAfterMs, cools down until now + retryAfterMs then continues', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'limit', kind: 'rate-limit', retryAfterMs: 5000 }),
        entry('b', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      1000,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([{ id: 'a', until: 6000 }]);
  });

  it('on a quota limit (or a rate-limit with no retryAfterMs), cools down to the quota deadline', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'limit', kind: 'quota' }),
        entry('b', { status: 'limit', kind: 'rate-limit' }), // no retryAfterMs ⇒ ambiguous ⇒ quota deadline
        entry('c', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([{ id: 'a', until: 1_000_000 }, { id: 'b', until: 1_000_000 }]);
  });

  it('on an error, tries the next entry WITHOUT setting a cooldown', async () => {
    const store = fakeStore();
    await runChain(
      [
        entry('a', { status: 'error', reason: 'net' }),
        entry('b', { status: 'ok', value: 'ok', clean: false }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(store.marks).toEqual([]);
  });

  it('returns exhausted with the last reason when every entry is exhausted', async () => {
    const store = fakeStore();
    const res = await runChain(
      [
        entry('a', { status: 'limit', kind: 'quota' }),
        entry('b', { status: 'error', reason: 'dead-url' }),
      ],
      store,
      0,
      MIDNIGHT,
    );
    expect(res).toEqual({ status: 'exhausted', lastReason: 'dead-url' });
  });
});

describe('nextLocalMidnight', () => {
  it('returns the next local midnight strictly after now', () => {
    const now = new Date(2026, 6, 3, 14, 30, 0).getTime(); // 2026-07-03 14:30 local
    const midnight = nextLocalMidnight(now);
    const d = new Date(midnight);
    expect(midnight).toBeGreaterThan(now);
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- routing`
Expected: FAIL — `Cannot find module './routing.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/workbench/web/routing.ts`:

```ts
/**
 * The generic, deterministic web-provider routing core (P1). A chain walks an
 * ordered list of keyed entries, skips any key still cooling down in a persisted
 * circuit-breaker, marks a cooldown on a `limit`, and returns the first `ok`
 * value. Value-generic, so the fetch side (this increment) and the search side
 * (increment 2) share it. No provider/HTTP specifics leak in — adapters map their
 * own responses to a {@link ProviderOutcome}.
 */

/** An adapter's classified result — never a throw (SC-1). `clean` = already extracted/summarized. */
export type ProviderOutcome<T> =
  | { status: 'ok'; value: T; clean: boolean }
  | { status: 'limit'; kind: 'rate-limit' | 'quota'; retryAfterMs?: number }
  | { status: 'error'; reason: string };

/** The persisted circuit-breaker surface {@link runChain} depends on (real impl: KeyStateStore). */
export interface CooldownStore {
  isCoolingDown(id: string, now: number): boolean;
  markCooldown(id: string, until: number): void;
  clear(id: string): void;
}

/** One ordered chain hop: a keyed, no-throw run producing a {@link ProviderOutcome}. */
export interface ChainEntry<T> {
  run: () => Promise<ProviderOutcome<T>>;
  keyStateId: string;
}

/** The chain's result: the first `ok`, or a miss carrying the last failure reason for surfacing. */
export type ChainResult<T> =
  | { status: 'ok'; value: T; clean: boolean }
  | { status: 'exhausted'; lastReason?: string };

/** The next local midnight strictly after `now` — the default cooldown for quota/ambiguous limits. */
export function nextLocalMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0); // rolls to 00:00 of the following local day
  return d.getTime();
}

/**
 * Walk `entries` in priority order: skip any still cooling down; run the next live
 * one; on `limit` compute a cooldown (`rate-limit` + `retryAfterMs` → `now +
 * retryAfterMs`; `quota` or an ambiguous rate-limit → `quotaCooldownUntil(now)`)
 * and continue; on `error` continue with no cooldown; on `ok` clear that key's
 * cooldown and return. All exhausted ⇒ a miss with the last reason (SC-1). Pure
 * but for the injected store's side effects and the entries' own runs.
 */
export async function runChain<T>(
  entries: readonly ChainEntry<T>[],
  store: CooldownStore,
  now: number,
  quotaCooldownUntil: (now: number) => number,
): Promise<ChainResult<T>> {
  let lastReason: string | undefined;
  for (const entry of entries) {
    if (store.isCoolingDown(entry.keyStateId, now)) continue;
    const outcome = await entry.run();
    if (outcome.status === 'ok') {
      store.clear(entry.keyStateId);
      return { status: 'ok', value: outcome.value, clean: outcome.clean };
    }
    if (outcome.status === 'limit') {
      const until =
        outcome.kind === 'rate-limit' && outcome.retryAfterMs !== undefined
          ? now + outcome.retryAfterMs
          : quotaCooldownUntil(now);
      store.markCooldown(entry.keyStateId, until);
      lastReason = `limit:${outcome.kind}`;
      continue;
    }
    lastReason = outcome.reason;
  }
  return { status: 'exhausted', ...(lastReason !== undefined ? { lastReason } : {}) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- routing`
Expected: PASS (all `runChain` + `nextLocalMidnight` cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/routing.ts packages/core/src/workbench/web/routing.test.ts
git commit -m "feat: add cooldown-aware web-provider routing core"
```

---

## Task 2: Persisted `KeyStateStore`

**Files:**
- Create: `packages/core/src/workbench/web/key-state-store.ts`
- Test: `packages/core/src/workbench/web/key-state-store.test.ts`

**Interfaces:**
- Consumes: `CooldownStore` from `./routing.js`; `Locator` from `@coa/shared`.
- Produces:
  - `function webKeysPath(home: string): string`
  - `function locatorId(locator: Locator): string`
  - `interface KeyStateStoreDeps { readFile: (path: string) => string; writeFile: (path: string, data: string) => void }`
  - `class KeyStateStore implements CooldownStore { constructor(home: string, deps?: Partial<KeyStateStoreDeps>); isCoolingDown; markCooldown; clear }`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/web/key-state-store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { KeyStateStore, webKeysPath, locatorId } from './key-state-store.js';

/** An in-memory fs so the store roundtrips with no disk (injected read/write). */
function memFs(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(webKeysPath('/home'), initial);
  return {
    files,
    readFile: (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: (p: string, d: string) => {
      files.set(p, d);
    },
  };
}

describe('locatorId', () => {
  it('keys on the pointer identity, never the secret', () => {
    expect(locatorId({ type: 'env-var', name: 'FIRECRAWL_KEY_1' })).toBe('FIRECRAWL_KEY_1');
    expect(locatorId({ type: 'key-file', path: '/k/f.key' })).toBe('/k/f.key');
    expect(locatorId({ type: 'config-dir', dir: '/c/d' })).toBe('/c/d');
    expect(locatorId({ type: 'ambient' })).toBe('ambient');
  });
});

describe('KeyStateStore', () => {
  it('roundtrips a cooldown to and from JSON via the injected fs', () => {
    const fs = memFs();
    const store = new KeyStateStore('/home', fs);
    store.markCooldown('firecrawl:FIRECRAWL_KEY_1', 5000);
    // A fresh instance over the same fs reads it back — the state is persisted, not in-memory.
    const reopened = new KeyStateStore('/home', fs);
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 4999)).toBe(true);
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 5000)).toBe(false); // expiry is exclusive
    expect(reopened.isCoolingDown('firecrawl:FIRECRAWL_KEY_1', 6000)).toBe(false);
  });

  it('clear removes a cooldown', () => {
    const fs = memFs();
    const store = new KeyStateStore('/home', fs);
    store.markCooldown('a', 5000);
    store.clear('a');
    expect(store.isCoolingDown('a', 1)).toBe(false);
  });

  it('is credential-blind: the written file contains only pointer ids + timestamps', () => {
    const fs = memFs();
    new KeyStateStore('/home', fs).markCooldown('firecrawl:FIRECRAWL_KEY_1', 42);
    const written = fs.files.get(webKeysPath('/home'))!;
    expect(written).toContain('FIRECRAWL_KEY_1');
    expect(written).not.toContain('fc-secret'); // no secret ever reaches the file
  });

  it('never throws on a missing file — treats it as no cooldowns', () => {
    const store = new KeyStateStore('/home', memFs());
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });

  it('never throws on a corrupt file — treats it as empty', () => {
    const store = new KeyStateStore('/home', memFs('{ not json'));
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });

  it('drops an unknown/invalid shape and returns empty (drop-unknown, never-throw)', () => {
    const store = new KeyStateStore('/home', memFs('{"cooldowns":"not-an-object"}'));
    expect(store.isCoolingDown('anything', 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- key-state-store`
Expected: FAIL — `Cannot find module './key-state-store.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/workbench/web/key-state-store.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Locator } from '@coa/shared';
import type { CooldownStore } from './routing.js';

/**
 * The persisted web-key circuit-breaker (implements {@link CooldownStore}). A
 * versioned JSON file of credential-blind cooldowns under `~/.coa/web-keys.json`,
 * mirroring the `AccountsRegistry` homedir pattern. It stores only pointer ids
 * (`${providerKind}:${locatorId}`) → `cooldownUntil` epoch-ms — never a secret.
 * fs is injectable for tests; load is drop-unknown / never-throw.
 */

/** The user-global cooldown-store path. `home` is injectable so tests run over a temp dir. */
export function webKeysPath(home: string): string {
  return join(home, '.coa', 'web-keys.json');
}

/** The credential-blind identity of a locator (env-var NAME / file path / dir), never the secret. */
export function locatorId(locator: Locator): string {
  switch (locator.type) {
    case 'env-var':
      return locator.name;
    case 'key-file':
      return locator.path;
    case 'config-dir':
      return locator.dir;
    case 'ambient':
      return 'ambient';
  }
}

const webKeysFileSchema = z
  .object({
    version: z.literal(1).default(1),
    cooldowns: z.record(z.string(), z.number()).default({}),
  })
  .strip();
type WebKeysFile = z.infer<typeof webKeysFileSchema>;

const EMPTY: WebKeysFile = { version: 1, cooldowns: {} };

export interface KeyStateStoreDeps {
  readFile: (path: string) => string;
  writeFile: (path: string, data: string) => void;
}

export class KeyStateStore implements CooldownStore {
  readonly #path: string;
  readonly #readFile: (path: string) => string;
  readonly #writeFile: (path: string, data: string) => void;

  constructor(home: string, deps?: Partial<KeyStateStoreDeps>) {
    this.#path = webKeysPath(home);
    this.#readFile = deps?.readFile ?? ((p) => readFileSync(p, 'utf8'));
    this.#writeFile =
      deps?.writeFile ??
      ((p, d) => {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, d, { encoding: 'utf8', mode: 0o600 });
      });
  }

  isCoolingDown(id: string, now: number): boolean {
    const until = this.#read().cooldowns[id];
    return until !== undefined && until > now;
  }

  markCooldown(id: string, until: number): void {
    const file = this.#read();
    file.cooldowns[id] = until;
    this.#write(file);
  }

  clear(id: string): void {
    const file = this.#read();
    if (file.cooldowns[id] === undefined) return;
    delete file.cooldowns[id];
    this.#write(file);
  }

  #read(): WebKeysFile {
    let raw: unknown;
    try {
      raw = JSON.parse(this.#readFile(this.#path));
    } catch {
      return structuredClone(EMPTY);
    }
    const parsed = webKeysFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : structuredClone(EMPTY);
  }

  #write(file: WebKeysFile): void {
    this.#writeFile(this.#path, JSON.stringify(file, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- key-state-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/key-state-store.ts packages/core/src/workbench/web/key-state-store.test.ts
git commit -m "feat: persist credential-blind web-key cooldowns"
```

---

## Task 3: `FetchProvider` port + Firecrawl adapter

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts` (add the `FetchProvider` + `RoutedFetch` type exports only — additive, no behavior change yet)
- Create: `packages/core/src/workbench/web/firecrawl.ts`
- Test: `packages/core/src/workbench/web/firecrawl.test.ts`

**Interfaces:**
- Consumes: `ProviderOutcome`, `ChainResult` from `./web/routing.js`.
- Produces:
  - In `web-tools.ts`: `interface FetchProvider { fetch(url: string): Promise<ProviderOutcome<string>> }` and `type RoutedFetch = (url: string) => Promise<ChainResult<string>>`.
  - In `firecrawl.ts`: `function makeFirecrawlFetch(config: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): FetchProvider`.

- [ ] **Step 1: Add the port types to `web-tools.ts`**

In `packages/core/src/workbench/web-tools.ts`, add an import at the top (after the existing imports):

```ts
import type { ProviderOutcome, ChainResult } from './web/routing.js';
```

Then, immediately after the `Summarizer` interface (around line 69), add:

```ts
/** A routed fetch provider — a keyed hop in the {@link RoutedFetch} chain (no-lock-in seam). */
export interface FetchProvider {
  fetch(url: string): Promise<ProviderOutcome<string>>;
}

/** The assembled, cooldown-aware fetch chain the WebFetch handler runs (built in web-config). */
export type RoutedFetch = (url: string) => Promise<ChainResult<string>>;
```

(Leave the existing `FetchLike`/`HtmlToMarkdown`/`webFetch`/`WebToolDeps` untouched for now — they are refactored in Task 5. This step is additive so the package still compiles.)

- [ ] **Step 2: Write the failing test**

Create `packages/core/src/workbench/web/firecrawl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeFirecrawlFetch } from './firecrawl.js';

/** A fake `fetch` returning a Response-like shape (cast to satisfy `typeof fetch`). */
function fakeFetch(res: {
  ok?: boolean;
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
}): typeof fetch {
  const headers = res.headers ?? {};
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => res.json ?? {},
    text: async () => JSON.stringify(res.json ?? {}),
  })) as unknown as typeof fetch;
}

describe('makeFirecrawlFetch', () => {
  it('maps a 200 with data.markdown to an ok, clean outcome', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'fc-secret',
      fetchImpl: fakeFetch({ status: 200, json: { success: true, data: { markdown: '# Hi' } } }),
    });
    const outcome = await provider.fetch('https://x.test');
    expect(outcome).toEqual({ status: 'ok', value: '# Hi', clean: true });
  });

  it('sends the scrape request to /v2/scrape with a Bearer key and markdown format', async () => {
    let capturedUrl = '';
    let capturedInit: { method?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (url: string, init: typeof capturedInit) => {
      capturedUrl = url;
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ success: true, data: { markdown: 'md' } }),
        text: async () => '',
      };
    }) as unknown as typeof fetch;
    await makeFirecrawlFetch({ apiKey: 'fc-secret', fetchImpl }).fetch('https://x.test');
    expect(capturedUrl).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(capturedInit.method).toBe('POST');
    expect(capturedInit.headers?.authorization).toBe('Bearer fc-secret');
    expect(JSON.parse(capturedInit.body!)).toEqual({ url: 'https://x.test', formats: ['markdown'] });
  });

  it('maps 429 to a rate-limit, reading Retry-After seconds into retryAfterMs', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 429, headers: { 'retry-after': '30' } }),
    });
    expect(await provider.fetch('https://x.test')).toEqual({
      status: 'limit',
      kind: 'rate-limit',
      retryAfterMs: 30_000,
    });
  });

  it('maps 429 with no Retry-After to a rate-limit with no retryAfterMs (ambiguous)', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'limit', kind: 'rate-limit' });
  });

  it('maps 402 to a quota limit', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 402 }) });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('maps another non-ok status to an error', async () => {
    const provider = makeFirecrawlFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 500 }) });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'error', reason: 'firecrawl-http-500' });
  });

  it('maps a malformed/empty body to an error', async () => {
    const provider = makeFirecrawlFetch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 200, json: { success: true, data: {} } }),
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('SC-1: a fetch throw becomes an error outcome, never a throw', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    const outcome = await makeFirecrawlFetch({ apiKey: 'k', fetchImpl }).fetch('https://x.test');
    expect(outcome).toMatchObject({ status: 'error' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- firecrawl`
Expected: FAIL — `Cannot find module './firecrawl.js'`.

- [ ] **Step 4: Write the implementation**

Create `packages/core/src/workbench/web/firecrawl.ts`:

```ts
import { z } from 'zod';
import type { FetchProvider } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

/**
 * The Firecrawl scrape adapter — a thin HTTP call to `POST /v2/scrape`, mapping the
 * response to a {@link ProviderOutcome}: a 200 → clean markdown; a 429 → rate-limit
 * (reading `Retry-After` seconds if present); a 402 → quota; anything else → error.
 * Injectable `fetchImpl`; credential-blind (the key is passed in). Never throws (SC-1).
 */
const DEFAULT_BASE_URL = 'https://api.firecrawl.dev';

const firecrawlResponseSchema = z.object({
  success: z.boolean().default(false),
  data: z.object({ markdown: z.string() }).partial().optional(),
});

export function makeFirecrawlFetch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): FetchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(`${baseUrl}/v2/scrape`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ url, formats: ['markdown'] }),
        });
        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          return { status: 'limit', kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
        }
        if (res.status === 402) return { status: 'limit', kind: 'quota' };
        if (!res.ok) return { status: 'error', reason: `firecrawl-http-${res.status}` };
        const parsed = firecrawlResponseSchema.safeParse(await res.json());
        const markdown = parsed.success ? parsed.data.data?.markdown : undefined;
        if (markdown === undefined || markdown === '') {
          return { status: 'error', reason: 'firecrawl-empty-body' };
        }
        return { status: 'ok', value: markdown, clean: true };
      } catch (err) {
        return { status: 'error', reason: `firecrawl-throw: ${String(err)}` };
      }
    },
  };
}

/** Parse a `Retry-After` header (delta-seconds) into milliseconds; `null`/invalid ⇒ `undefined`. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- firecrawl`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web/firecrawl.ts packages/core/src/workbench/web/firecrawl.test.ts
git commit -m "feat: add a firecrawl fetch provider"
```

---

## Task 4: Plain-fetch free-floor provider

**Files:**
- Create: `packages/core/src/workbench/web/plain-fetch.ts`
- Test: `packages/core/src/workbench/web/plain-fetch.test.ts`

**Interfaces:**
- Consumes: `FetchProvider` from `../web-tools.js`; `ProviderOutcome` from `./routing.js`.
- Produces: `function makePlainFetch(deps?: { fetchImpl?: typeof fetch; htmlToMarkdown?: (html: string) => string }): FetchProvider`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/web/plain-fetch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makePlainFetch } from './plain-fetch.js';

function fakeFetch(res: { ok?: boolean; status: number; contentType?: string; body?: string }): typeof fetch {
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? res.contentType ?? '' : null) },
    text: async () => res.body ?? '',
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

const stripTags = (html: string) => html.replace(/<[^>]+>/g, '').trim();

describe('makePlainFetch', () => {
  it('fetches html and returns non-clean markdown', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'text/html', body: '<p>hello</p>' }),
      htmlToMarkdown: stripTags,
    });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'ok', value: 'hello', clean: false });
  });

  it('accepts text/plain content', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'text/plain', body: 'raw' }),
      htmlToMarkdown: (s) => s,
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'ok', clean: false });
  });

  it('never returns a limit — a non-ok status is an error', async () => {
    const provider = makePlainFetch({ fetchImpl: fakeFetch({ status: 404 }), htmlToMarkdown: stripTags });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'error', reason: 'http-404' });
  });

  it('rejects an unsupported content type as an error', async () => {
    const provider = makePlainFetch({
      fetchImpl: fakeFetch({ status: 200, contentType: 'application/octet-stream', body: 'bin' }),
      htmlToMarkdown: stripTags,
    });
    expect(await provider.fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('SC-1: a fetch throw becomes an error outcome', async () => {
    const fetchImpl = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    expect(await makePlainFetch({ fetchImpl }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- plain-fetch`
Expected: FAIL — `Cannot find module './plain-fetch.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/workbench/web/plain-fetch.ts`:

```ts
import TurndownService from 'turndown';
import type { FetchProvider } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

/**
 * The free plain-fetch floor (D85): global `fetch` + turndown, repackaged as a
 * {@link FetchProvider}. This is the always-last hop, so WebFetch can never fully
 * fail. It returns `clean: false` (the summarizer runs over it) and NEVER a
 * `limit` — an unkeyed public fetch has no quota to trip. Never throws (SC-1).
 */
const turndownService = new TurndownService();

export function makePlainFetch(deps?: {
  fetchImpl?: typeof fetch;
  htmlToMarkdown?: (html: string) => string;
}): FetchProvider {
  const doFetch = deps?.fetchImpl ?? fetch;
  const toMarkdown = deps?.htmlToMarkdown ?? ((html) => turndownService.turndown(html));
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(url);
        if (!res.ok) return { status: 'error', reason: `http-${res.status}` };
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('html') && !contentType.includes('text/plain')) {
          return { status: 'error', reason: `unsupported-content-type: ${contentType}` };
        }
        return { status: 'ok', value: toMarkdown(await res.text()), clean: false };
      } catch (err) {
        return { status: 'error', reason: `fetch-failed: ${String(err)}` };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- plain-fetch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/plain-fetch.ts packages/core/src/workbench/web/plain-fetch.test.ts
git commit -m "feat: add a plain-fetch free-floor provider"
```

---

## Task 5: Route `WebFetch` through the chain (handler + config refactor)

This is the one breaking refactor: it swaps `WebToolDeps.fetch`/`htmlToMarkdown` for a routed `fetchChain`, and decouples the web-tool offering from the search key. Because these are one coherent change, the handler, the config builder, and all four affected test files land together so the package compiles at the end.

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts` (refactor `webFetch`, `WebToolDeps`, `webToolSpecs`; delete `FetchLike`/`HtmlToMarkdown`)
- Modify: `packages/core/src/workbench/web/web-config.ts` (schema `fetch` block; assemble the chain; decouple search)
- Modify: `packages/core/src/workbench/web-tools.test.ts`
- Modify: `packages/core/src/workbench/web/web-config.test.ts`
- Modify: `packages/core/src/workbench/governed-tools.test.ts` (the `webDeps()` helper)
- Modify: `packages/core/src/session/daemon.test.ts` (the web-offering assertions)

**Interfaces:**
- Consumes: `FetchProvider`, `RoutedFetch` (Task 3); `runChain`, `nextLocalMidnight`, `ChainEntry` (Task 1); `KeyStateStore`, `locatorId` (Task 2); `makeFirecrawlFetch` (Task 3); `makePlainFetch` (Task 4); `locatorSchema`, `Locator` (`@coa/shared`).
- Produces:
  - `web-tools.ts`: `webFetch(req, deps: { fetchChain: RoutedFetch; summarizer?: Summarizer; maxChars?: number })`; `interface WebToolDeps { search: SearchProvider; fetchChain: RoutedFetch; summarizer?: Summarizer }`.
  - `web-config.ts`: `type WebFetchConfig`; `buildWebToolDeps(config: WebConfig, env: Record<string, string | undefined>, opts?: { summarizer?: Summarizer; home?: string; now?: () => number; store?: CooldownStore }): WebToolDeps` (now always returns a value — the free floor guarantees a chain).

- [ ] **Step 1: Rewrite the `webFetch` handler + deps in `web-tools.ts`**

In `packages/core/src/workbench/web-tools.ts`:

1. Delete the `FetchLike` type (lines ~55–61) and the `HtmlToMarkdown` type (lines ~63–64) — they are superseded by `FetchProvider`/`plainFetch`.
2. Replace the entire `webFetch` function (the `const DEFAULT_MAX_CHARS` through the end of `webFetch`, lines ~75–105) with:

```ts
const DEFAULT_MAX_CHARS = 100_000;

/**
 * `WebFetch` — mirrors Claude's args (url + prompt). Runs the routed {@link RoutedFetch}
 * chain, then: on `exhausted` (only possible with the free floor off) → an SC-1 unapplied
 * result; on `ok` clean content (Firecrawl) → return as-is, SKIPPING the summarizer; on `ok`
 * non-clean content (free floor) → summarize if configured, else the capped markdown. The
 * up-front `maxChars` cap bounds both the summarizer input and the returned markdown (SC-1).
 */
export async function webFetch(
  req: { url: string; prompt: string },
  deps: { fetchChain: RoutedFetch; summarizer?: Summarizer; maxChars?: number },
): Promise<ToolResponse<WebFetchResult>> {
  const result = await deps.fetchChain(req.url);
  if (result.status === 'exhausted') {
    return wrap(
      { fetched: false, reason: result.lastReason ?? 'no-provider-succeeded' },
      'web_fetch:error',
      req.url,
    );
  }
  const cap = deps.maxChars ?? DEFAULT_MAX_CHARS;
  const markdown = result.value.slice(0, cap);
  if (!result.clean && deps.summarizer) {
    try {
      const content = await deps.summarizer.summarize({ markdown, prompt: req.prompt });
      return wrap({ fetched: true, content, summarized: true }, `web_fetch:${req.url}`, req.url);
    } catch {
      // Summarizer failure degrades to raw markdown rather than failing the fetch (D85 / SC-1).
    }
  }
  return wrap({ fetched: true, content: markdown, summarized: false }, `web_fetch:${req.url}`, req.url);
}
```

3. Replace the `WebToolDeps` interface (lines ~107–113) with:

```ts
/** The pure-API web-tool ports; present only when the adapter wires egress. */
export interface WebToolDeps {
  search: SearchProvider;
  fetchChain: RoutedFetch;
  summarizer?: Summarizer;
}
```

4. In `webToolSpecs`, replace the `WebFetch` spec (lines ~145–152) with:

```ts
    WebFetch: spec({ url: z.string(), prompt: z.string() }, (a, d: GovernedToolDeps) => {
      const wd = w(d);
      return webFetch(a, {
        fetchChain: wd.fetchChain,
        ...(wd.summarizer ? { summarizer: wd.summarizer } : {}),
      });
    }),
```

- [ ] **Step 2: Rewrite `web-config.ts`**

Replace the entire contents of `packages/core/src/workbench/web/web-config.ts` with:

```ts
import { z } from 'zod';
import { homedir } from 'node:os';
import { locatorSchema, type Locator } from '@coa/shared';
import type {
  FetchProvider,
  RoutedFetch,
  SearchProvider,
  Summarizer,
  WebToolDeps,
} from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch } from './firecrawl.js';
import { makePlainFetch } from './plain-fetch.js';
import { runChain, nextLocalMidnight, type ChainEntry, type CooldownStore } from './routing.js';
import { KeyStateStore, locatorId } from './key-state-store.js';

/**
 * The web-egress config: the (increment-2) search provider + the fetch-routing block.
 * Reuses the shared account {@link Locator} (M0) for every credential pointer — one
 * credential-blind schema for the whole system. `.strip()` + Zod-validated at the edge.
 */
const firecrawlProviderSchema = z.object({
  kind: z.literal('firecrawl'),
  credentials: z.array(locatorSchema).default([]),
});

const fetchConfigSchema = z
  .object({
    providers: z.array(firecrawlProviderSchema).default([]),
    freeFloor: z.boolean().default(true),
    summarizer: z
      .object({
        provider: z.literal('deepseek'),
        model: z.string().min(1),
        credential: locatorSchema,
      })
      .optional(),
    quotaCooldown: z.union([z.literal('next-midnight'), z.number().positive()]).default('next-midnight'),
  })
  .strip();

export const webConfigSchema = z
  .object({
    // Search side (unrouted; increment 2 routes it). Optional so a fetch-only config validates.
    provider: z.enum(['parallel', 'exa', 'tavily', 'brave']).default('parallel'),
    credential: locatorSchema.optional(),
    summarizerModel: z.object({ provider: z.string(), model: z.string() }).optional(),
    // Fetch side (this increment): the routed provider chain + summarizer default.
    fetch: fetchConfigSchema.optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;
export type WebFetchConfig = z.infer<typeof fetchConfigSchema>;

/** Resolve an env-var locator; other locator kinds resolve to `undefined` (env-only for now). */
function resolveKey(locator: Locator, env: Record<string, string | undefined>): string | undefined {
  if (locator.type === 'env-var') {
    const value = env[locator.name];
    return value !== undefined && value !== '' ? value : undefined;
  }
  return undefined;
}

/** A no-op search provider — WebSearch stays registered but inert until a key is configured (SC-1). */
const NULL_SEARCH: SearchProvider = { search: async () => [] };

function buildSearch(config: WebConfig, env: Record<string, string | undefined>): SearchProvider {
  if (config.provider !== 'parallel' || config.credential === undefined) return NULL_SEARCH;
  const apiKey = resolveKey(config.credential, env);
  return apiKey !== undefined ? makeParallelSearch({ apiKey }) : NULL_SEARCH;
}

/**
 * Assemble the routed fetch chain: each resolvable Firecrawl credential becomes a
 * keyed hop (`firecrawl:<locatorId>`), in priority order, followed by the free
 * plain-fetch floor (default on). An unresolvable credential is simply absent from
 * the chain. The `quotaCooldown` config resolves the deadline for quota/ambiguous
 * limits (`'next-midnight'` or an explicit duration in ms).
 */
function buildFetchChain(
  fetchCfg: WebFetchConfig | undefined,
  env: Record<string, string | undefined>,
  store: CooldownStore,
  now: () => number,
): RoutedFetch {
  const providers: Array<{ provider: FetchProvider; keyStateId: string }> = [];
  for (const provider of fetchCfg?.providers ?? []) {
    for (const cred of provider.credentials) {
      const apiKey = resolveKey(cred, env);
      if (apiKey === undefined) continue;
      providers.push({
        provider: makeFirecrawlFetch({ apiKey }),
        keyStateId: `${provider.kind}:${locatorId(cred)}`,
      });
    }
  }
  const floor =
    (fetchCfg?.freeFloor ?? true)
      ? { provider: makePlainFetch(), keyStateId: 'plain-fetch:free' }
      : undefined;
  const quotaCooldownUntil = (n: number): number => {
    const q = fetchCfg?.quotaCooldown ?? 'next-midnight';
    return q === 'next-midnight' ? nextLocalMidnight(n) : n + q;
  };
  return (url) => {
    const entries: ChainEntry<string>[] = [
      ...providers.map((p) => ({ run: () => p.provider.fetch(url), keyStateId: p.keyStateId })),
      ...(floor ? [{ run: () => floor.provider.fetch(url), keyStateId: floor.keyStateId }] : []),
    ];
    return runChain(entries, store, now(), quotaCooldownUntil);
  };
}

/**
 * Build the pure-API web-tool ports from config. The fetch chain always exists (the
 * free floor guarantees it — D85), so this always returns a {@link WebToolDeps} when
 * a `web` block is configured; WebSearch degrades to an inert provider without a key.
 * The summarizer is injected by the caller (composed at the daemon root).
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
  opts?: { summarizer?: Summarizer; home?: string; now?: () => number; store?: CooldownStore },
): WebToolDeps {
  const store = opts?.store ?? new KeyStateStore(opts?.home ?? homedir());
  const now = opts?.now ?? ((): number => Date.now());
  return {
    search: buildSearch(config, env),
    fetchChain: buildFetchChain(config.fetch, env, store, now),
    ...(opts?.summarizer ? { summarizer: opts.summarizer } : {}),
  };
}
```

- [ ] **Step 3: Rewrite the `webFetch` + registration tests in `web-tools.test.ts`**

In `packages/core/src/workbench/web-tools.test.ts`:

1. Change the import (lines 1–9) to:

```ts
import { describe, expect, it } from 'vitest';
import {
  webSearch,
  type SearchProvider,
  webFetch,
  type RoutedFetch,
  WEB_TOOL_CATALOGUE,
  webToolSpecs,
} from './web-tools.js';
```

2. Delete the `okFetch` helper (lines 15–16).
3. Replace the entire `describe('webFetch', …)` block (lines 34–91) with:

```ts
describe('webFetch', () => {
  const okChain = (value: string, clean: boolean): RoutedFetch => async () => ({
    status: 'ok',
    value,
    clean,
  });

  it('summarizes non-clean content when a Summarizer is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'what is x?' },
      { fetchChain: okChain('hello', false), summarizer: { summarize: async () => 'SUMMARY' } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'SUMMARY', summarized: true });
  });

  it('returns clean content as-is, SKIPPING the summarizer', async () => {
    let called = false;
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      {
        fetchChain: okChain('# clean markdown', true),
        summarizer: { summarize: async () => { called = true; return 'NOPE'; } },
      },
    );
    expect(called).toBe(false);
    expect(res.result).toMatchObject({ fetched: true, content: '# clean markdown', summarized: false });
  });

  it('D85: degrades to raw markdown when no summarizer is configured', async () => {
    const res = await webFetch({ url: 'https://x.test', prompt: 'p' }, { fetchChain: okChain('hello', false) });
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
  });

  it('truncates raw markdown to maxChars', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: okChain('abcdef', false), maxChars: 3 },
    );
    expect((res.result as { content: string }).content).toBe('abc');
  });

  it('caps the markdown fed to the summarizer at maxChars', async () => {
    let seen = '';
    await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      {
        fetchChain: okChain('abcdef', false),
        summarizer: { summarize: async ({ markdown }) => { seen = markdown; return 'S'; } },
        maxChars: 3,
      },
    );
    expect(seen).toBe('abc');
  });

  it('SC-1: an exhausted chain returns an unapplied result carrying the last reason', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: async () => ({ status: 'exhausted', lastReason: 'dead-url' }) },
    );
    expect(res.result).toMatchObject({ fetched: false, reason: 'dead-url' });
  });

  it('SC-1: a summarizer throw degrades to raw markdown (never throws)', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetchChain: okChain('hello', false), summarizer: { summarize: async () => { throw new Error('x'); } } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
  });
});
```

4. Replace the `'dispatches WebFetch through its spec into web deps'` test (lines 106–116) with:

```ts
  it('dispatches WebFetch through its spec into web deps', async () => {
    const specs = webToolSpecs();
    const deps = {
      web: {
        search: { search: async () => [] },
        fetchChain: async () => ({ status: 'ok', value: 'hi', clean: false }),
      },
    };
    const res = specs.WebFetch?.dispatch({ url: 'https://x.test', prompt: 'p' }, deps as never);
    await expect(Promise.resolve(res as never)).resolves.toMatchObject({ pointer: 'https://x.test' });
  });
```

- [ ] **Step 4: Rewrite `web-config.test.ts`**

Replace the entire contents of `packages/core/src/workbench/web/web-config.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webConfigSchema, buildWebToolDeps } from './web-config.js';
import type { CooldownStore } from './routing.js';

afterEach(() => vi.unstubAllGlobals());

const noopStore: CooldownStore = {
  isCoolingDown: () => false,
  markCooldown: () => {},
  clear: () => {},
};

describe('webConfigSchema', () => {
  it('drops unknown fields and defaults the provider to parallel', () => {
    const cfg = webConfigSchema.parse({ credential: { type: 'env-var', name: 'PARALLEL_API_KEY' }, extra: 1 });
    expect(cfg.provider).toBe('parallel');
    expect('extra' in cfg).toBe(false);
  });

  it('validates a fetch-only config (no search credential required)', () => {
    const cfg = webConfigSchema.parse({
      fetch: { providers: [{ kind: 'firecrawl', credentials: [{ type: 'env-var', name: 'FIRECRAWL_KEY_1' }] }] },
    });
    expect(cfg.credential).toBeUndefined();
    expect(cfg.fetch?.freeFloor).toBe(true); // default
    expect(cfg.fetch?.quotaCooldown).toBe('next-midnight'); // default
  });
});

describe('buildWebToolDeps', () => {
  it('always returns deps with a callable fetch chain (the free floor guarantees it)', () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(typeof deps.fetchChain).toBe('function');
    expect(deps.search).toBeDefined();
    expect(deps.summarizer).toBeUndefined();
  });

  it('free-floor plain-fetches when no provider keys resolve', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' },
      text: async () => '<p>hi</p>',
      json: async () => ({}),
    }));
    const cfg = webConfigSchema.parse({ fetch: { providers: [], freeFloor: true } });
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res).toMatchObject({ status: 'ok', clean: false });
  });

  it('marks a credential-blind cooldown id when a Firecrawl key rate-limits', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = {
      isCoolingDown: () => false,
      markCooldown: (id, until) => marks.push({ id, until }),
      clear: () => {},
    };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));
    const cfg = webConfigSchema.parse({
      fetch: {
        providers: [{ kind: 'firecrawl', credentials: [{ type: 'env-var', name: 'FIRECRAWL_KEY_1' }] }],
        freeFloor: false,
      },
    });
    const deps = buildWebToolDeps(cfg, { FIRECRAWL_KEY_1: 'fc-secret' }, { store, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('firecrawl:FIRECRAWL_KEY_1');
  });

  it('builds a real search provider when a parallel key resolves, else an inert one', () => {
    const withKey = buildWebToolDeps(
      webConfigSchema.parse({ provider: 'parallel', credential: { type: 'env-var', name: 'PARALLEL_API_KEY' } }),
      { PARALLEL_API_KEY: 'sk-123' },
      { store: noopStore, now: () => 0 },
    );
    expect(withKey.search).toBeDefined();
    const noKey = buildWebToolDeps(webConfigSchema.parse({}), {}, { store: noopStore, now: () => 0 });
    expect(noKey.search).toBeDefined(); // inert null-search, still present
  });

  it('includes the injected summarizer when provided', () => {
    const summarizer = { summarize: async () => 'summary' };
    const deps = buildWebToolDeps(webConfigSchema.parse({}), {}, { summarizer, store: noopStore, now: () => 0 });
    expect(deps.summarizer).toBe(summarizer);
  });
});
```

- [ ] **Step 5: Update the `webDeps()` helper in `governed-tools.test.ts`**

In `packages/core/src/workbench/governed-tools.test.ts`, replace the `webDeps` helper (lines 142–146) with:

```ts
  const webDeps = () => ({
    search: { search: async () => [{ title: 'T', url: 'https://x.test', snippet: 'S' }] },
    fetchChain: async () => ({ status: 'ok' as const, value: 'hi', clean: false }),
  });
```

- [ ] **Step 6: Update the web-offering assertions in `daemon.test.ts`**

In `packages/core/src/session/daemon.test.ts`, replace the third web test — `'omits WebSearch/WebFetch from baseCatalogue when the configured key does not resolve'` (lines 290–307) — with an assertion of the new decoupled behavior:

```ts
  it('offers WebFetch via the free floor even when the search key does not resolve', () => {
    const prior = process.env.MISSING_KEY_VAR;
    delete process.env.MISSING_KEY_VAR;
    try {
      handle = createDaemonCore({
        walPath: join(dir, 'log.ndjson'),
        web: { provider: 'parallel', credential: { type: 'env-var', name: 'MISSING_KEY_VAR' } },
      });
      const names = handle.core.baseCatalogue.map((t) => t.name);
      expect(names).toContain('WebFetch');
      expect(names).toContain('WebSearch'); // registered but inert without a key (SC-1)
    } finally {
      if (prior !== undefined) process.env.MISSING_KEY_VAR = prior;
    }
  });
```

(The first two web tests at lines 263 and 283 stay unchanged: a resolvable key still offers both tools; no web config still omits them.)

- [ ] **Step 7: Run the full `@coa/core` suite + typecheck**

Run: `pnpm --filter @coa/core test`
Expected: PASS (all web, governed-tools, and daemon suites green).

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: no errors. (If `tsc` flags a stray import of the deleted `FetchLike`/`HtmlToMarkdown`, grep `rg "FetchLike|HtmlToMarkdown" packages/core/src` and remove the reference.)

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web-tools.test.ts packages/core/src/workbench/web/web-config.test.ts packages/core/src/workbench/governed-tools.test.ts packages/core/src/session/daemon.test.ts
git commit -m "refactor: route web fetch through a cooldown-aware provider chain"
```

---

## Task 6: Compose the DeepSeek summarizer at the daemon root

**Files:**
- Modify: `packages/core/package.json` (add the `@coa/adapter-deepseek` workspace dep)
- Modify: `packages/core/src/session/daemon.ts` (build the summarizer from `web.fetch.summarizer`, bind cost to the ledger, pass it into `buildWebToolDeps`)
- Modify: `packages/core/src/session/daemon.test.ts` (a composition test for the summarizer path)
- Modify: `docs/REPO_LAYOUT.md` (note the fetch-routing files + the new dependency)

**Interfaces:**
- Consumes: `makeDeepSeekComplete` (`@coa/adapter-deepseek`); `makeSummarizer` (`./web/summarizer.js` — signature: `makeSummarizer(config: { complete: CompleteFn; recordCost?: (usage: RuntimeUsage) => void; systemPrompt?: string }): Summarizer`); `buildWebToolDeps` (Task 5); `Governance.record(event: Record<string, unknown>)`.
- Produces: no new exports — `buildBaseCatalogue` now composes the summarizer internally.

- [ ] **Step 1: Add the workspace dependency**

In `packages/core/package.json`, add to the `dependencies` block (keep it alphabetized among the `@coa/*` entries, after `@coa/adapter-*`/before `@coa/code-intel`):

```json
    "@coa/adapter-deepseek": "workspace:*",
```

Then relink the workspace:

Run: `pnpm install`
Expected: adds the `@coa/adapter-deepseek` symlink into `packages/core/node_modules/@coa/` with no lockfile churn beyond that link.

- [ ] **Step 2: Write the failing composition test**

In `packages/core/src/session/daemon.test.ts`, add a test inside the same `describe` block that holds the existing web tests (after the test added in Task 5):

```ts
  it('composes a DeepSeek summarizer from web.fetch.summarizer when its key resolves', () => {
    const prior = process.env.DEEPSEEK_SUMMARIZER_KEY;
    process.env.DEEPSEEK_SUMMARIZER_KEY = 'ds-secret';
    try {
      handle = createDaemonCore({
        walPath: join(dir, 'log.ndjson'),
        web: {
          provider: 'parallel',
          fetch: {
            providers: [],
            freeFloor: true,
            summarizer: {
              provider: 'deepseek',
              model: 'deepseek-chat',
              credential: { type: 'env-var', name: 'DEEPSEEK_SUMMARIZER_KEY' },
            },
            quotaCooldown: 'next-midnight',
          },
        },
      });
      // The tools are offered; the summarizer path is wired without throwing at composition.
      const names = handle.core.baseCatalogue.map((t) => t.name);
      expect(names).toContain('WebFetch');
    } finally {
      if (prior === undefined) delete process.env.DEEPSEEK_SUMMARIZER_KEY;
      else process.env.DEEPSEEK_SUMMARIZER_KEY = prior;
    }
  });
```

Run: `pnpm --filter @coa/core test -- daemon`
Expected: FAIL — the raw `web` literal (with a `fetch` block) is accepted by the loose `DaemonCoreOptions.web: WebConfig` type, but the summarizer is not yet composed; the test fails because `createDaemonCore` does not yet build one. (If the raw literal does not typecheck because `WebConfig` requires the parsed shape, wrap it: `web: webConfigSchema.parse({ … })` and import `webConfigSchema` from `../workbench/web/web-config.js` in the test.)

> NOTE for the implementer: this test primarily guards that composition does not throw and the tools are offered. Assert only what is observable from `DaemonCore` — do not reach into the summarizer instance.

- [ ] **Step 3: Wire the summarizer in `daemon.ts`**

In `packages/core/src/session/daemon.ts`:

1. Add imports near the other workbench imports (after the `buildWebToolDeps` import on line 14):

```ts
import { makeDeepSeekComplete } from '@coa/adapter-deepseek';
import { makeSummarizer } from '../workbench/web/summarizer.js';
import type { Summarizer } from '../workbench/web-tools.js';
import type { Locator } from '@coa/shared';
```

2. Replace `buildBaseCatalogue` (lines ~303–318) with:

```ts
function buildBaseCatalogue(
  kernel: ChangeKernel,
  governance: Governance,
  flags: FlagPipeline,
  options: DaemonCoreOptions,
) {
  const summarizer = options.web ? buildFetchSummarizer(options.web, governance) : undefined;
  const web = options.web
    ? buildWebToolDeps(options.web, process.env, { ...(summarizer ? { summarizer } : {}) })
    : undefined;
  return buildGovernedTools(
    {
      ...governedToolDeps(kernel, governance, flags, options.root ?? '.'),
      base: baseToolDeps(kernel, options.root ?? '.'),
      ...(web ? { web } : {}),
    },
    { includeBaseTools: true, ...(web ? { includeWebTools: true } : {}) },
  );
}

/**
 * Compose the WebFetch summarizer (§5) from `web.fetch.summarizer`: a minimal
 * `makeSummarizer` over the DeepSeek `complete()` primitive, model config-driven,
 * cost recorded to the M7 ledger. Absent config or an unresolved key ⇒ `undefined`
 * (D85 raw-markdown floor). Runs only on non-clean content (the handler decides).
 */
function buildFetchSummarizer(web: WebConfig, governance: Governance): Summarizer | undefined {
  const cfg = web.fetch?.summarizer;
  if (cfg === undefined || cfg.provider !== 'deepseek') return undefined;
  const apiKey = resolveEnvVar(cfg.credential);
  if (apiKey === undefined) return undefined;
  return makeSummarizer({
    complete: makeDeepSeekComplete({ apiKey, model: cfg.model }),
    recordCost: (usage) => governance.record({ kind: 'web_fetch_summarizer', ...usage }),
  });
}

/** Resolve an env-var locator against `process.env`; other kinds ⇒ `undefined` (env-only for now). */
function resolveEnvVar(locator: Locator): string | undefined {
  if (locator.type !== 'env-var') return undefined;
  const value = process.env[locator.name];
  return value !== undefined && value !== '' ? value : undefined;
}
```

- [ ] **Step 4: Run the daemon suite + full suite + typecheck**

Run: `pnpm --filter @coa/core test -- daemon`
Expected: PASS (the new composition test + the unchanged web tests).

Run: `pnpm --filter @coa/core test`
Expected: PASS (whole `@coa/core` suite).

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: no errors.

- [ ] **Step 5: Update `docs/REPO_LAYOUT.md`**

In `docs/REPO_LAYOUT.md`, update the M6 Workbench row (line ~59) so the `workbench/web/` note reflects the routing files and the summarizer dependency. Replace the trailing clause:

`; \`workbench/web/web-config.ts\` (credential-gated WebSearch/WebFetch) pulls in \`turndown\`.`

with:

`; \`workbench/web/\` (credential-gated WebSearch/WebFetch) pulls in \`turndown\` and routes WebFetch through a cooldown-aware provider chain (\`routing.ts\` + \`key-state-store.ts\` → \`~/.coa/web-keys.json\`, \`firecrawl.ts\`, \`plain-fetch.ts\`); the WebFetch summarizer is composed at the daemon root over \`@coa/adapter-deepseek\`.`

- [ ] **Step 6: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/session/daemon.ts packages/core/src/session/daemon.test.ts docs/REPO_LAYOUT.md
git commit -m "feat: compose the web-fetch summarizer at the daemon root"
```

---

## Task 7: Firecrawl live smoke + commit the spec & plan

**Files:**
- Modify: `packages/core/src/workbench/web/web-tools.smoke.test.ts` (append a key-gated Firecrawl smoke)
- Commit: `docs/superpowers/specs/2026-07-03-web-tool-routing-design.md` + `docs/superpowers/plans/2026-07-03-web-tool-routing.md`

**Interfaces:**
- Consumes: `makeFirecrawlFetch` (Task 3).
- Produces: nothing (test + docs only).

- [ ] **Step 1: Append the Firecrawl smoke test**

In `packages/core/src/workbench/web/web-tools.smoke.test.ts`, add the import and a new key-gated block below the existing Parallel smoke:

```ts
import { makeFirecrawlFetch } from './firecrawl.js';

const hasFirecrawl = !!process.env.FIRECRAWL_KEY_1;

describe.skipIf(!hasFirecrawl)('firecrawl fetch live smoke', () => {
  it('scrapes a real page to clean markdown', async () => {
    const provider = makeFirecrawlFetch({ apiKey: process.env.FIRECRAWL_KEY_1! });
    const outcome = await provider.fetch('https://example.com');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.clean).toBe(true);
      expect(outcome.value.length).toBeGreaterThan(0);
    }
  }, 30_000);
});
```

- [ ] **Step 2: Verify the smoke is skipped without a key (never fails offline)**

Run: `pnpm --filter @coa/core test -- web-tools.smoke`
Expected: PASS with the Firecrawl block reported as skipped (no `FIRECRAWL_KEY_1` in the environment). If a real `FIRECRAWL_KEY_1` is present, the block runs and must return an `ok`/clean outcome.

- [ ] **Step 3: Final whole-package check**

Run: `pnpm --filter @coa/core test`
Expected: PASS.

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/workbench/web/web-tools.smoke.test.ts docs/superpowers/specs/2026-07-03-web-tool-routing-design.md docs/superpowers/plans/2026-07-03-web-tool-routing.md
git commit -m "test: add a firecrawl fetch live smoke"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** Task 1 = neutral outcome + `runChain` (§1, §2 `runChain`); Task 2 = `KeyStateStore` + credential-blind id (§2 `KeyStateStore`); Task 3 = `FetchProvider` + `firecrawl` (§3); Task 4 = `plainFetch` free floor (§3); Task 5 = WebFetch handler refactor + config shape + clean-skips-summarizer (§4, §6); Task 6 = summarizer default at the daemon root + ledger cost (§5); Task 7 = Firecrawl live smoke (§Testing). Deferred items (search routing, Tavily-extract, live-credit introspection) are intentionally NOT built.
- **Type consistency:** `ProviderOutcome`/`ChainEntry`/`ChainResult`/`CooldownStore` (Task 1) are consumed unchanged by Tasks 2–5. `RoutedFetch` (Task 3) is the exact deps field the handler (Task 5) and config builder (Task 5) agree on. `buildWebToolDeps` returns non-`undefined` after Task 5 — Task 6's `buildBaseCatalogue` accounts for that (`web` truthiness gates on `options.web`, not the return).
- **Breaking-change ordering:** Tasks 1–4 are additive (package compiles after each). Task 5 is the single breaking refactor and updates all four affected test files in the same commit. Task 6 adds the summarizer without further breakage.
```

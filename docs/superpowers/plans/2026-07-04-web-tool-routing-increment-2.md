# Web-Tool Routing Increment 2 (Search + Tavily/Firecrawl Providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route WebSearch through an ordered, cooldown-aware chain of provider keys (Tavily → Firecrawl-search → Parallel) and add a Tavily-extract hop to the WebFetch chain — so an assortment of Firecrawl and Tavily keys serves both tools.

**Architecture:** Reuse the increment-1 routing core unchanged (`runChain<T>`/`KeyStateStore`/`ProviderOutcome` are already value-generic). Add three new provider adapters (Tavily search, Tavily extract, Firecrawl search), refactor the existing Parallel adapter to return a classified outcome, refactor the WebSearch handler to run a `runChain<SearchHit[]>` chain (mirroring the increment-1 WebFetch refactor), and generalize the config into `web.search.providers` + a `firecrawl|tavily` fetch-provider union. The same store keys on `${kind}:${locatorId}`, so a key used in both search and fetch shares one cooldown.

**Tech Stack:** TypeScript (strict), Zod (edge validation), Vitest (mock-first). No new dependencies.

## Global Constraints

Every task's requirements implicitly include this section. Values are verbatim from the spec + constitution.

- **TypeScript `strict`, no `any`.** `exactOptionalPropertyTypes` is ON — spread-guard optional fields (`...(x !== undefined ? { x } : {})`); never assign `undefined` to an optional property.
- **SC-1** — tools never throw and never deny. Provider adapters return a classified `ProviderOutcome`; an exhausted search chain returns **empty results with a reason** (WebSearch has NO free floor — no free search backend).
- **Strict-superset (D85)** — absent `web.search` config, WebSearch returns empty results exactly as today; the WebFetch free plain-fetch floor is still the always-last hop.
- **Credential-blind** — config stores locator POINTERS (reuse the shared `locatorSchema`/`Locator` from `@coa/shared`); the cooldown store keys on `` `${providerKind}:${locatorId}` ``, never the secret. An unresolvable credential is simply absent from its chain.
- **Determinism-first (P1)** — the router + cooldown logic stay pure; no model call on the search path.
- Web tools emit **NO M1 change-event** (egress) — `wrap(...)` with no `emit()`.
- **Verified provider APIs (use exactly):**
  - **Tavily Search:** `POST https://api.tavily.com/search`, header `Authorization: Bearer <key>`, body `{ query, max_results, include_domains?, exclude_domains? }`. Success → `results[]` with `.title`, `.url`, `.content`. **429**=rate-limit, **432**/**433**=quota, **401**=invalid key.
  - **Tavily Extract:** `POST https://api.tavily.com/extract`, body `{ urls: [url], format: 'markdown' }`. Success → `results[].raw_content`. Same status codes.
  - **Firecrawl Search:** `POST https://api.firecrawl.dev/v2/search`, body `{ query, limit, sources: [{ type: 'web' }], includeDomains?, excludeDomains? }`. Success → `data.web[]` with `.title`, `.url`, `.description`. **402**=quota, **429**=rate-limit.
  - Retry-After is undocumented on all three — parse it if present, else the limit is ambiguous → the quota cooldown deadline.
- **Cooldown mapping:** rate-limit + `retryAfterMs` → `now + retryAfterMs`; quota or ambiguous → `quotaCooldownUntil` (next local midnight by default); a **bad key (401)** → `error` (retrying won't help — NO cooldown, just try the next hop); a plain non-ok → `error`.
- Commits: **subject-only Conventional Commits** — no body, no `Co-Authored-By`/"Generated with" trailer, no phase/module identifiers.
- **Stage files BY NAME** (`git add <path> ...`) — NEVER `git add -A`/`git add .`. The tree carries ~40 unrelated modified/untracked files (apps/desktop, packages/console-ui, other docs, `.superpowers/` scratch) — never touch, stage, or revert them.
- Tests: **this repo has NO `@coa/core` `test` script.** Use `npx vitest run <file>` (focused) and `pnpm vitest run packages/core` (full). Run the full `packages/core` suite + `pnpm --filter @coa/core exec tsc -b` once before committing an integration task (Tasks 2, 4). Two pre-existing failing tests in `apps/desktop/src/renderer/console.test.tsx` are unrelated WIP — not in `packages/core`; ignore them.

---

## File Structure

**New files (all under `packages/core/src/workbench/web/`):**
- `limits.ts` — shared status→limit classifiers `firecrawlLimit`, `tavilyLimit`, and `parseRetryAfterHeader`.
- `tavily.ts` — `makeTavilySearch` (search adapter) + `makeTavilyFetch` (`FetchProvider`, clean markdown).

**Modified files:**
- `firecrawl.ts` — refactor to call `firecrawlLimit`/`parseRetryAfterHeader` (behavior unchanged); ADD `makeFirecrawlSearch` (search adapter).
- `parallel.ts` — refactor `makeParallelSearch` to return a `ProviderOutcome<readonly SearchHit[]>`.
- `web-tools.ts` — add `SearchRequest`; change `SearchProvider` to outcome-returning; add `RoutedSearch`; refactor the `webSearch` handler; change `WebToolDeps.search`→`searchChain`; update `webToolSpecs.WebSearch`.
- `web-config.ts` — remove `provider`/`credential`; add the `web.search` schema; widen the fetch-provider union to `firecrawl|tavily`; add `buildSearchChain`; wire the Tavily fetch hop into `buildFetchChain`.
- `session/daemon.ts` — none required (it passes `WebConfig` through; verify only). The plan updates `daemon.test.ts`.
- `docs/REPO_LAYOUT.md` — note the search routing + Tavily provider.

**Test files:** `limits.test.ts`, `tavily.test.ts` (new); `firecrawl.test.ts`, `parallel.test.ts`, `web-tools.test.ts`, `web/web-config.test.ts`, `governed-tools.test.ts`, `session/daemon.test.ts`, `web/web-tools.smoke.test.ts` (modified).

---

## Task 1: Shared limit classifiers

**Suggested model:** cheap (transcription + a small internal refactor).

**Files:**
- Create: `packages/core/src/workbench/web/limits.ts`
- Test: `packages/core/src/workbench/web/limits.test.ts`
- Modify: `packages/core/src/workbench/web/firecrawl.ts` (use the shared helpers; behavior unchanged)

**Interfaces:**
- Produces:
  - `type LimitOutcome = { kind: 'rate-limit'; retryAfterMs?: number } | { kind: 'quota' }`
  - `function parseRetryAfterHeader(header: string | null): number | undefined`
  - `function firecrawlLimit(status: number, headers: { get(name: string): string | null }): LimitOutcome | undefined`
  - `function tavilyLimit(status: number, headers: { get(name: string): string | null }): LimitOutcome | undefined`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/web/limits.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRetryAfterHeader, firecrawlLimit, tavilyLimit } from './limits.js';

const headers = (retryAfter?: string) => ({ get: (n: string) => (n.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) });

describe('parseRetryAfterHeader', () => {
  it('parses delta-seconds to milliseconds', () => {
    expect(parseRetryAfterHeader('30')).toBe(30_000);
  });
  it('returns undefined for null or non-numeric', () => {
    expect(parseRetryAfterHeader(null)).toBeUndefined();
    expect(parseRetryAfterHeader('soon')).toBeUndefined();
  });
});

describe('firecrawlLimit', () => {
  it('maps 429 to rate-limit with Retry-After when present', () => {
    expect(firecrawlLimit(429, headers('12'))).toEqual({ kind: 'rate-limit', retryAfterMs: 12_000 });
  });
  it('maps 429 with no Retry-After to a bare rate-limit', () => {
    expect(firecrawlLimit(429, headers())).toEqual({ kind: 'rate-limit' });
  });
  it('maps 402 to quota', () => {
    expect(firecrawlLimit(402, headers())).toEqual({ kind: 'quota' });
  });
  it('returns undefined for a non-limit status', () => {
    expect(firecrawlLimit(200, headers())).toBeUndefined();
    expect(firecrawlLimit(500, headers())).toBeUndefined();
  });
});

describe('tavilyLimit', () => {
  it('maps 429 to rate-limit (with Retry-After if present)', () => {
    expect(tavilyLimit(429, headers('5'))).toEqual({ kind: 'rate-limit', retryAfterMs: 5000 });
    expect(tavilyLimit(429, headers())).toEqual({ kind: 'rate-limit' });
  });
  it('maps 432 and 433 to quota', () => {
    expect(tavilyLimit(432, headers())).toEqual({ kind: 'quota' });
    expect(tavilyLimit(433, headers())).toEqual({ kind: 'quota' });
  });
  it('returns undefined for a non-limit status (incl. 401)', () => {
    expect(tavilyLimit(401, headers())).toBeUndefined();
    expect(tavilyLimit(200, headers())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/workbench/web/limits.test.ts`
Expected: FAIL — `Cannot find module './limits.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/workbench/web/limits.ts`:

```ts
/**
 * Per-provider HTTP status → limit classifiers, shared by each provider's two
 * adapters (search + fetch/extract) so a single mapping can't drift. A `LimitOutcome`
 * is spread into a {@link ProviderOutcome} `limit` variant by the caller; `undefined`
 * means "not a limit" (the caller decides ok vs error).
 */
export type LimitOutcome = { kind: 'rate-limit'; retryAfterMs?: number } | { kind: 'quota' };

/** Parse a `Retry-After` header (delta-seconds) into milliseconds; `null`/invalid ⇒ `undefined`. */
export function parseRetryAfterHeader(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

/** Firecrawl: 429 → rate-limit (Retry-After if present); 402 → quota; else not a limit. */
export function firecrawlLimit(
  status: number,
  headers: { get(name: string): string | null },
): LimitOutcome | undefined {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers.get('retry-after'));
    return { kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  if (status === 402) return { kind: 'quota' };
  return undefined;
}

/** Tavily: 429 → rate-limit (Retry-After if present); 432/433 → quota; else not a limit (401 is a bad key, not a limit). */
export function tavilyLimit(
  status: number,
  headers: { get(name: string): string | null },
): LimitOutcome | undefined {
  if (status === 429) {
    const retryAfterMs = parseRetryAfterHeader(headers.get('retry-after'));
    return { kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
  }
  if (status === 432 || status === 433) return { kind: 'quota' };
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/workbench/web/limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `firecrawl.ts` to use the shared helpers (behavior unchanged)**

In `packages/core/src/workbench/web/firecrawl.ts`:

1. Add the import after the existing imports:

```ts
import { firecrawlLimit } from './limits.js';
```

2. Replace the two status branches (the `if (res.status === 429) {...}` and `if (res.status === 402) ...` block) with:

```ts
        const limit = firecrawlLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `firecrawl-http-${res.status}` };
```

3. Delete the now-unused local `parseRetryAfter` function at the bottom of the file.

- [ ] **Step 6: Run the firecrawl + limits tests to confirm both green**

Run: `npx vitest run packages/core/src/workbench/web/firecrawl.test.ts packages/core/src/workbench/web/limits.test.ts`
Expected: PASS (the existing firecrawl tests still pass — the refactor is behavior-preserving).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/workbench/web/limits.ts packages/core/src/workbench/web/limits.test.ts packages/core/src/workbench/web/firecrawl.ts
git commit -m "refactor: extract shared provider limit classifiers"
```

---

## Task 2: Tavily-extract fetch hop

**Suggested model:** standard (adds an adapter AND edits the shared `web-config.ts` fetch chain + tests).

**Files:**
- Create: `packages/core/src/workbench/web/tavily.ts` (the `makeTavilyFetch` half; `makeTavilySearch` is added in Task 3)
- Test: `packages/core/src/workbench/web/tavily.test.ts` (the extract cases)
- Modify: `packages/core/src/workbench/web/web-config.ts` (widen the fetch-provider union; add the Tavily branch to `buildFetchChain`)
- Modify: `packages/core/src/workbench/web/web-config.test.ts` (a Tavily-fetch cooldown-id test)

**Interfaces:**
- Consumes: `FetchProvider` (`../web-tools.js`), `ProviderOutcome` (`./routing.js`), `tavilyLimit` (`./limits.js`).
- Produces: `function makeTavilyFetch(config: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): FetchProvider`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/workbench/web/tavily.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeTavilyFetch } from './tavily.js';

/** A fake `fetch` returning a Response-like shape (cast to satisfy `typeof fetch`). */
function fakeFetch(res: { ok?: boolean; status: number; headers?: Record<string, string>; json?: unknown }): typeof fetch {
  const headers = res.headers ?? {};
  return (async () => ({
    ok: res.ok ?? (res.status >= 200 && res.status < 300),
    status: res.status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => res.json ?? {},
    text: async () => JSON.stringify(res.json ?? {}),
  })) as unknown as typeof fetch;
}

describe('makeTavilyFetch', () => {
  it('maps a 200 with results[].raw_content to an ok, clean outcome', async () => {
    const provider = makeTavilyFetch({
      apiKey: 'tvly-secret',
      fetchImpl: fakeFetch({ status: 200, json: { results: [{ raw_content: '# Page' }] } }),
    });
    expect(await provider.fetch('https://x.test')).toEqual({ status: 'ok', value: '# Page', clean: true });
  });

  it('POSTs to /extract with a Bearer key and markdown format', async () => {
    let url = '';
    let init: { method?: string; headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [{ raw_content: 'md' }] }), text: async () => '' };
    }) as unknown as typeof fetch;
    await makeTavilyFetch({ apiKey: 'tvly-secret', fetchImpl }).fetch('https://x.test');
    expect(url).toBe('https://api.tavily.com/extract');
    expect(init.method).toBe('POST');
    expect(init.headers?.authorization).toBe('Bearer tvly-secret');
    expect(JSON.parse(init.body!)).toEqual({ urls: ['https://x.test'], format: 'markdown' });
  });

  it('maps 429 to rate-limit and 432/433 to quota', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 432 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 433 }) }).fetch('https://x.test')).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('maps 401 and other non-ok statuses to an error', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 401 }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 500 }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('maps an empty/failed extract to an error', async () => {
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 200, json: { results: [] } }) }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });

  it('SC-1: a fetch throw becomes an error outcome', async () => {
    const fetchImpl = (async () => { throw new Error('dns'); }) as unknown as typeof fetch;
    expect(await makeTavilyFetch({ apiKey: 'k', fetchImpl }).fetch('https://x.test')).toMatchObject({ status: 'error' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/workbench/web/tavily.test.ts`
Expected: FAIL — `Cannot find module './tavily.js'`.

- [ ] **Step 3: Write `tavily.ts` (the extract half)**

Create `packages/core/src/workbench/web/tavily.ts`:

```ts
import { z } from 'zod';
import type { FetchProvider } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';
import { tavilyLimit } from './limits.js';

/**
 * The Tavily adapters (search + extract) — thin HTTP over `api.tavily.com`, each
 * mapping the response to a {@link ProviderOutcome}: 429 → rate-limit, 432/433 →
 * quota, 401 → error (a bad key — no cooldown), other non-ok → error. Injectable
 * `fetchImpl`; credential-blind (the key is passed in). Never throws (SC-1).
 * `makeTavilySearch` is added in a later task in this same file.
 */
const DEFAULT_BASE_URL = 'https://api.tavily.com';

const tavilyExtractResponseSchema = z.object({
  results: z.array(z.object({ raw_content: z.string() })).default([]),
});

export function makeTavilyFetch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): FetchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(`${baseUrl}/extract`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ urls: [url], format: 'markdown' }),
        });
        const limit = tavilyLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `tavily-http-${res.status}` };
        const parsed = tavilyExtractResponseSchema.safeParse(await res.json());
        const markdown = parsed.success ? parsed.data.results[0]?.raw_content : undefined;
        if (markdown === undefined || markdown === '') {
          return { status: 'error', reason: 'tavily-extract-empty' };
        }
        return { status: 'ok', value: markdown, clean: true };
      } catch (err) {
        return { status: 'error', reason: `tavily-throw: ${String(err)}` };
      }
    },
  };
}
```

- [ ] **Step 4: Run the tavily test to confirm it passes**

Run: `npx vitest run packages/core/src/workbench/web/tavily.test.ts`
Expected: PASS.

- [ ] **Step 5: Widen the fetch-provider union + add the Tavily branch in `web-config.ts`**

In `packages/core/src/workbench/web/web-config.ts`:

1. Add the import (next to the `makeFirecrawlFetch` import):

```ts
import { makeTavilyFetch } from './tavily.js';
```

2. Replace `firecrawlProviderSchema` (lines ~22–25) with a union-capable fetch-provider schema:

```ts
const fetchProviderSchema = z.object({
  kind: z.enum(['firecrawl', 'tavily']),
  credentials: z.array(locatorSchema).default([]),
});
```

3. In `fetchConfigSchema`, change `providers: z.array(firecrawlProviderSchema).default([])` to `providers: z.array(fetchProviderSchema).default([])`.

4. In `buildFetchChain`, replace the provider-construction line (`provider: makeFirecrawlFetch({ apiKey }),`) with a kind switch:

```ts
      providers.push({
        provider: provider.kind === 'tavily' ? makeTavilyFetch({ apiKey }) : makeFirecrawlFetch({ apiKey }),
        keyStateId: `${provider.kind}:${locatorId(cred)}`,
      });
```

- [ ] **Step 6: Add a Tavily-fetch cooldown-id test to `web-config.test.ts`**

In `packages/core/src/workbench/web/web-config.test.ts`, add inside `describe('buildWebToolDeps', …)` (after the existing Firecrawl cooldown test):

```ts
  it('routes a Tavily fetch key and marks its credential-blind cooldown id on quota', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = { isCoolingDown: () => false, markCooldown: (id, until) => marks.push({ id, until }), clear: () => {} };
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      status: 432,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => '',
    }));
    const cfg = webConfigSchema.parse({
      fetch: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }], freeFloor: false },
    });
    const deps = buildWebToolDeps(cfg, { TAVILY_KEY_1: 'tvly-secret' }, { store, now: () => 0 });
    const res = await deps.fetchChain('https://x.test');
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('tavily:TAVILY_KEY_1');
  });
```

- [ ] **Step 7: Verify (full suite + typecheck — this is an integration task)**

Run: `npx vitest run packages/core/src/workbench/web/web-config.test.ts packages/core/src/workbench/web/tavily.test.ts`
Expected: PASS.

Run: `pnpm vitest run packages/core`
Expected: whole package green (skips are fine).

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/workbench/web/tavily.ts packages/core/src/workbench/web/tavily.test.ts packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web/web-config.test.ts
git commit -m "feat: add a tavily-extract fetch hop to the web fetch chain"
```

---

## Task 3: Search adapters (Tavily search + Firecrawl search)

**Suggested model:** cheap (two additive adapters, complete code below).

These adapters return `Promise<ProviderOutcome<readonly SearchHit[]>>` — additive new exports, unused until Task 4 wires them, so the package still compiles.

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts` (add the `SearchRequest` type only — additive)
- Modify: `packages/core/src/workbench/web/tavily.ts` (add `makeTavilySearch`)
- Modify: `packages/core/src/workbench/web/firecrawl.ts` (add `makeFirecrawlSearch`)
- Test: `packages/core/src/workbench/web/tavily.test.ts` (search cases) + `packages/core/src/workbench/web/firecrawl.test.ts` (search cases)

**Interfaces:**
- Consumes: `SearchHit` (`../web-tools.js`), `ProviderOutcome` (`./routing.js`), `tavilyLimit`/`firecrawlLimit` (`./limits.js`).
- Produces:
  - In `web-tools.ts`: `interface SearchRequest { query: string; allowedDomains?: readonly string[]; blockedDomains?: readonly string[]; maxResults?: number }`
  - `function makeTavilySearch(config: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> }`
  - `function makeFirecrawlSearch(config: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> }`

- [ ] **Step 1: Add the `SearchRequest` type to `web-tools.ts` (additive)**

In `packages/core/src/workbench/web-tools.ts`, immediately after the `SearchHit` interface (around line 19), add:

```ts
/** The neutral search request the routed search providers accept. */
export interface SearchRequest {
  query: string;
  allowedDomains?: readonly string[];
  blockedDomains?: readonly string[];
  maxResults?: number;
}
```

(Leave the existing `SearchProvider`/`webSearch`/`WebToolDeps` untouched — they are refactored in Task 4. This step is additive so the package still compiles.)

- [ ] **Step 2: Write the failing search tests**

Append to `packages/core/src/workbench/web/tavily.test.ts` (add `makeTavilySearch` to the import at the top: `import { makeTavilyFetch, makeTavilySearch } from './tavily.js';`), a new describe block:

```ts
describe('makeTavilySearch', () => {
  it('maps results[] to neutral SearchHits (content → snippet)', async () => {
    const provider = makeTavilySearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 200, json: { results: [{ title: 'T', url: 'https://x.test', content: 'snip' }] } }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'snip' }],
    });
  });

  it('POSTs to /search with a Bearer key and the query', async () => {
    let url = '';
    let init: { headers?: Record<string, string>; body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ results: [] }), text: async () => '' };
    }) as unknown as typeof fetch;
    await makeTavilySearch({ apiKey: 'tvly-secret', fetchImpl }).search({ query: 'hello', allowedDomains: ['a.com'], maxResults: 3 });
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers?.authorization).toBe('Bearer tvly-secret');
    expect(JSON.parse(init.body!)).toEqual({ query: 'hello', max_results: 3, include_domains: ['a.com'] });
  });

  it('maps 429→rate-limit, 432/433→quota, 401→error', async () => {
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 432 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'quota' });
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 401 }) }).search({ query: 'q' })).toMatchObject({ status: 'error' });
  });

  it('SC-1: a throw becomes an error outcome', async () => {
    const fetchImpl = (async () => { throw new Error('dns'); }) as unknown as typeof fetch;
    expect(await makeTavilySearch({ apiKey: 'k', fetchImpl }).search({ query: 'q' })).toMatchObject({ status: 'error' });
  });
});
```

Append to `packages/core/src/workbench/web/firecrawl.test.ts` (add `makeFirecrawlSearch` to the import: `import { makeFirecrawlFetch, makeFirecrawlSearch } from './firecrawl.js';`), a new describe block:

```ts
describe('makeFirecrawlSearch', () => {
  it('maps data.web[] to neutral SearchHits (description → snippet)', async () => {
    const provider = makeFirecrawlSearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ status: 200, json: { success: true, data: { web: [{ title: 'T', url: 'https://x.test', description: 'desc' }] } } }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'desc' }],
    });
  });

  it('POSTs to /v2/search with a web source', async () => {
    let url = '';
    let init: { body?: string } = {};
    const fetchImpl = (async (u: string, i: typeof init) => {
      url = u;
      init = i;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true, data: { web: [] } }), text: async () => '' };
    }) as unknown as typeof fetch;
    await makeFirecrawlSearch({ apiKey: 'k', fetchImpl }).search({ query: 'hello', maxResults: 4 });
    expect(url).toBe('https://api.firecrawl.dev/v2/search');
    expect(JSON.parse(init.body!)).toMatchObject({ query: 'hello', limit: 4, sources: [{ type: 'web' }] });
  });

  it('maps 429→rate-limit and 402→quota', async () => {
    expect(await makeFirecrawlSearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 429 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'rate-limit' });
    expect(await makeFirecrawlSearch({ apiKey: 'k', fetchImpl: fakeFetch({ status: 402 }) }).search({ query: 'q' })).toEqual({ status: 'limit', kind: 'quota' });
  });

  it('SC-1: a throw becomes an error outcome', async () => {
    const fetchImpl = (async () => { throw new Error('dns'); }) as unknown as typeof fetch;
    expect(await makeFirecrawlSearch({ apiKey: 'k', fetchImpl }).search({ query: 'q' })).toMatchObject({ status: 'error' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run packages/core/src/workbench/web/tavily.test.ts packages/core/src/workbench/web/firecrawl.test.ts`
Expected: FAIL — `makeTavilySearch`/`makeFirecrawlSearch` are not exported.

- [ ] **Step 4: Add `makeTavilySearch` to `tavily.ts`**

In `packages/core/src/workbench/web/tavily.ts`, change the imports to add the search types, then add the adapter:

```ts
import type { FetchProvider, SearchHit, SearchRequest } from '../web-tools.js';
```

Add the search response schema next to the extract schema:

```ts
const tavilySearchResponseSchema = z.object({
  results: z
    .array(z.object({ title: z.string().default(''), url: z.string(), content: z.string().default('') }))
    .default([]),
});
```

Add the exported factory (after `makeTavilyFetch`):

```ts
/** Tavily Search adapter (`POST /search`) → a routed search hop. Success → hits; limits per {@link tavilyLimit}. */
export function makeTavilySearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> } {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            query: req.query,
            max_results: req.maxResults ?? 5,
            ...(req.allowedDomains ? { include_domains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { exclude_domains: req.blockedDomains } : {}),
          }),
        });
        const limit = tavilyLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `tavily-http-${res.status}` };
        const parsed = tavilySearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'tavily-malformed' };
        const value = parsed.data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `tavily-throw: ${String(err)}` };
      }
    },
  };
}
```

- [ ] **Step 5: Add `makeFirecrawlSearch` to `firecrawl.ts`**

In `packages/core/src/workbench/web/firecrawl.ts`, add the search types to the imports and add the adapter:

```ts
import type { FetchProvider, SearchHit, SearchRequest } from '../web-tools.js';
```

Add a search response schema next to `firecrawlResponseSchema`:

```ts
const firecrawlSearchResponseSchema = z.object({
  success: z.boolean().default(false),
  data: z
    .object({
      web: z
        .array(z.object({ title: z.string().default(''), url: z.string(), description: z.string().default('') }))
        .default([]),
    })
    .optional(),
});
```

Add the exported factory (after `makeFirecrawlFetch`):

```ts
/** Firecrawl Search adapter (`POST /v2/search`) → a routed search hop. Success → hits; limits per {@link firecrawlLimit}. */
export function makeFirecrawlSearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> } {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(`${baseUrl}/v2/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            query: req.query,
            limit: req.maxResults ?? 10,
            sources: [{ type: 'web' }],
            ...(req.allowedDomains ? { includeDomains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { excludeDomains: req.blockedDomains } : {}),
          }),
        });
        const limit = firecrawlLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `firecrawl-http-${res.status}` };
        const parsed = firecrawlSearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'firecrawl-search-malformed' };
        const value = (parsed.data.data?.web ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `firecrawl-search-throw: ${String(err)}` };
      }
    },
  };
}
```

Note: `SearchHit` and `SearchRequest` are type-only imports; `ProviderOutcome` is already imported.

- [ ] **Step 6: Run the adapter tests to confirm they pass**

Run: `npx vitest run packages/core/src/workbench/web/tavily.test.ts packages/core/src/workbench/web/firecrawl.test.ts`
Expected: PASS (all fetch + search cases).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web/tavily.ts packages/core/src/workbench/web/tavily.test.ts packages/core/src/workbench/web/firecrawl.ts packages/core/src/workbench/web/firecrawl.test.ts
git commit -m "feat: add tavily and firecrawl search provider adapters"
```

---

## Task 4: Route WebSearch through the chain (breaking search refactor)

The central breaking change: `SearchProvider` becomes outcome-returning, the WebSearch handler runs a routed chain, Parallel is refactored, and the config gains `web.search` (dropping the legacy `provider`/`credential`). All affected files + tests land in ONE commit so the package compiles at the end.

**Suggested model:** standard.

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts` (SearchProvider shape, RoutedSearch, webSearch handler, WebToolDeps, webToolSpecs.WebSearch)
- Modify: `packages/core/src/workbench/web/parallel.ts` (return a ProviderOutcome)
- Modify: `packages/core/src/workbench/web/web-config.ts` (drop provider/credential; add web.search + buildSearchChain)
- Modify tests: `packages/core/src/workbench/web-tools.test.ts`, `web/parallel.test.ts`, `web/web-config.test.ts`, `governed-tools.test.ts`, `session/daemon.test.ts`

**Interfaces:**
- Produces:
  - `web-tools.ts`: `interface SearchProvider { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> }`; `type RoutedSearch = (req: SearchRequest) => Promise<ChainResult<readonly SearchHit[]>>`; `webSearch(req, deps: { searchChain: RoutedSearch })`; `interface WebToolDeps { searchChain: RoutedSearch; fetchChain: RoutedFetch; summarizer?: Summarizer }`.
  - `web-config.ts`: `type WebSearchConfig`; `buildWebToolDeps` builds `searchChain` from `config.search`.

- [ ] **Step 1: Refactor `web-tools.ts`**

In `packages/core/src/workbench/web-tools.ts`:

1. Replace the `SearchProvider` interface (lines ~21–29) with:

```ts
/** A routed search provider — a keyed hop in the {@link RoutedSearch} chain (no-lock-in seam). */
export interface SearchProvider {
  search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>>;
}

/** The assembled, cooldown-aware search chain the WebSearch handler runs (built in web-config). */
export type RoutedSearch = (req: SearchRequest) => Promise<ChainResult<readonly SearchHit[]>>;
```

2. Replace the `webSearch` handler (lines ~35–54) with:

```ts
/** `WebSearch` — mirrors Claude's args (query + optional domain filters). Runs the routed chain. */
export async function webSearch(
  req: {
    query: string;
    allowed_domains?: readonly string[] | undefined;
    blocked_domains?: readonly string[] | undefined;
  },
  deps: { searchChain: RoutedSearch },
): Promise<ToolResponse<WebSearchResult>> {
  const result = await deps.searchChain({
    query: req.query,
    ...(req.allowed_domains ? { allowedDomains: req.allowed_domains } : {}),
    ...(req.blocked_domains ? { blockedDomains: req.blocked_domains } : {}),
  });
  if (result.status === 'ok') {
    return wrap({ results: result.value }, `web_search:${req.query}`, req.query);
  }
  return wrap(
    { results: [], reason: result.lastReason ?? 'no-search-provider' },
    `web_search:error:${req.query}`,
    req.query,
  );
}
```

3. In `WebToolDeps` (lines ~108–112), change `search: SearchProvider` to `searchChain: RoutedSearch`:

```ts
export interface WebToolDeps {
  searchChain: RoutedSearch;
  fetchChain: RoutedFetch;
  summarizer?: Summarizer;
}
```

4. In `webToolSpecs`, replace the `WebSearch` spec dispatch (`(a, d) => webSearch(a, { search: w(d).search })`) with:

```ts
      (a, d: GovernedToolDeps) => webSearch(a, { searchChain: w(d).searchChain }),
```

- [ ] **Step 2: Refactor `parallel.ts` to return a `ProviderOutcome`**

Replace the contents of `packages/core/src/workbench/web/parallel.ts` with:

```ts
import { z } from 'zod';
import type { SearchHit, SearchProvider, SearchRequest } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

const DEFAULT_BASE_URL = 'https://api.parallel.ai/v1beta/search';

// NOTE: Parallel.ai field names (objective, max_results, include_domains, exclude_domains)
// are provisional and will be validated at the live smoke against the actual API docs.
const parallelResponseSchema = z.object({
  results: z
    .array(z.object({ title: z.string().default(''), url: z.string(), excerpts: z.array(z.string()).default([]) }))
    .default([]),
});

/**
 * Parallel.ai Search adapter — a routed search hop. Parallel does not publish
 * rate-limit codes, so it never emits `limit` (a non-2xx or a malformed body →
 * `error`, and the chain falls through to the next hop). Injectable `fetchImpl`.
 */
export function makeParallelSearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): SearchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(baseUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
          body: JSON.stringify({
            objective: req.query,
            max_results: req.maxResults ?? 10,
            ...(req.allowedDomains ? { include_domains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { exclude_domains: req.blockedDomains } : {}),
          }),
        });
        if (!res.ok) return { status: 'error', reason: `parallel-http-${res.status}` };
        const parsed = parallelResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'parallel-malformed' };
        const value = parsed.data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.excerpts.join('\n') }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `parallel-throw: ${String(err)}` };
      }
    },
  };
}
```

- [ ] **Step 3: Rewrite `web-config.ts`**

Replace the contents of `packages/core/src/workbench/web/web-config.ts` with:

```ts
import { z } from 'zod';
import { homedir } from 'node:os';
import { locatorSchema, type Locator } from '@coa/shared';
import type {
  FetchProvider,
  RoutedFetch,
  RoutedSearch,
  SearchHit,
  SearchProvider,
  Summarizer,
  WebToolDeps,
} from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch, makeFirecrawlSearch } from './firecrawl.js';
import { makeTavilyFetch, makeTavilySearch } from './tavily.js';
import { makePlainFetch } from './plain-fetch.js';
import {
  runChain,
  nextLocalMidnight,
  type ChainEntry,
  type CooldownStore,
  type ProviderOutcome,
} from './routing.js';
import { KeyStateStore, locatorId } from './key-state-store.js';

/**
 * The web-egress config: the routed search chain + the routed fetch chain. Every
 * credential is the shared account {@link Locator} (M0) — one credential-blind
 * schema for the whole system. `.strip()` + Zod-validated at the edge.
 */
const fetchProviderSchema = z.object({
  kind: z.enum(['firecrawl', 'tavily']),
  credentials: z.array(locatorSchema).default([]),
});

const fetchConfigSchema = z
  .object({
    providers: z.array(fetchProviderSchema).default([]),
    freeFloor: z.boolean().default(true),
    summarizer: z
      .object({ provider: z.literal('deepseek'), model: z.string().min(1), credential: locatorSchema })
      .optional(),
    quotaCooldown: z.union([z.literal('next-midnight'), z.number().positive()]).default('next-midnight'),
  })
  .strip();

const searchProviderSchema = z.object({
  kind: z.enum(['tavily', 'firecrawl', 'parallel']),
  credentials: z.array(locatorSchema).default([]),
});

const searchConfigSchema = z
  .object({
    providers: z.array(searchProviderSchema).default([]),
    quotaCooldown: z.union([z.literal('next-midnight'), z.number().positive()]).default('next-midnight'),
  })
  .strip();

export const webConfigSchema = z
  .object({
    search: searchConfigSchema.optional(),
    fetch: fetchConfigSchema.optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;
export type WebFetchConfig = z.infer<typeof fetchConfigSchema>;
export type WebSearchConfig = z.infer<typeof searchConfigSchema>;

/** Resolve an env-var locator; other locator kinds resolve to `undefined` (env-only for now). */
function resolveKey(locator: Locator, env: Record<string, string | undefined>): string | undefined {
  if (locator.type === 'env-var') {
    const value = env[locator.name];
    return value !== undefined && value !== '' ? value : undefined;
  }
  return undefined;
}

/** Resolve a `'next-midnight'`-or-duration cooldown config into an absolute-deadline function. */
function quotaCooldown(cfg: 'next-midnight' | number | undefined): (now: number) => number {
  const q = cfg ?? 'next-midnight';
  return (n) => (q === 'next-midnight' ? nextLocalMidnight(n) : n + q);
}

/**
 * Assemble the routed fetch chain: each resolvable credential becomes a keyed hop
 * (`<kind>:<locatorId>`) in priority order, followed by the free plain-fetch floor
 * (default on). An unresolvable credential is simply absent from the chain.
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
        provider: provider.kind === 'tavily' ? makeTavilyFetch({ apiKey }) : makeFirecrawlFetch({ apiKey }),
        keyStateId: `${provider.kind}:${locatorId(cred)}`,
      });
    }
  }
  const floor =
    (fetchCfg?.freeFloor ?? true)
      ? { provider: makePlainFetch(), keyStateId: 'plain-fetch:free' }
      : undefined;
  const until = quotaCooldown(fetchCfg?.quotaCooldown);
  return (url) => {
    const entries: ChainEntry<string>[] = [
      ...providers.map((p) => ({ run: () => p.provider.fetch(url), keyStateId: p.keyStateId })),
      ...(floor ? [{ run: () => floor.provider.fetch(url), keyStateId: floor.keyStateId }] : []),
    ];
    return runChain(entries, store, now(), until);
  };
}

/** Build one search adapter for a provider kind (credential-blind — the key is passed in). */
function makeSearchAdapter(kind: 'tavily' | 'firecrawl' | 'parallel', apiKey: string): SearchProvider {
  if (kind === 'tavily') return makeTavilySearch({ apiKey });
  if (kind === 'firecrawl') return makeFirecrawlSearch({ apiKey });
  return makeParallelSearch({ apiKey });
}

/**
 * Assemble the routed search chain: each resolvable credential becomes a keyed hop
 * in priority order. There is NO free floor for search (no free search backend), so
 * an empty or fully-exhausted chain resolves to `exhausted` and the handler returns
 * empty results (SC-1 / D85).
 */
function buildSearchChain(
  searchCfg: WebSearchConfig | undefined,
  env: Record<string, string | undefined>,
  store: CooldownStore,
  now: () => number,
): RoutedSearch {
  const providers: Array<{ provider: SearchProvider; keyStateId: string }> = [];
  for (const provider of searchCfg?.providers ?? []) {
    for (const cred of provider.credentials) {
      const apiKey = resolveKey(cred, env);
      if (apiKey === undefined) continue;
      providers.push({
        provider: makeSearchAdapter(provider.kind, apiKey),
        keyStateId: `${provider.kind}:${locatorId(cred)}`,
      });
    }
  }
  const until = quotaCooldown(searchCfg?.quotaCooldown);
  return (req) => {
    const entries: ChainEntry<readonly SearchHit[]>[] = providers.map((p) => ({
      run: () => p.provider.search(req),
      keyStateId: p.keyStateId,
    }));
    return runChain(entries, store, now(), until);
  };
}

/**
 * Build the pure-API web-tool ports from config. Both chains share one
 * {@link KeyStateStore}, so a key used for both search and fetch shares one cooldown.
 * Absent `web.search` ⇒ the search chain is empty ⇒ WebSearch returns empty results
 * (D85). The summarizer is injected by the caller (composed at the daemon root).
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
  opts?: { summarizer?: Summarizer; home?: string; now?: () => number; store?: CooldownStore },
): WebToolDeps {
  const store = opts?.store ?? new KeyStateStore(opts?.home ?? homedir());
  const now = opts?.now ?? ((): number => Date.now());
  return {
    searchChain: buildSearchChain(config.search, env, store, now),
    fetchChain: buildFetchChain(config.fetch, env, store, now),
    ...(opts?.summarizer ? { summarizer: opts.summarizer } : {}),
  };
}
```

Note: `ProviderOutcome` is imported for type-consistency with the adapters even though it's referenced only transitively — if `tsc` flags it as unused, drop it from the import.

- [ ] **Step 4: Update `web-tools.test.ts` (the webSearch tests + registration)**

In `packages/core/src/workbench/web-tools.test.ts`:

1. Change the import to bring in `RoutedSearch` and drop `SearchProvider`:

```ts
import {
  webSearch,
  type RoutedSearch,
  webFetch,
  type RoutedFetch,
  WEB_TOOL_CATALOGUE,
  webToolSpecs,
} from './web-tools.js';
```

2. Replace the entire `describe('webSearch', …)` block with:

```ts
describe('webSearch', () => {
  const okChain = (hits: { title: string; url: string; snippet: string }[]): RoutedSearch =>
    async () => ({ status: 'ok', value: hits, clean: true });

  it('returns the chain hits wrapped as a distilled handle', async () => {
    const res = await webSearch(
      { query: 'find x' },
      { searchChain: okChain([{ title: 'T', url: 'https://x.test', snippet: 'S' }]) },
    );
    expect(res.result).toEqual({ results: [{ title: 'T', url: 'https://x.test', snippet: 'S' }] });
    expect(res.pointer).toBe('find x');
  });

  it('SC-1: an exhausted chain returns empty results with a reason (never throws)', async () => {
    const res = await webSearch(
      { query: 'q' },
      { searchChain: async () => ({ status: 'exhausted', lastReason: 'all-down' }) },
    );
    expect(res.result).toEqual({ results: [], reason: 'all-down' });
  });
});
```

3. In the `'dispatches WebSearch through its spec into web deps'` registration test, change the deps object from `search: { search: … }` to a `searchChain`:

```ts
    const deps = { web: { searchChain: async () => ({ status: 'ok' as const, value: [{ title: 'T', url: 'u', snippet: 's' }], clean: true }) } };
```

(The assertion `toMatchObject({ pointer: 'q' })` stays.)

- [ ] **Step 5: Update `parallel.test.ts`**

Replace the two assertions in `packages/core/src/workbench/web/parallel.test.ts` to expect the outcome shape:

```ts
  it('maps Parallel results to an ok outcome of neutral SearchHits', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ results: [{ title: 'T', url: 'https://x.test', excerpts: ['E1', 'E2'] }] }),
    });
    expect(await provider.search({ query: 'q' })).toEqual({
      status: 'ok',
      clean: true,
      value: [{ title: 'T', url: 'https://x.test', snippet: 'E1\nE2' }],
    });
  });

  it('a non-200 response resolves to an error outcome (the chain falls through)', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch,
    });
    await expect(provider.search({ query: 'q' })).resolves.toMatchObject({ status: 'error' });
  });
```

- [ ] **Step 6: Update `web-config.test.ts`**

In `packages/core/src/workbench/web/web-config.test.ts`:

1. Replace the `describe('webConfigSchema', …)` block with (the `provider`/`credential` fields are gone; validate the new `search` block):

```ts
describe('webConfigSchema', () => {
  it('drops unknown fields and parses an empty config', () => {
    const cfg = webConfigSchema.parse({ extra: 1 });
    expect('extra' in cfg).toBe(false);
    expect(cfg.search).toBeUndefined();
    expect(cfg.fetch).toBeUndefined();
  });

  it('parses a search block with a provider union and default quotaCooldown', () => {
    const cfg = webConfigSchema.parse({
      search: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }] },
    });
    expect(cfg.search?.providers[0]?.kind).toBe('tavily');
    expect(cfg.search?.quotaCooldown).toBe('next-midnight');
  });
});
```

2. Replace the `'always returns deps with a callable fetch chain'` test's `deps.search` assertion, and the `'builds a real search provider …'` test, with search-chain equivalents:

```ts
  it('always returns deps with callable search and fetch chains', () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(typeof deps.searchChain).toBe('function');
    expect(typeof deps.fetchChain).toBe('function');
    expect(deps.summarizer).toBeUndefined();
  });

  it('an empty search chain resolves to exhausted (WebSearch returns empty)', async () => {
    const cfg = webConfigSchema.parse({});
    const deps = buildWebToolDeps(cfg, {}, { store: noopStore, now: () => 0 });
    expect(await deps.searchChain({ query: 'q' })).toMatchObject({ status: 'exhausted' });
  });

  it('routes a Tavily search key and marks its credential-blind cooldown id on quota', async () => {
    const marks: Array<{ id: string; until: number }> = [];
    const store: CooldownStore = { isCoolingDown: () => false, markCooldown: (id, until) => marks.push({ id, until }), clear: () => {} };
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 432, headers: { get: () => null }, json: async () => ({}), text: async () => '' }));
    const cfg = webConfigSchema.parse({
      search: { providers: [{ kind: 'tavily', credentials: [{ type: 'env-var', name: 'TAVILY_KEY_1' }] }] },
    });
    const deps = buildWebToolDeps(cfg, { TAVILY_KEY_1: 'tvly-secret' }, { store, now: () => 0 });
    const res = await deps.searchChain({ query: 'q' });
    expect(res.status).toBe('exhausted');
    expect(marks[0]?.id).toBe('tavily:TAVILY_KEY_1');
  });
```

(Keep the existing fetch-chain tests — `'free-floor plain-fetches …'`, `'marks a credential-blind cooldown id when a Firecrawl key rate-limits'`, the Task-2 Tavily-fetch test, and `'includes the injected summarizer …'` — unchanged.)

- [ ] **Step 7: Update `governed-tools.test.ts`**

In `packages/core/src/workbench/governed-tools.test.ts`, replace the `webDeps` helper (lines ~142–145) with:

```ts
  const webDeps = () => ({
    searchChain: async () => ({ status: 'ok' as const, value: [{ title: 'T', url: 'https://x.test', snippet: 'S' }], clean: true }),
    fetchChain: async () => ({ status: 'ok' as const, value: 'hi', clean: false }),
  });
```

(The `'awaits the async WebSearch dispatch …'` test's assertion — `{ results: [{ title: 'T', url: 'https://x.test', snippet: 'S' }] }` — stays valid: the handler returns `{ results: value }`.)

- [ ] **Step 8: Update `daemon.test.ts` (the web config literals)**

In `packages/core/src/session/daemon.test.ts`, every `web:` literal that used `provider`/`credential` must move to the new `search`/`fetch` shape. Update:

1. `'offers WebSearch/WebFetch in baseCatalogue when a web config + resolvable key are present'` — change the `web:` literal to:

```ts
        web: { search: { providers: [{ kind: 'parallel', credentials: [{ type: 'env-var', name: 'PARALLEL_API_KEY' }] }] } },
```

2. `'offers WebFetch via the free floor even when the search key does not resolve'` — change the `web:` literal to:

```ts
        web: { search: { providers: [{ kind: 'parallel', credentials: [{ type: 'env-var', name: 'MISSING_KEY_VAR' }] }] } },
```

3. The Task-6 summarizer composition test (`'composes a DeepSeek summarizer from web.fetch.summarizer …'`) — its `web:` literal currently begins `provider: 'parallel', fetch: { … }`. Remove the `provider: 'parallel',` line so it reads `web: { fetch: { … } }` (the `fetch` block is unchanged).

4. The `describe('buildFetchSummarizer', …)` block — its configs use `webConfigSchema.parse({...})` with a `fetch.summarizer`; no `provider`/`credential` appears there, so no change is needed. If any `webConfigSchema.parse` call in that block passes `provider`/`credential`, remove those keys.

After editing, grep to confirm nothing stale remains: `rg "provider: 'parallel'|credential:" packages/core/src/session/daemon.test.ts` should return no web-config literals (only unrelated matches, if any).

- [ ] **Step 9: Verify (full suite + typecheck)**

Run: `pnpm vitest run packages/core`
Expected: whole package green (skips are fine).

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: clean. (If `tsc` flags a stale `SearchProvider` import or an unused `ProviderOutcome` import in `web-config.ts`, fix the import.)

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web/parallel.ts packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web-tools.test.ts packages/core/src/workbench/web/parallel.test.ts packages/core/src/workbench/web/web-config.test.ts packages/core/src/workbench/governed-tools.test.ts packages/core/src/session/daemon.test.ts
git commit -m "refactor: route web search through a cooldown-aware provider chain"
```

---

## Task 5: Live smokes + docs

**Suggested model:** cheap.

**Files:**
- Modify: `packages/core/src/workbench/web/web-tools.smoke.test.ts` (Tavily search, Tavily extract, Firecrawl search — key-gated)
- Modify: `docs/REPO_LAYOUT.md`
- Commit: the increment-2 spec + plan docs

**Interfaces:**
- Consumes: `makeTavilySearch`, `makeTavilyFetch` (`./tavily.js`), `makeFirecrawlSearch` (`./firecrawl.js`).

- [ ] **Step 1: Append the key-gated live smokes**

In `packages/core/src/workbench/web/web-tools.smoke.test.ts`, add imports and new gated blocks below the existing Parallel + Firecrawl smokes:

```ts
import { makeTavilySearch, makeTavilyFetch } from './tavily.js';
import { makeFirecrawlSearch } from './firecrawl.js';

const hasTavily = !!process.env.TAVILY_KEY_1;
const hasFirecrawlSearch = !!process.env.FIRECRAWL_KEY_1;

describe.skipIf(!hasTavily)('tavily live smoke', () => {
  it('WebSearch returns real hits from Tavily', async () => {
    const outcome = await makeTavilySearch({ apiKey: process.env.TAVILY_KEY_1! }).search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') {
      expect(outcome.value.length).toBeGreaterThan(0);
      expect(outcome.value[0]!.url).toMatch(/^https?:\/\//);
    }
  }, 20_000);

  it('WebFetch extracts clean markdown from Tavily', async () => {
    const outcome = await makeTavilyFetch({ apiKey: process.env.TAVILY_KEY_1! }).fetch('https://example.com');
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.value.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.skipIf(!hasFirecrawlSearch)('firecrawl search live smoke', () => {
  it('WebSearch returns real hits from Firecrawl', async () => {
    const outcome = await makeFirecrawlSearch({ apiKey: process.env.FIRECRAWL_KEY_1! }).search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(outcome.status).toBe('ok');
    if (outcome.status === 'ok') expect(outcome.value.length).toBeGreaterThan(0);
  }, 20_000);
});
```

- [ ] **Step 2: Verify the smokes skip cleanly**

Run: `npx vitest run packages/core/src/workbench/web/web-tools.smoke.test.ts`
Expected: PASS with the Tavily + Firecrawl-search blocks reported as skipped (no keys set). Do NOT set real keys.

- [ ] **Step 3: Update `docs/REPO_LAYOUT.md`**

In `docs/REPO_LAYOUT.md`, update the M6 Workbench row's `workbench/web/` note to mention that BOTH WebSearch and WebFetch route through cooldown-aware provider chains, and list the providers. Replace the existing `workbench/web/` clause with:

`; \`workbench/web/\` (credential-gated WebSearch/WebFetch) pulls in \`turndown\` and routes BOTH tools through cooldown-aware provider chains (\`routing.ts\` + \`key-state-store.ts\` → \`~/.coa/web-keys.json\`, shared \`limits.ts\` classifiers): fetch = \`firecrawl.ts\`/\`tavily.ts\` scrape+extract → \`plain-fetch.ts\` free floor; search = \`tavily.ts\`/\`firecrawl.ts\`/\`parallel.ts\`; the WebFetch summarizer is composed at the daemon root over \`@coa/adapter-deepseek\`.`

- [ ] **Step 4: Final whole-package check**

Run: `pnpm vitest run packages/core`
Expected: green.

Run: `pnpm --filter @coa/core exec tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/web-tools.smoke.test.ts docs/REPO_LAYOUT.md docs/superpowers/specs/2026-07-04-web-tool-routing-increment-2-design.md docs/superpowers/plans/2026-07-04-web-tool-routing-increment-2.md
git commit -m "test: add tavily and firecrawl-search live smokes"
```

---

## Self-Review Notes (for the executor)

- **Spec coverage:** Task 1 = shared limit classifiers (spec §3); Task 2 = Tavily-extract fetch hop (spec §2); Task 3 = Tavily + Firecrawl search adapters (spec §1); Task 4 = the WebSearch routed refactor + config (spec §1, §4, §5, §6) + Parallel refactor; Task 5 = live smokes (spec §Testing). Deferred (exa/brave, scrapeOptions, include_answer, legacy-config shim) intentionally NOT built.
- **Type consistency:** `SearchRequest` (added Task 3) is the exact arg type the adapters, the new `SearchProvider`, and `RoutedSearch` all use. `ProviderOutcome<readonly SearchHit[]>` is the adapter return; `runChain<readonly SearchHit[]>` yields `ChainResult<readonly SearchHit[]>`; the handler reads `.value`/`.lastReason`. Search sets `clean: true` (ignored by the handler).
- **Breaking-change ordering:** Tasks 1–3 are additive (package compiles after each). Task 4 is the single breaking refactor and updates all five affected test files in one commit. Task 5 is docs/smokes.
- **Shared-cooldown property:** both chains are built over the one `store` in `buildWebToolDeps`, and hops key on `${kind}:${locatorId}`, so a Firecrawl/Tavily key listed in both `web.search` and `web.fetch` shares its cooldown — verified by the credential-blind id tests.

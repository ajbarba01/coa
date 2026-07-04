# Owned WebSearch + WebFetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give coa's pure-API agents (DeepSeek today) `WebSearch` and `WebFetch` tools that coa executes itself, faithfully mirroring Claude's server-side versions.

**Architecture:** Two new pure handlers in `packages/core/src/workbench/web-tools.ts`, dispatched through the existing `buildGovernedTools` seam and registered as in-process MCP tools on the owned-adapter path. Following the base-tools pattern, `web-tools.ts` defines the handlers plus injectable ports (`SearchProvider`, `Summarizer`, a `fetch` port, and a `recordCost` callback); concrete adapters (Parallel HTTP, the DeepSeek-backed summarizer) are wired at the composition root, not in core. Neither tool touches the M1 spine (no `emit`); both obey SC-1 (never throw, never deny).

**Tech Stack:** TypeScript (strict), Zod, Vitest, `@coa/loop-driver` (`CompleteFn`), `turndown` (HTML→markdown), Parallel.ai Search API.

## Global Constraints

- TypeScript `strict`, no `any`.
- Every handler obeys SC-1: never throws, never denies — errors return an unapplied `ToolResponse` result.
- No model call on any critical path (P1); the summarizer is a tool-invoked, configurable, omittable call.
- Strict-superset (D85): WebFetch with no summarizer configured returns cleaned page markdown, never worse than absent.
- No-lock-in: the search backend is a swappable `SearchProvider` port; default adapter is Parallel.ai.
- Typed boundaries: all external data (provider responses, fetched bodies) validated/parsed at the edge with Zod (M0 owns schemas).
- Stage files by name (never `git add -A`). Commit subject-only Conventional Commits, no body/trailer, no internal identifiers.
- **Branch:** implement on `main` — after the branch consolidation, the base tools (`baseToolSpecs()`/`buildGovernedTools`) are present on `main`. There is now a single branch.
- Same-commit doc rule: update `docs/design/research/pure-api-base-tools.md` and `docs/REPO_LAYOUT.md` when a package/dependency is added.

---

### Task 1: WebSearch handler + `SearchProvider` port

**Files:**
- Create: `packages/core/src/workbench/web-tools.ts`
- Test: `packages/core/src/workbench/web-tools.test.ts`

**Interfaces:**
- Consumes: `ToolResponse<R>` from `@coa/shared`; `wrap` from `./base-tools.js`.
- Produces:
  - `interface SearchHit { title: string; url: string; snippet: string }`
  - `interface SearchProvider { search(req: { query: string; allowedDomains?: readonly string[]; blockedDomains?: readonly string[]; maxResults?: number }): Promise<readonly SearchHit[]> }`
  - `type WebSearchResult = { results: readonly SearchHit[] } | { results: readonly []; reason: string }`
  - `webSearch(req, deps): Promise<ToolResponse<WebSearchResult>>` where `deps: { search: SearchProvider }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { webSearch, type SearchProvider } from './web-tools.js';

const okProvider = (hits: { title: string; url: string; snippet: string }[]): SearchProvider => ({
  search: async () => hits,
});

describe('webSearch', () => {
  it('returns provider hits wrapped as a distilled handle', async () => {
    const provider = okProvider([{ title: 'T', url: 'https://x.test', snippet: 'S' }]);
    const res = await webSearch({ query: 'find x' }, { search: provider });
    expect(res.result).toEqual({ results: [{ title: 'T', url: 'https://x.test', snippet: 'S' }] });
    expect(res.pointer).toBe('find x');
  });

  it('SC-1: a provider throw degrades to an empty result with a reason (never throws)', async () => {
    const provider: SearchProvider = { search: async () => { throw new Error('boom'); } };
    const res = await webSearch({ query: 'q' }, { search: provider });
    expect(res.result.results).toEqual([]);
    expect('reason' in res.result && res.result.reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- web-tools`
Expected: FAIL — cannot find module `./web-tools.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ToolResponse } from '@coa/shared';
import { wrap } from './base-tools.js';

/**
 * The pure-API web tools (WebSearch/WebFetch). coa supplies these only on the
 * owned-adapter path — Claude gets equivalents server-side. They are egress tools:
 * they never touch the worktree and never emit a change-event. Every handler obeys
 * SC-1 — a provider error or dead URL comes back as an unapplied result, never a throw.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** The swappable search backend (no-lock-in seam). Default adapter: Parallel.ai. */
export interface SearchProvider {
  search(req: {
    query: string;
    allowedDomains?: readonly string[];
    blockedDomains?: readonly string[];
    maxResults?: number;
  }): Promise<readonly SearchHit[]>;
}

export type WebSearchResult =
  | { results: readonly SearchHit[] }
  | { results: readonly []; reason: string };

/** `WebSearch` — mirrors Claude's args (query + optional domain filters). */
export async function webSearch(
  req: { query: string; allowed_domains?: readonly string[]; blocked_domains?: readonly string[] },
  deps: { search: SearchProvider },
): Promise<ToolResponse<WebSearchResult>> {
  try {
    const results = await deps.search({
      query: req.query,
      ...(req.allowed_domains ? { allowedDomains: req.allowed_domains } : {}),
      ...(req.blocked_domains ? { blockedDomains: req.blocked_domains } : {}),
    });
    return wrap({ results }, `web_search:${req.query}`, req.query);
  } catch (err) {
    return wrap({ results: [], reason: String(err) }, 'web_search:error', req.query);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- web-tools`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web-tools.test.ts
git commit -m "feat: add WebSearch handler with a swappable search provider port"
```

---

### Task 2: WebFetch handler + `Summarizer` port + raw-markdown degrade

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts`
- Test: `packages/core/src/workbench/web-tools.test.ts`

**Interfaces:**
- Consumes: `wrap` from `./base-tools.js`.
- Produces:
  - `type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; contentType: string; body: string }>`
  - `interface Summarizer { summarize(req: { markdown: string; prompt: string }): Promise<string> }`
  - `type HtmlToMarkdown = (html: string) => string`
  - `type WebFetchResult = { fetched: true; content: string; summarized: boolean } | { fetched: false; reason: string }`
  - `webFetch(req, deps): Promise<ToolResponse<WebFetchResult>>` where `deps: { fetch: FetchLike; htmlToMarkdown: HtmlToMarkdown; summarizer?: Summarizer; maxChars?: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { webFetch, type FetchLike } from './web-tools.js';

const okFetch = (body: string, contentType = 'text/html'): FetchLike =>
  async () => ({ ok: true, status: 200, contentType, body });

describe('webFetch', () => {
  const md = (html: string) => html.replace(/<[^>]+>/g, '').trim();

  it('summarizes via the Summarizer when one is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'what is x?' },
      { fetch: okFetch('<p>hello</p>'), htmlToMarkdown: md, summarizer: { summarize: async () => 'SUMMARY' } },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'SUMMARY', summarized: true });
  });

  it('D85: degrades to raw markdown when no summarizer is configured', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: okFetch('<p>hello</p>'), htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: true, content: 'hello', summarized: false });
  });

  it('truncates raw markdown to maxChars', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: okFetch('<p>abcdef</p>'), htmlToMarkdown: md, maxChars: 3 },
    );
    expect((res.result as { content: string }).content).toBe('abc');
  });

  it('SC-1: a non-HTML content type returns an unapplied result', async () => {
    const res = await webFetch(
      { url: 'https://x.test/data.bin', prompt: 'p' },
      { fetch: okFetch('binary', 'application/octet-stream'), htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: false });
  });

  it('SC-1: a fetch throw returns an unapplied result (never throws)', async () => {
    const res = await webFetch(
      { url: 'https://x.test', prompt: 'p' },
      { fetch: async () => { throw new Error('dns'); }, htmlToMarkdown: md },
    );
    expect(res.result).toMatchObject({ fetched: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- web-tools`
Expected: FAIL — `webFetch` is not exported.

- [ ] **Step 3: Write minimal implementation** (append to `web-tools.ts`)

```ts
/** A minimal fetch surface (injectable so handlers are unit-testable with no network). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}>;

/** HTML→markdown conversion (injected; the concrete lib is chosen at the wiring layer). */
export type HtmlToMarkdown = (html: string) => string;

/** The optional page-summarizer (a stripped model call). Absent ⇒ raw-markdown mode (D85). */
export interface Summarizer {
  summarize(req: { markdown: string; prompt: string }): Promise<string>;
}

export type WebFetchResult =
  | { fetched: true; content: string; summarized: boolean }
  | { fetched: false; reason: string };

const DEFAULT_MAX_CHARS = 100_000;

/** `WebFetch` — mirrors Claude's args (url + prompt). Fetch → HTML→markdown → optional summarize. */
export async function webFetch(
  req: { url: string; prompt: string },
  deps: { fetch: FetchLike; htmlToMarkdown: HtmlToMarkdown; summarizer?: Summarizer; maxChars?: number },
): Promise<ToolResponse<WebFetchResult>> {
  let resp: Awaited<ReturnType<FetchLike>>;
  try {
    resp = await deps.fetch(req.url);
  } catch (err) {
    return wrap({ fetched: false, reason: `fetch-failed: ${String(err)}` }, 'web_fetch:error', req.url);
  }
  if (!resp.ok) return wrap({ fetched: false, reason: `http-${resp.status}` }, 'web_fetch:error', req.url);
  if (!resp.contentType.includes('html') && !resp.contentType.includes('text/plain')) {
    return wrap({ fetched: false, reason: `unsupported-content-type: ${resp.contentType}` }, 'web_fetch:error', req.url);
  }
  const markdown = deps.htmlToMarkdown(resp.body);
  if (deps.summarizer) {
    try {
      const content = await deps.summarizer.summarize({ markdown, prompt: req.prompt });
      return wrap({ fetched: true, content, summarized: true }, `web_fetch:${req.url}`, req.url);
    } catch {
      // Summarizer failure degrades to raw markdown rather than failing the fetch (D85 / SC-1).
    }
  }
  const cap = deps.maxChars ?? DEFAULT_MAX_CHARS;
  return wrap({ fetched: true, content: markdown.slice(0, cap), summarized: false }, `web_fetch:${req.url}`, req.url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- web-tools`
Expected: PASS (all webFetch + webSearch tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/web-tools.test.ts
git commit -m "feat: add WebFetch handler with an optional summarizer and raw-markdown fallback"
```

---

### Task 3: Register web tools in the catalogue + dispatch

**Files:**
- Modify: `packages/core/src/workbench/web-tools.ts` (add catalogue entries + specs)
- Modify: `packages/core/src/workbench/governed-tools.ts` (extend `GovernedToolDeps` + merge specs)
- Test: `packages/core/src/workbench/web-tools.test.ts`

**Interfaces:**
- Consumes: `spec`, `ToolSpec`, `GovernedToolDeps` from `./governed-tools.js`; `ToolManifestEntry` from `./catalogue.js`; `z` from `zod`.
- Produces:
  - `WEB_TOOL_CATALOGUE: readonly ToolManifestEntry[]`
  - `webToolSpecs(): Record<string, ToolSpec>`
  - `GovernedToolDeps.web?: WebToolDeps` where `interface WebToolDeps { search: SearchProvider; fetch: FetchLike; htmlToMarkdown: HtmlToMarkdown; summarizer?: Summarizer }`

- [ ] **Step 1: Write the failing test**

```ts
import { WEB_TOOL_CATALOGUE, webToolSpecs } from './web-tools.js';

describe('web tool registration', () => {
  it('catalogues WebSearch and WebFetch as kernel egress tools', () => {
    expect(WEB_TOOL_CATALOGUE.map((e) => e.name)).toEqual(['WebSearch', 'WebFetch']);
    expect(WEB_TOOL_CATALOGUE.every((e) => e.group === 'egress')).toBe(true);
  });

  it('dispatches WebSearch through its spec into web deps', async () => {
    const specs = webToolSpecs();
    const deps = { web: { search: { search: async () => [{ title: 'T', url: 'u', snippet: 's' }] } } };
    const res = specs.WebSearch.dispatch({ query: 'q' }, deps as never);
    await expect(Promise.resolve(res as never)).resolves.toMatchObject({ pointer: 'q' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- web-tools`
Expected: FAIL — `WEB_TOOL_CATALOGUE` / `webToolSpecs` not exported.

- [ ] **Step 3: Write minimal implementation**

In `web-tools.ts` add:

```ts
import { z } from 'zod';
import { spec, type ToolSpec, type GovernedToolDeps } from './governed-tools.js';
import type { ToolManifestEntry } from './catalogue.js';

/** The pure-API web-tool ports; present only when the adapter wires egress. */
export interface WebToolDeps {
  search: SearchProvider;
  fetch: FetchLike;
  htmlToMarkdown: HtmlToMarkdown;
  summarizer?: Summarizer;
}

/** Always-loaded (kernel) egress tools, supplied only on the pure-API path. */
export const WEB_TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  { name: 'WebSearch', partition: 'kernel', group: 'egress', description: 'search the web' },
  { name: 'WebFetch', partition: 'kernel', group: 'egress', description: 'fetch a URL and optionally summarize it' },
];

export function webToolSpecs(): Record<string, ToolSpec> {
  const w = (deps: { web?: WebToolDeps }): WebToolDeps => {
    if (deps.web === undefined) throw new Error('web tools require GovernedToolDeps.web');
    return deps.web;
  };
  return {
    WebSearch: spec(
      { query: z.string(), allowed_domains: z.array(z.string()).optional(), blocked_domains: z.array(z.string()).optional() },
      (a, d) => webSearch(a, { search: w(d).search }) as never,
    ),
    WebFetch: spec(
      { url: z.string(), prompt: z.string() },
      (a, d) => {
        const wd = w(d);
        return webFetch(a, {
          fetch: wd.fetch,
          htmlToMarkdown: wd.htmlToMarkdown,
          ...(wd.summarizer ? { summarizer: wd.summarizer } : {}),
        }) as never;
      },
    ),
  };
}
```

> Note: `webSearch`/`webFetch` are async; `ToolSpec.dispatch` returns `ToolResponse<unknown>`. Confirm whether `buildGovernedTools`'s `invokeSpec` already awaits async dispatch — if not, extend `ToolSpec.dispatch` to allow `Promise<ToolResponse<unknown>>` and `await` it in `invokeSpec` (small, localized change; add a test that an async spec resolves through `invoke`). This is the one cross-cutting edit and belongs in this task.

In `governed-tools.ts`, add to `GovernedToolDeps`:

```ts
  /** The pure-API web-tool ports; present only when built with egress. */
  web?: WebToolDeps;
```

and merge `webToolSpecs()` into the specs table where `baseToolSpecs()` is merged (guarded the same way).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- web-tools governed-tools`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web-tools.ts packages/core/src/workbench/governed-tools.ts packages/core/src/workbench/web-tools.test.ts
git commit -m "feat: register the web tools in the governed dispatch catalogue"
```

---

### Task 4: Parallel.ai `SearchProvider` adapter

**Files:**
- Create: `packages/core/src/workbench/web/parallel.ts`
- Test: `packages/core/src/workbench/web/parallel.test.ts`

**Interfaces:**
- Consumes: `SearchProvider`, `SearchHit` from `../web-tools.js`.
- Produces: `makeParallelSearch(config: { apiKey: string; fetchImpl?: typeof fetch; baseUrl?: string }): SearchProvider`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';

const fakeFetch = (payload: unknown): typeof fetch =>
  (async () => ({ ok: true, status: 200, json: async () => payload })) as unknown as typeof fetch;

describe('makeParallelSearch', () => {
  it('maps Parallel results to neutral SearchHits', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: fakeFetch({ results: [{ title: 'T', url: 'https://x.test', excerpts: ['E1', 'E2'] }] }),
    });
    const hits = await provider.search({ query: 'q' });
    expect(hits).toEqual([{ title: 'T', url: 'https://x.test', snippet: 'E1\nE2' }]);
  });

  it('a non-200 response resolves to no hits (handler applies SC-1)', async () => {
    const provider = makeParallelSearch({
      apiKey: 'k',
      fetchImpl: (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch,
    });
    await expect(provider.search({ query: 'q' })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- parallel`
Expected: FAIL — cannot find `./parallel.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from 'zod';
import type { SearchHit, SearchProvider } from '../web-tools.js';

const DEFAULT_BASE_URL = 'https://api.parallel.ai/v1beta/search';

const parallelResponseSchema = z.object({
  results: z
    .array(z.object({ title: z.string().default(''), url: z.string(), excerpts: z.array(z.string()).default([]) }))
    .default([]),
});

/** Parallel.ai Search adapter — thin HTTP, injectable fetch, credential-blind (key passed in). */
export function makeParallelSearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): SearchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req): Promise<readonly SearchHit[]> {
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
      if (!res.ok) return [];
      const parsed = parallelResponseSchema.safeParse(await res.json());
      if (!parsed.success) return [];
      return parsed.data.results.map((r) => ({ title: r.title, url: r.url, snippet: r.excerpts.join('\n') }));
    },
  };
}
```

> Confirm Parallel's exact request/response field names against `https://docs.parallel.ai` at implementation time; the Zod schema is the single edit point if they differ.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- parallel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/parallel.ts packages/core/src/workbench/web/parallel.test.ts
git commit -m "feat: add the Parallel search provider adapter"
```

---

### Task 5: Summarizer over `CompleteFn` + ledger cost

**Files:**
- Create: `packages/core/src/workbench/web/summarizer.ts`
- Test: `packages/core/src/workbench/web/summarizer.test.ts`

**Interfaces:**
- Consumes: `Summarizer` from `../web-tools.js`; `CompleteFn`, `DriverMessage` from `@coa/loop-driver`; `RuntimeUsage` from `@coa/spi`.
- Produces: `makeSummarizer(config: { complete: CompleteFn; recordCost?: (usage: RuntimeUsage) => void; systemPrompt?: string }): Summarizer`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { makeSummarizer } from './summarizer.js';

const completeReturning = (text: string) =>
  vi.fn(async () => ({ text, toolCalls: [], usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 } }));

describe('makeSummarizer', () => {
  it('feeds page + prompt to complete() and returns its text', async () => {
    const complete = completeReturning('SUMMARY');
    const s = makeSummarizer({ complete });
    const out = await s.summarize({ markdown: '# page', prompt: 'what is it?' });
    expect(out).toBe('SUMMARY');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('records the summarize call cost to the ledger port', async () => {
    const recordCost = vi.fn();
    const s = makeSummarizer({ complete: completeReturning('x'), recordCost });
    await s.summarize({ markdown: 'm', prompt: 'p' });
    expect(recordCost).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- summarizer`
Expected: FAIL — cannot find `./summarizer.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CompleteFn, DriverMessage } from '@coa/loop-driver';
import type { RuntimeUsage } from '@coa/spi';
import type { Summarizer } from '../web-tools.js';

const DEFAULT_SYSTEM =
  'You summarize a fetched web page to answer the user prompt. Be faithful to the page; do not invent facts.';

/**
 * A minimal summarizer agent over the shared `complete()` primitive. Bound at the
 * wiring layer to a cheap model (e.g. DeepSeek V4 flash); its cost is recorded to
 * the M7 ledger via `recordCost`. It offers no tools — one round-trip, text out.
 */
export function makeSummarizer(config: {
  complete: CompleteFn;
  recordCost?: (usage: RuntimeUsage) => void;
  systemPrompt?: string;
}): Summarizer {
  return {
    async summarize(req): Promise<string> {
      const messages: DriverMessage[] = [
        { role: 'system', content: config.systemPrompt ?? DEFAULT_SYSTEM },
        { role: 'user', content: `Prompt: ${req.prompt}\n\nPage:\n${req.markdown}` },
      ];
      const result = await config.complete(messages, []);
      config.recordCost?.(result.usage);
      return result.text;
    },
  };
}
```

> Confirm the `DriverMessage`/`BackendMessage` field names (`role`/`content`) against `@coa/shared` at implementation time; adjust the two message literals if the shape differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- summarizer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/workbench/web/summarizer.ts packages/core/src/workbench/web/summarizer.test.ts
git commit -m "feat: add a minimal summarizer agent over the shared completion primitive"
```

---

### Task 6: Config `web` block + credential resolution + wiring

**Files:**
- Modify: the owned-adapter config schema (locate via `git grep -n "searchProvider\|web" packages/*/src` and the existing account/model-config schema; likely `packages/core/src/**` or `packages/shared/src/**`)
- Modify: the composition root that builds `GovernedToolDeps` for the pure-API adapter (locate via `git grep -n "buildGovernedTools\|includeBaseTools\|base:" packages apps`)
- Test: a co-located `*.test.ts` next to the schema, and a wiring test next to the composition root.

**Interfaces:**
- Consumes: `resolveApiKey` / the `Locator` pattern from `@coa/adapter-deepseek` (or the shared credential locator); `makeParallelSearch`, `makeSummarizer`, `WebToolDeps`.
- Produces: a `webConfigSchema` (Zod) and a `buildWebToolDeps(config, env): WebToolDeps | undefined` that returns `undefined` when no search credential resolves (so the tools simply aren't offered — strict-superset).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { webConfigSchema, buildWebToolDeps } from './web-config.js';

describe('web config', () => {
  it('drops unknown fields and defaults the provider to parallel', () => {
    const cfg = webConfigSchema.parse({ credential: { type: 'env-var', name: 'PARALLEL_API_KEY' }, extra: 1 });
    expect(cfg.provider).toBe('parallel');
    expect('extra' in cfg).toBe(false);
  });

  it('returns undefined web deps when the search key does not resolve (tools not offered)', () => {
    const deps = buildWebToolDeps(
      { provider: 'parallel', credential: { type: 'env-var', name: 'MISSING' } },
      {},
    );
    expect(deps).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coa/core test -- web-config`
Expected: FAIL — cannot find `./web-config.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/workbench/web/web-config.ts`:

```ts
import { z } from 'zod';
import type { WebToolDeps } from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';

// Reuse the shared credential-locator schema if one exists; this local shape matches
// the env-var/key-file pointer the DeepSeek adapter uses. Replace with the shared schema at wiring.
const locatorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('env-var'), name: z.string() }),
  z.object({ type: z.literal('key-file'), path: z.string() }),
]);

export const webConfigSchema = z
  .object({
    provider: z.enum(['parallel', 'exa', 'tavily', 'brave']).default('parallel'),
    credential: locatorSchema,
    summarizerModel: z.object({ provider: z.string(), model: z.string() }).optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;

function resolveKey(loc: WebConfig['credential'], env: Record<string, string | undefined>): string | undefined {
  if (loc.type === 'env-var') return env[loc.name] || undefined;
  return undefined; // key-file resolution reuses the DeepSeek readKeyFile at wiring.
}

/**
 * Build the web-tool ports from config, or `undefined` when no search key resolves —
 * in which case the tools are simply not offered (strict-superset). The summarizer +
 * htmlToMarkdown + fetch are injected here at the composition root, not shown.
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
): WebToolDeps | undefined {
  const apiKey = resolveKey(config.credential, env);
  if (config.provider !== 'parallel') return undefined; // only parallel wired at launch
  if (!apiKey) return undefined;
  // htmlToMarkdown, fetch, summarizer are assembled by the composition root and passed here;
  // this function only proves the credential-gated shape. See the composition-root wiring step.
  throw new Error('assemble full WebToolDeps at the composition root');
}
```

> This task's deliverable is the *schema + credential gate* (the two tested behaviors). The full `WebToolDeps` assembly — binding `makeParallelSearch(apiKey)`, `makeSummarizer(complete)`, a `turndown` `htmlToMarkdown`, and a real `fetch` adapter matching `FetchLike` — lands at the composition root in the same commit; wire it where the base-tool deps are assembled and add a wiring test that asserts a built adapter exposes `WebSearch`/`WebFetch` in its tool list. Split the `throw` out once the real ports are in scope.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coa/core test -- web-config`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the composition root**

Assemble `WebToolDeps` where base-tool deps are built, add `web` to `GovernedToolDeps`, add a `turndown`-backed `htmlToMarkdown`, and a `fetch` adapter that maps `Response` → `{ ok, status, contentType, body }`. Add `turndown` to the package via `pnpm --filter @coa/core add turndown` and its types. Add a wiring test asserting the pure-API adapter offers `WebSearch`/`WebFetch` when a key is present and omits them when absent.

- [ ] **Step 6: Update docs + commit**

Update `docs/design/research/pure-api-base-tools.md` (note the two egress tools) and `docs/REPO_LAYOUT.md` (the `turndown` dependency).

```bash
git add packages/core/src/workbench/web/web-config.ts packages/core/src/workbench/web/web-config.test.ts <composition-root files> package.json pnpm-lock.yaml docs/design/research/pure-api-base-tools.md docs/REPO_LAYOUT.md
git commit -m "feat: wire the web tools into the pure-API adapter behind a credential gate"
```

---

### Task 7: Live smoke test (manual, key-gated)

**Files:**
- Create: `packages/core/src/workbench/web/web-tools.smoke.test.ts` (skipped unless `PARALLEL_API_KEY` + a DeepSeek key are set)

**Interfaces:**
- Consumes: the fully-wired `SearchProvider` + `Summarizer`.

- [ ] **Step 1: Write the gated smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { makeParallelSearch } from './parallel.js';

const hasKey = !!process.env.PARALLEL_API_KEY;

describe.skipIf(!hasKey)('web tools live smoke', () => {
  it('WebSearch returns real hits from Parallel', async () => {
    const provider = makeParallelSearch({ apiKey: process.env.PARALLEL_API_KEY! });
    const hits = await provider.search({ query: 'anthropic claude api pricing', maxResults: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.url).toMatch(/^https?:\/\//);
  }, 20_000);
});
```

- [ ] **Step 2: Run manually with a key**

Run: `PARALLEL_API_KEY=... pnpm --filter @coa/core test -- web-tools.smoke`
Expected: PASS (or SKIP with no key). Validate Parallel's throughput/rate-limit headroom here (open item from the spec).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/workbench/web/web-tools.smoke.test.ts
git commit -m "test: add a key-gated live smoke for the web tools"
```

---

## Self-Review

- **Spec coverage:** WebSearch (Task 1, 4), WebFetch + summarizer + degrade (Task 2, 5), registration/dispatch (Task 3), config/credentials/wiring (Task 6), mock-first + live smoke (all tasks + Task 7), placement in `web-tools.ts` sibling (Task 1). Deferred items (full S-4 policy, caching, extra adapters) are correctly left out.
- **Type consistency:** `SearchProvider`/`SearchHit`/`Summarizer`/`FetchLike`/`HtmlToMarkdown`/`WebToolDeps` defined in Tasks 1–3 and consumed unchanged in Tasks 4–6; `webSearch`/`webFetch` signatures match their specs.
- **Open items carried into execution (confirm against the branch, not guesses):** whether `invokeSpec` already awaits async dispatch (Task 3); Parallel's exact request/response field names (Task 4); `DriverMessage` field names (Task 5); the shared credential-locator schema location (Task 6); the composition-root file that assembles base-tool deps (Task 6).

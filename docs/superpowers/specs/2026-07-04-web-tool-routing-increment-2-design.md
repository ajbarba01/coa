# Cooldown-aware web-tool routing (increment 2 — search + Tavily/Firecrawl providers) — design

_Date: 2026-07-04 · Status: approved design, pre-plan_

## Problem

Increment 1 shipped cooldown-aware routing for **WebFetch** (all Firecrawl keys → free plain-fetch floor) and
built a generic routing core (`runChain` + `KeyStateStore` + `ProviderOutcome`). Two gaps remain, both required
to "use an assortment of Firecrawl and Tavily keys for web search and web fetch":

1. **WebSearch is still single-key.** It calls one Parallel key (and returns empty without one) — no key list,
   no cooldown, no Tavily. The search side of the routing was explicitly deferred to this increment.
2. **WebFetch has no Tavily hop.** Its chain accepts only `kind: firecrawl` providers; Tavily-extract was
   deferred as a second `FetchProvider`.

This increment closes both by **reusing the increment-1 routing core unchanged** — the core is already generic
over the value type (`runChain<T>`), so search (`SearchHit[]`) and fetch (`string`) share it.

Concrete target stack: **WebSearch** = a routed chain of Tavily → Firecrawl-search → Parallel keys; **WebFetch**
= Firecrawl-scrape keys → Tavily-extract keys → free plain-fetch floor.

## Principles (unchanged from increment 1)

- **SC-1** — tools never throw/deny; provider failures return classified `ProviderOutcome`s. An exhausted search
  chain returns empty results with a reason (WebSearch has **no free floor** — there is no free search backend).
- **Strict-superset (D85)** — absent `web.search` config, WebSearch returns empty results exactly as today; the
  WebFetch free floor is still the always-last hop.
- **No-lock-in** — every provider is a swappable adapter behind a port; adding one = an adapter + appending keys.
- **Credential-blind** — config holds locator *pointers*; the cooldown store keys on `${providerKind}:${locatorId}`,
  never the secret.
- **Determinism-first (P1)** — the router + cooldown logic stay pure/deterministic; no model call on this path
  (search returns provider hits; the optional fetch summarizer is the only model call, unchanged).

## Reused unchanged (no edits)

`runChain`, `KeyStateStore`, `ProviderOutcome<T>`, `ChainEntry<T>`, `ChainResult<T>`, `CooldownStore`,
`nextLocalMidnight`, `locatorId` (`packages/core/src/workbench/web/routing.ts` + `key-state-store.ts`). The search
adapters return `ProviderOutcome<readonly SearchHit[]>` and the search chain is `runChain<readonly SearchHit[]>`.

**Emergent property (call it out):** the store keys on `${kind}:${locatorId}`, and both chains share one
`KeyStateStore`, so **the same Firecrawl (or Tavily) key used in both search and fetch shares one cooldown** — a
429/402 from either endpoint cools the account for both. This is correct: rate-limit/quota is account-level.

## Components

### 1. Search chain — the `SearchProvider` port, routed

Today `SearchProvider.search(req): Promise<readonly SearchHit[]>` is a single throwing-swallowed provider. Replace
it with an **outcome-returning** port so the search chain mirrors the fetch chain:

```ts
interface SearchProvider { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>>; }
// SearchRequest = { query: string; allowedDomains?: readonly string[]; blockedDomains?: readonly string[]; maxResults?: number }
type RoutedSearch = (req: SearchRequest) => Promise<ChainResult<readonly SearchHit[]>>;
```

Adapters map their own response + status codes to a `ProviderOutcome` (`clean` is unused for search — set
`true`; the handler ignores it):

- **`tavily`** — `POST https://api.tavily.com/search`, `Authorization: Bearer tvly-<key>`, body
  `{ query, max_results, include_domains?, exclude_domains? }`. Success → `results[]` → `SearchHit{title, url,
  snippet: content}`. **429** → rate-limit (Retry-After parsed if present); **432/433** → quota; **401** →
  error (bad key — retrying won't help, so no cooldown); other non-ok → error. Injectable `fetchImpl`.
- **`firecrawl`** (search) — `POST https://api.firecrawl.dev/v2/search`, `Authorization: Bearer <key>`, body
  `{ query, limit, sources: [{ type: 'web' }], includeDomains?, excludeDomains? }`. Success → `data.web[]` →
  `SearchHit{title, url, snippet: description}`. **429** → rate-limit; **402** → quota; other non-ok → error.
- **`parallel`** — the existing `makeParallelSearch` (`web/parallel.ts`), refactored to return a
  `ProviderOutcome` instead of `SearchHit[]`/`[]`: success → ok; non-2xx or parse failure → error (Parallel does
  not publish rate-limit codes, so it never emits `limit` — it just falls through to the next hop on error).

### 2. Fetch chain gains a Tavily-extract hop

- **`makeTavilyFetch`** (`FetchProvider`) — `POST https://api.tavily.com/extract`, `Authorization: Bearer
  tvly-<key>`, body `{ urls: [url], format: 'markdown' }`. Success → `results[0].raw_content` →
  `{ status:'ok', value: markdown, clean: true }` (Tavily extract returns clean markdown, so it SKIPS the
  summarizer, like Firecrawl). Empty `results` / non-empty `failed_results` with no result → error. **429** →
  rate-limit; **432/433** → quota; other non-ok → error. Injectable `fetchImpl`.
- Extend the `web.fetch.providers` provider union to accept `kind: 'tavily'`; `buildFetchChain` builds a
  `makeTavilyFetch` hop for each resolvable Tavily credential, in the configured order, before the free floor.

### 3. Shared per-provider limit classifiers (DRY)

Two providers appear on both chains, so factor their status→outcome mapping into one helper each, reused by both
adapters (avoids two Firecrawl mappings drifting):

- `firecrawlLimit(status, headers)` → `{kind:'rate-limit', retryAfterMs?}` (429) | `{kind:'quota'}` (402) |
  `undefined` (not a limit) — used by the increment-1 `firecrawl` fetch adapter AND the new `firecrawl` search
  adapter.
- `tavilyLimit(status, headers)` → rate-limit (429) | quota (432/433) | `undefined` — used by the `tavily`
  search AND `tavily` extract adapters.

(The increment-1 `firecrawl.ts` fetch adapter is refactored to call `firecrawlLimit`; behavior unchanged, verified
by its existing tests.)

### 4. WebSearch handler refactor

Mirror the increment-1 WebFetch refactor. `webSearch(req, { searchChain: RoutedSearch })`: run the chain; on
`ok` → `wrap({ results }, ...)`; on `exhausted` → `wrap({ results: [], reason }, ...)`. No `emit` (egress). This
reshapes `WebToolDeps.search` (a single `SearchProvider`) into `WebToolDeps.searchChain` (the routed chain) — the
same cleanup applied to fetch in increment 1.

### 5. Config shape

```yaml
web:
  fetch:
    providers:                     # priority order; now a firecrawl|tavily union
      - { kind: firecrawl, credentials: [ {type: env-var, name: FIRECRAWL_KEY_1}, ... ] }
      - { kind: tavily,    credentials: [ {type: env-var, name: TAVILY_KEY_1}, ... ] }
    freeFloor: true
    summarizer: { provider: deepseek, model: "<v4-flash-id>", credential: {type: env-var, name: DEEPSEEK_API_KEY} }
    quotaCooldown: next-midnight
  search:                          # NEW — the routed search chain (mirrors web.fetch; no freeFloor)
    providers:                     # priority order; tavily|firecrawl|parallel union
      - { kind: tavily,    credentials: [ {type: env-var, name: TAVILY_KEY_1}, ... ] }
      - { kind: firecrawl, credentials: [ {type: env-var, name: FIRECRAWL_KEY_1}, ... ] }
      - { kind: parallel,  credentials: [ {type: env-var, name: PARALLEL_API_KEY} ] }
    quotaCooldown: next-midnight
```

The legacy top-level `web.provider` + `web.credential` (the single-key search config) is **removed** and replaced
by `web.search.providers` (pre-v1, single-user, and the old form was barely wired). Reuses the shared
`locatorSchema`; `.strip()`; Zod-validated at the edge (M0). An unresolvable credential is simply absent from its
chain. Absent `web.search` ⇒ the search chain is empty ⇒ WebSearch always returns empty results (D85, exactly
today's no-key behavior).

### 6. Daemon wiring

`buildWebToolDeps` builds the search chain (`buildSearchChain`, mirroring `buildFetchChain`) over the shared
`KeyStateStore`, alongside the fetch chain. `buildFetchChain` gains the Tavily branch. No new daemon-root
composition (the summarizer wiring is unchanged); the search chain needs no model call.

## Testing (mock-first)

- `tavily` search adapter: response→outcome mapping with injected fetch (hits, 429/432/433/401, malformed body).
- `firecrawl` search adapter: `data.web[]` mapping, 429/402, malformed body.
- `parallel` adapter refactor: success→ok outcome; non-2xx/parse-failure→error; never `limit`.
- `tavily` extract adapter: `results[0].raw_content`→clean; `failed_results`/empty→error; 429/432/433.
- `firecrawlLimit`/`tavilyLimit`: the shared classifiers, unit-tested for each status.
- `buildSearchChain`: ordered fallback across kinds; credential-blind `${kind}:${locatorId}` id (via injected
  `CooldownStore` + `vi.stubGlobal('fetch')`); exhausted→empty; shared-cooldown across search+fetch for one key.
- WebSearch handler: chain `ok`→results; `exhausted`→empty+reason (SC-1).
- Config: `web.search` parse (union kinds, defaults); Tavily fetch hop assembled in `web.fetch`.
- Key-gated live smokes (skipped without keys): Tavily search (`TAVILY_KEY_1`), Tavily extract, Firecrawl search.

## Deferred (increment 3+)

- Exa/Brave search adapters (only Tavily + Firecrawl + Parallel this increment).
- Firecrawl-search `scrapeOptions` (returning page markdown inline) and Tavily `include_answer`/images/topic.
- Live remaining-credit introspection; proactive local quota accounting.
- A backward-compat shim for the removed `web.provider`/`web.credential` form (removed outright, pre-v1).

## Open items to confirm at plan time

- The exact `parallel` refactor surface (its provisional field names are already flagged unverified in
  `web/parallel.ts`; the return-type change is the only required edit — keep the field names as-is).
- Tavily's `Retry-After` presence (undocumented; parse-if-present, else ambiguous → quota cooldown, same as
  Firecrawl).

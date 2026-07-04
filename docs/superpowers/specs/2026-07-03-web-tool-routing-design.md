# Cooldown-aware multi-key web-tool routing (increment 1 — fetch) — design

_Date: 2026-07-03 · Status: approved design, pre-plan_

## Problem

The shipped web tools (`WebSearch`/`WebFetch`) each call a single provider with a single key. The goal is a
zero-manual routing layer: register a provider by writing an adapter, list several keys, and have the tool walk
the keys in priority order, skipping any that recently returned a limit error until a cooldown expires — so a
web fetch does not re-probe dead keys on every call. This increment covers the **fetch** side; the search side
reuses the same core in a later increment.

Concrete target stack (this increment): **WebFetch** = all Firecrawl keys → free plain-fetch floor, with a
**DeepSeek V4 flash** summarizer as the default (applied only when the fetched content isn't already clean).

## Principles

- **SC-1** — tools never throw/deny; provider failures return classified outcomes the router handles.
- **Strict-superset (D85)** — the free plain-fetch floor is always the last hop, so WebFetch can never fully
  fail; absent config degrades to exactly today's behavior.
- **No-lock-in** — providers are swappable adapters behind a port; adding one = an adapter + appending its keys.
- **Credential-blind** — config holds locator *pointers* (env-var name / file path); the cooldown store keys on
  the pointer identity, never the secret.
- **Determinism-first (P1)** — the router and cooldown logic are pure/deterministic; the only model call is the
  optional summarizer, off the critical path.

## Components

### 1. Neutral provider outcome

Adapters return a classified outcome instead of throwing, so the router never inspects HTTP internals:

```ts
type ProviderOutcome<T> =
  | { status: 'ok'; value: T; clean: boolean }        // clean = content already extracted/summarized
  | { status: 'limit'; kind: 'rate-limit' | 'quota'; retryAfterMs?: number }
  | { status: 'error'; reason: string };
```

Each adapter owns the provider-specific mapping (which status/body/header means quota vs rate-limit; whether a
`Retry-After` is present). The exact Firecrawl mapping is verified against Firecrawl docs at implementation.

### 2. Routing core (generic; reused by search in increment 2)

- **`KeyStateStore`** — the persisted circuit-breaker. A versioned JSON file in coa's state dir
  (`~/.coa/web-keys.json`), matching the credential-blind `AccountsRegistry` (homedir) pattern. Keyed by a
  credential-blind id `` `${providerKind}:${locatorId}` `` where `locatorId` is the env-var *name* or file path.
  Stores `cooldownUntil` epoch-ms per id. Injectable clock + fs for tests; drop-unknown/never-throw on load.
  Methods: `isCoolingDown(id, now)`, `markCooldown(id, until)`, `clear(id)`.
- **`runChain(entries, store, now)`** — walks an ordered list of `{ provider, keyStateId }` entries:
  - skip any entry still cooling down (`isCoolingDown`);
  - run the next live entry;
  - on `status:'limit'` → compute cooldown (`rate-limit` + `retryAfterMs` → `now + retryAfterMs`; `quota` or
    ambiguous → next local midnight, configurable default) via `markCooldown`, then continue;
  - on `status:'error'` → try the next entry **without** a cooldown;
  - on `status:'ok'` → `clear` any prior cooldown for that id and return the value + `clean` flag;
  - if all entries are exhausted → return a miss (`{ status: 'exhausted' }`).
  Generic over the value type, so search and fetch share it.

### 3. `FetchProvider` port + adapters

```ts
interface FetchProvider { fetch(url: string): Promise<ProviderOutcome<string>>; }
```

- **`firecrawl`** — Firecrawl scrape; success → `{ status:'ok', value: markdown, clean: true }`; maps
  quota/rate-limit responses to `{ status:'limit', kind, retryAfterMs? }`; other failures → `{ status:'error' }`.
  Injectable `fetchImpl`; credential-blind (apiKey passed in).
- **`plainFetch`** (free floor) — global `fetch` + turndown; success → `{ status:'ok', value: markdown,
  clean: false }`; **never returns `limit`**. This is the existing raw-markdown behavior repackaged as a provider.

### 4. WebFetch handler refactor

Replace the handler's `fetch + htmlToMarkdown + optional summarizer` deps with a single **routed `FetchProvider`
chain** + optional summarizer:

- Run the chain. On `exhausted` (only possible if `freeFloor` is off) → SC-1 unapplied result.
- On `ok`: if `clean` → return the content as-is (**Firecrawl output skips the summarizer**); if not `clean`
  and a summarizer is configured → summarize (the free-floor path); else return the (capped) markdown.
- The `Summarizer` port and the up-front `maxChars` cap from the previous increment are unchanged.

This reshapes `WebToolDeps.fetch`/`htmlToMarkdown` (from the prior increment) into a `fetchProvider` (the routed
chain) — a deliberate cleanup of code we own.

### 5. Summarizer default — wired at the daemon root

The DeepSeek-V4-flash summarizer (deferred in the prior increment) is now composed:
`makeSummarizer(makeDeepSeekComplete({ model: <flash id from config>, apiKey }))`, bound to an optional
`recordCost` → M7 ledger. The V4-flash model id stays **config-driven** (not pinned in code). It runs only on
non-clean content.

### 6. Config shape

```yaml
web:
  fetch:
    providers:                     # priority order
      - kind: firecrawl
        credentials:               # ordered key list; the router tries each
          - { type: env-var, name: FIRECRAWL_KEY_1 }
          - { type: env-var, name: FIRECRAWL_KEY_2 }
    freeFloor: true                # append plainFetch as the last hop (default true)
    summarizer:                    # optional; when absent, non-clean content returns raw markdown
      provider: deepseek
      model: "<v4-flash-id>"
      credential: { type: env-var, name: DEEPSEEK_API_KEY }
    quotaCooldown: "next-midnight" # or a duration; default for quota/ambiguous limit errors
```

Reuses the shared `locatorSchema`; `.strip()`; Zod-validated at the edge (M0). A credential that doesn't resolve
is skipped (its entry is simply absent from the chain). No `web.fetch` config ⇒ WebFetch = free floor only
(exactly today's behavior).

## Testing (mock-first)

- `KeyStateStore`: JSON roundtrip, cooldown set/expiry, credential-blind id, corrupt-file → empty (never throws);
  injected clock + fs.
- `runChain`: ordered fallback; skip cooling-down entries; `limit` → cooldown set (rate-limit uses `Retry-After`,
  quota uses next-midnight) then continue; `error` → next without cooldown; `ok` → clears prior cooldown; all
  exhausted → `exhausted`.
- `firecrawl` adapter: response → outcome mapping with injected fetch, including quota vs rate-limit and
  `Retry-After` extraction.
- `plainFetch`: fetch+turndown → `clean:false`; never `limit`.
- WebFetch refactor: clean content skips the summarizer; non-clean + summarizer runs it; free floor always
  succeeds; exhausted (freeFloor off) → SC-1 unapplied.
- Daemon composition: fetch chain built from config in priority order; summarizer built from DeepSeek flash;
  credential-blind key-state ids; absent config → free-floor-only.
- Key-gated live smoke against real Firecrawl (skipped without `FIRECRAWL_KEY_*`).

## Deferred (increment 2+)

- The WebFetch summarizer's model spend is recorded to the M7 audit ledger (scoped `web_fetch_summarizer`) but not
  yet charged to the cost-cap — charging it needs a live per-session id at the daemon-wide catalogue seam, deferred
  to a later increment.
- Search-side routing (Tavily primary → Parallel backup) reusing `runChain` + `KeyStateStore`.
- Tavily-extract as a second `FetchProvider`.
- Live remaining-credit introspection as an optional per-adapter capability.
- Proactive local quota accounting (count-per-key vs a configured monthly free cap).

## Open items to confirm at plan time

- Firecrawl's exact scrape request/response shape and its quota-vs-rate-limit signaling (verify against docs).
- The DeepSeek V4 flash model id (config-driven; user supplies).
- Whether the cooldown store lives under an existing coa state-dir helper or a new small module.

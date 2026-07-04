# Owned WebSearch + WebFetch for pure-API agents — design

_Date: 2026-07-03 · Status: approved design, pre-plan_

## Problem

coa's fully-owned API agents (DeepSeek today; any future from-scratch `RuntimeAdapter`) have no web
tooling. Claude gets `WebSearch` and `WebFetch` for free because they are Anthropic **server-side**
tools — they execute on Anthropic's infrastructure as part of processing a request, and only when an
Anthropic model runs that request. There is no configuration — Agent SDK, Claude Code harness, or an
`ANTHROPIC_BASE_URL` swap in front of a non-Anthropic model — under which a DeepSeek model obtains
Anthropic's server-side `WebSearch`: the tool's *definition* travels with the harness, but its
*execution* lives at the backend, and a non-Anthropic backend does not implement it. (Repointing the
base URL at a DeepSeek proxy is also exactly the compat-endpoint routing the owned-adapter direction
deliberately rejected.)

`WebFetch` is portable (its fetch is client-side), but its "run a fast model over the page" step is a
model call that, on the owned path, must be a model coa controls.

**Conclusion:** for any non-Anthropic model, *coa* must own the execution of these tools. This is the
same posture as the pure-API base tools (Read/Glob/Grep/Write/Edit/Bash), which coa supplies only on
the owned-adapter path because Claude gets equivalents from the SDK.

## Principles this design honors

- **Strict-superset (D85).** Every capability adds value or degrades to a literal pass-through. WebFetch
  with no summarizer configured returns cleaned page markdown — never worse than not having the tool.
- **No-lock-in.** The search backend is a swappable port with one default adapter; never assume a
  provider.
- **SC-1 — help, never cage.** Both tools never throw and never deny. A dead URL, a missing key, or a
  provider error returns an unapplied result the agent can retry.
- **Determinism-first (P1).** The only model call is WebFetch's optional summarize step, which is a tool
  the agent invokes — off any critical path — and is itself configurable/omittable.
- **Compose, don't reinvent (P8).** Orchestrate an existing search provider and an existing HTML→markdown
  library; build no crawler or ranker.

## Placement

New sibling file `packages/core/src/workbench/web-tools.ts` (kept out of the already-large
`base-tools.ts`; egress is a genuinely separate concern). Wired through the same aggregation the base
tools use:

- Handlers added to the pure-API catalogue and to `baseToolSpecs()` (or a parallel `webToolSpecs()`
  merged alongside it) so they dispatch through `buildGovernedTools` and are registered by the M9
  adapter as in-process MCP tools on the owned path only.
- Two structural differences from the file base tools drive the design:
  1. **Egress, not worktree-confined.** Their precondition is an egress seam (S-4), not `confinePath`.
     Governed-egress is not yet built, so this design *places the injection seam* — an injectable
     `fetch` port plus provider/summarizer ports, all mockable — and records cost to the ledger, but
     leaves full S-4 domain allow/deny policy as a documented floor.
  2. **No change-events.** They never mutate the worktree, so they skip the M1 spine entirely — `wrap()`
     returns a distilled handle with no `emit()`.

## WebSearch

`SearchProvider` port (the no-lock-in seam):

```ts
interface SearchProvider {
  search(req: {
    query: string;
    allowedDomains?: string[];
    blockedDomains?: string[];
    maxResults?: number;
  }): Promise<readonly SearchHit[]>; // SearchHit = { title: string; url: string; snippet: string }
}
```

- **Adapters:** `parallel` (default), `exa` (semantic-quality alternate), `tavily`, `brave`. Each is a
  thin HTTP call; credentials via env-var-pointer, same pattern as the DeepSeek adapter's credentials.
- **Default = Parallel.ai** (verified 2026-07-03): 16,000 free searches for new users, $5/1k paid,
  own independent web-scale index, agent-native ranked markdown excerpts, official MCP server, zero data
  retention. Caveat: Parallel does not publish rate limits — validate throughput before the live smoke
  locks it in; the port makes swapping to Tavily/Exa a config change, not a code change.
- **Tool spec** mirrors Claude's `WebSearch` faithfully: `query: string`, optional
  `allowed_domains: string[]`, `blocked_domains: string[]`. Returns
  `wrap({ results }, 'web_search:<query>', query)` — no `emit`.
- **SC-1:** a provider 4xx / timeout / missing key returns `{ results: [], reason }`, never a throw.

## WebFetch

Pipeline: **fetch (egress port) → HTML→markdown → `Summarizer` port**.

```ts
interface Summarizer {
  summarize(req: { markdown: string; prompt: string }): Promise<string>;
}
```

- **Default binding:** a configurable *minimal summarizer agent* — the maintainer assigns it a cheap
  model (e.g. DeepSeek V4 flash) via config. Implemented as a stripped `complete()` call through the
  existing `@coa/loop-driver` primitive; cost attributed to the M7 ledger.
- **Degrades to raw-markdown (D85):** with no summarizer configured, WebFetch returns cleaned +
  truncated page markdown and the agent reasons over it itself.
- **Tool spec** mirrors Claude's `WebFetch`: `url: string`, `prompt: string`. HTML→markdown via a small
  dependency (candidate: `turndown`) — confirm the repo's preferred library at plan time rather than
  assume one.
- **SC-1:** dead URL / non-HTML content-type / oversized body returns an unapplied result with a typed
  reason.

## Config & credentials

- A `web` block in the owned-adapter config selects: `searchProvider` (default `'parallel'`), its
  credential env-var pointer, and `summarizerModel` (provider + model + reasoning, reusing the existing
  model-config seam). Absent `summarizerModel` ⇒ raw-markdown mode.
- Credentials fold into the **account registry** exactly like the DeepSeek key — env-var-pointer, never
  inline secrets; Zod-validated at the edge (M0 owns the schema).
- Cost from both the search provider (flat per-search) and the summarizer (tokens) records to the M7
  ledger. The placed-but-floored S-4 egress seam is where a future cost-cap / deny attaches.

## Testing & build order

- **Mock-first.** Every unit test injects a fake `fetch` plus fake `SearchProvider` / `Summarizer` — no
  live network, mirroring how the DeepSeek `complete.ts` is tested. Coverage: handlers, Zod dispatch,
  SC-1 error paths, raw-markdown degrade, HTML→markdown conversion.
- **One live smoke test** against Parallel + a DeepSeek summarizer, run manually and gated on keys being
  present (same discipline as the existing live smokes).
- **Branch:** the pure-API base tools this work depends on (`baseToolSpecs()` / `buildGovernedTools`)
  live on the unmerged `core-context-roles` branch, so this lands on `core-context-roles` (or a branch
  off it), not on `chat-interface-overhaul`. Confirm at plan time.
- **Same-commit doc rule:** update the pure-API base-tools research doc and `docs/REPO_LAYOUT.md` if a
  package or dependency is added.

## Deferred (not built for v1)

- Full S-4 domain-policy governance (allow/deny lists, per-fetch robots.txt handling).
- WebSearch result caching.
- Provider adapters beyond the one or two wired at launch.
- A real cost-cap/deny on the egress seam (the seam is placed; enforcement is floored).

## Open items to confirm at plan time

- File structure: `web-tools.ts` sibling vs. folding into `base-tools.ts` (design assumes sibling).
- HTML→markdown library choice.
- Which provider adapters to ship at launch beyond the Parallel default.
- Parallel rate-limit headroom (validate in the live smoke).

# Spec: LongCat 2.0 backend adapter

_Status: draft for maintainer review · Authored: 2026-07-05 · Owner module: M9 seam + a new `@coa/adapter-longcat`_
_Process: brainstorming COMPLETE + design APPROVED. This spec is the next gate before writing-plans → TDD._

## 1. Problem

coa governs a rented coding loop behind the M9 `RuntimeAdapter` port. Two backends are wired today: `claude`
(the Claude Agent SDK) and `deepseek` (a thin pure-API backend over the shared `@coa/loop-driver`). We want a
third: **LongCat 2.0**, Meituan's trillion-parameter agentic coding model, exposed as an OpenAI-compatible chat
API with native tool calling — the exact shape `@coa/adapter-deepseek` was built to be copied for
(`adapter.ts`: _"adding another pure API is the same shape"_).

## 2. Goal / non-goals

**Goal.** Register LongCat as a selectable `provider`, run a governed session against `LongCat-2.0` over its
OpenAI-compatible HTTP API, discover its model(s), and attribute spend to the M7 ledger — all through the same
`complete()` primitive + shared loop driver DeepSeek uses. coa supplies everything else (tools, roles, context,
the two SC-1 blocks); LongCat only completes.

**Non-goals (out for this increment):**
- **No provider SDK.** `fetch` only, like DeepSeek.
- **No Anthropic-compat path.** LongCat also exposes `/anthropic/v1/messages`; we route the OpenAI-compat
  `/openai/v1/chat/completions` path to reuse DeepSeek's wire shape. The Anthropic path is deferred.
- **No streaming.** The loop driver consumes whole completions (DeepSeek parity).
- **No effort ladder.** LongCat's reasoning surface is a thinking on/off toggle, not graded effort.
- **No generic auth-CLI refactor.** Parallel `--longcat-*` flags, not a reworked `--api-key <provider>` verb.
- **No M8/core branching on `longcat`.** Pure-API behavior is reached via the existing non-Claude code paths.

## 3. Invariants preserved (Constitution / SPEC §B)

- **Determinism-first (P1).** No model call on any critical path; the adapter renders, resolves a key, builds
  `complete()`, and hands the loop the two SC-1 predicates. ✔
- **Strict-superset (D85).** No `longcat` account / not selecting a LongCat model ⇒ behavior byte-identical to
  today. An unwired provider still throws an SC-1 error frame, never a silent wrong-backend run. ✔
- **The one backend seam (M9).** LongCat is a swappable leaf constructed only in the app-side adapter factory;
  `core` never imports it. ✔
- **Credential-blind.** coa stores a **pointer** (env-var name or a 0600 key-file path), never the key. ✔
- **Typed boundaries.** The chat/completions + `/models` responses are Zod-parsed-and-dropped at the edge, so a
  LongCat response that only adds fields never breaks the mapping. ✔

## 4. The LongCat 2.0 API (grounded)

| Fact | Value |
| --- | --- |
| Chat endpoint | `POST https://api.longcat.chat/openai/v1/chat/completions` |
| Models endpoint | `GET https://api.longcat.chat/openai/v1/models` (live-verified; the docs' `/v1/models` 404s) |
| Auth | `Authorization: Bearer <KEY>` |
| Model ID | `LongCat-2.0` (exact casing) |
| Tool calling | Native, OpenAI function-call shape (`tools` / `tool_calls`) |
| Reasoning | `thinking: {"type":"enabled"\|"disabled"}` — on/off only, no `reasoning_effort` |
| Context / output | 1M context; `max_tokens` ≤ 131072 |
| Usage | `prompt_tokens`, `completion_tokens`, `total_tokens`, `completion_tokens_details.reasoning_tokens`; message carries `reasoning_content` |
| Pricing (USD / 1M) | in **$0.75** (cached **$0.015**), out **$2.95** — published |

Sources: LongCat API docs (`api/chat.html`, `APIDocs.html`, `Pricing/LongCat-2.0.html`), the model card
(`longcatai.org/models/longcat-2`), Hugging Face `meituan-longcat/LongCat-2.0`.

**Two facts confirmed against the live API during the smoke test (2026-07-05):**
1. ✅ Models path: `https://api.longcat.chat/openai/v1/models` — the docs' `/v1/models` **404s**; the working
   endpoint is under the same `/openai/v1` base as chat. Returns `{data:[{id:'LongCat-2.0'}]}`.
2. ✅ Cache-token usage field: OpenAI-standard `prompt_tokens_details.cached_tokens` is present as assumed. The
   live tool-calling round-trip returned `finish_reason:'tool_calls'` in the OpenAI function-call shape.

## 5. Design

### 5.1 New package `@coa/adapter-longcat`

Mirrors `@coa/adapter-deepseek` 1:1 — 8 `src` files + `.test.ts` siblings, same `package.json` deps
(`@coa/loop-driver`, `@coa/shared`, `@coa/spi`, `zod`), same `tsdown`/`tsconfig`. Two files are byte-identical
except one constant:

- **`credentials.ts`** — identical; `DEFAULT_API_KEY_VAR = 'LONGCAT_API_KEY'`.
- **`render.ts`** — identical (neutral `NeutralConfig` → single system-prompt string; pure API has only a
  system message).

### 5.2 The three real deltas from DeepSeek

- **`complete.ts` / `wire.ts`** — base URL `https://api.longcat.chat/openai/v1`, default model `LongCat-2.0`.
  Reasoning maps to `thinking`: `mode:'off'` → `{thinking:{type:'disabled'}}`; any `mode:'effort'` →
  `{thinking:{type:'enabled'}}`; absent/`budget` → omit. The wire usage schema reads
  `prompt_tokens_details.cached_tokens` (optional nested object) instead of DeepSeek's `prompt_cache_hit_tokens`.
  `reasoning_content` on the message is ignored (coa consumes `content` only). Tool-call request/response shape is
  the OpenAI function-call shape, unchanged from DeepSeek.
- **`models.ts`** — the models URL is kept as its own constant (`https://api.longcat.chat/openai/v1/models`,
  live-verified) rather than derived from the chat base, so a future path divergence is a one-line change. `LongCat-2.0`'s
  descriptor is `{ id }` with no `supportsEffort` (thinking toggle, not a ladder). Keep the config-overridable
  capability map for future models. A non-OK `/models` fetch throws (never a silently-empty list — cache-poison
  guard, DeepSeek parity).
- **`pricing.ts`** — ships a **real** default price for `LongCat-2.0` (in $0.75 / out $2.95 / cache $0.015 per
  1M), keeping the `COA_LONGCAT_PRICES` env override and the zero-floor for unlisted models. `cacheReadTokens`
  is surfaced when the cache field is present, billed at the cache rate.

### 5.3 Registration seams (4 edits)

- **`packages/shared/src/auth.ts`** — add `'longcat'` to `providerSchema` (`z.enum(['claude','deepseek','longcat'])`).
- **`apps/cli/src/adapter-factory.ts`** — `case 'longcat'` in `createAdapter` (constructs `LongCatAdapter`),
  plus a `longcat` branch in `fetchModels` (fetch + tag with the provider). The existing `default:` throw covers
  any still-unwired provider.
- **`apps/cli/src/auth-cli.ts`** — add parallel `--longcat-key <KEY>` (writes a 0600 key-file, `key-file`
  locator) and `--longcat-env-var <NAME>` (env-var locator), each registering the account with provider
  `longcat`. Reuses the existing credential-blind machinery; DeepSeek's flags are untouched. Update `ADD_USAGE`.
- **`docs/REPO_LAYOUT.md`** — new-package entry (same-commit doc rule).

**No change** at `packages/core/src/session/memory-plan.ts`: `planMemory` branches on `isClaude`, so LongCat
rides the existing non-Claude pure-API history-replay path (a chat API has no server-side `resume`). The
DeepSeek-specific WebFetch summarizer (`daemon.ts`) stays deepseek-only this increment.

### 5.4 Data flow

`createSession` (M8) → `createAdapter` routes by `provider: 'longcat'` → `LongCatAdapter.renderNative` collapses
the `NeutralConfig` to a system prompt → `runLoop` resolves the key from the account locator, builds
`makeLongCatComplete`, and drives `runGovernedLoop` with the SC-1 `canUseTool` + stop predicates → per-turn
`onTurn` frames flow to M8's emission policy → settled `RuntimeUsage` (priced) → `onSettle` → M7 ledger.

## 6. Error handling

- Non-OK chat/completions → throw with status + body snippet (loop-driver surfaces it as an SC-1 error frame).
- No resolvable API key → throw (`longcat: no API key — set LONGCAT_API_KEY or add an env-var account`).
- Non-OK `/models` → throw (never cache an empty list).
- Malformed tool-call arguments JSON → degrade to empty args (DeepSeek parity).
- Unknown provider (misconfig) → the factory `default:` throw → SC-1 error frame.

## 7. Testing

**Unit (mocked `fetch`, no network), mirroring DeepSeek's suite:**
- `complete`: reasoning-body mapping (off / effort / absent), tool-call round-trip (request tools → response
  `tool_calls` → neutral), message/tool/assistant wire mapping, non-OK throw.
- `wire`: parse a representative response incl. `prompt_tokens_details.cached_tokens` and `reasoning_content`;
  unknown-field drop.
- `pricing`: input/output/cache math, zero-floor for unlisted model, real `LongCat-2.0` default, env override.
- `models`: `/v1/models` discovery + provider tagging, non-OK throw, no-effort descriptor.
- `credentials`: env-var / key-file / fallback resolution.
- `adapter`: `renderNative` → system prompt; `runLoop` wiring + settle.
- `auth-cli` / `adapter-factory`: `--longcat-key` / `--longcat-env-var` register provider `longcat`; factory
  routes `longcat` to the LongCat adapter.

**Live smoke (with the maintainer's key, `LONGCAT_API_KEY`):** confirm the `/models` path resolves, one
tool-calling turn round-trips end-to-end, and log the real `usage` block to lock the cache-field name. Adjust
the wire schema if the live field differs.

## 8. Open items

- Live-verify the two §4 unknowns; adjust the wire usage schema if needed.
- Anthropic-compat path, streaming, and multi-model effort ladders are deferred.

# Recipe: an OpenAI-compatible bridge

Point coa's OpenAI-compatible adapter at a proxy running on your own machine — CLIProxyAPI, or
anything else that re-exposes a subscription or a gateway as an OpenAI-compatible HTTP API.

**coa ships no bridge-specific code.** The adapter knows a base URL, a bearer key, and the
OpenAI chat-completions wire format; whatever answers on the other end is the bridge's business. There
is no integration to enable and nothing that detects a particular proxy.

## What the bridge has to speak

The adapter posts to `<base-url>/chat/completions` with `stream: true` and lists models from
`<base-url>/models`. The base URL is used verbatim, so include the version segment if the proxy serves
its OpenAI surface under one (`http://127.0.0.1:8317/v1`, not `http://127.0.0.1:8317`).

The bridge must:

- stream Server-Sent Events — a proxy that only answers non-streaming requests fails the turn;
- carry OpenAI-shaped function tool calls in the stream deltas (coa supplies every tool; the model
  cannot do anything without them);
- tolerate `stream_options: { include_usage: true }`, which is always sent. A strict proxy that
  rejects unknown body fields will reject the request. Without a usage report the turn still runs; it
  is recorded as zero tokens.

Reasoning text is picked up from `reasoning_content` deltas when the bridge forwards them, and shown
as a thinking block.

## Step 1 — repoint the base URL (source edit today)

The base URL lives as a field on the provider's record in `packages/adapter-openai-compat`, one record
per provider. Change the `openai` record's base URL to the bridge's address and rebuild
(`pnpm build`).

This is the honest state of things: the adapter accepts a base-URL override where it is constructed,
but nothing in the CLI or the console passes one, and no config file or environment variable feeds it.
**Roadmap:** a per-account base-URL override, so a bridge survives a rebuild and two accounts can point
at different endpoints.

Adding a *new* provider id (`bridge`, say) rather than repointing `openai` means editing the provider
enum in the shared schema plus the two registries that route on it — the model-handler provider list
and the CLI's adapter factory. Repointing `openai` is the one-field route; prefer it unless you need
OpenAI proper at the same time.

## Step 2 — register the key as a pointer

coa stores a pointer, never the secret. Either name an environment variable:

```sh
coa auth add bridge --openai-env-var BRIDGE_API_KEY
coa auth use bridge
```

or hand it the key, which it writes to an owner-only file under `~/.coa/keys/` and points at:

```sh
coa auth add bridge --openai-key sk-local-whatever
coa auth use bridge
```

With no account registered for the provider, the adapter falls back to `OPENAI_API_KEY`.

A bridge that authenticates nothing still needs *something*: an unresolved or empty key aborts the
turn before the request goes out. Give it any non-empty placeholder.

## Step 3 — name the models

Model ids are sent verbatim, so use whatever ids the bridge advertises. Two lists feed the picker: the
per-provider list in `~/.coa/models.yaml` (seeded from a shipped catalog, editable — the console has an
editor), enriched by the live list fetched from the bridge. If the bridge implements the models
endpoint, its ids appear on their own; if it does not, add them to `models.yaml` by hand. A failed live
fetch degrades to the stored list rather than emptying it.

Then run one:

```sh
coa run --provider openai --model <bridge-model-id> "explain what this repo does"
```

### Naming caveats

- **Prices are keyed by model id.** The shipped table carries OpenAI's own ids, so a bridge id matches
  nothing and every turn is recorded at zero cost. Supply rates with the `COA_OPENAI_PRICES`
  environment variable — JSON, keyed by model id, with `inPerMillion`, `outPerMillion` and an optional
  `cacheInPerMillion` in dollars per million tokens. It merges over the shipped table, so you only
  name the models you use.
- **Effort ladders are keyed by model id too.** A model absent from the table exposes no reasoning
  control at all. Supply ladders with `COA_OPENAI_EFFORT` — JSON, keyed by model id, values drawn from
  `low`, `medium`, `high`, `xhigh`, `max`. The OpenAI record sends the selected level as
  `reasoning_effort` and clamps `xhigh`/`max` down to `high`, because that is the top rung the wire
  format has.
- **A Claude model reached through a bridge is not the Claude backend.** It runs the pure-API path:
  coa's own tools, a fresh loop per turn, no SDK session and none of the SDK's hooks. Same governance,
  different machinery — and a different set of things that can go wrong.
- **Cache accounting follows the OpenAI shape.** Cache-hit input tokens are read from the nested
  `prompt_tokens_details.cached_tokens` field. A bridge that reports its cache split some other way is
  simply recorded as having no cache hits.

## Where it shows up

Everything else is unchanged: the session is the daemon's, the conversation is the same append-only
log, the tool surface and the gate are coa's. Spend is priced from the table above and recorded
against the account you selected — coa accounts spend, it does not cap it.

_Last reviewed: 2026-08-08_

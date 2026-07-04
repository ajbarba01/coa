# Local web-key store + config loader + `coa web` CLI — design

_Date: 2026-07-04 · Status: approved design, pre-plan_

## Problem

The web-tool routing (increments 1–2) is fully built and tested, but two things keep a user from actually using
their keys:

1. **Nothing loads a `web` config into the running daemon.** `createDaemonCore` accepts a `web` option, but
   `buildSessionDeps` (what the `coa` CLI calls) never sets it, and no file feeds it — so in a live session the
   web tools aren't even offered.
2. **Keys can only be manual environment variables.** The user wants coa to **save keys locally**, the same way
   it already saves DeepSeek keys — credential-blind, coa-managed.

## Existing patterns to mirror (this design adds no new mechanism)

- `coa auth add <label> --deepseek-key <KEY>` → `writeKeyFile` writes the secret to `~/.coa/keys/<label>` (mode
  `0600`) and records a credential-blind `{ type: 'key-file', path }` **pointer** in `~/.coa/accounts.yaml` (the
  `AccountsRegistry`). `--env-var <NAME>` records an env-var pointer instead. (See `apps/cli/src/auth-cli.ts`.)
- `resolveApiKey(locator, env, readKeyFile)` (adapter-deepseek) resolves a locator to a secret at runtime:
  `key-file` → read the 0600 file (trimmed); `env-var` → read the named var. The secret never lives in the
  registry file.
- `webConfigSchema` (`web/web-config.ts`) already models the search + fetch chains as ordered provider entries
  whose credentials are shared `locator`s.

This feature is the **web analogue of the accounts system**: a user-global store of credential-blind pointers,
secrets in `~/.coa/keys/`, a `coa web` CLI twin of `coa auth`, and the daemon loading it.

## Design

### 1. Storage — a user-global web config, coa-managed

- **`~/.coa/web.yaml`** — the existing `WebConfig` shape (`{ search?: {...}, fetch?: {...} }`), user-global,
  credential-blind (every credential is a `locator` pointer). Not project-level: personal keys and provider
  preferences don't belong in a repo directory, and this matches `accounts.yaml`.
- **Secrets** live in `~/.coa/keys/web-<label>` (mode `0600`), written by coa via the same `writeKeyFile`
  pattern the auth CLI uses.
- **`WebConfigStore`** (new, `packages/core/src/auth/web-config-store.ts`) — mirrors `AccountsRegistry`:
  injectable `home`; drop-unknown/never-throw read; `0600` write. Methods:
  - `read(): WebConfig` — parse `~/.coa/web.yaml` with `webConfigSchema`; missing/corrupt ⇒ empty (`{}`).
  - `addCredential(chain, kind, locator)` — `chain ∈ {'search','fetch'}`; ensure a provider entry for `kind`
    exists in that chain and append `locator` to its `credentials`. `kind` is validated against the chain's
    allowed set (search: `tavily|firecrawl|parallel`; fetch: `firecrawl|tavily`).
  - `removeCredential(chain, id)` — remove from **that chain** every credential whose locator matches `id` (a
    key-file at `~/.coa/keys/web-<id>`, or an env-var named `id`), returning any key-file path that is now
    unreferenced by **either** chain, so the CLI can safely unlink it (a key shared by both chains isn't deleted
    until removed from both).
  - `write(config)` — persist.

### 2. Resolver — teach the web chains to read a saved key

- Extend `resolveKey` in `web-config.ts` to resolve a **`key-file`** locator (read the 0600 file, trimmed) in
  addition to `env-var` — mirroring `resolveApiKey`. `config-dir`/`ambient` still resolve to `undefined`. So a
  coa-saved key resolves at chain-assembly time exactly like an env-var key.
- The cooldown store already keys `key-file` credentials on their path (`locatorId` case `key-file`), so nothing
  changes there — a saved key gets a stable credential-blind cooldown id (`firecrawl:/…/keys/web-<label>`).

### 3. `coa websearch` / `coa webfetch` CLI — twins of `coa auth`, split by chain

New `apps/cli/src/web-cli.ts` (mirrors `auth-cli.ts`), dispatched from `cli.ts` on **two** commands —
`websearch` (chain `'search'`) and `webfetch` (chain `'fetch'`) — that share one `runWebCommand(chain, …)`
body. Each has `add`/`list`/`remove`:

- `coa websearch add <provider> <label> --key <KEY>` → `writeKeyFile('web-<label>', KEY)` +
  `store.addCredential('search', provider, { type: 'key-file', path })`. `coa webfetch add …` does the same into
  the fetch chain. To use one key for both, run both commands (same or different label).
- `coa websearch add <provider> <label> --env-var <NAME>` → an env-var pointer (same env-var-name-vs-pasted-key
  guard `auth-cli` uses).
- `coa websearch list` / `coa webfetch list` → one line per provider/credential in that chain: the label,
  key-file vs env-var — **never the secret**.
- `coa websearch remove <id>` / `coa webfetch remove <id>` → remove from that chain the credential matching
  `<id>` (key-file `~/.coa/keys/web-<id>`, or env-var named `<id>`), unlinking the key-file only if no chain
  still references it.
- `<provider>` is validated against the chain's allowed set: search `firecrawl|tavily|parallel`, fetch
  `firecrawl|tavily`. `parallel` under `webfetch` → a usage error (Parallel is search-only).

### 4. Daemon loader — feed the config in

- `buildSessionDeps` (`apps/cli/src/session-deps.ts`) constructs a `WebConfigStore(homedir())`, reads it, and
  forwards the result to `createDaemonCore({ web })` — only when the config is non-empty (has at least one
  provider), so an unconfigured user gets exactly today's behavior (tools not offered — D85). No new
  `DaemonSessionOptions` field is required; the store read happens inside `buildSessionDeps`.

## Decisions (YAGNI)

- **User-global only** — no project `.coa/web.yaml`. Keys don't belong in a repo; matches `accounts.yaml`.
- **Split by chain** — `coa websearch` and `coa webfetch` are separate command families, so a key can be added
  to search only, fetch only, or both (run both). If the same key-file label is used for both, the shared
  `KeyStateStore` still gives it one cooldown (keyed on the key-file path).
- **Priority = add order**, within a fixed provider order per chain (search: tavily → firecrawl → parallel;
  fetch: firecrawl → tavily). No reordering command.
- **Reuse `webConfigSchema`** for `~/.coa/web.yaml` — no new file schema.
- Labels are explicit (parity with `coa auth`) and name the key-file (`web-<label>`).

## Testing (mock-first)

- `WebConfigStore`: roundtrip; `addCredential('search', …)` and `('fetch', …)` land in the right chain and reject
  a wrong-chain kind (e.g. `parallel` under fetch); `removeCredential` drops the credential from that chain and
  returns the key-file path only when unreferenced by either chain; missing/corrupt file ⇒ empty (never throws);
  the written YAML contains only pointers, never a secret.
- `resolveKey`: env-var and key-file both resolve; a missing file/var ⇒ `undefined` (injected reader).
- `web-cli`: `add --key` writes the 0600 file + registers; `add --env-var` guards a pasted key; `list` never
  prints the secret; `remove` unlinks the file — all over an injected temp `home` (mirrors `auth-cli` tests).
- Loader: `buildSessionDeps` forwards a non-empty store config to `createDaemonCore`; an empty store ⇒ `web`
  omitted. (A focused unit over the store→options wiring; the full session build stays covered by the CLI e2e.)

## Deferred (not built here)

- A console/GUI surface for web keys (the M10 inspector) — the CLI is the v1 surface, like `coa auth`.
- Priority-reordering and per-chain targeting flags.
- Key rotation / import-from-env bulk commands.
- Live remaining-credit introspection (already deferred in increment 1).

# Spec: Credential-blind multi-account selection (Claude subscription)

_Status: draft for maintainer review · Authored: 2026-06-30 · Owner module: M9 seam + a new `auth` core_
_Process: brainstorming COMPLETE + design APPROVED (see the `auth-multiaccount-design` memory). This spec is the
next gate before writing-plans → TDD._

## 1. Problem

coa governs a **rented Claude Agent SDK loop** that authenticates with a **Claude subscription login** (Pro/Max
OAuth), not an API key. A single user often has more than one subscription login (personal vs work, or two
Max seats) and wants coa to run a session under a chosen one and **attribute that session's spend to it**.

Today coa is **credential-blind**: the M9 adapter passes **zero auth** to the SDK — the spawned Claude Code CLI
resolves credentials from its own environment/login. coa only reads `usage` for the cost ledger. There is no way
to say "run this session under login B instead of login A."

## 2. Goal / non-goals

**Goal.** Let a single user **register pointers to** their Claude subscription logins and **select which one is
active**, so the governed loop runs under it and the M7 ledger attributes spend per account. coa selects *which
login*; the SDK resolves the token itself.

**Hard invariant — subscription, not API key.** The selected login must be a **subscription OAuth login**. The
adapter therefore **clears `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`** for the session (both force API-key
billing and outrank the OAuth login in the SDK's precedence chain). coa never stores, reads, or transports a
token of any kind.

**Non-goals (explicitly out for v1 — maintainer-decided, see memory):**
- **No credential vault / no token storage.** coa stores *pointers* (profile names, config-dir paths), never secrets.
- **No login-from-inside-coa** (brainstorming "option B"). Registering an account assumes the login already
  exists on disk (`claude /login` / `claude setup-token` / `ant auth login` already run). This is register + switch.
- **No multi-USER design** (OPEN.md §1.1 MU-*). Single user, multiple accounts.
- **No API-key accounts.** If a user wants raw API billing they set the ambient env themselves; that is the
  `ambient` locator's pass-through, not a managed account type.

## 3. Invariants preserved (Constitution / SPEC §B)

- **Determinism-first (P1).** All new code is deterministic; no model call on any path. ✔
- **Strict-superset (D85).** No `~/.coa/accounts.yaml`, or `active: ambient`, ⇒ behavior is **byte-identical to
  today** (the adapter passes zero auth; the ambient login wins). ✔
- **No-lock-in / M9 is the one backend seam.** The neutral `auth` core is backend-blind; the locator→env mapping
  (the only SDK-specific code) lives in `adapter-claude-sdk`. ✔
- **SC-1 — help, never cage.** No new blocks. Account selection is advisory plumbing. ✔
- **D84 secrets-at-rest posture untouched.** coa still holds no secrets. ✔
- **Spine (M1).** Account attribution rides existing session/ledger events; no new sideways module calls. ✔

## 4. Design

Four pieces: an M0 schema, an `auth` core module, the Claude-adapter env mapping, and the two surfaces (CLI + RPC).

### 4.1 M0 schema (`packages/shared/src/auth.ts`, Zod, exported from the M0 barrel)

```text
Locator =
  | { type: 'config-dir'; dir: string }       // CLAUDE_CONFIG_DIR → a Claude Code config dir holding one subscription /login
  | { type: 'ambient' }                        // no override — whatever login the environment already resolves (today's behavior)

// NOTE (post-spike, 2026-06-30): the `ant-profile` (ANTHROPIC_PROFILE) arm was DROPPED. `ant auth login` profiles
// select Anthropic Console/API profiles (the API-billing path this design avoids), not Claude.ai subscription
// logins. `config-dir` is proven (the spike) and sufficient for subscription multi-account. See §7/§9.

Account = {
  label: string;                 // user-facing id, unique, kebab/sluggable; the key for use/remove and ledger attribution
  provider: 'claude';            // default 'claude'; reserved for fwd-compat (multi-provider later) — NOT built now
  locator: Locator;
}

AccountsFile = {
  active: string;                // a label, OR the reserved sentinel 'ambient'
  accounts: Account[];
}
```

- Parsed/validated at the edge with Zod (typed-boundary rule). `label` uniqueness and `active` referential
  integrity are validated on load; a malformed file is a loud typed error, never a silent fall-through.
- `provider` defaults to `'claude'` so existing files round-trip when multi-provider is added later.

**Why `config-dir` is primary for subscription.** Claude Code stores its subscription OAuth login under its
config directory (default `~/.claude`, overridable via `CLAUDE_CONFIG_DIR`). Pointing the spawned CLI at a
distinct config dir per account is the most direct way to select among *subscription* logins. `ant-profile`
(`ant auth login` profiles, under `ANTHROPIC_CONFIG_DIR`) is the secondary mechanism and may resolve to either a
subscription-backed or API profile. **The spike (§7) decides which locator types ship** — if only one mechanism
selects among subscription logins, keep that type + `ambient` and drop the other; the rest of this design is
unchanged.

### 4.2 `auth` core module (`packages/core/src/auth/`)

Mostly-pure file ops over a **user-global** file `~/.coa/accounts.yaml` (outside the repo; created `0600`).
Deps: M0 schema + `node:fs` + `yaml`. Backend-blind — knows nothing about env vars or the SDK.

Operations (the surface both the CLI and the RPC verbs call):

- `list(): Account[]`
- `getActive(): { label: 'ambient' } | { label: string; account: Account }` — resolves `active` against `accounts`
- `add(label, locator): void` — append; reject duplicate label; does **not** change `active`
- `remove(label): void` — drop by label; if it was `active`, reset `active` to `'ambient'`
- `setActive(label | 'ambient'): void` — must reference an existing label or the sentinel

Strict-superset: **missing file** ⇒ `getActive()` returns `ambient`, `list()` returns `[]`. No file is written
until the first `add`/`setActive`. Path is injectable (`home` dir param) so tests run over a temp home.

### 4.3 Claude adapter: locator → SDK env overlay (`packages/adapter-claude-sdk`)

This is the **only** SDK-specific, subscription-aware code (the M9 seam). A pure function:

```text
resolveAuthEnv(locator, baseEnv): Record<string, string | undefined>
```

builds an env **overlay** from the active account's neutral locator:

| locator                       | sets                                  | always also clears                                  |
| ----------------------------- | ------------------------------------- | --------------------------------------------------- |
| `{config-dir, dir}`           | `CLAUDE_CONFIG_DIR = dir`             | `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, **and the ambient OAuth-token vars** (→ `undefined`) |
| `{ambient}`                   | — (no overlay)                        | — (zero auth, byte-identical to today)              |

**The ambient-token trap (subscription-specific).** A headless daemon is often started with a subscription token
already in the environment — `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) and/or `ANTHROPIC_AUTH_TOKEN`.
Because `options.env` is built by spreading `process.env`, that ambient token would be **carried into every
session and pin all of them to one login**, silently defeating per-account `CLAUDE_CONFIG_DIR`/`ANTHROPIC_PROFILE`
switching. So for any **non-ambient** account the overlay must also clear the ambient subscription-token vars
(`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`) so the *selected* login on disk is what resolves. The exact
set of token vars to clear (and whether clearing `CLAUDE_CODE_OAUTH_TOKEN` is necessary or breaks the config-dir
login) is a **spike output (§7)** — `resolveAuthEnv` takes the list as data so the spike can finalize it without a
design change. The `ambient` locator clears nothing (that ambient token *is* the intended login).

**Delivery into the loop.** The installed SDK `Options` type (`@anthropic-ai/claude-agent-sdk` 0.3.196,
`sdk.d.ts:1367-1381`) exposes an **`env` field** documented to *replace the subprocess environment entirely* and
explicitly to "override variables like `ANTHROPIC_API_KEY`." So the adapter passes, per session:

```text
options.env = { ...process.env, ...resolveAuthEnv(locator) }     // only when locator ≠ ambient
```

Spreading `process.env` first (the SDK does NOT merge it for you), then applying the overlay. Setting a var to
`undefined` removes it from the subprocess env. For `ambient`, `options.env` is left unset ⇒ subprocess inherits
`process.env` ⇒ today's behavior exactly. This is **per-session and process-local** — no mutation of the daemon's
own `process.env`, so two sessions under different accounts never race.

**Clearing rationale (subscription-not-API).** Per the SDK/`ant` precedence chain
(`ANTHROPIC_API_KEY` → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_PROFILE`/active profile → WIF → default login), a set
`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (even empty-string) **silently wins** over the OAuth login and bills as
API. Clearing both — plus the ambient OAuth-token vars per the ambient-token trap above — is what guarantees the
**selected subscription** login is used rather than an inherited one.

The adapter wiring (which session-construction point reads the active account and sets `options.env`) is injected
the same way the existing adapter init is — core hands the adapter the active locator; the adapter owns the env
mapping. Core never imports env-var names.

### 4.4 Surfaces

**CLI (`apps/cli`)** — pure local file ops, no daemon needed:

```text
coa auth list                          # table: label, provider, locator, * = active
coa auth current                       # the active label (or 'ambient')
coa auth add <label> --config-dir <d>  # a Claude Code config dir holding a subscription login
coa auth use <label> | ambient         # set active
coa auth remove <label>
```

`add` requires `--config-dir`; missing it ⇒ error (no ambient *account*; `ambient` is selected via `use ambient`,
not registered).

**RPC (CON-CAT verbs over the existing daemon transport, GUI-ready)** — wrap the *same* `auth` core:
`listAccounts` · `currentAccount` · `addAccount` · `useAccount` · `removeAccount`. Registered through the existing
`rpc/router.ts` + `session/daemon.ts` handler-binding pattern (mirror the read-only console handlers already
shipped). Params/results validated with the M0 schema. Maintainer confirmed: keep the RPC surface now so the
M10 inspector can drive account selection without a CLI shell-out.

### 4.5 Ledger attribution (M7 tie-in)

When a session starts, the daemon records **which account label** it ran under (or `ambient`) on the session
record that already feeds the M7 ledger. `M7.charge` attributes spend to that label. No new event type — the
label rides the existing session-start metadata. (Surfacing per-account totals is a read concern, not built here
beyond storing the label.)

## 5. Data flow (one governed session under account "work")

```text
coa auth use work
  → auth.setActive('work')                         [writes ~/.coa/accounts.yaml]
coa run … (later, maintainer-attended)
  → daemon reads auth.getActive() → {label:'work', locator:{config-dir, dir}}
  → records label='work' on the session (M7 attribution)
  → adapter: options.env = { ...process.env, CLAUDE_CONFIG_DIR: dir, ANTHROPIC_API_KEY: undefined,
                             ANTHROPIC_AUTH_TOKEN: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined }
  → query({ options }) → spawned CLI resolves the 'work' SUBSCRIPTION login → loop runs, usage → ledger('work')
```

## 6. Testing strategy

- **`auth` core** — pure file ops over a temp home: empty/missing-file strict-superset case; add/list/use/remove;
  duplicate-label rejection; remove-active resets to `ambient`; malformed-file loud error. (Vitest, no daemon.)
- **`resolveAuthEnv`** — unit per locator type: correct var set **and** `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
  cleared; `ambient` yields no overlay. Assert the env object shape; no real SDK.
- **CLI / RPC** — drive the verbs over a temp registry; assert file state and returned shapes.
- **SDK-honors-env** — the **attended spike (§7)**, not CI (needs two real subscription logins on disk).

## 7. Load-bearing first build step — the spike (§7)

**Before** building the registry/CLI/RPC, verify the rented loop actually switches **subscription** logins via
the env overlay. Smallest possible check, maintainer-attended (needs a shell with two subscription logins on disk
— e.g. two `CLAUDE_CONFIG_DIR`s each with their own `claude /login`, or two `ant auth login` profiles):

1. Confirmed already (de-risked): the installed SDK `Options.env` field exists and is documented to override
   `ANTHROPIC_API_KEY` — the *plumbing* works. ✔ (`sdk.d.ts:1367-1381`)
2. **Spike RESULT (2026-06-30 — PASSED for `config-dir`).** Ran `query()` with `options.env =
   { ...process.env, CLAUDE_CONFIG_DIR: <dir>, ANTHROPIC_API_KEY/AUTH_TOKEN/CLAUDE_CODE_OAUTH_TOKEN: undefined }`.
   Positive: a logged-in Pro subscription dir → `success` (no API key involved). Negative: an empty config dir →
   "Not logged in · Please run /login" (`is_error`), with no ambient token vars set in the shell. ⇒
   `CLAUDE_CONFIG_DIR` deterministically governs which subscription login the loop uses; no ambient leak.
3. **Decision (taken):** ship `config-dir` + `ambient`; **drop `ant-profile`** (Console/API-profile path, not
   subscription). Registry/CLI/RPC/schema unchanged except the removed union arm.

The spike does not need coa — it's a standalone `query()` call. It does need subscription auth in the shell,
which this session cannot provision (no OAuth flow here); it is maintainer-attended.

## 8. Build order (feeds writing-plans)

1. Spike (§7) — gate the locator set. _(attended)_
2. M0 `Account`/`Locator`/`AccountsFile` schema + barrel export. _(TDD)_
3. `auth` core over temp-home file ops. _(TDD)_
4. `resolveAuthEnv` in the adapter + wire `options.env` per session. _(TDD)_
5. CLI `coa auth …`. _(TDD)_
6. RPC verbs over the same core. _(TDD)_
7. Ledger label attribution on session start. _(TDD)_

Same-commit doc rule: each package/file add updates REPO_LAYOUT.md in its commit. Commits are subject-only
Conventional Commits describing the change (no module IDs / decision codes in the subject).

## 9. Maintainer decisions (resolved 2026-06-30)

1. **Spike sequencing — RESOLVED: build CI-testable pieces now.** Land the M0 schema + `auth` core +
   `resolveAuthEnv` (all spike-invariant, behind the locator union) ahead of the attended spike; gate only the
   final locator-set decision and the live session-path wiring on it.
2. **Locator set — RESOLVED: `config-dir` + `ambient` only.** The spike (§7) proved `config-dir` switches among
   subscription logins; `ant-profile` was **dropped** — `ant auth login` profiles target Anthropic Console/API
   (the API-billing path this design avoids), not Claude.ai subscriptions. `config-dir` is the sole registered
   account type.
3. **`~/.coa/` home — default `~/.coa/accounts.yaml`** (symmetry with daemon runtime-state keying); XDG is a later
   addition behind the injectable home param. Flag if you'd rather XDG from day one.
```

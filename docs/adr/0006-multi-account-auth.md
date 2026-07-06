# 0006. Credential-blind multi-account auth

- Status: accepted
- Date: 2026-07-06

## Context and problem

coa is single-user but a user routinely holds more than one Claude subscription login (e.g. a personal Pro
account and a work account), and the rented loop authenticates as whichever login the Claude Agent SDK resolves
from its own environment. Before this design, that resolution was implicit and singular: whatever `claude
/login` last wrote to the ambient config was the only login any session could ever run under, with no way to
select or attribute per session. Two requirements collide here: coa must let the user pick *which* login a
session uses, and coa must never become a place secrets pass through or rest — `~/.coa` already holds no token
material for anything else, and this design cannot be the first exception. A daemon process also complicates the
naive fix (an env var set once at process start): a long-lived daemon serving many sessions cannot select a
login by mutating its own `process.env`, because that would pin every concurrent session to whichever account
last set it.

## Decision drivers

- **Credential-blindness is a standing invariant, not new to this feature.** coa's M9 adapter already passes
  zero auth material to the SDK — the SDK resolves its own credentials from the environment. Any multi-account
  design must add *selection*, not a parallel credential store.
- **Subscription, not API key.** The user's Claude access is billed against a Claude.ai subscription (OAuth
  login), not an API key; any mechanism that causes the SDK to fall back to API billing defeats the reason
  multiple accounts exist in the first place.
- **Strict-superset (D85).** A user who registers no accounts must see byte-identical behavior to today — zero
  auth passed, ambient login wins — never a regression gated behind "did you configure this."
- **No new mutable shared state.** The daemon is long-lived and multi-session; whatever mechanism selects a
  login must not let one session's choice leak into another's.
- **Spend must be attributable per login** once multiple accounts exist, so the M7 ledger reflects reality
  instead of a single undifferentiated total.

## Considered options

1. **`ant auth login` profiles (`ANTHROPIC_PROFILE`).** Rejected post-spike: this mechanism selects Anthropic
   Console/API profiles — the API-billing path this design exists to avoid — not Claude.ai subscription logins.
   It was in the original design's locator union and dropped once the spike showed it targets the wrong
   credential family entirely.
2. **A credential vault coa owns (store or proxy the token itself).** Rejected: breaks the credential-blind
   invariant for no functional gain — the SDK already resolves subscription tokens fine on its own; coa's job is
   only to tell it *which* login directory to resolve from.
3. **Mutate the daemon's own `process.env` to switch accounts.** Rejected: the daemon is one process serving
   potentially-concurrent sessions; a shared mutable env var is exactly the race this design must not introduce.
4. **A credential-blind pointer registry (`~/.coa/accounts.yaml`) selecting a Claude Code config directory,
   delivered per session via the SDK's own `Options.env` override** (chosen). coa never touches a token; it
   only names *which login directory* the SDK should resolve from, and does so per session rather than
   per process.

## Decision

### Pointers, never secrets

`~/.coa/accounts.yaml` (`packages/core/src/auth/registry.ts`, `packages/shared/src/auth.ts`) stores accounts as
`{ label, provider, locator }`. The Claude locator is `{ type: 'config-dir', dir }` — a path to a Claude Code
config directory that already holds a completed `claude /login`. coa reads and writes this pointer only; it
never opens, parses, or copies whatever credential material lives inside that directory. Selecting an account
means choosing *which* config directory the SDK should treat as its home, not extracting or relaying anything
from it. `AccountsRegistry` is otherwise a plain file-backed registry (list / add / remove / `getActive` /
`setActive` per provider) with no knowledge of environment variables or the SDK — that translation is the
adapter's job, not the registry's, keeping the registry backend-blind.

### The hard invariant: subscription, not API key — and the ambient-token trap

Two families of environment variable can silently override a subscription login, and the adapter clears both
whenever a non-ambient account is active (`DEFAULT_CLEAR_VARS`, `packages/adapter-claude-sdk/src/auth-env.ts`):

- `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` — both force API-key billing and outrank an OAuth login if
  present, so leaving them set would silently defeat the whole point of picking a subscription account.
- `CLAUDE_CODE_OAUTH_TOKEN` — the **ambient-token trap**. A daemon process can be started with this variable
  already in its shell (e.g. from a previous manual login). Left alone, spreading `process.env` into every
  session would pin *every* session to that one ambient login regardless of which account the user selected for
  that session — the daemon's own environment would quietly outrank per-session selection.

`resolveAuthEnv(locator, clearVars)` only produces an overlay for a `config-dir` locator (`dir →
CLAUDE_CONFIG_DIR`, plus every entry in the clear list set to `undefined`); `ambient` and other provider locator
types return `undefined` — no overlay at all.

### Per-session delivery, not per-process mutation

The overlay is delivered through the Claude Agent SDK's own `Options.env` field, which **replaces** the spawned
subprocess's environment rather than patching the caller's. `sessionAuthEnv(locator, base = process.env)`
spreads the daemon's own `process.env` first, then applies the overlay on top, and the adapter passes the result
as `options.env` for that session only (`claude-sdk-adapter.ts`: `const env = sessionAuthEnv(this.#init.locator)`
feeds `assembleSessionOptions`). Nothing here mutates the daemon's own `process.env`. Because each session gets
its own computed `Options.env` object rather than sharing process-global state, two sessions running under two
different accounts do not race, and a session with no locator (or an `ambient` locator) gets `undefined` —
`Options.env` stays unset, and the subprocess inherits `process.env` unchanged, which is today's zero-auth
behavior. `getActive(provider)` returning `{ kind: 'ambient' }` (no accounts registered, or a dangling active
label) degrades identically: no locator reaches the adapter, no overlay is computed, nothing changes for a user
who never opts in.

### `ant-profile` dropped, post-spike

The original design carried `ant-profile` (`ANTHROPIC_PROFILE`) as a second locator type alongside `config-dir`.
An attended spike against a real login showed `config-dir` deterministically selects a subscription login (a
config directory pointing at a logged-in Pro account succeeded; an empty one failed with "Not logged in," with
no ambient fallback leaking through). `ant-profile` was never proven to select a *subscription* login at all —
by design, `ant auth login` profiles are how a user authenticates to the Anthropic Console/API, the API-billing
path this whole design exists to avoid. It was dropped rather than shipped untested and pointed at the wrong
credential family; the shipped locator set for the `claude` provider is `config-dir` and `ambient` only
(verified: `rg -n "ant-profile" packages/core/src/auth/registry.ts packages/shared/src/auth.ts` returns no
matches).

### Per-account ledger attribution rides existing metadata

The session records which account label it ran under (`Session.account`, stamped at `createSession` from the
same `ActiveAccountResolution` that supplied the locator) and `M7.record` attributes spend to it
(`LedgerRecord.account?`, `packages/core/src/governance/ledger.ts`). This is a new optional field on the
existing session-start and ledger-record shapes — not a new event type, transport, or spine addition. An
install running only the ambient login simply never populates the field, and every existing ledger consumer is
unaffected.

## Consequences (good / bad)

**Good**

- coa gains multi-account selection without becoming a place any token ever passes through, at rest or in
  transit — the credential-blind invariant holds exactly as it did before this feature existed.
- The ambient-token trap is closed structurally, not by convention: because delivery is per-session
  `Options.env` rather than daemon-global `process.env`, no amount of daemon-uptime or concurrent-session load
  can cause one session's account choice to bleed into another's.
- Strict-superset holds for free: an install that never touches `coa auth` never computes an overlay, and the
  loop is byte-identical to pre-multi-account coa.
- Per-account spend attribution cost nothing beyond one optional field on data that already existed at both ends
  (session start, ledger record) — no new spine event, no new transport.

**Bad**

- The design's only verified locator (`config-dir`) is Claude-subscription-specific; a second subscription-style
  provider needing its own non-API-key locator would need its own spike, not a reuse of this one.
- `~/.coa/accounts.yaml` pointing at the *wrong* config directory fails loudly at session start ("Not logged
  in"), which is correct but means a stale or manually-edited pointer surfaces as an auth failure rather than a
  clearer "account not found" — acceptable for v1's attended, single-user scope, not yet a polished error path.
- This ADR covers only the Claude subscription account family. The web-provider credential store (ADR 0005)
  reuses the same credential-blind pointer shape for a different credential family (API keys, not OAuth logins)
  — a parallel application of the same pattern, not something this ADR governs.

---

_Last reviewed: 2026-07-06_

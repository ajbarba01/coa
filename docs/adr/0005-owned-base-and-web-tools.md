# 0005. Owned base and web tools for the pure-API path

- Status: accepted
- Date: 2026-07-06

## Context and problem

Claude Code (the Claude Agent SDK's `claude_code` preset) ships `Read`/`Glob`/`Grep`/`Write`/`Edit`/`Bash` as
SDK built-ins and `WebSearch`/`WebFetch` as Anthropic *server-side* tools — the model names a tool, the SDK (or
Anthropic's servers) supplies the executor behind it. The two thin backends coa also runs (DeepSeek, LongCat,
per ADR 0002) are bare chat-completion APIs: a model can emit a tool call shaped like `Read` or `WebSearch`, but
there is no executor behind that name unless coa supplies one. Nothing in the compat-endpoint direction ADR
0002 rejected (pointing a non-Anthropic model's base URL at an Anthropic-shaped API) closes this gap either —
that swap makes a foreign model *look like* Claude to the SDK, but it cannot make Anthropic's own server-side
WebSearch execute on Anthropic's infrastructure for a model Anthropic isn't serving. So on the pure-API path,
and only there, coa owns both families of executors itself: `packages/core/src/workbench/base-tools.ts` (the
six base tools) and `packages/core/src/workbench/web-tools.ts` plus `packages/core/src/workbench/web/` (the two
egress tools and their provider chains). This ADR is the durable record of why coa owns them, where the
boundary sits, and the security posture that ownership commits to.

## Decision drivers

- **No-lock-in (constitution):** the neutral floor must always work. A thin backend without Read/Write/Bash
  cannot edit code at all; without WebSearch/WebFetch it cannot research past its training cutoff. Both are
  floor requirements, not enhancements, for the pure-API path to be a real backend rather than a second-class
  one.
- **Don't duplicate what the fat adapter gets for free.** Claude already has better-integrated equivalents
  (native SDK sandboxing, Anthropic's own indexed web access); re-supplying them there would be adherence tax
  with no governance upside — coa's job is to fill the gap the thin backends actually have, not to re-litigate
  a path that already works.
- **Two different questions must never collapse into one:** "does this backend have an executor for this tool
  at all" is a different axis from "may this session call it," and conflating them either hides a capability a
  role should have or silently grants one a backend cannot actually run.
- **SC-1 (help, never cage)** applies to every handler these tools add — a rejected path, a bad match, or a
  spawn failure must degrade to an unapplied result the agent can read and retry, never a thrown exception that
  ends the turn outside governance's view.
- **coa is local-first, attended, single-user (v1 scope, per AGENTS.md).** Security choices below are sized to
  that threat model, not to a multi-tenant or unattended one; the ADR says so explicitly rather than leaving it
  implicit.

## Considered options

1. **Do nothing — thin backends simply have no file or web tools.** Rejected: fails the no-lock-in floor
   outright; a backend that can't touch the repo or the web isn't a governable coding agent, it's a chat box.
2. **Compat-endpoint routing — point a thin backend's requests at an Anthropic-shaped API surface so the SDK
   (or Anthropic) supplies the executors.** Rejected by ADR 0002 for the loop generally, and it specifically
   cannot work for server-side WebSearch: that tool executes on Anthropic's own infrastructure against
   Anthropic's own model, not against whatever model answers on the other end of a rerouted base URL.
3. **coa supplies its own executors, scoped to the pure-API path only, wired through the existing M6 governed-tool
   catalogue** (chosen). `buildGovernedTools`'s `includeBaseTools`/`includeWebTools` flags add these tools only
   when the backend has no native equivalent; the fat (Claude) adapter never sets them (verified:
   `packages/core/src/session/daemon.ts:326` sets `includeBaseTools: true` unconditionally only inside
   `buildBaseCatalogue`, the pure-API tool-catalogue builder, and `includeWebTools` only when a `web` config is
   present — nothing analogous exists for the Claude SDK path, which relies on the preset's own built-ins per
   ADR 0004).

## Decision

### The backend gate vs. the role gate — two axes, not one

**Backend gate — does the executor exist for this provider at all.** `buildGovernedTools`
(`packages/core/src/workbench/governed-tools.ts:140`) takes `{ includeBaseTools?, includeWebTools? }`; each flag
asserts its matching deps object is present (`deps.base`, `deps.web`) and throws a build-time error otherwise —
a composition bug, not a runtime one. This is the *only* place backend-awareness about these tools lives,
consistent with DC-5a (ADR 0004): composition and compile stay neutral; the M9/session layer (`daemon.ts`)
decides per backend which tool families exist. `includeWebTools` is set whenever a `web` config block is
present (`daemon.ts:326`), because the free-fetch floor (below) guarantees a working chain even with no
provider keys configured.

**Role gate — which subset of the existing tools a given session may call.** This is unchanged machinery,
reused rather than duplicated: the `CapabilityFrame.allow`/`deny` list feeds the `canUseTool` predicate
(`packages/core/src/session/permission.ts`) that already governs every tool. Each base/web tool is an
individually-named catalogue entry — never a single opaque "file-tools" or "web-tools" blob — tagged with a
capability `group` (`packages/core/src/workbench/catalogue.ts`'s `ToolManifestEntry.group`:
`'read' | 'write' | 'exec' | 'egress'`; `Read`/`Glob`/`Grep` are `read`, `Write`/`Edit` are `write`, `Bash` is
`exec`, `WebSearch`/`WebFetch` are `egress`). A role's frame can allow-list by name or by group without coa
inventing new grouping machinery beyond what capability-frame allow/deny already does.

A tool can therefore be backend-absent-but-role-irrelevant (Claude session: the flags are never set, so the
question doesn't arise) or backend-present-but-role-denied (thin backend, but this role's frame excludes
`Bash`) — the two gates compose independently and neither can substitute for the other.

### SC-1 discipline in every added handler

Every handler in `base-tools.ts` and `web-tools.ts` follows the same shape: Zod-validate the args (structural
failures are the caller's contract, not this ADR's concern), confine/dispatch, and on any operational failure —
a path outside the worktree, a missing file, a non-unique `Edit` match, a spawn failure, an exhausted provider
chain — return a typed *unapplied* result (`{ applied: false, error }` for writes; `{ found: false, reason }`
for reads; `{ fetched: false, reason }` for web) rather than throwing. `bash()`'s underlying `exec` port is
documented to never throw — a spawn failure surfaces as a non-zero `exitCode`, still inside the normal
tool-result shape. This is what lets a session recover mid-turn instead of the whole loop dying on a bad tool
call, and it is the same SC-1 contract every other coa tool already honors — these tools don't get an exception.

### Security posture, base tools

- **S-1 confinement covers both reads and writes.** `confine()` (`base-tools.ts:154`) runs `confinePath` before
  every `Read`/`Glob`/`Grep`/`Write`/`Edit` touches disk, with a symlink-aware `realpath` resolver and a
  `denyRead` deny-list layered on top of the worktree-root boundary. These are in-process MCP tool handlers,
  not the SDK's own sandbox — the confinement is coa's to own precisely because there is no SDK backing it up
  on this path.
- **Write/Edit fund through the single M1 `emit` spine (P7).** Both handlers write bytes to disk *and* call
  `deps.emit(draft)` to append a `ChangeEventDraft` to the same M1 append log every other producer uses
  (`emitFileChange`, `base-tools.ts:260`) — there is no separate "pure-API write path" that could drift from the
  spine's disk+graph invariant; a write from a thin-backend session is exactly as observable to M1's consumers
  as one from the fat adapter.
- **Bash is a named S-2 deviation, not an oversight.** `bash()` confines only to `cwd = worktreeRoot`
  (`base-tools.ts:311`) — there is no OS-level sandbox on the pure-API path, because none exists to call into.
  This is accepted, not merely tolerated, on the stated grounds that coa v1 is local-first/attended/single-user
  (the same user who could run an unsandboxed shell directly has lost nothing) and that this is parity with
  Claude Code itself, which also runs an unsandboxed shell under the user's own permissions. Output is capped
  (`BASH_OUTPUT_CAP`) and time-boxed (`DEFAULT_BASH_TIMEOUT_MS`) so a runaway command degrades gracefully rather
  than hanging the loop or flooding the transcript, but neither cap is a security boundary — they bound
  blast radius on a misbehaving command, not on a malicious one. **Full per-session process isolation remains
  the documented v2 prerequisite** before this deviation could be closed; it is out of scope for v1.

### Web egress posture

- **Cooldown-aware multi-key provider chains, falling back to a plain-fetch floor (D85).** `WebSearch`/`WebFetch`
  each run a routed chain (`RoutedSearch`/`RoutedFetch`, `packages/core/src/workbench/web/routing.ts`) across
  configured providers before either exhausting (an unapplied SC-1 result) or, for fetch, degrading to a bare
  `fetch()` when no provider key resolves — the strict-superset invariant (D85) means an unconfigured install
  still has a working (if unenriched) web tool, never a hard failure.
- **The WebFetch summarizer is optional; its absence is a mode, not a degradation to fix.** When
  `web.fetch.summarizer` is configured (a DeepSeek `complete()` call) and the fetched content is non-clean
  (i.e., not already-clean Firecrawl markdown), `webFetch()` summarizes; otherwise it returns capped raw
  markdown. A summarizer failure itself also degrades to raw markdown rather than failing the fetch
  (`web-tools.ts:105-112`) — SC-1 all the way down.
- **Egress produces no change-events.** `WebSearch`/`WebFetch` never touch the worktree and never call `emit` —
  they are reads *of the outside world*, not writes to the governed one, so M1's change-event spine correctly
  has nothing to say about them.
- **S-4 domain-policy governance is a placed-but-floored seam, not a built one.** `SearchRequest`/`FetchProvider`
  carry `allowedDomains`/`blockedDomains` fields that pass straight through to each provider's own query
  parameters (Firecrawl/Parallel/Tavily each accept an include/exclude-domains parameter) — this is the *agent*
  requesting a filter on its own search, not coa enforcing a domain allow/deny policy on the agent's behalf.
  There is no coa-side gate today that inspects or overrides a URL/domain before `WebFetch` or a search
  provider call executes. The shape for such a gate exists (the same field names a policy layer would consume)
  but no enforcement sits behind it; closing this is deferred, consistent with OPEN.md's tuning-knob scope.
- **The summarizer's cost is audited but not yet counted against the M7 cap.** `buildFetchSummarizer`
  (`packages/core/src/session/daemon.ts:336`) records every summarizer call to the governance ledger
  (`governance.record({ scope: 'web_fetch_summarizer', ...usage })`) so the spend is never invisible, but the
  inline comment is explicit that it is *not yet* charged against the M7 cost-cap this increment — a scoped,
  named deferral, not silent scope creep.

### Local key store

Web-provider credentials live in a **credential-blind pointer file**, `~/.coa/web.yaml`
(`packages/core/src/workbench/web/web-config-store.ts`): each entry is a `{ type: 'env-var', name }` or
`{ type: 'key-file', path }` locator, never the secret itself. A `key-file` locator names a coa-written,
0600-permissioned file under `~/.coa/keys/web-<label>` (`webKeyFilePath`). `coa websearch`/`coa webfetch`
(`apps/cli/src/web-cli.ts`) are CLI twins of `coa auth`'s account-credential commands, split by chain
(`search` vs. `fetch`) rather than by a single flat provider list, because a provider can support one chain, the
other, or both. This mirrors the same credential-blind-pointer + 0600-key-file pattern the Claude
subscription-account store already uses (see the companion multi-account ADR 0006) — one pattern, reused for
a second credential family, not reinvented.

**Shipped providers: `firecrawl`, `parallel`, `tavily`.** Verified directly against
`packages/core/src/workbench/web/web-config-store.ts`: `SEARCH_KINDS = ['tavily', 'firecrawl', 'parallel']`,
`FETCH_KINDS = ['firecrawl', 'tavily']` (Parallel is search-only in the shipped code — it has no fetch
adapter). No `exa` or `brave` provider exists anywhere under `packages/core/src/workbench/web/`; an earlier
owned-web-tools design draft that named `exa`/`brave`/a Parallel-default has drifted from what shipped, and
this ADR records the current, verified set as authoritative.

## Consequences (good / bad)

**Good**
- The pure-API path is a genuinely complete backend, not a crippled one: a DeepSeek or LongCat session can read,
  write, run shell commands, search, and fetch, with the same governance surface (change-events, capability
  frames, SC-1) as the fat adapter's equivalents.
- The backend/role split means adding a third thin backend costs nothing new here — it reuses the same
  `includeBaseTools`/`includeWebTools` flags and the same capability-frame allow/deny path; no new gating
  machinery is invented per backend.
- Every added handler is individually named and grouped, so a role's capability frame can be as narrow as
  "read-only, no egress" without coa needing a new mechanism beyond what already governs every other tool.
- Both named deviations from a stricter security posture (Bash's cwd-only confinement, the summarizer's
  ledger-but-uncapped cost, the domain-policy seam) are documented as deliberate, scoped, and reversible, rather
  than left to be rediscovered as surprises.

**Bad**
- Bash on the pure-API path has no real sandbox — a malicious or badly-prompted session can run anything the
  host user could run, bounded only by output size and a timeout, not by permission. This is accepted for v1's
  attended/single-user scope, but it is a real gap for any future multi-tenant or unattended posture.
- The S-4 domain-policy seam being placed-but-floored means an operator who configures `allowedDomains`
  expecting coa-side enforcement would be surprised: today it is purely a per-call parameter forwarded to
  whichever provider happens to honor it, not a coa-owned policy.
- The WebFetch summarizer's cost is ledger-visible but cap-invisible — an install with a configured summarizer
  and no attention to the ledger could accumulate spend the M7 cost-cap does not see or block, until the
  deferred wiring lands.
- The credential-blind key store depends on `~/.coa/keys/*` actually staying 0600 on every OS coa runs on;
  Windows' ACL model does not map cleanly onto POSIX file-mode bits, so the "0600" guarantee is stronger on
  POSIX hosts than on Windows ones — a gap this ADR names but does not close.

---

_Last reviewed: 2026-07-06_

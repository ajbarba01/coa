# ADR rationale harvest — for the ARCHITECTURE.md author

Source: every file in `docs/adr/` (0001–0034 + README), read 2026-08-07, after the knife
(dead subsystems moved to `archive/`). Each entry below was verified against live code with
grep before classification — liveness claims name the file that proves them. ADR numbers are
cited once per entry for git-history traceability only; every distillation is written to stand
alone without the numbering. When `docs/adr/` is deleted, these notes are what survives.

Classification: **LIVE** (inline this rationale where the constraint lives), **DORMANT**
(belongs in the dormant-substrate section), **SUPERSEDED/DEAD** (one line, do not carry).

---

## Cross-cutting invariants (LIVE)

### Strict superset — feature-off is never worse than the raw loop (ADR 0008)
Every feature coa adds must either add value or degrade to a literal pass-through, and a raw,
unfiltered view of the loop always exists. The reason: coa sits between the user and a rented
loop it does not own, so "not yet built" or "misconfigured" must never make the governed loop
worse than running the agent bare. This is a floor every module builds down to, enforced
independently at the context layer (an absent producer registry stays inert), the tool layer
(an unconfigured summarizer degrades to raw output), and the UI (raw mode reprojects verbatim
frames). Cost: every feature carries an explicit off/degrade path.

### Exactly two blocks, through one deny channel (ADR 0009)
The only two things in the whole system that can stop the agent are the close-gate (a governed
"you're not done yet" at turn end) and the cost cap. Both are issued through one seam —
`buildCanUseTool`/`buildStopGate` in `packages/core/src/session/permission.ts` — so auditing
"can coa ever block me" is a two-line answer instead of a system-wide search. The cost-cap
check runs first; a predicate exception fails closed rather than silently admitting a call.
The per-tool advisory→deny (`FlagPipeline.perToolDeny`, `packages/core/src/flags/`) rides the
same hook but is an explicitly demotable policy, not a third standing block. Adapters hold no
policy — they only run the predicate the core assembles.
Note for the author: the knife kept the cost-cap deny path but flagged it as questioned; the
mechanism above is what ships today.

### The cost cap bounds fan-out — there is no depth limit (ADR 0032) — KEEP PROMINENTLY
The original spec bounded subagents to depth 1 by withholding the spawn tool from children.
When `spawn_agent` actually shipped, the fix that made it reachable made it available to
children too, and the depth bound was deliberately **not** restored. Rationale, all still live
design: (1) a depth check that denies a spawn would be a third block, violating the
two-blocks-only invariant; (2) a depth counter only stops a chain, not a wide fan-out — the
real risk is total spend, not nesting; (3) the cost cap is already daemon-global
(`CostCap.capState`/`charge`, `packages/core/src/governance/cost-cap.ts` — one running total
for the whole daemon, every session draws it down), so a spawned child's calls are ordinary
governed calls with nothing new to build. The tree's `root` id is a record key for spend
attribution and the stop cascade, never a second ceiling. Because nothing guarantees the
parent graph is acyclic, the lineage walk (`packages/core/src/session/lineage.ts`) carries a
visited set — termination is structural, not trusted. Known, accepted lag: the cap is checked
pre-call and charged at settlement, so a burst of spawns can be admitted before the ceiling
reflects their cost; the daemon-wide cap still ends it, just not instantly. This decision
blocked a reset ruling and is live design.

---

## Backend seam and the borrowed harness (LIVE)

### One backend-blind core, one seam (ADR 0002)
The core never names a backend. Everything upstream produces neutral artifacts; the only
backend seam is the runtime-adapter port (`packages/spi/src/runtime-adapter.ts`), and the one
wire vocabulary every consumer reads is the neutral frame stream
(`packages/shared/src/push.ts`) — console and CLI consume frames identically no matter which
backend produced them. Adapters differ in shape, not interface: the Claude adapter is "fat"
(the SDK owns its loop; coa configures and governs around it), DeepSeek/LongCat are "thin" (a
bare `complete()` primitive; the shared `packages/loop-driver` supplies the governed loop, so
the governance-critical dispatch path exists exactly once). The single place a concrete
backend is constructed is `createAdapter` in `apps/cli/src/adapter-factory.ts`. The core asks
capability questions with defined null-fallbacks, never `if (backend === …)`. On the thin
path coa executes every tool call itself, so governance there is tighter, not looser.

### Layer on the native preset; composition never branches on backend (ADR 0004)
On Claude, coa does not own the whole system prompt — it layers its own authority on the SDK's
native `claude_code` preset, because restating baseline conduct the model already follows is
pure token tax and fights a model that is already good at it. The invariant worth keeping: the
composition/compile layers are backend-neutral and emit every piece; the only place a
backend's coverage is subtracted is the adapter's render step (a small drop-set of generic
baseline pieces in `packages/adapter-claude-sdk/src/render-native.ts`; bare-API adapters apply
no drop-set and render everything). Leaning on the preset reopens a config-leak risk, and its
containment is live and test-asserted: `buildBaseOptions`
(`packages/adapter-claude-sdk/src/sdk-options.ts`) sets `settingSources: []` and
`strictMcpConfig: true` unconditionally, so the target repo's own CLAUDE.md / settings /
ambient MCP servers can never enter a governed session as authority coa never rendered.
Known cost: the drop-set is hand-picked and can drift against the vendor's preset with no
automated signal.

### Session strategy per provider: held-open vs per-turn (ADR 0012)
How a live session drives its turns is an abstract per-provider verdict —
`sessionStrategy(provider) → 'held-open' | 'per-turn'` in `apps/cli/src/adapter-factory.ts`,
co-located with the backend map so core never sees a provider literal. Claude runs held-open:
ONE SDK query stays alive across a session's turns (warm continuation, no resume replay), fed
successive user turns as a stream; pure-API backends stay per-turn. A mid-conversation model
or prompt-config change re-establishes the query rather than silently continuing on the old
pinned prompt. The measured ceiling that shaped everything downstream: the SDK has **no
mid-turn inject primitive** — a message pushed into the open input stream queues to the next
turn boundary. That measurement is why mid-turn delivery rides the tool-result slot (see
delivery entry) and not the input stream. (This ADR's barge-in follow-up was later removed —
see the steer-recording entry.)

### coa borrows the harness; it never modifies it (ADR 0026)
The vendor harness is a compiled binary behind a thin wrapper; forking the public repo buys
none of the behavior anyone wants to change, and patching the binary fails on release cadence
(~27/month), checksum/signature integrity, and licensing. Ruling: **configure the harness, or
don't borrow it for that case** (the pure-API path exists) — no middle option involving a
modified binary. The mitigation for "the boundary moves under us" is the control-probe suite
(`packages/adapter-claude-sdk/src/control/`): every measured verdict about the SDK is
version-stamped and asserted, so an SDK bump fails a probe and names what expired instead of
silently invalidating a design. The rule is uniform for any future borrowed harness.

---

## Tool surface and governance (LIVE)

### One bounded tool surface, governed at one seam (ADR 0029)
Every backend carries the same eight-tool floor — Read, Glob, Grep, Write, Edit, Bash,
WebSearch, WebFetch (`packages/adapter-claude-sdk/src/tool-frame.ts`) — set unconditionally:
an empty capability frame yields the floor, and an allow-list narrows it, never widens it.
Everything outside the floor was ungoverned, unrecorded, and unmatched on other backends.
coa owns **no native tool implementation** — trained priors cover the whole contract including
output shape (Read's numbered lines are what Edit's exact-match is calibrated against), so
substituting a body under a native name reproduces known upstream hazards for no gain.
`PreToolUse` is the single per-tool gate (wired in
`packages/adapter-claude-sdk/src/session-options.ts`); it **denies or abstains and never
asserts allow** — an explicit allow at that seam is an auto-approve, the same mistake as the
`allowedTools` list this design replaced. Why this seam: measurement showed the SDK's
permission callback is simply not consulted for delegation or (under the preset) ordinary
reads, so governance rides the seam measured to see calls, and coa's own deny record lands in
its own append-only log. `PostToolUse` drives the change reconciler
(`packages/core/src/reconcile/reconciler.ts`): rather than parsing per-tool inputs, it scans
the worktree after tool activity, dedups coa's own precise writes, respects `.gitignore` — one
trigger covers a native Edit, a Write, and anything a shell command touched. Outside a git
worktree the reconciler latches to a no-op: the gate still runs, the record degrades —
an honest floor, stated rather than hidden.

### Owned base and web tools on the pure-API path (ADR 0005)
The thin backends are bare chat APIs — no executor exists behind a tool name unless coa
supplies one — so coa owns the file tools (`packages/core/src/workbench/base-tools.ts`) and
web tools (`packages/core/src/workbench/web-tools.ts` + `web/`) for that path only; the Claude
path keeps the vendor's better-integrated equivalents. Durable structure: **two independent
gates** — "does this backend have an executor at all" (composition-time flags) vs "may this
session call it" (the capability frame / permission predicate) — must never collapse into one.
Every handler honors the no-throw discipline: operational failures return typed unapplied
results (`{applied:false}`, `{found:false}`, `{fetched:false}`) the agent can read and retry,
never an exception that kills the turn. Reads and writes are path-confined (symlink-aware
realpath + deny-list) because no SDK sandbox backs this path. Named deviations, accepted for
an attended single-user v1: Bash is confined only to the worktree cwd (output-capped and
time-boxed, but no OS sandbox — parity with the vendor's own shell); web domain filters are
forwarded to providers, not enforced coa-side. Writes fund through the one change-event emit
spine, so a thin-backend write is exactly as observable as any other. Web egress runs
cooldown-aware provider chains degrading to a plain-fetch floor; provider keys live as
credential-blind pointers (`~/.coa/web.yaml` + 0600 key files), the same pattern as account
auth.

---

## Session engine and persistence (LIVE)

### One append-only conversation log per session (ADR 0010)
A session's conversation persists as a single append-only `events.ndjson`; the UI view and
the provider-shaped transcript are **read-time projections** of it
(`foldEventsToTranscript`, `packages/core/src/session/transcript-projection.ts`;
store in `packages/core/src/session/conversation-store.ts`). Why: the prior two-store shape
(incremental UI file + canonical transcript rewritten on clean settle) made transcript
integrity a per-call-site flushing discipline, and a mid-turn error produced disk/conversation
divergence. With one log that only grows, integrity is structural: a crash cannot persist an
inconsistent state. Unpaired tool calls are repaired at read time (a synthesized
"[Tool execution was interrupted]" result, keyed by call-id set membership; orphaned results
dropped) so cross-provider replay stays valid. Streaming token deltas stay OUT of the log —
settled frames only. Every surveyed mature harness converged on this shape.

### The daemon owns a live session; a connection is just a viewer (ADR 0011)
A session's lifecycle and liveness belong to the daemon-singleton registry
(`packages/core/src/session/live-registry.ts`, `live-session.ts`, `run-live-session.ts`),
never to any one connection. Creating a session is send-or-create: sends queue as turn
requests; a daemon-owned loop drains them one at a time through the same per-turn body both
backends already use. A connection is a stateless, reattachable subscriber that is hydrated
with true current run-status on attach — a console reload or second window reads the daemon's
truth instead of reconstructing liveness from stale client memory, and a live session runs
headless with zero subscribers. Interrupt/steer/close act on the registry's session; an
interrupt is a user action and never renders as an error. The registry's single teardown path
(idle eviction, the close verb, or shutdown alike) is where the checkpoint and worktree
release happen; idle eviction is running-aware.

### Streaming deltas are delivery-only (ADR 0013)
The thin-path completion primitive is an async generator: it yields text/reasoning deltas and
*returns* the settled result (a non-streaming backend yields nothing — the degrade is free).
Delta frames (`text-delta`/`thinking-delta` in `packages/shared/src/push.ts`) are pushed to
the UI but never appended to the durable log; the settled frame is the sole record, so the
append-only substrate stays correct by construction (zero appends during a stream, exactly one
at settle — peers that persisted deltas filed regressions). A mid-stream interrupt keeps the
accumulated partial, marked `[interrupted]`, as one settled frame.

### Mid-turn delivery: one intent, realized per backend (ADR 0030)
"Text waiting to reach a running loop" is one neutral port — `Delivery {origin: 'user' |
'system'; text}` / `DrainDeliveries` on the adapter interface, queued in
`packages/core/src/session/delivery.ts` — drained by each backend at its own soonest legal
boundary; core never asks which backend it is talking to. On Claude the only legal mid-loop
position is beside a tool result (the API forbids a bare user message between a tool call and
its result), so the post-tool hook carries pending text as additional context, with the Stop
hook as the floor for tool-free turns; the pure-API loop drains at the top of each round trip;
a delivery stranded past the last drain point degrades to a plain next turn — never lost,
never a hang. The queue's `seal()` is a one-way cancel-guard: a delivery arriving after a
session tore down can never wake a subtree a person deliberately stopped. The `system` origin
is unforgeable **by reachability, not convention**: no tool handler ever receives a session
handle capable of authoring a delivery, so nothing a model runs can mint a system notice.

### A steer is recorded when the model receives it (ADR 0031)
The append-only log line for a steer is written at **drain** (when the text is actually handed
to the model), not at send — held while any tool call is open and written the instant the last
one closes (`createDeliveryRecorder`, `packages/core/src/session/session-handlers.ts`). A
send-time record claimed a transcript position that never happened and could land inside a
tool_use/tool_result pair — an illegal shape that corrupted cross-provider replay. The rule is
phrased as the legality constraint (hold while a tool_use is open) precisely so it is correct
regardless of unmeasured hook-timing facts, provable against a mock frame stream. One writer,
in core, for every backend. Floors: an unbalanced turn flushes held lines at the boundary; a
sealed queue is never drained, so an undelivered steer is never recorded. Barge-in was removed
outright: a steer always delivers at the next possible boundary and never discards in-flight
work — discarding a turn is now an explicit Stop-then-send.

### A completion notice is a fact, not a message (ADR 0033)
When a child session ends, its parent gets a daemon-authored lifecycle fact — child id, agent
ref, one of three observed reasons (completed/errored/stopped), and a bounded, sanitized error
detail (`packages/core/src/session/notify.ts`) — **never the child's own text**. If the notice
were child-authored, a broken or adversarial child claiming "done" would be indistinguishable
from an observed fact in the parent's context. There is deliberately no inferred reason (no
"went quiet"): a signal that cannot be detected must not be reported as one. The notice rides
the same delivery queue as everything else (no parallel pipe), with the system origin
unreachable from any tool handler. The parent retrieves the child's actual work itself by
reading the child's own append-only log with its ordinary file tools. Deliberately not built:
agent-to-agent messaging — left fully undesigned so its trust model isn't inherited from this
narrower channel.

### A subagent is a session with a parent link (ADR 0034)
A spawned child is created through the exact same path as any session, carrying two optional
fields — `parent` and `root` — and nothing else distinguishes it. Everything a session already
has (idle eviction, the single teardown path, cost settlement, the append-only log) is thereby
free for a child with zero new state to synchronize, and the ordinary session's on-disk shape
is byte-identical (no parent ⇒ no key written). Lineage is a single stored pointer per
session; `descendantsOf` (`packages/core/src/session/lineage.ts`) rebuilds the tree on demand
with a visited set, so the stop cascade provably terminates on any graph shape, cyclic or not.
Abort is wired at the session-lifecycle seam (seal the delivery queue, close the session), not
the turn seam — it works mid-turn, between turns, or before the first turn, on every backend.
A spawn against a dead parent orphans the child rather than refusing it (a refusal would need
a throw or a lying success); the orphan runs its assigned turn and self-cleans via idle
eviction. Named, accepted risk: a child shares its root's worktree — two agents can write the
same tree concurrently; v1 is attended and every write still passes the gate.

---

## Auth and identity (LIVE)

### Credential-blind multi-account auth (ADR 0006)
coa stores **pointers, never secrets**: `~/.coa/accounts.yaml`
(`packages/core/src/auth/registry.ts`) maps an account label to a config-directory path
holding a completed vendor login; coa never opens, parses, or copies what's inside. Selection
is delivered per session through the SDK's own env-override option — never by mutating the
daemon's `process.env`, which would pin every concurrent session to one account. The overlay
(`packages/adapter-claude-sdk/src/auth-env.ts`) also clears the env vars that would silently
outrank a subscription login (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN` — the ambient-token trap), because those force API-key billing and
defeat the reason multiple subscription accounts exist. No accounts registered ⇒ no overlay ⇒
byte-identical ambient behavior. Spend is attributed per account label on the existing ledger
record.

### Login health is probe-derived; broken is flagged, never auto-switched (ADR 0017)
Health comes only from the CLI's own status probe
(`packages/adapter-claude-sdk/src/auth-status.ts`) — never from reading token files, which
would breach credential-blindness and lie under silent OAuth refresh. The probe's landed email
is the identity truth; a mismatch is surfaced with keep/retry. A broken **active** account is
flagged with a re-login action, never silently rerouted to another account — silent switching
would hide the problem. Health is cached per daemon run and refreshed on view/refresh/live
failure; no background polling.

### A login is a transition, not a state (ADR 0022)
A login flow completes only if the login directory **started clean**: the manager
(`packages/core/src/auth/login-manager.ts`) probes a baseline concurrently with the CLI spawn
and finalizes only from that baseline. A directory that was already authenticated ends the
flow in a `preexisting` decision naming who it holds — use it or cancel — instead of being
reported as a successful login that never happened (found live: closing the browser tab
without authorizing "succeeded"). A baseline that cannot be established is treated as clean,
so probe failure degrades to the old behavior. The verdict is enforced at the one completion
funnel all probe-driven paths pass through, not per caller.

### Removal deletes the login coa created — and only that (ADR 0023)
Removing an account deletes its login directory **iff coa created it**: the ownership test
(`isManagedLoginDir`) is a path-containment check under `~/.coa/logins` that fails toward
"kept". A config dir the user pointed at is never touched. No toggle: a login is the
credential itself, and keeping it is what produced phantom re-login surprises; the browser
profile keeps its opt-in toggle because a cookie jar is a cache, not a credential.

### Browser-profile auth: identity-keyed profiles, one shared browser root, courier shim (ADRs 0020, 0021, 0024)
Isolated sign-ins launch a **real** browser (embedded windows are rejected by identity
providers; honesty over spoofing), with per-identity cookie isolation via one Chrome
profile-directory per identity under a single shared user-data-dir
(`~/.coa/browser-session/profiles`) — measured: ~90% of a per-identity user-data-dir was
shared machinery, not the login, so isolation is bought per-profile, not per-dir
(`packages/core/src/auth/browser-session.ts`, `browser-paths.ts`). Profiles are keyed by
**identity, not account row**: `profileKey(email)` = readable slug + short digest — the jar is
a cache of a signed-in identity whose worth is being found again; row-keying stranded
unreachable megabyte-scale orphans and forced re-sign-ins. The `BROWSER` env shim is a
**courier**: it writes the CLI's self-completing authorize url (the localhost-callback one,
not the paste-code fallback) to a file and exits, suppressing the CLI's own browser open; coa
performs the real open itself as an argv spawn with **no shell in the path** — every failure
in this lineage was a shell-quoting failure, and the class was removed, not patched. Every
failure degrades to copy-link + paste-code, which stays portable to another device. Dead jars
are reclaimed only through a surfaced list the user acts on (rename-then-delete so an open
window can't leave a half-deleted jar); never a background sweeper.
Process lesson kept from this lineage: when an experiment rules out a mechanism, name the
variant tested, not the category (three ADRs in one day came from over-generalizing one test).

---

## Prompt, roles, and model catalog (LIVE)

### Roles, slots, and no coa-added safety prose (ADR 0003)
A role is coa-authored prose plus typed capability references, and roles are **additive and
stackable**: none selected adds nothing (the permissive floor); several union their prose and
capabilities, deduped (`packages/shared/src/agent.ts`,
`packages/core/src/session/assemble-agent.ts`). The assembled prompt is a fixed nine-slot
skeleton (`packages/shared/src/slots.ts`, rendered byte-stably) — stable, high-authority
content first for primacy and cache warmth, one volatile tail last — because measured evidence
says structure beats prose and instruction density has a real adherence cost. coa adds **no
refusal/safety prose**: it duplicates the model's trained behavior, costs adherence tokens,
and would be an undeclared third block — coa does not govern how a user uses their agent.
Registries are designed to merge user `.coa/` overrides (data change, not code change). The
generic bundle/package wrapper was demoted to an optional distribution shell; its import
machinery is archived.

### The model catalog is coa-owned; the backend enriches, never defines (ADR 0016)
The per-provider model list the pickers consume is the user's editable list
(`~/.coa/models.yaml`), seeded from a hand-verified shipped catalog
(`packages/core/src/models/default-catalog.ts`); the backend's live model fetch is demoted to
enrichment (capabilities, "add from defaults") because no backend reliably enumerates what
actually works — the SDK advertises five aliases while the subscription honors explicit older
ids it never mentions. Resolution is user override → live fetch → shipped catalog → bare
`{id}` (`effective-models.ts`). Never-cage holds structurally: an emptied list serves empty,
a removed or hidden id still runs on the wire, an unknown hand-typed id assembles to a bare
runnable descriptor. Reaching a new model is a data change, not a rearchitecture.

---

## Console / workbench (LIVE)

### The workbench design system (ADR 0014; carrying forward the surviving rules of 0007; extended by 0015; package shape from 0025)
The console is a conversation-first workbench: the session's conversation holds the center
canvas on the darkest ground; other surfaces swap in via an app-scoped left nav; the right
column is the active session's working state. A session is presented as a unit of work, not a
chat log. The register is quiet on a sand-dark neutral scale: state is a **dot**, magnitude is
a **count** (zero renders nothing), detail lives at hover/focus, and exactly four status hues
exist (blue running, amber needs-you, red critical, green done) — accent color never
decorates. One named motion character (fast, expo-out, small travel, reduced-motion collapses
it). A theme is a full scale swap at equal quality, never a partial recolour.
Rules that survive from the first console system and still bind:
- **The GUI is a client, never a second source of truth**; raw mode renders the daemon's
  frames byte-faithfully and is reachable (command palette) but never advertised chrome.
- **Exactly one component can render a block** — `DenyNotice`
  (`packages/console-transcript/src/DenyNotice.tsx`), constructed only from a daemon-issued
  deny frame; the console itself never originates a denial. This is the two-blocks invariant
  made structural at the component boundary.
- **The transcript is unwindowed by design**: every frame is a real DOM node with
  `content-visibility` keeping off-screen rows cheap, because full-conversation text selection
  and native find are incompatible with row windowing (the windowed foundation was built,
  used, and reversed on evidence).
- **Every kit member carries an enforced intent contract** (blank fields throw at declaration)
  and a showcase specimen enforced by test — the catalogue cannot drift from the code.
Package shape: two packages that each mean one thing — `packages/console-kit` (the vocabulary:
primitives, tokens, themes) and `packages/console-transcript` (the one big surface built from
it). The transcript is deliberately not a kit member: admitting a 3,600-line single-consumer
renderer would carve a permanent exception into the kit's discipline.
Color exceptions, both deliberate and bounded (ADR 0015): a third party's brand mark wears its
own colour on every row — on a credentials surface the logo IS the identity, and identity is
never state (a benched provider's mark is dimmed, never recoloured; the hex lives on a
descriptor, not a token; unknown providers degrade to a monogram tile so a new provider stays
a registry row). Charts get their own three-colour series palette, disjoint from the status
hues so a spend segment can never read as a warning — assigned in fixed order, never
reassigned by rank, validated as a set (lightness band, chroma floor, colourblind separation,
contrast), never colour-alone (legend + named hover).

---

## Dormant substrate (the kept symbol/graph layer)

The change-event spine itself is **live**: the kernel (`packages/core/src/kernel.ts`) with its
WAL (`packages/core/src/wal/`) is the single append log all file-change producers fund through
— coa's own Write/Edit handlers emit change events (ADR 0005's rule: no second write path that
could drift from the spine), the post-tool reconciler emits what native tools and shell
commands touched (ADR 0029), and the checkpoint timeline reads it
(`packages/core/src/checkpoint.ts`, surfaced in the console Timeline panel).

What is **dormant** is the graph/symbol projection layered on those events: the typed graph,
symbol table, tree-sitter reparse and convention extractors
(`packages/core/src/graph/`, `packages/code-intel/`), and the scope resolver
(`packages/core/src/scope/`). No production path populates the symbol table — which is exactly
why the grounding producer was archived (it could only query a permanently-empty index). No
ADR governs this layer directly; the ADRs touch it only twice, and both touches are live
facts: the append-only conversation log (ADR 0010) explicitly cites the spine's append-only
pattern as the in-repo precedent it reused, and the one-emit-spine rule (ADR 0005) is what
keeps every writer observable to whatever consumer this layer becomes when revived. If the
dormant layer is revived, its first real design decision (what populates the symbol table, and
when) has no prior ADR to honor — it starts clean.

---

## SUPERSEDED / DEAD (do not carry into ARCHITECTURE.md)

- **ADR 0001** (docs consolidation: router + ADRs + ROADMAP) — a docs-process decision, not
  architecture; the docs reset that deletes `docs/adr/` supersedes its ADR half, and the
  router/one-fact-one-home discipline already lives in AGENTS.md.
- **ADR 0007** (first console design system, warm-dark "forge") — visual direction and layout
  architecture superseded by the workbench system (0014); the package it described was deleted
  (0025); its surviving governance rules are folded into the workbench entry above.
- **ADR 0018 / 0019** (browser-login mechanisms) — superseded steps in the lineage that ended
  at the courier shim + identity keying + shared root (0020/0021/0024, distilled above).
- **ADR 0027** (per-tool alias-or-own posture) — resolved by the bounded-surface decision
  (0029) to "neither" for the whole floor. One durable measurement worth keeping if tool
  ownership is ever revisited: an alias redirects a visible native name but never publishes
  one, so aliasing and owning are mutually exclusive per tool.
- **ADR 0028** (governance on two seams) — superseded by 0029's single PreToolUse seam; its
  premise (that the permission callback sees every non-delegation call) was measured false.

## Notes on drift the author should know

- ADR 0031 named two then-unfixed wiring bugs; both are closed in current code: the Claude
  adapter now accepts and forwards `observeChanges` (reconciler trigger) — asserted in
  `apps/cli/src/adapter-factory.test.ts` — and root spend attribution now exists
  (`LedgerRecord.root`, `packages/core/src/governance/ledger.ts`).
- `foldTreeToTranscript` (project a session tree as one transcript,
  `packages/core/src/session/transcript-projection.ts`) is built and tested; its only
  non-test consumers are the subagent-orchestration live test — treat "a tree reads as one
  transcript" as capability, not yet a shipped surface.
- The knife kept the cost-cap deny path but marked it questioned; if it is later removed, the
  two-blocks invariant (0009) and the fan-out ruling (0032) both need re-statement, since both
  count the cost cap as one of the two blocks.

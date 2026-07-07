# coa agent hardening — Design

> **Status:** approved goals/principles, pre-plan. This is the Phase-2 sub-project of the de-drift refactor arc
> (`2026-07-05-coa-dedrift-refactor-design.md` §5). It doubles as the **first genuine increment of coa's
> Pieces/packages/skills system** — not throwaway plumbing. Authority for product behavior stays with
> [SPEC.md](../../design/handoff/SPEC.md) (M8/M9) and the ADRs; this doc is the build-facing design.
>
> **Verify every seam against current code before acting** — this arc has hit multiple stale-report failures.

---

## 1. North-star

The first **durable** increment of coa's agent system: interrupt-safety, capability-scoping, session
independence, and the packaging machinery. These capabilities are load-bearing for *all* future agent work.
Gating Phase 3 (coa agents executing the graveyard extraction unsupervised) is a **consequence** of this work,
not the definition of done — "done" means these capabilities are real, tested, and permanent.

This phase also **absorbs the remaining open items of the chat-interface overhaul**
(`2026-07-02-chat-interface-overhaul-design.md`): its C9 interrupt and deferred steer are the same surface as
conversation control; its E17 permission-mode/plan toggle is the same surface as the capabilities axis. Folding
them here retires the overhaul's orphaned "Phase 2" rather than leaving it stranded.

## 2. Scope

### In

| # | Workstream | Primary seams (verified) |
|---|---|---|
| G1 | **Conversation control** — block-preserving interrupt (H1) + error resilience (H2) + steering (queue/inject mid-run) | `packages/loop-driver/src/driver.ts` (no interrupt/abort today), the Claude SDK path in `packages/adapter-claude-sdk/`, `packages/core/src/session/conversation-store.ts` (R-7) |
| G2 | **Capabilities (enforcement)** — tool-level allow/deny wired into the predicate; agent-default + chat override; plan mode as a read-only preset | `packages/core/src/session/permission.ts` (`buildCanUseTool` ignores the computed frame today), `assemble-agent.ts` (frame is computed but dangling), `sdk-options.ts:95` (`permissionMode` mapped at the adapter only) |
| G3 | **Roles → semantic-only** — decouple prose identity from enforcement | `packages/core/src/session/assemble-agent.ts` (`Role` carries both `pieces` *and* `packageIds` today), `@coa/shared` `Role`/`CapabilityFrame` |
| G4 | **Session independence from the console** — daemon owns liveness; console hydrates on connect | `apps/desktop/src/renderer/console.ts` (run-status is UI-local, lost on reload), `SessionSummary` (no live run-state field), `session-handlers.ts:82` (`status` Push) |
| G5 | **P1 — AGENTS.md-into-context package** — agents auto-load the router like CC auto-loads CLAUDE.md | the package registry / `assembleAgent` inclusion path, `CORE_PACKAGE_ID` |
| G6 | **Skills base + P2** — design the base skills delivery model; ship caveman as the first skill-as-package | the package/Piece model in `assemble-agent.ts`; a new skill-package shape |
| G7 | **Streaming output** — incremental token streaming (like Claude Code and other harnesses), all backends | `packages/loop-driver/src/complete.ts` (the `CompleteFn` primitive is whole-response today), `driver.ts` emit path, `@coa/shared` `TurnFrame` (`text` is a whole block), the Claude SDK `includePartialMessages`, the console incremental render |

### Out (scope discipline)

- **R-12-gated approval enrichment** (`respondApproval(scope)` + live diff-led cards). Blocked on the R-12
  WAL→Push bridge (a large independent keystone); not needed for the unsupervised-agent gate (headless agents
  don't sit on approval prompts). The inert stub stays; this is the overhaul's one remaining follow-up, gated on
  R-12.
- **Path-scoping enforcement** — ship tool-level only; keep the `perToolDeny(tool, input)` seam so path-scoping
  is a later increment, not a rewrite.
- **The full skills system** beyond the designed base + first package.
- **P3 CC behavior mirroring** — deferred, maintainer-driven; a placeholder for a future maintainer input, not a
  build item here.
- Already dropped/done: cost-cap bind (deprioritized), chat cross-talk (already fixed), green-turn gate (already
  works). Verified, not assumed.

## 3. Binding principles

- **Block-preserving invariant.** Only the incomplete block is ever discarded — never the whole user turn. H1
  (interrupt), H2 (error), and steering all share this one guarantee. Today an error/interrupt replays from the
  last user turn and strands in-turn edits on disk while dropping them from the conversation; that is the exact
  defect to kill. **Streaming refinement (G7):** a partially-streamed *text* block is kept (committed with an
  interrupt marker, as Claude Code does) — it is real output the model already produced; an incomplete *tool*
  block is still dropped (its call never completed). "Incomplete block" means an unfinished tool round-trip, not
  visible partial prose.
- **SC-1 preserved.** Capability/role/plan enforcement is a per-tool **DENY on the existing `canUseTool` seam**,
  *not* a third block class. The only two blocks in the system stay M3's close-gate + M7's cost-cap, both through
  M9's single deny channel (see `docs/adr/0009`).
- **P1 determinism.** Enforcement is a deterministic predicate; **no model call on any critical path**.
- **D85 strict-superset.** Feature-off ≤ raw loop: an unrestricted role behaves as raw; plan mode off behaves as
  raw; `coa raw` stays sacred (see `docs/adr/0008`).
- **Session independence.** The daemon is the authoritative owner of session lifecycle *and* liveness. The
  console is a stateless, reattachable viewer that hydrates full current state (including run-status) from the
  daemon on connect — it never reconstructs liveness from its own in-flight tracking. Agents run headless with no
  console attached (the Phase-3 precondition).
- **Real machinery, not plumbing.** This is the genuine first increment of the Pieces/packages/skills system;
  G5/G6 set the base every later skill/package builds on.

## 4. Workstream designs

### G1 — Conversation control (H1 + H2 + steering)

**Root cause (pinned via `systematic-debugging`, 2026-07-06).** Each session has *two* persistence stores with
different write semantics. `turns.ndjson` (the lossy UI view, R-7.a) is appended **incrementally per frame** as
the loop streams (`session-handlers.ts` `record`), so completed frames + an error frame survive an error — this
is why output stays visible. But `messages.json` (the *canonical*, lossless cross-turn memory) is written **only
via `onBackendMessages`, which fires only after the loop finishes cleanly**: `driver.ts:184` (pure-API, last
line) and `claude-sdk-adapter.ts:279` (SDK, after the `for await` stream). A mid-turn throw skips it, so canonical
memory stays at the *previous* turn's state while `tool.invoke` (`driver.ts:162`) has already mutated disk → the
next send replays from the last user turn with no record of the executed work, and disk diverges from
conversation. The error `.catch` correctly drops the resume token to force replay, but replay reads the stale
transcript.

**Shared *pattern*, two *sites*.** The defect is identical in shape but lives in two independent loops
(`runGovernedLoop` and the SDK adapter's `run`); the fix applies at both. **The invariant holds for free:** both
loops append a block to their accumulated buffer only *after* it is fully received (`driver.ts:119`,
`claude-sdk-adapter.ts:255`), so at a throw the buffer already excludes the incomplete block.

**Locked fix shape (industry-standard):** flush-on-exit — wrap each loop in `try/finally` and call
`onBackendMessages` with the accumulated buffer on **every** exit path (clean, error, interrupt), and settle
accumulated usage (`onSettle`) on the error/interrupt path too, so a partial turn is still cost-charged.

- **Interrupt (H1):** a cooperative abort signal checked at the safe boundary (between iterations — after a tool
  result is persisted, before the next `complete()`/model round-trip), then exit through the same flush path. No
  interrupt path exists today; the SDK exposes native interruption, the pure-API loop checks an `AbortSignal`.
- **Error (H2):** an errored turn is just an early exit through the same flush — no separate handling.
- **Steering:** a queued user injection applied at the same safe boundary, pushed into the running `messages`
  before the next round-trip; reuses the interrupt boundary machinery.
- **Surfacing** rides the existing `status` Push (running/idle/blocked/done/error already on the wire) and the
  composer's Stop/Esc (the overhaul shaped the composer for this; the backend is what's missing).

### G2 — Capabilities (enforcement)

The `CapabilityFrame = { allow, deny }` is **already computed** by `assembleAgent` and then **thrown away** —
`buildCanUseTool` only consults cost-cap + `perToolDeny`. Close the gap: compose the frame into the predicate as
a per-tool allow/deny check, ordered after the cost cap and alongside `perToolDeny`, **first-deny-wins,
fail-closed** (the existing predicate contract).

- **Tool-level only** this phase (allow/deny by tool name). Keep `perToolDeny(tool, input)`'s input arg unused-
  but-present as the path-scoping seam.
- **Agent-default + chat override**, parallel to the reasoning-level pattern: a capability set resolves from the
  agent/role default and a chat-issued override patches it coherently (mirror the field-by-field merge already
  used for model/effort selection, per the `console.ts` `resolveSelection` note).
- **Plan mode is a built-in read-only capability preset**, not separate machinery: it restricts the frame to
  read/search tools and denies mutation via the same `canUseTool` seam (SC-1-consistent). The Claude SDK already
  maps `permissionMode` (`sdk-options.ts:95`); the gaps are (a) no console toggle, (b) not driven from the
  session, (c) no pure-API equivalent — the capability-preset model gives pure-API backends plan mode for free.
- Both backends must be covered (the pure-API path already has a tool allow/deny gate per `docs/adr/0005`'s two
  gates; determine what file/tool-scoping is still missing there vs. the SDK path).

### G3 — Roles become semantic-only

Today a `Role` carries both `pieces` (prose identity) and `packageIds` (which resolve to tool refs → the frame),
coupling identity to enforcement. Decouple: a role is prose identity; capabilities are their own axis (G2) that a
role *may default* but does not *own*. This is a durable architectural decision → **new ADR (0011) role/
capability decoupling** (0010 is the append-only-log convergence), authored in the same commit as the change. Reconcile with `docs/adr/0003`
(core-context/roles), which currently blesses the coupled shape.

### G4 — Session independence from the console

Make the daemon authoritative for run-state and have the console hydrate it on connect. Options for the plan to
choose among: add a live run-state field to `SessionSummary`/`listSessions`; a `getSessionStatus` snapshot read;
or re-emit `status` on (re)subscribe. Then the console derives the run pill from the daemon snapshot on connect,
and `state.ui.runStatus` becomes a cache seeded by that snapshot rather than the source of truth. Proof: reload
the renderer mid-run and the session still reads *running*. This is a durable contract → capture it in an ADR
(the daemon-authoritative / stateless-viewer contract) or extend the M8 SPEC module, same-commit.

### G5 — P1: AGENTS.md-into-context package

A package that loads the repo router (AGENTS.md) into the agent's context the way Claude Code auto-loads
CLAUDE.md — delivered through the existing package/Piece inclusion path (a `default` package, so excluding it
degrades to raw per D85). Defines how a coa agent working *in a repo* picks up that repo's AGENTS.md.

### G6 — Skills base + P2 (caveman)

Design the **base** of the skills system to sit close to established agentic UXs and set coa up for its end goal,
then prove it with one real skill-as-package. The spec (and its plan) must outline the base mechanisms:
- **Delivery model** — global on-demand (a skill available to invoke when asked) vs auto-push (a skill injected
  into context proactively). Scope is not yet fully defined; the base must make both expressible.
- **Skill-as-package shape** — how a skill is packaged, discovered, and composed through `assembleAgent`
  (Pieces + tool-groups), building on the existing package model rather than a parallel mechanism (P8).
- **P2 caveman** is the first concrete skill-package, exercising the machinery end-to-end before the full system
  is built.

### G7 — Streaming output (all backends)

Incremental token streaming, the way Claude Code and other harnesses render — the agent's text appears as it is
produced, not as one block per model round-trip. The `CompleteFn` primitive (`complete.ts`) returns a whole
`CompletionResult` today, and the driver emits one `text` frame per completion (`driver.ts:118`). Scope
(maintainer decisions, 2026-07-06): **all backends** — the Claude SDK via `includePartialMessages`, and pure-API
SSE streaming for DeepSeek and LongCat.

- **SPI:** give `complete()` a streaming shape (an async-iterable of text/reasoning deltas terminating in the
  settled `CompletionResult`), so the driver can emit deltas while a round-trip is in flight. Keep it a strict
  superset — a non-streaming adapter degrades to a single final delta (D85).
- **Adapters:** DeepSeek/LongCat parse SSE (`stream: true`) into deltas; the Claude SDK surfaces its partial
  messages. Neutral shapes only — no provider streaming type crosses the seam.
- **Frame model:** the `TurnFrame` union gains a text-delta shape (append-to-current-block) alongside the whole
  `text` block, so the console appends deltas to the in-progress block; the final canonical `messages.json` still
  records the *whole* assistant text (streaming changes delivery, not the stored transcript).
- **Interrupt interaction (locked):** on interrupt mid-generation, the partially-streamed text is **kept and
  marked interrupted** (like Claude Code's `[Request interrupted]`) — see the block-preserving refinement in §3.
- **Console:** the transcript renders streaming deltas into the active text block; `coa raw` still degrades to the
  verbatim floor (D85).

G7 depends on G1's reshaped driver loop (both touch `driver.ts`) and is planned *after* it, rebasing on the
flush-on-exit/safe-boundary structure rather than colliding with it.

## 5. Verification

- **G1** — TDD against the loop-driver mock; assert the block-preserving invariant directly (interrupt/error
  mid-block → completed blocks survive in the conversation store, only the in-progress block is dropped, on-disk
  edits reconcile with the conversation). Drive the real flow end-to-end with the `verify` skill.
- **G2** — unit-test the composed `canUseTool` (frame allow/deny + cost-cap + `perToolDeny`, first-deny-wins,
  fail-closed); a docs-writer role cannot call code-editing tools; plan-mode preset denies mutation on both
  backends.
- **G3** — role resolution yields prose without capability coupling; capability default + override merge tested
  field-by-field.
- **G4** — reload-mid-run integration proof (session reads running after a renderer reload); pure mapping units
  for the hydration snapshot.
- **G5/G6** — package inclusion/exclusion units (present → loaded, excluded → degrades to raw); the caveman
  skill-package composes and invokes.
- **G7** — streaming units: the streaming `complete()` shape yields deltas terminating in the settled result; a
  non-streaming adapter degrades to one final delta; the driver emits text-delta frames; the canonical
  `messages.json` still stores the whole assistant text; an interrupt mid-stream keeps + marks the partial text.
- **Same-commit doc rule** — each unit updates ROADMAP status + the owning SPEC module + REPO_LAYOUT; new durable
  decisions get ADRs (0011 role/capability decoupling; the session-independence contract; plan-mode-as-capability
  -preset; the streaming `complete()` contract). Keep `pnpm docs:check` green.

## 6. Sequencing (plan decomposition)

Each workstream is its own reviewed plan + committed unit; the executable plans are produced by `writing-plans`
one at a time as each is reached (matching the arc's cadence).

- **Plan A1 — G1 block-preserving turn persistence** (flush-on-exit, both backends). The correctness keystone;
  mechanism de-risked above. **Written first** (`docs/superpowers/plans/2026-07-06-block-preserving-turn-persistence.md`).
- **Plan A2 — G1 interrupt + steering** — written
  (`docs/superpowers/plans/2026-07-06-interrupt-and-steering.md`). Locked decisions: an `AbortSignal` seam
  (industry-standard; the SDK's `abortController`), abort in-flight + persist at the safe boundary, and
  interrupt + steering together via streaming-input mode. Built on A1's flush-on-exit; no partial-text retention
  (that arrives with Plan E). **Not yet executed.**
- **Plan B — G2 + G3** capabilities + role decoupling (tightly coupled — the capability axis and the role
  decoupling land together).
- **Plan C — G4** session independence (independent, small-ish).
- **Plan D — G5 + G6** packaging + skills base (can start once G2/G3's package/role shape settles).
- **Plan E — G7** streaming output (planned after Plan A; rebases on the reshaped driver loop).

## 7. Open questions for the plan

- **G1:** *resolved* — shared pattern, two sites; flush-on-exit + settle-usage (see §4).
- **G2:** exact pure-API vs SDK coverage gap for tool-scoping (ADR 0005's two gates) — pin against code.
- **G4:** which hydration mechanism (summary field / snapshot read / re-emit) — a plan-time choice.
- **G6:** how far to formalize the global-on-demand vs auto-push model now vs. leave expressible-but-unbuilt.
- **G7:** the exact streaming `complete()` signature (async-iterable-of-deltas vs callback) — a Plan E choice;
  and whether the text-delta frame is a new `TurnFrame` kind or a flag on `text`.

---

_Last reviewed: 2026-07-06_

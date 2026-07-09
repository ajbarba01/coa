# coa roadmap

A shared reference for **where the project is and the directions open from here.** Replaces status
previously kept in private agent memory — this file is agent- and human-readable standalone. Update
in the **same commit** as the work that changes state (see `docs/WORKFLOW.md`'s same-commit rule).

For **what each module is** (public interface, owned decisions), see the handoff docs under
[`docs/design/handoff/`](docs/design/handoff/) — this file does not restate the spec, only status.

## Module status (M0–M10)

| Module | Status | What's real | What's missing |
| --- | --- | --- | --- |
| M0 Shared Schema | Done (living) | The cross-module Zod schema set; validated at every external boundary. | Evolves with new modules; no open gaps flagged. |
| M1 Change Kernel | Partial | The change-event spine is live (the single append path all producers/consumers point at). | GRF-* graph-relation hardening (see item J below). |
| M2 Code Lens | Partial | tree-sitter parsing, canonicalization, symbol table, metrics. | `refs` (reference resolution) runs at its honest floor only. |
| M3 Constraint/Flag | Partial | Constraint producers + the Type-1 close-gate are live. | No `perToolDeny` rules yet. |
| M4 Context Engine | Partial | Grounding, SSOT drift detection, and origin-anchor verification are live. | L-ASM (assembly/sizing) is spike-gated on the v0 calibration turn (keystone B below); G5 model-confirm needs M9's `runEval`. |
| M5 Config Compiler | Done (interface) | Public interface complete: `compile`, `versionGate`, `importBundle`. | — |
| M6 Workbench | Partial | Governed tools, base tools, and the M6↔M9 bridge (the rented loop is genuinely governed) are live. | AST-ops (rename/rewrite), fork, and the diff engine are not built. |
| M7 Governance & Audit | Partial | Cost-cap, ledger, and sandbox/process-isolation posture are live. | Subscription-plan cost is still a notional (not metered) figure. |
| M8 Daemon | Partial / runnable | `coa serve` + `coa run` over a real JSON-RPC pipe transport; the R-7 conversation store; provider-independent persistent session memory and frozen/cached prompts with drift detection (session hardening); `interruptSession`/`steerSession` RPC verbs over a per-session neutral `AbortSignal` + steer queue, wired to both backends (interrupt) and the pure-API path (steering); the daemon now owns a live session's lifecycle **across turns** — a daemon-singleton `LiveSessionRegistry` (keyed by conversation id, constructed once in `apps/cli`'s daemon composition and torn down via `closeAll()` on shutdown) holds one `LiveSession` per conversation, `createSession` is send-or-create (a second send on a live conversation queues as its next turn rather than starting a new one), and a `subscribeSession` verb reattaches a connection with an immediate run-status hydration, now called by the console on every conversation-open (G4 proven end to end: a reload mid-run reads `running` from the daemon snapshot; see `docs/adr/0011`); idle-timeout eviction is running-aware (re-arms rather than evicting a session still mid-turn) and its single teardown path (`registry.close`) runs the M1 checkpoint + worktree release exactly once, on eviction, the `closeSession` verb, or shutdown alike; the fan-out to subscribers is crash-safe (a throwing/dropped sink is dropped, never aborts delivery to the rest) and a closed connection's sinks are pruned. The Claude backend is now genuinely long-lived (P-β; `docs/adr/0012`): it holds one `query()` open across turns, selected by the abstract `sessionStrategy(provider)` verdict (never a backend branch), and a **live smoke** (`streaming-smoke.live.test.ts`, `COA_LIVE`-gated) verified held-open multi-turn + cross-turn memory + graceful termination against the real SDK. A pushed steer is **queued** as the next turn (the SDK has no mid-turn inject). **Barge-in (true mid-turn redirect) now ships** (`docs/adr/0012`): `steerSession` carries a `mode` (`queue | barge-in`) realized per strategy — Claude via the SDK's turn-level `query.interrupt()` (keeps the query alive) + a framed push, pure-API via a two-buffer drain (`drainSteer` at the round-trip boundary, `drainQueuedSteer` at the close-gate) — with a `pendingTurns` boundary count (the I3 fix) and SC-1 suppression of the interrupt's `error_during_execution` result, all live-verified in `barge-in-smoke.live.test.ts`. | Live deny/R-12 push bridge, worktree manager, subagent depth-1 fan-out; the console steer affordance (the barge-in daemon seam is ready); role/capability enforcement (see "Coa-agent hardening"). |
| M9 Runtime Adapter | Partial | Claude adapter, the tri-backend adapter factory (`adapter-claude-sdk` / `adapter-deepseek` / `adapter-longcat`), `registerTools`, the model/reasoning config seam, and per-provider reasoning surfaced as thinking blocks. | `runEval`/Tier-B path, `registerMcp` resolver. |
| M10 Console | Partial / rich | Electron shell, the `console-ui` kit, live chat wired to a real governed session, rich tool cards, live drift/cache-staleness banners, a Stop button + Esc that cooperatively interrupts the running turn (`interruptSession`). | Live approvals/deny (blocked on M8's R-12), Longform + graph (React Flow) views, the system-prompt viewer; console steer affordance (deferred, see "Coa-agent hardening"). |

**Cross-cutting workstreams**

- **Tri-backend adapters** — Partial. Three adapter packages ship (`packages/adapter-claude-sdk`,
  `packages/adapter-deepseek`, `packages/adapter-longcat`) behind the shared `spi`/`loop-driver`
  seam; DeepSeek and LongCat are thin pure-API adapters, not routed through the Claude SDK compat
  endpoint. Polish items are tracked as item F below.
- **Multi-account auth** — Done. Credential-blind subscription-account selection, per-account
  ledger attribution, `coa auth` verbs + RPC wiring.
- **Session hardening** — Partial. Done: provider-independent persistent memory (a session pins to one
  provider/model with a resume-vs-replay-vs-preamble plan across restarts and provider switches),
  frozen/byte-stable compiled prompts for cache warmth with drift detection, live drift and
  cache-staleness banners in the console, per-provider model reasoning surfaced as thinking blocks
  (DeepSeek/LongCat/pure-API), block-preserving persistence on a mid-turn error (both governed
  loops flush the completed transcript before the resume token is cleared; proven by a session-level
  reconciliation test), and block-preserving interrupt (H1) — `interruptSession`/`steerSession` RPC
  verbs over a per-session `AbortController` + steer queue, landing interrupt on both backends and
  steering on the pure-API path (SC-1: a user stop, never rendered as an error), **now wired end to
  end: the console's Stop button + Esc call `interruptSession` for the active session, and the
  running pill clears from the daemon's own `'interrupted'` status Push.** Also done: the **long-lived
  session core (P-α)** — the daemon is now the authoritative owner of a conversation's live state
  across turns (a `LiveSessionRegistry` of `LiveSession`s; `createSession` is send-or-create, queuing a
  second send on a live conversation as its next turn instead of starting a fresh one) and a
  `subscribeSession` verb reattaches a connection with an immediate run-status hydration. **G4
  (session independence) is now proven end to end:** the console calls `subscribeSession` on every
  conversation-open (mount-time restore, session switch, and new-session create alike), so a reload
  mid-run reads `running` from the daemon's own snapshot rather than reconstructing it from this
  renderer's send-tracking (see `docs/adr/0011`). **The Claude backend is now genuinely long-lived (P-β; `docs/adr/0012`):**
  it holds ONE `query()` open across a session's turns, fed the session's user turns (and each steer) as a
  derived `AsyncIterable<string>` — selected by an abstract `sessionStrategy(provider)` verdict in the
  composition root (held-open for the SDK, per-turn for the pure-API backends), never a backend branch in M8.
  Streamed-turn transcript capture, preamble-under-streaming, and per-turn-boundary flush all landed with it,
  and a **live smoke** (`streaming-smoke.live.test.ts`, gated behind `COA_LIVE`, skipped by default) verified
  against the real `@anthropic-ai/claude-agent-sdk` `query()`: held-open multi-turn, cross-turn memory on one
  server session, and graceful termination on iterable-close all hold. The gate also established the SDK's
  **steering ceiling** — a pushed steer is **queued** and runs as the next turn (the SDK has no mid-turn inject
  primitive; upstream feature #50246 pending), so SDK steering is a queued warm follow-up, not mid-turn
  redirect. **Barge-in now closes that path** (`docs/adr/0012`): a neutral queue-vs-barge-in `mode` on
  `steerSession` for both backends — Claude via the SDK's turn-level `query.interrupt()` (keeps the query alive)
  + a framed push, pure-API via `drainSteer`/`drainQueuedSteer` — with the I3 boundary-latch fix (`pendingTurns`
  counting) and SC-1 suppression of the interrupt's result, live-verified. Remaining on that path: only the
  **console steer affordance** (typing a redirect while a turn is running; the daemon seam is ready).
  Also remaining: streaming output,
  role/capability enforcement, the system-prompt viewer, and the apply-as-update injection spike —
  see "Coa-agent hardening" below and item G.
- **Core-context / roles / pieces** — Partial, merged to `main`. Structure-over-prose context
  assembly and role composition (skill-Pieces + tool-groups + MCP, additive) are implemented;
  `registerMcp` wiring and the DC-12 `.coa` merge remain open.

## Remaining work (keystones first)

These are candidate directions, not a committed backlog. Two items, if picked up, unblock the
most other work:

1. **R-12 — the WAL→Push bridge [L].** Unblocks live deny/cost/approval surfacing in the console
   (M10) and closes M8's biggest deferred item. Nothing in "live governance surfacing" (A) below
   works until this lands.
2. **The attended v0 L-ASM calibration turn [S].** A clean, attended Claude Code turn used to
   calibrate M4's context-assembly sizing knobs. This is the one pre-build gate `IMPL-SPEC-BRIEF.md`
   requires before M4 depth work (C) begins. *(Note: the separate pure-API "does a governed turn
   complete end to end" smoke test has already been proven live — this gate is specifically about
   the L-ASM calibration numbers, not basic connectivity.)*

Everything else, grouped by area (size tags: `[S]` small, `[M]` medium, `[L]` large):

- **A. Live governance surfacing** — R-12 WAL→Push bridge [L] (see keystone 1); cost Push [S];
  tool-name correlation on `tool_result` [S].
- **B. v0 calibration** — the L-ASM decision gate [S] (see keystone 2).
- **C. M4 depth (gated on B)** — L-ASM assembly/sizing [L]; per-relation `governed-by` + `coa link`
  [M]; the G0→G5 grounding gauntlet incl. G5 model-confirm [L]; AST health tiers [M].
- **D. M9 secondary path** — the `ai`/`@ai-sdk` version decision [S] (SPEC currently pins `ai@^6`/
  `@ai-sdk/anthropic@^3`, later than what shipped when the spec was written — reconcile at build
  time); `runEval` + Tier-B [M]; `registerMcp` resolver [M]; light up `deliverReminder`/
  `render_context`/`cache_control` [M].
- **E. M6 remainder** — AST-ops rename/rewrite + diff engine [L]; the `begin_fork`/`exit_fork` tool
  verbs (depend on M8's worktree manager, item I) [L]; `find_tools`/`load_tool` proxy [M]; POSIX-only
  confine + graph reads [S–M].
- **F. Adapters polish** — real DeepSeek prices (currently config-driven zero-floor placeholders)
  [S]; a provider-discriminated reasoning union (today's reasoning surfacing is per-provider, not
  unified) [M]; verify LongCat model IDs/effort levels against the live API [S].
- **G. System-prompt + injection surfacing** — the system-prompt viewer [M]; the
  apply-as-update injection spike [S]. (Interrupt/error-resilience/role-enforcement live under
  "Coa-agent hardening" below, not here.)
- **H. Console mock→live** — Longform + graph (React Flow) views [M]; console add-account flow
  [S]; **`apps/cli` has no `build` script** (only `typecheck` — verified in
  `apps/cli/package.json`) [S], needed so daemon auto-spawn works from a built CLI rather than a
  dev-mode run.
- **I. M8 deferred** — the daemon-singleton `LiveSessionRegistry` (threaded into `apps/cli`'s daemon
  composition, with running-aware idle-timeout eviction, `onClose`-hooked checkpoint/worktree-release, and
  `registry.closeAll()` wired into shutdown) is DONE; interactive multi-turn REPL / streaming-input mode [M];
  worktree manager [L]; subagents (D122 depth-1 fan-out) [L]; DACL/peer-cred hardening on the
  named-pipe transport [M].
- **J. M1 graph hardening (GRF-*)** — calls/inherits/weight edges, an SCC model, temporal
  projection [L]; underpins M3 staleness and M4 health scoring.

### Coa-agent hardening (gates running real work through coa agents)

This is the intermediate phase between "docs refactor done" and "coa agents execute work
unsupervised" (Phase 2 of the de-drift refactor arc, see "In flight" below). It doubles as the
first genuine increment of coa's Pieces/packages/skills system, not throwaway plumbing:

- **H1 Interrupt** — done: `interruptSession`/`steerSession` RPC verbs over a per-session
  `AbortController` + steer queue (M8), threaded to both backends via a neutral `signal`/`drainSteer`
  on the `SessionAdapterInit` seam. Interrupt lands on both backends (the existing block-preserving
  flush discards only the in-progress round-trip, never the completed transcript) **and is now wired
  to the console (M10): a Stop button and Esc, visible only while a turn is running, call
  `interruptSession` for the active session** — never rendered as an error affordance (SC-1). Steering
  (mid-turn redirection, queue-only — no inject-now mode) lands on the pure-API path via `drainSteer`;
  the **Claude backend now holds one `query()` open across turns (P-β; `docs/adr/0012`)** — a steer is pushed
  into its live input feed (selected by the abstract `sessionStrategy(provider)` verdict, never a backend
  branch) and **live-smoke-verified** to be **queued** as the next turn: the Agent SDK has no mid-turn inject,
  so SDK steering is a queued warm follow-up, not mid-turn redirect. Retired the prior deferral (the held-open
  streaming-input substrate now exists and is proven live). **Barge-in is now done too** (`docs/adr/0012`):
  `steerSession` carries a `mode` (`queue | barge-in`) realized per strategy — Claude via the SDK's turn-level
  `query.interrupt()` (keeps the query alive) + a framed push, pure-API via `drainSteer` (round-trip boundary)
  and a new `drainQueuedSteer` (close-gate) — with the I3 boundary-latch fix (`pendingTurns` counting) and SC-1
  suppression of the interrupt's `error_during_execution` result, live-verified in `barge-in-smoke.live.test.ts`.
  What remains: only the **console's own steer affordance** (typing a redirect mid-turn; the daemon seam is ready).
- **H2 Error resilience** — done. Both governed loops now flush the completed transcript on every
  exit path before the resume token is cleared, so completed blocks survive a mid-turn error instead
  of stranding in-turn edits on disk while dropping them from the conversation (proven by a
  session-level reconciliation test). Interrupt (H1) + steering remain.
- **Role/capability enforcement** — wire the already-computed capability frame into the governed
  loop so, e.g., a "docs-writer" role physically cannot touch code files (`permission.ts` +
  `driver.ts`/`session.ts`).
- **P1 — AGENTS.md-into-context package** — agents auto-load the router the way Claude Code
  auto-loads `CLAUDE.md`.
- **P2 — caveman-skill package** — the first skill delivered *as a package*, proving the packaging
  machinery before the full skills system is built out.
- **P3 — Claude-Code behavior mirroring** *(deferred, maintainer-driven)* — the maintainer supplies
  the specific CC leaked-prompt behaviors to mirror; scoped into its own later plan once supplied.

## In flight

- **The de-drift refactor** (this arc) — docs/comments/junk cleanup, the ADR system, and this
  ROADMAP itself. See
  `docs/superpowers/specs/2026-07-05-coa-dedrift-refactor-design.md` for the design and
  `docs/adr/` for durable decisions as they graduate out of it. Phase 3 (the graveyard extraction,
  executed by coa agents) is gated behind the "Coa-agent hardening" work above.

## Someday / ideas (not scheduled)

Captured from prior scratch notes; none of these are planned or sized yet:

- **Conversation naming** — auto-name conversations instead of leaving them titled by their first
  message.
- **Constraint → flag authoring** — a lighter-weight authoring path for turning an observed
  constraint into an M3 flag, instead of hand-writing producer config.
- **Semantic-connection "graphify"** — surface graph-like semantic connections between code/docs
  beyond the current structural (M1/M2) graph.
- **Prompt-engineering surface** — a dedicated surface for iterating on and testing prompts/roles.
- **Agent tools** — summarization and judgement-filtering tools for agents to call mid-session.

## Known issues / next-phase

Surfaced during this refactor; not fixed here — flagged for the later architecture/quality phase:

- **`apps/desktop/src/renderer/console.test.tsx`, "subscribes to the push stream and handles a
  live turn without throwing"** — this test only proves the push handler doesn't throw. It emits a
  turn push for `sessionId: 's'`, but the mounted/active session in the test fixture is `'c1'`
  (see `FAKE_SESSIONS` at the top of the file), so the push is recorded but never merged into
  visible state and the test cannot actually assert that the pushed row renders. The test's own
  comment acknowledges this. Fix by pushing under the active session id and asserting the row
  appears.

## Do not build for v1

See `docs/design/handoff/OPEN.md` §1 (deferred to v2/v3, e.g. multi-user/multi-writer, a
credential vault) and §4 (rejected outright). Nothing in `OPEN.md` is a v1 build target.

---

_Last reviewed: 2026-07-09_

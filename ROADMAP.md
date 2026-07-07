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
| M8 Daemon | Partial / runnable | `coa serve` + `coa run` over a real JSON-RPC pipe transport; the R-7 conversation store; provider-independent persistent session memory and frozen/cached prompts with drift detection (session hardening). | Live deny/R-12 push bridge, worktree manager, subagent depth-1 fan-out; block-preserving interrupt/error-resilience and role/capability enforcement (see "Coa-agent hardening"). |
| M9 Runtime Adapter | Partial | Claude adapter, the tri-backend adapter factory (`adapter-claude-sdk` / `adapter-deepseek` / `adapter-longcat`), `registerTools`, the model/reasoning config seam, and per-provider reasoning surfaced as thinking blocks. | `runEval`/Tier-B path, `registerMcp` resolver. |
| M10 Console | Partial / rich | Electron shell, the `console-ui` kit, live chat wired to a real governed session, rich tool cards, live drift/cache-staleness banners. | Live approvals/deny (blocked on M8's R-12), Longform + graph (React Flow) views, the system-prompt viewer. |

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
  (DeepSeek/LongCat/pure-API), and block-preserving persistence on a mid-turn error (both governed
  loops flush the completed transcript before the resume token is cleared; proven by a session-level
  reconciliation test). Remaining: block-preserving interrupt (H1) and steering, streaming output,
  role/capability enforcement, the system-prompt viewer, and the apply-as-update injection spike — see
  "Coa-agent hardening" below and item G.
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
- **I. M8 deferred** — interactive multi-turn REPL [M]; worktree manager [L]; subagents (D122
  depth-1 fan-out) [L]; DACL/peer-cred hardening on the named-pipe transport [M].
- **J. M1 graph hardening (GRF-*)** — calls/inherits/weight edges, an SCC model, temporal
  projection [L]; underpins M3 staleness and M4 health scoring.

### Coa-agent hardening (gates running real work through coa agents)

This is the intermediate phase between "docs refactor done" and "coa agents execute work
unsupervised" (Phase 2 of the de-drift refactor arc, see "In flight" below). It doubles as the
first genuine increment of coa's Pieces/packages/skills system, not throwaway plumbing:

- **H1 Interrupt** — block-preserving stop: discard only the in-progress block on interrupt, never
  the whole user turn. Steering (mid-turn redirection) remains too.
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

_Last reviewed: 2026-07-06_

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
| M8 Daemon | Partial / runnable | `coa serve` + `coa run` over a real JSON-RPC pipe transport; the R-7 conversation store; provider-independent persistent session memory and frozen/cached prompts with drift detection (session hardening); `interruptSession`/`steerSession` RPC verbs over a per-session neutral `AbortSignal` + steer queue, wired to both backends (interrupt) and the pure-API path (steering); the daemon now owns a live session's lifecycle **across turns** — a daemon-singleton `LiveSessionRegistry` (keyed by conversation id, constructed once in `apps/cli`'s daemon composition and torn down via `closeAll()` on shutdown) holds one `LiveSession` per conversation, `createSession` is send-or-create (a second send on a live conversation queues as its next turn rather than starting a new one), and a `subscribeSession` verb reattaches a connection with an immediate run-status hydration, now called by the console on every conversation-open (G4 proven end to end: a reload mid-run reads `running` from the daemon snapshot; see `docs/adr/0011`); idle-timeout eviction is running-aware (re-arms rather than evicting a session still mid-turn) and its single teardown path (`registry.close`) runs the M1 checkpoint + worktree release exactly once, on eviction, the `closeSession` verb, or shutdown alike; the fan-out to subscribers is crash-safe (a throwing/dropped sink is dropped, never aborts delivery to the rest) and a closed connection's sinks are pruned. The Claude backend is now genuinely long-lived (P-β; `docs/adr/0012`): it holds one `query()` open across turns, selected by the abstract `sessionStrategy(provider)` verdict (never a backend branch), and a **live smoke** (`streaming-smoke.live.test.ts`, `COA_LIVE`-gated) verified held-open multi-turn + cross-turn memory + graceful termination against the real SDK. A pushed steer is **queued** as the next turn (the SDK has no mid-turn inject). **Barge-in (true mid-turn redirect) now ships** (`docs/adr/0012`): `steerSession` carries a `mode` (`queue | barge-in`) realized per strategy — Claude via the SDK's turn-level `query.interrupt()` (keeps the query alive) + a framed push, pure-API via a two-buffer drain (`drainSteer` at the round-trip boundary, `drainQueuedSteer` at the close-gate) — with a `pendingTurns` boundary count (the I3 fix) and SC-1 suppression of the interrupt's `error_during_execution` result, all live-verified in `barge-in-smoke.live.test.ts`. **Conversation persistence is now ONE append-only event log** (`docs/adr/0010`, executed): `events.ndjson` is the sole writer, and the UI `TurnFrame` view + the provider transcript are read-time projections (the transcript folds the log, repairing an unmatched tool call by synthesis); `messages.json`/the second-writer path are retired, so integrity is structural (not a flush discipline) and the P-β M2 divergence is closed — full-fidelity capture live-verified in `sot-smoke.live.test.ts`. | Live deny/R-12 push bridge, worktree manager, subagent depth-1 fan-out; role/capability enforcement (deferred — see "Someday / ideas"). |
| M9 Runtime Adapter | Partial | Claude adapter, the tri-backend adapter factory (`adapter-claude-sdk` / `adapter-deepseek` / `adapter-longcat`), `registerTools`, the model/reasoning config seam, and per-provider reasoning surfaced as thinking blocks. | `runEval`/Tier-B path, `registerMcp` resolver. |
| M10 Console | Partial / rich | Electron shell on `@coa/console-kit` (+ `@coa/console-transcript` for the conversation), live chat wired to a real governed session, rich tool cards, live drift/cache-staleness banners, a Stop button + Esc that cooperatively interrupts the running turn (`interruptSession`); an auto-expanding, smooth-collapsing (and now correctly-timed: collapses when output begins) reasoning block in the muted trace color, a cascaded blur+rise entrance for non-streamed blocks (tool cards/results/plans), and a block-split streaming reveal (`StreamingMarkdown`) in which agent output arrives a whole formatted markdown block at a time (each with the entrance; the in-progress block is held until it completes) while the reasoning trace types out per-word (stable-key, append-only) — all behind a single `reveal` config seam; and a live mid-turn steer affordance (the Composer's Queue/Steer buttons + Enter-to-barge-in, wired to `steerSession`). | The **workbench rebuild** (see "In flight" — the 2026-07 UX overhaul's new design system at `docs/adr/0014`; W0–W5 have landed); live approvals/deny (blocked on M8's R-12), Longform + graph (React Flow) views, the system-prompt viewer. | 

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
  counting) and SC-1 suppression of the interrupt's result, live-verified. **The console steer affordance now ships too** — the Composer's Queue/Steer buttons
  + Enter-to-barge-in are wired to `steerSession`, closing that path.
  **Streaming output (G7) now ships for all backends** (`docs/adr/0013`): the pure-API `complete()` primitive is
  an `AsyncGenerator<CompletionDelta, CompletionResult>` streaming text/reasoning deltas over SSE
  (DeepSeek/LongCat) and the Claude SDK enables `includePartialMessages` — both mapped to two delivery-only
  `TurnFrame` kinds (`text-delta`/`thinking-delta`) that are pushed over R-12 but **never** appended to the
  append-only log (only the settled frame persists, so the fold and cross-turn memory are unchanged); the
  console accumulates deltas into a live block and the settled frame replaces it, and an interrupt mid-stream
  keeps + marks the partial (`[interrupted]`) as one settled frame (A1). A `COA_LIVE` smoke
  (`streaming-output-smoke.live.test.ts`) verifies real partial-message streaming against the SDK.
  Also remaining: the system-prompt viewer and the apply-as-update injection spike
  (item G). Role/capability enforcement is now deferred — see "Someday / ideas".
- **Agent SDK control survey** — Done (offline), live pass outstanding. A probe-backed answer to how
  much of the Claude Agent SDK's loop coa can control, taken before the backend-independent agent arc
  starts: nine stages rated, **no stage `Opaque`**, and **six of nine standing assumptions falsified**
  — including the arc's "the tool name `Agent` is unavailable to coa" and the premise that the
  harness's own subagents are ungovernable. The fork question is closed (**do not fork**: 26.8 upstream
  releases a month, signed and checksummed binaries, no redistribution grant). 197 offline probes live
  in `packages/adapter-claude-sdk/src/control/` and are version-stamped, so an SDK bump names the
  verdict that expired. Ledger + the P1 delta:
  [`docs/design/research/2026-08-02-claude-sdk-control-ledger.md`](docs/design/research/2026-08-02-claude-sdk-control-ledger.md);
  binary findings alongside it. **Live pass complete bar two probes:** the CLI **honours `toolAliases`
  at dispatch** (a model-emitted `Read` ran coa's MCP handler), killing the arc's naming limit — but an
  alias only **redirects** a name the harness already advertises and never **publishes** one, so coa
  chooses per tool between owning the implementation under Anthropic's schema and owning everything
  under `mcp__coa__*`. All 16 delegation probes pass; risk R2 is confirmed inside one run
  (`system:init` says `Task`, the model emits `Agent`); `maxBudgetUsd` is enforced but **raised as an
  exception, not a result frame**; `maxTurns` outranks the close-gate; `ANTHROPIC_BASE_URL` genuinely
  redirects real inference (P5's premise); child text reaches coa by default; coa can choose
  compaction's **moment** via `/compact` though never veto it; and assumption 9 resolved — a
  `role:system` message is transmitted but not obeyed, while a `shouldQuery:false` user message does
  land in context at the cost of a turn. **The most serious finding: `allowedTools` means auto-approve,
  so it suppresses `canUseTool` entirely — coa's per-tool governance does not run for exactly the tools
  coa granted.** Fixing that mapping proved **necessary but not sufficient**: the P1a gate run
  (2026-08-03) found the callback is still not consulted for a plain in-cwd read, this time because of
  the `claude_code` system-prompt preset — measured effect, hypothesised mechanism, now item K below.
  Two probes stay unsettled by choice (forcing a real auto-compaction costs several
  dollars; the synthesised-transcript probe hangs and needs restructuring). Also surfaced: a stale
  builtin set, an inert re-anchor path, an ungoverned child permission mode, an undeclared
  subagent-prompt lever, `terminal_reason` never being read, `CLAUDE_CONFIG_DIR` overloaded as both
  credential and store location, and a shared live-test helper whose allow-result the real CLI rejects.
- **P1a foundation fixes** — Code-complete, gating live smoke outstanding. Eight defects the
  control spike above found in shipped `adapter-claude-sdk` code are fixed and offline-verified:
  per-tool governance now actually runs (`allowedTools` no longer auto-approves coa's own tools,
  and the allow result echoes the input the real CLI requires); the native spawn is gated at
  `PreToolUse`, the only seam that sees it
  ([ADR-0028](docs/adr/0028-per-tool-governance-rides-two-seams.md)); the built-in tool list
  carries both delegation spellings and has a drift test; a governed stop renders as a `deny`
  frame instead of a crash; the inert `.claude/CLAUDE.md` re-anchor is gone; and `skills: []`
  closes the one isolation leak that was closable. **The gating live smoke now exists and has run**
  (`packages/adapter-claude-sdk/src/governed-gate.live.test.ts`, `COA_LIVE`-gated, committed red):
  its second half **passed** — the allow-result repair holds against the real CLI, which is the half
  offline probes could not prove — while its first half **failed twice**, for a cause the P1a design
  did not predict and did not introduce. Both P1a fixes were re-verified intact in the same runs;
  what suppresses the callback is the **`claude_code` system-prompt preset**, which
  `buildBaseOptions` always sets (measured 0/2 consulted with the preset, 6/6 without; mechanism
  hypothesised, not measured —
  [ledger](docs/design/research/2026-08-02-claude-sdk-control-ledger.md#the-p1a-gate-run--2026-08-03)).
  So P1a is **code-complete with one named live gap**: per-tool governance still does not see an
  ordinary in-project read. The file's second probe — that a `PreToolUse` deny of a native
  `Task`/`Agent` call actually stops child work — is written but **unrun**, so ADR-0028's delegation
  deny is still verified against types alone. Both are item K below, not a continuation of this
  plan. Next: **P1b — the orchestration slice.**
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
- **H. Console mock→live** — Longform + graph (React Flow) views [M] (build them *as workbench
  surfaces* once the rebuild arc's W1 shell lands); console add-account flow [S] (fold into the
  rebuild's W4 account home); **`apps/cli` has no `build` script** (only `typecheck` — verified in
  `apps/cli/package.json`) [S], needed so daemon auto-spawn works from a built CLI rather than a
  dev-mode run.
- **I. M8 deferred** — the daemon-singleton `LiveSessionRegistry` (threaded into `apps/cli`'s daemon
  composition, with running-aware idle-timeout eviction, `onClose`-hooked checkpoint/worktree-release, and
  `registry.closeAll()` wired into shutdown) is DONE; interactive multi-turn REPL / streaming-input mode [M];
  worktree manager [L]; subagents (D122 depth-1 fan-out) [L]; DACL/peer-cred hardening on the
  named-pipe transport [M].
- **J. M1 graph hardening (GRF-*)** — calls/inherits/weight edges, an SCC model, temporal
  projection [L]; underpins M3 staleness and M4 health scoring.
- **K. The preset-vs-`canUseTool` spike [S–M, live spend].** The named live gap P1a leaves behind
  (above). Two questions, both needing real calls and a deliberate budget: (1) **why** the
  `claude_code` preset suppresses `canUseTool` for an in-cwd read — probe the preset arm against a
  call the CLI's own defaults would *not* allow (a write, a read outside the cwd) to test the
  default-allow-rules hypothesis; and (2) run the **written-but-unrun delegation probe**, so
  ADR-0028's `PreToolUse` deny stops being types-only. Fold in one cheap third arm while paying for
  the run: **does a coa-owned `mcp__coa__*` tool reach `canUseTool` under the preset?** Only a
  built-in `Read` was tested, and P1b's whole thesis is a *governed* `spawn_agent` — if coa's own
  tools are suppressed too, the governed spawn is ungoverned by construction. The design decision behind (1) is real —
  route everything through `PreToolUse`, or drop the preset and lose Claude Code's baseline — so it
  is its own spike, not a fix to slot in. This gates the *value* of per-tool governance on the
  Claude path; it does not block P1b from building.

### Agent-hardening increment (phase dissolved; what shipped)

The interrupt / steer / barge-in / error-resilience hardening below **shipped** (also captured in the
Session hardening workstream above). The phase's original framing — "gate running real work through
coa agents before they execute the docs refactor" — no longer applies: the de-drift Phase 3 docs work
is now **Claude-run** (see "In flight"), so it needs no agent capability-enforcement. The unshipped
items (role/capability enforcement, the P1/P2 packages, P3 CC-mirroring) are therefore **deferred to
"Someday / ideas"** and are not part of closing the de-drift arc.

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
  This path is now complete: the console's own steer affordance ships — the Composer's Queue/Steer
  buttons + Enter-to-barge-in are wired to `steerSession`.
- **H2 Error resilience** — done. Both governed loops now flush the completed transcript on every
  exit path before the resume token is cleared, so completed blocks survive a mid-turn error instead
  of stranding in-turn edits on disk while dropping them from the conversation (proven by a
  session-level reconciliation test).

The remaining hardening items — role/capability enforcement, the P1 AGENTS.md-into-context package,
the P2 caveman-skill package, and P3 CC-behavior mirroring — are **deferred**; see "Someday / ideas".

## Completed arcs

### The console workbench rebuild (Gate 4 plan of the 2026-07 UX overhaul) — ✅ closed 2026-08-02

All six phases (W0–W5) shipped. **Authority:** [`docs/adr/0014`](docs/adr/0014-workbench-design-system.md)
(the why) + [`docs/UI.md`](docs/UI.md) (the laws). The reference implementation is now the console's own
[showcase surface](apps/desktop/src/renderer/panels/ShowcasePanel.tsx) — `apps/workbench-proto` was deleted
once that surface lived in the real console. Every phase left the console **runnable and strictly no worse**
than before it (D85 discipline applied to the migration itself), and each opened with its own execution-time
implementation plan, designed through the impeccable skill per `docs/UI.md`.

The arc ends with **one kit**: `@coa/console-kit` is the vocabulary, `@coa/console-transcript` is the
conversation renderer built on it, and the retired `@coa/console-ui` — with the forge palette it injected at
runtime — no longer exists ([ADR-0025](docs/adr/0025-retire-the-legacy-console-kit.md)).

Standing rulings the phases encoded (maintainer-resolved 2026-07-10): the streaming transcript renderer is
**re-skinned, never rebuilt**; the agents editor keeps a first-class home; drift/cache banners keep their
function in quiet indicator-law form; the forge/brass identity returns later as a re-tailored theme;
everything else the new design overwrites.

- **W0 — Kit graduation [M]. ✅ Done.** The hardened prototype primitives live in `packages/console-kit`
  as real components (intent blocks + generated catalogue, all applicable states, jsdom tests): the theme
  seam (`themes/sand-dark.css` — a theme is one full scale file), type/z/shadow token scales, StatusDot,
  Button, the menu vocabulary (MenuCard · MenuItem `current` marker · CapsLabel · PopoverCard), select,
  boxy toggle, step slider, kbd chip + shortcuts overlay, modal shell, dismiss-layer/click-away + zoom
  seams, panel-resize + collapse hysteresis, and the settings-dialog frame. Interactive mechanics ride
  Base UI per ADR-0014 (Popover/Select/Switch/Slider/Dialog — the focus trap and positioning came free);
  the kit's dismiss-layer stack is the single Escape authority. The showcase renders from kit imports;
  the proto keeps only composition + mock data.
- **W1 — The shell [L]. ✅ Done.** `apps/desktop`'s frame is the three-column workbench on `@coa/console-kit`:
  segmented title bar (project ▣ dialog · session tabs with the ⌕ search morph into the session browser ·
  AGENTS header + DOM window controls, kit-graduated), app-scoped left nav (surface rows with the flags-only
  red count → HUD reading the real cap/account/flag Remotes → account/settings/daemon foot), full-window
  daemon gate (auto-retries while the daemon is down), collapsible right session column with drag-through-collapse
  seams, ⌘K palette (owns the raw toggle — the chat raw button is gone, D85 held by reachability + the amber
  strip indicator), the kit settings dialog (theme pinned sand-dark until the light scale; density/motion
  persisted through the existing settings path; keybinds registry section), 1.2 base zoom (Chromium level 1;
  Ctrl+/- offsets preserved), and an unclaimed-Escape stop for the running turn. Retired: the `console-layout`
  descriptor engine (package deleted), `AppShell`/`DaemonStatus`/`WindowControls` inspector chrome (from
  `console-ui`), Pane-card composition, `coa:window`-era layout persistence (now `layout.json` epoch 5:
  surface/tabs/columns). Acceptance held: sessions (create/subscribe/switch), the push stream, the streaming
  transcript, interrupt (Stop + Esc anywhere) and steer (Queue/Barge-in), the account selector, settings
  persistence, and the drift/cache banner functions all work inside the new shell — plus a cold-boot rehydrate
  so a daemon that comes up late repopulates the boot reads. Center-surface content still rendered on the legacy
  kit at that point by design (W2 re-skinned conversation; W3 redrew surfaces; W4 deleted the kit).
- **W2 — Conversation re-skin [L]. ✅ Done.** Re-token the streaming transcript (StreamingMarkdown, reasoning block,
  plan checklist, tool cards + openPath links, subagent roll-ups, approval cards, DenyNotice) onto the
  sand scale with a Slipstream motion audit (durations/easing/fill-mode; reduced-motion). New composer:
  attach chip, model picker + reasoning **step slider** off the real capabilities seam (degrading to the
  on/off toggle for thinking-only models), steer Queue/Barge-in + Stop, permission chip (surfacing only —
  the daemon owns the decision). Session tabs + the ⌕ session-browser morph run over the real session list
  (sort/group; dividers floor). Acceptance: a live governed turn streams end-to-end in the new skin with
  steer/interrupt intact.
- **W3 — Surfaces in the new language [M]. ✅ Done.** Flags / timeline / cost redrawn as center surfaces on
  the sand language, states-first (loading/error/empty/ok) via a shared `surfaceStates` module (skeleton /
  role=alert error / quiet empty), dropping the old `console-ui` `Pane` chrome (the surface name lives in the
  title strip). The right column now shows the session's real state — the root agent row and the agent's
  plan checklist (Claude-only seam: `plan` frames come from the SDK `TodoWrite` tool; a session without one
  shows a "no plan yet" line) — with subagents / changes / worktree / record / session-cost as honestly
  labeled "not tracked yet" floors (their data is deferred, items E/I). The flags nav item keeps the app's
  only red count. The nav HUD content (usage/account/flags mini-states) was deferred out of this arc — see
  "Someday / ideas".
- **W4 — Orphan homes [M]. ✅ Done.** The redesigned **agents editor** (role/package picker, thinking
  toggles, scope, pin) landed as its designed home in the new IA; drift/cache **notices** ship in
  indicator-law form (one quiet line docked to the composer: dot + name + inline action); the project-switch
  dialog at its floor; `apps/workbench-proto` retired once the showcase surface moved into the real console;
  and the "Known issues" perf items were each re-verified against current code, then closed or re-filed with
  their measurement. **Account management was not part of W4** — credentials outgrew the ◐ foot button and
  became the `auth` surface (below), which also retired the old `AccountPanel`.
  A first drive-the-app pass then closed the arc's four unseen-risk areas (the `AddPicker` popover is
  unclipped, the narrow drill-down and its Escape work, `SetBox`'s four membership marks read as four
  states, and all 25 kit specimens render outside jsdom) and turned up three defects, since fixed: the
  create control sat on the title bar's top edge, the agent editor's two columns were keyed to the
  *surface* width so the right column clipped instead of collapsing (now a container query on the editor's
  own box), and the showcase was still wrapped in the legacy `Pane` — a second title bar over a retired
  brown ground.
  **The legacy kit is now gone entirely** ([ADR-0025](docs/adr/0025-retire-the-legacy-console-kit.md)):
  `@coa/console-ui` is deleted, its 39 unreachable files with it; the conversation renderer moved to a new
  `@coa/console-transcript`; `InlineMessage`, `Toast` (ported off Radix), `PaneOverlay`, the `agent-*`
  identity colours and `--color-focus` moved into `@coa/console-kit`; and the runtime-injected forge palette
  — a hex table no theme control could reach — stops existing, verified as zero occurrences in the shipped
  bundle. `radix-ui` left the dependency tree. The density control was removed rather than shipped as a
  visible no-op, since the kit scale never answered to it.
- **W5 — Auth + Usage surfaces [M]. ✅ Auth backend wired + usage mock.** Two new center surfaces
  (`AUTH-*`/`USAGE-*` in the [M10 spec](docs/design/handoff/spec/M10.md)): **auth** (credentials only —
  master–detail over a provider **descriptor registry**, an add-flow that branches on **locator kind** so a
  new provider is a registry row and zero new UI, replace-never-edit for secrets (labels and pointer
  locators edit normally — they are readable facts), and a three-level bench) **backend wired to real RPC**
  (authView read + the write verbs `addProvider`/`removeProvider`/`addCredential`/`replaceSecret`/
  `renameCredential`/`removeCredential`/`setProviderEnabled`/`setCredentialDisabled`/`makeActive`/
  `clearCooldown`/`refresh`); **usage** (providers/tools view toggle; workspace spend chart + per-account
  dashboard + rail HUD; key-health for tool services; **no caps**) remains Phase 2 (mock). **Model reads
  shipped (2026-07-18): the editable per-provider model list is the source of truth** — `models.yaml` +
  the coa-owned default catalog + a pure effective-list assembler behind the `modelCatalog`/`addModels`/
  `addCustomModel`/`editModel`/`removeModel`/`setModelHidden` verbs, with `listModels` serving the
  assembled projection to both pickers and a full in-surface editor (add-from-defaults dialog,
  create-custom, hide/remove, reasoning profiles) —
  [ADR-0016](docs/adr/0016-coa-owned-model-catalog.md). Retires the `cost` surface and the ◐ account popover. New kit members: `BrandMark` +
  `Meter`; new theme tokens: the validated chart-`series` palette ([ADR-0015](docs/adr/0015-brand-marks-and-series-palette.md)).
  **This closes the deferred "Nav HUD mini-states" question for `usage`** — the HUD is a customizable projection
  of the usage reads. The auth surface renders from live stores; usage surface renders from a renderer-side mock
  until the Phase 2 RPC verbs land. **In-app login shipped (2026-07-19): coa drives `claude auth login`
  itself** — email-defined accounts (the declared email pre-fills the login; the probe's landed email is the
  truth, mismatch flagged with keep/retry), login health from `claude auth status --json` + live-session
  auth failures (never token files), attention badges on the nav tab / provider row / account HUD with a
  one-click driven re-login, and a PTY-captured OAuth copy-link that degrades to browser-only —
  [ADR-0017](docs/adr/0017-probe-derived-login-health.md). **Isolated browser logins shipped:** a global, off-by-default toggle signs each account in
  through a browser launched on its own profile dir (`~/.coa/browser-profiles/<account-id>`), so
  an email-defined account is enforced rather than declared; accounts gained a stable opaque id,
  and removing one prompts about its profile. `BROWSER` points the `claude auth login` spawn at a
  courier shim that writes down the authorize url the CLI hands it and exits; coa itself launches
  the profiled browser on that url, as argv with no shell. The relayed url is the one the CLI
  would have opened — a *localhost* callback that completes itself — so an isolated sign-in needs
  no pasted code, while the copy-link keeps showing the portable url the CLI prints. win32
  Chrome/Edge detection with an override; anything missing degrades to the copy-link + paste-code
  path — [ADR-0020](docs/adr/0020-courier-shim-relays-the-self-completing-url.md), superseding
  [0019](docs/adr/0019-coa-opens-the-profiled-browser.md) and
  [0018](docs/adr/0018-isolated-browser-login-sessions.md). Profiles are keyed by **identity**
  (an email slug plus a digest), not by account row, so a relogin reuses the session it already
  established and two providers signed in as the same person share one jar —
  [ADR-0021](docs/adr/0021-browser-profiles-keyed-by-identity.md). Every jar now shares **one**
  Chrome user-data-dir (`~/.coa/browser-session/profiles`), isolated by `--profile-directory` —
  ~90% of a profile is not the login, and the model store, Safe Browsing database and component
  cache live at the root, so they are paid once instead of once per identity. Launches carry disk
  flags (measured 67 MB → 10 MB), Safe Browsing deliberately kept. Jars no account resolves to are
  listed in settings and deleted on request, never swept —
  [ADR-0024](docs/adr/0024-browser-profiles-share-one-user-data-dir.md), superseding 0021's layout.

Out of scope for this arc (unchanged owners): live approvals/deny (blocked on R-12, item A), Longform +
graph views (item H — they arrive later *as workbench surfaces*), the system-prompt viewer (item G).

The **de-drift refactor arc is closed** (2026-07-10). Project truth now lives on the
[`AGENTS.md`](AGENTS.md) router + [`docs/adr/`](docs/adr/) (the durable *why*) + this ROADMAP (status),
with a thin README per package. Every durable decision was graduated out of the transient
`docs/superpowers/` corpus — into an ADR, the per-module SPEC split, or this file — which was then
deleted (git history is its archive). The rationale is
[`docs/adr/0001`](docs/adr/0001-consolidate-docs-into-router-adr-roadmap.md); the deferred
agent-hardening items are under "Someday / ideas" below.

## Someday / ideas (not scheduled)

Captured from prior scratch notes; none of these are planned or sized yet:

- **Role/capability enforcement** *(deferred agent-hardening; was the load-bearing item)* — wire the
  already-computed capability frame into the governed loop so a role (e.g. "docs-writer") physically
  cannot touch code files (`permission.ts` + `driver.ts`/`session.ts`). Unscheduled now that the
  de-drift docs refactor is Claude-run rather than agent-run.
- **P1 — AGENTS.md-into-context package** *(deferred agent-hardening)* — agents auto-load the router
  the way Claude Code auto-loads `CLAUDE.md`; the first real coa Piece/package.
- **P2 — caveman-skill package** *(deferred agent-hardening)* — the first skill delivered as a
  package, proving the packaging machinery ahead of the full skills system.
- **P3 — Claude-Code behavior mirroring** *(deferred, maintainer-driven)* — the maintainer supplies
  the specific CC leaked-prompt behaviors to mirror; scoped into its own later plan once supplied.
- **Nav HUD mini-states** *(partly answered by W5, 2026-07-13)* — the left-nav foot HUD. The **usage** HUD is
  designed and built (the meters you tick, auto-quieting below 50%, a projection of the usage reads); the
  **account** and **flags** mini-states are still floors, and what they should show remains an open design
  question rather than something to guess at.
- **A density scale for the kit** *(surfaced by ADR-0025)* — the old density control only ever scaled the
  retired kit's type ramp, so it was removed rather than shipped as a visible no-op. Making density mean
  something again is a real feature and its own design question: which of the kit's members respond, and how.
- **Conversation naming** — auto-name conversations instead of leaving them titled by their first
  message.
- **Constraint → flag authoring** — a lighter-weight authoring path for turning an observed
  constraint into an M3 flag, instead of hand-writing producer config.
- **Semantic-connection "graphify"** — surface graph-like semantic connections between code/docs
  beyond the current structural (M1/M2) graph.
- **Prompt-engineering surface** — a dedicated surface for iterating on and testing prompts/roles.
- **Agent tools** — summarization and judgement-filtering tools for agents to call mid-session.
- **Open design sub-questions** (surfaced during graduation; unsettled, each sits within an accepted ADR):
  where the baseline Piece set physically lives — a built-in package vs. a seeded `.coa/` bundle (the
  general built-in∪user merge mechanism is settled in `docs/adr/0003`; only this placement call is open);
  MCP reference level — role-level vs. agent/project-level references (within `docs/adr/0003`'s third
  capability type); and tool-description minimalism — how far to lean on a prior-rich backend's training
  vs. shipping full descriptions that also serve prior-free backends (within `docs/adr/0005`).

## Known issues / next-phase

Surfaced during this refactor; not fixed here — flagged for the later architecture/quality phase:

- **Console startup/render performance — re-measured and closed 2026-08-01 (W4).** The earlier
  console-perf audit's items, each re-verified against current code rather than trusted as-is:
  - **`optimizeDeps.include`** — measured, not added. `vite optimize --force` against the real
    renderer config (react + tailwind plugins, the four `@coa/*` aliases) already auto-discovers
    and pre-bundles every bare import the app has (`react-syntax-highlighter` + its 12 language
    modules, `radix-ui`, `@base-ui/react/*`, `@floating-ui/react`, `cmdk`, `motion/react`,
    `lucide-react`, `zustand`, `react-markdown`/`remark-gfm`, `zod`) with no `include` declared —
    every import in this app is static, so Vite's crawl-scan finds it all on its own. Timing 5
    fresh (`--force`) runs against 5 runs of the identical set declared as `optimizeDeps.include`:
    baseline ~11.0–11.4s (tight), with `include` ~11.7–12.0s (one 7.4s outlier) — declaring it
    measured *slower*, never faster. Nothing to add.
  - **Tailwind `@source` scanning tests — fixed.** `globals.css` now carries `@source not` for
    `**/*.test.{ts,tsx}` under both `console-kit/src` and the conversation renderer's src (a third of those two
    trees by file count). Verified safe by diffing the built CSS with and without the exclusion:
    the only rules it drops are ones that existed purely because a test's own assertion string
    contained a bare utility name production only ever uses compounded with a variant (e.g.
    `cx.test.ts`'s `toContain('outline-focus')` synthesized a bare `.outline-focus` that no
    shipped markup renders — `cx.ts`/`Composer.tsx` only ever emit
    `focus-visible:outline-focus`/`focus-within:outline-focus`). Measured saving: 85.62 KB → 85.42
    KB — small, but free and correct, not claimed as a startup win.
  - **The ~2s poll replaces state with no equality guard — the cheap guard added; the
    architecture stays re-filed.** `console.ts`'s `refresh()` (driven by `App.tsx`'s
    `setInterval(..., 2000)`) built a fresh `ConsoleState` and published it every tick regardless
    of whether `capState`/`flagsForUser`/`listTimeline` actually changed. `consoleStore.ts`
    publishes via `useConsoleState.setState(s, true)` (a full replace), and eight surfaces
    subscribe with an unmemoized `(s) => s` selector — `AgentsPanel.tsx:1084`, `Center.tsx:130`,
    `Nav.tsx:273`, `NewSession.tsx:13`, `Palette.tsx:22`, `Settings.tsx:225`, `Work.tsx:19`,
    `Workbench.tsx:112` — so every tick re-rendered all eight regardless of content. Added a
    cheap structural-equality guard (`remoteEqual`, `JSON.stringify` — the three Remote values are
    plain Zod-inferred JSON, no functions/Dates) that skips the replace+publish when nothing
    changed; covered by a new test (`console.test.tsx`, "publishes nothing when a poll returns
    unchanged data"), verified load-bearing by breaking the guard and watching it fail. The real
    cure — a push-based store instead of a poll-and-replace one — is its own phase of work and is
    **not** built here; re-filed below.
  - **`React.memo`/`useCallback` coverage — documented, not widened.** Current exact set: `memo`
    wraps `Freeze` (`shell/deferredMount.tsx`), `CompletedBlock`
    (`console-transcript/src/dense/StreamingMarkdown.tsx`), and `MemoRow`
    (`console-transcript/src/dense/Transcript.tsx`); `useCallback` appears in `ChatPanel.tsx` and
    `console-kit/src/overlay/PaneOverlay.tsx`. No measured hot path beyond the transcript justifies
    widening this pre-emptively; re-filed under "Someday / ideas" if a future profile finds one.
  - **Layout persistence debounce — already fixed, closed by inspection.** `layoutPersistence.ts`
    already trailing-debounces `saveLayout` 300ms (`SAVE_DEBOUNCE_MS = 300`, `setTimeout`/
    `clearTimeout` around every persisted-field change) — the audit's premise (fires per drag
    pixel) no longer matches the code. No change made.
  - **Vite CSS `devSourcemap` tuning — closed, already at the perf-optimal default.**
    `css.devSourcemap` is unset in `electron.vite.config.ts`, which is Vite's `false` default (no
    dev sourcemap generation cost). There is nothing to tune; the flagged "issue" was already the
    fast setting.
  - **~7 sequential IPC round-trips on startup — closed, the number was stale.** `console.ts`
    already fires its five top-level boot reads (`loadAccounts`/`loadModels`/`loadCatalogue`/
    `initAgents`/`initSessions`) concurrently via `Promise.allSettled`, not as a waterfall. Of the
    underlying calls, `getSettings`/`getLayout`/`listAgents` are local synchronous-file reads
    proxied over IPC (`main/index.ts`'s `readJson`), not daemon round trips. The one real
    sequential daemon chain left is `listSessions → reloadConversation` inside `initSessions` (2
    deep) — an unavoidable data dependency, since the transcript read needs the session id the
    list read returns. Today's real critical-path depth is 2, not ~7; whatever produced the
    original count predates the `Promise.allSettled` parallelization. The transcript-grouping
    `useMemo` gap was already fixed before this pass. Note: the original audit predated the
    deliberate removal of transcript virtualization (full-text selection + Ctrl-F), so its
    windowing-related framings were already moot.
- **Poll-and-replace console state (re-filed, architectural — not built here).** The cheap
  equality guard above stops an *unchanged* poll from re-rendering the eight `(s) => s`
  subscribers, but a poll that DOES change anything (cap/flags/timeline) still replaces and
  republishes the entire `ConsoleState`, and the live turn-frame path (`appendTurns`/`flushTurns`)
  still rebuilds+republishes the whole state object on every rAF-coalesced flush. The durable fix
  is a push-based store (subscribers read slices, not the whole object) instead of the current
  poll-and-replace one; that is its own phase of work, out of scope for this pass.

## Do not build for v1

See `docs/design/handoff/OPEN.md` §1 (deferred to v2/v3, e.g. multi-user/multi-writer, a
credential vault) and §4 (rejected outright). Nothing in `OPEN.md` is a v1 build target.

---

_Last reviewed: 2026-08-03_

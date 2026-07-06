# IMPL-SPEC-BRIEF.md — how to build coa from the SPEC

**Date:** 2026-06-24 · **Status:** the executor brief — one of the three self-contained handoff docs
(`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`). It tells a downstream agent **what to build, in what order, and what
to measure first.** It assumes only these three docs; it does not reference the planning corpus.

> **What coa is (one paragraph, so the builder has the frame).** coa is a **local-first, single-user governance/audit
> layer over a rented Claude Agent SDK loop.** It does not replace the agent; it governs it — running deterministic
> checks, keeping the agent working against the project's real symbols/specs/tests, capping cost, and keeping an
> honest record. Its value is **WITH-MODEL** (it appreciates as the model improves: the better the agent's judgment,
> the more you want a record, guardrails, and sound context rather than raw capability). v1 is **attended**
> (a human is present) and **Claude-primary** — Claude is the default backend, with the rented loop swappable
> behind the one M9 port (DeepSeek and LongCat adapters ship today). See `SPEC.md` for the module
> definitions; this doc is the build plan over them.

---

## 1. The ONE pre-build gate — the v0 calibration spike (run this FIRST)

Almost every *magnitude* claim in the design is deferred to a single cheap spike; **soundness does not depend on it.**
Run it before committing to any Context-Engine (M4) milestone:

- **What it measures** (all observable from M7's minimal ledger): structure-first retrieval vs. raw-read-with-caching
  net of coa's own spend (the token thesis); cheap-graph vs. cheap-subagent staleness rate+cost (the detection
  shrink); grounding suggestion precision + uptake; the context-package's selection precision/recall + the position
  effect + the **[LOOP]** token/turn win; the confidence-tier calibration (severity×confidence); the capture-quality
  of intent/rationale; the **SCO-4** scope-delivery precision + uptake (fraction of scope-delivered docs the agent
  uses) and the **SCO-5** scope-linter drift-heuristic precision; the **GRF-7** graph-as-agent-nav edge (does
  graph-tool navigation beat the model's native retrieval on token/turn — the navigation analog of the [LOOP] bet);
  and the **HLT-8** health behavior-change + validity (does surfacing a hotspot/cycle/complexity finding actually
  change what gets refactored, measured on coa's own ledger — so health is grounded on this repo, not on a vendor's
  study); and the **console (CHAT-\*/CON-\*) behavior-change set** — does **structured turn-by-turn legibility** (CHAT-5)
  + **nested-subagent rendering** with cost roll-up (CHAT-2) change how much the user verifies vs. rubber-stamps; does
  **authoritative reconciliation** (CHAT-9, agent-claim-vs-ground-truth) catch real claim/effect divergences on coa's
  own ledger; does **investigate-dispatch** (CON-3) shorten time-to-resolution on a flag; and what is the **throughput/
  perf of the structured turn-event producer (C1)** at a busy session's frame rate (the one console magnitude unknown —
  OPEN.md risk #22). All observable from the M7 ledger + the conversation store; none gates soundness (the console
  degrades to the raw-`tokens` floor regardless).
- **What it gates: MAGNITUDE, not soundness.** These hold regardless of the result and you can build them without the
  spike: deterministic checks are facts; generation regenerate-diff is sound; grounding existence-checks are sound;
  nothing is hidden from the user; only deterministic constraints block; every layer degrades to a floor (never
  worse than the raw loop); the inspectable artifacts are byte-stable.
- **The decision rule:** if the spike shows the **[LOOP]** win is marginal, the upstream layers (M4) stay **thin** and
  justify themselves on soundness/inspectability/governance — the *shape* of the build does not change, only how much
  to invest in selection sophistication.

**This is the cheapest way to de-risk ~1/3 of the v1 surface. Do not skip it.**

---

## 2. Build order (topological — what's independently buildable, and why)

The order follows the module dependency graph in `SPEC.md`. **The phase table below is authoritative for build
ordering.** The linear string `M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10` is **one valid linearization**
of the same partial order — it is not an additional constraint. In particular M5→M7 is **not** a real edge (M5 and
M7 are independent; the phase table builds M7 in Phase 2 and M5 in Phase 4); where the string and the table seem to
disagree on M5/M7, follow the table. Modules in the same phase are independently spec-able and buildable in parallel.

| Phase | Build | Why here | Parallel? |
|---|---|---|---|
| **0** | **M0 Shared Schema** | the root types every module imports (the change-event frame, the flag record, the **axis'd `Piece` type + `ContentAxes`** (TAX-1), the capability-profile, the JSON-RPC payloads, the graph schema incl. the `governed-by` authority-link edge, the **GRF-\* edge additions** (`calls`/`inherits`, `EdgeProvenance`, `weight`, `inScc`) and the **HLT-\* `MetricSample`/`HealthProfile`** record types). Pure types. | n/a (it's types) |
| **1** | **M2 Code Lens**, then **M1 Change Kernel** | M2 is a pure function of bytes (parse + canonicalize/G0 + per-file symbol extraction **+ `extractMetrics` AST station for HLT-6**; depends on M0 only). M1 then builds the WAL + typed graph + the symbol table / fuzzy index / piece-resolver from M2's output, **+ the GRF-\* hardening** (retained-cycle model, `EdgeProvenance` + convention extractors, `calls`/`inherits`/`weight`, the WAL⨝structure temporal view, the SCO-\* scope tier). **This pair is the D81/D120 first prototype** — get the change-event spine + the hardened graph working before anything else. | M2 fully standalone; M1 once M2 stubs exist |
| **2** | **M3 Constraint & Flag System** · **M7 Governance** | both sit directly on M1 (flags + ledger are change-event consumers); M3 uses M2's `canonicalize` for Type-1 byte-compares (M2 exposes no "checker" method — checkers are M3/M4 *producers*). | M3 ∥ M7 |
| **3** | **M4 Context Engine** | needs M1+M2+M3. **Stage its four sub-layers in DEPENDENCY order:** shared substrate (graph + G0 + the authored/derived tag, already in M1/M2) → existence-grounding + the SSOT-constraint producer (highest leverage, standalone) → the spec-tier grounding (needs generation's `declared_symbols()`) → detection shrinks to the residual. **Gate the M4 milestone on the §1 spike.** | sub-layers stage internally |
| **4** | **M5 Config Compiler** · **M6 Workbench** · **M9 Runtime Adapter** | M5 needs M4's stable context slice (+ a consume-only M1 graph read for `versionGate`); M5 owns the **TAX-* axis→slot compiler** (the TAX-4 normalization pass → the TAX-3 `slotFor` routing → D104/D105 layout); M6 needs M1–M4 **+ M7** (the get_decision/why/context_status edge); M9 needs only M0 + the port types (everything else is injected). | M5 ∥ M6 ∥ M9 |
| **5** | **M8 Daemon Orchestration** | the hub — wires the full `{M1, M3, M4, M5, M6, M7, M9}` closure set into a running session (M3 included — its deny predicate + reminder decision; it owns lifecycle + transport + the worktree manager + the composition root, not domain logic). | last of the daemon side |
| **6** | **M10 Console** | the leaf — CLI verbs + the inspector + `coa raw`; talks only to M8's JSON-RPC catalogue. | n/a |

**The load-bearing build-phase probe — D-PROBE-1** (run at Phase 4/5): N concurrent isolated in-process `query()`
sessions in one daemon process. It is **security-load-bearing**, not just performance — it tests whether the
in-process session model leaks cross-session state (the surface the v2 process-isolation seam will close). Its
pass/fail tells you how urgently the v2 isolation work is needed; it gates the multi-agent (M8) work.

**Scope (the SCO-* family) staging.** Scope resolution (**SCO-1/2/3** — the `ScopeExpr` evaluator, the cached
member-set projection, `.coa/scopes.yaml` + tag edges) is **part of M1 (Phase 1)**: it is a graph projection like the
symbol table, and M3/M4 already consume scope membership, so the resolver must exist before they do. Scope-triggered
delivery (**SCO-4**) is **part of M4 (Phase 3)**, sequenced with L-ASM as its in-flight complement. The **SCO-5**
observability + linter spans M1 (resolve/lint) + M10 (the `coa scope` inspector view). **Build the floor first:**
`glob` + `tag` membership + the single `dependsOn` leaf gives every downstream consumer a working resolver before
SCO-4 delivery is wired; the SCO-6 boundary producer and the richer graph leaves are deferred (`OPEN.md`).

**Taxonomy (the TAX-* family) staging.** The collapsed content model spans **M0** (the axis'd `Piece` +
`ContentAxes` + the `governed-by` link edge — Phase 0, pure types) and **M5** (the axis→slot compiler — Phase 4).
**Build the compiler as two ordered passes:** (1) the **TAX-4 normalization/coercion pass** (reject/coerce
incoherent axis combos — the robustness core; build it first so nothing downstream sees an incoherent Piece), then
(2) the **TAX-3 static `slotFor` routing** into the existing `NeutralConfig` slots, feeding D104/D105 unchanged. The
**empty-config==vanilla-skill** path is the first test to pass (a `name`+`description` SKILL.md → `onDemandPullable`,
nothing else) — it is the regression guard for the whole collapse. `importBundle` is a **wrap** (one SKILL.md → one
default-axis Piece) and the **single-Piece round-trip** ships in v1; the **bundle/asset bidirectional round-trip is
v1.1** (D145/TAX-8). The TAX-7 reconciliation means **there is one scope-delivery path to build, not two**: M5's
`scopePushed` slot (compile) and M4's `scopeDeliver` (runtime, Phase 3) are the same Pieces — wire `scopeDeliver`
once, against the same scope↔Piece edge `compile()` normalizes. Capabilities stay **structural** (M9's `toolIntents`
render, not a Piece key — the SDK ignores `allowed-tools`); do not build a per-content tool-grant path.

**Graph hardening (the GRF-\* family) staging.** GRF-\* is **part of M1 (Phase 1)** — it hardens the typed graph that
every downstream consumer (M3 staleness, M4 context/health, M8 fan-out) reads, so it must land with the graph itself.
**Build the floor first:** the tree-sitter import graph + GRF-1's retained-cycle model (every intra-cycle edge kept;
SCC-collapse is a *view*, never a destructive write) + `EdgeProvenance` give every consumer a working, honest graph
before anything rides it. Then layer: GRF-4 `calls`/`inherits`/`weight` (the coupling substrate, `refs`-first then the
M2 floor — D144), GRF-5's WAL⨝structure temporal projection (a P4 view, **no parallel history store**), and GRF-3's
**convention extractors** (start with the stress-tested ecosystems — TS/JS DI+registry+codegen, Go codegen +
`go.work`/`replace`; more are additive and degrade to the floor). GRF-2's third tier is the SCO-\* `scope` node (no new
kind) and the symbol index gains health signal — both ride the M1 work already staged. SCIP export (GRF-6) is a small
one-way verb, build last. **The graph-nav-edge ([LOOP]) value is GRF-7 — a v0-spike measurement, not a build gate.**

**Health engine (the HLT-\* family) staging.** L-HLT is **part of M4 (Phase 3)**, sequenced **after** GRF-\* lands in
M1 (it consumes the cycle/coupling/temporal projections) and alongside M2's new `extractMetrics` AST station (Phase 1,
byte-pure beside `extractSymbols`). It is otherwise independent of L-GEN/ASM/GND — L-DET's sibling (a Type-2, idle-swept,
graph-reading producer that **never blocks**). **Build the floor first:** the three graph-native + WAL-native signals
that are cheap and sound (cycles, hotspots = churn×complexity, propagation-cost/core-size) before the AST-basis
cognitive-complexity layer (which degrades where no grammar). **Ship the non-compensatory profile, never a rolled-up
score** (HLT-2), enforce the **numerology deny-list** (HLT-4 — no MI, no standalone CC, no Halstead-derived, no
DIT/NOC/LCOM-as-score, no modularity-Q-as-score), and wire the **behavior-change ledger hook** (HLT-8) from day one so
the metric is measured, not assumed. Health surfaces only through existing channels (M3 two-audience + M10 inspector);
**do not add a new injection or a blocking path** — the only blocks remain M3's gate + M7's cap (SC-1).

**Visualization (the VIZ-\* family) staging.** VIZ-\* is **part of M10 (Phase 6, the leaf)** — it renders data pulled
over M8's JSON-RPC catalogue (`M4.health`, `graph.cycles/coupling/temporal`, `graph.coverage`) and **computes nothing
authoritative**. **Build the idiom-per-tier set** (treemap/circle-pack for the repo · DSM for scope/module coupling +
cycles · indented tree for files · small node-link ego-graph for symbols) with **semantic-zoom drill-down** mapping onto
GRF-2's tiers; the cycle view is **detect (Tarjan) → locate (DSM) → read (extracted back-edge subgraph)**. Honor the
anti-patterns as hard non-goals (**no full-repo force-directed hairball, no 3D code-city, no overview-first of the whole
graph, no node-link past ≈50 nodes** — VIZ-5), and the pull-only/byte-faithful M10 contract (Ruling-12/D128). Health is
the **colorant** over structure (worst-of, size-alongside, coverage-honest), never a separate pushed dashboard.

**Console (the CHAT-\* / CON-\* families + the VIZ-\* extension) staging — the no-refactor guarantee.** The console
**RENDER** is **M10 (Phase 6, the leaf)** — it computes nothing; it renders CON-CAT methods + CON-PUSH notifications.
But **every backend SEAM the console needs lands in its home module's phase (1–5), *before* M10**, so the Phase-6 render
never forces a backend refactor. The seams are deliberately concentrated in **M8 (Phase 5)**, with small touches in
modules that build earlier — **place them there:**
- **M8 (Phase 5):** enumerate the **CON-CAT** catalogue + **CON-PUSH** taxonomy as M8's client API; build the
  **structured turn-event producer (C1)** in M8's WAL→Push bridge (reuse the existing `subscribe`/consumer machinery)
  and the **R-7 turn store (C1/C2)** that persists `TurnFrame`s + the `parentTurn` subagent linkage; add the reads
  (`getToolDetail`/`resolveRef`/`getContext`/`graphView`/`health`/`capState`/`ledgerView`/… — C4/C5/C9), the actions
  (`respondApproval`/`compactConversation`/`steerSession`/`interruptSession`/`investigate-seed`/`invokeSkill` —
  C3/C6/C8/C10), the `reconcile` mapping (C11), and the view-scoped delta channel (`subscribeView` — C12).
- **M9 (Phase 4):** the native-SDK-permission routing half of **C3** (extend the `canUseTool` wiring with the
  await-human path) — built when M9 is.
- **M3 (Phase 2):** nothing new — the **CON-3 investigate-seed** reads M3's existing `envelope?`; the CON-2 panel reads
  existing `flagsForUser`/`submitFeedback`. **M5 (Phase 4) / M1 (Phase 1):** **CON-1** agent-config writes ride M5's
  `compile` + M8's R-4 `.coa/` authority + `M1.emit` (all pre-existing) — no new M5/M1 surface.
**Build the floor first:** the raw `tokens` stream + on-demand pulls (`getContext`, `graphView`, …) already give a
working console (the D85 degrade-to-floor / `coa raw`); the **structured `turn` taxonomy (C1) is the single
load-bearing addition** layered on top, and nesting (C2)/permissions (C3)/diff-inspection (C4) ride it. Honor the
console invariants throughout: **no new block** (SC-1 — only the M3 gate + M7 cap), all writes through `M1.emit`,
Zod-validate-before-touch + peer-cred (D124/D140), byte-faithful diffs/metrics (D128), and the reshaped Ruling-12
posture (live-while-viewing, no ambient alerting; the always-on push-dashboard stays deferred). **All net-new seams are
`⚠ REVIEW` and collected in `OPEN.md` §0** for owner sign-off before build.

---

## 3. Build & Packaging (not runtime modules, but required)

- **Bundler (D142):** `tsup` is officially unmaintained → use **`tsdown`** (Rolldown+Oxc, tsup-compatible), **pinned to
  an exact version** (it is pre-1.0), with **`tsc`+esbuild` documented as the fallback** if the 0.x cadence churns.
  The bundler must emit the Code-Lens parser (M2) as a **separate runnable process entry** (so the parser-as-child-
  process isolation is a build flag, not a re-tooling).
- **Supply-chain hygiene (D142):** commit `pnpm-lock.yaml`; verify integrity (lockfile + content hashes); gate CI on
  **`pnpm audit` / `osv-scanner`**; default **`--ignore-scripts`** with an explicit native-addon allowlist for the
  packages that legitimately need build scripts (`better-sqlite3`, `@parcel/watcher`, the tree-sitter binding) —
  rebuilt deterministically for the daemon's Node ABI, never Electron's. Install-time `postinstall` runs *before* any
  sandbox, so this is the highest-leverage supply-chain control.
- **Dependencies, live-verified:** the secondary backend path is `ai@^6` (Vercel AI SDK) + `@ai-sdk/anthropic@^3`
  (version-coherent, behind the M9 port). Do **not** jump to the unstable `ai@7` / `@ai-sdk/anthropic@4`. Re-confirm
  the exact pins at build time.

---

## 4. How to read the doc set

- **`SPEC.md`** is organized by module (M0–M10). Each module section gives its responsibility, public interface,
  dependencies, and every owned decision in final form. Build a module from its section + the interfaces of the
  modules it depends on.
- **`OPEN.md`** is what is *deferred* (v2/v3), the *tuning knobs* (the numbers the spike calibrates), and the *open
  risks*. Do not build anything in `OPEN.md` for v1; check it before adding scope.
- **The cross-cutting invariants** (stated in `SPEC.md`'s preamble) bind every module: **SC-1** (coa helps, never
  cages — the only blocks are M3's Type-1 close-gate and M7's cost-cap, both issued through M9's single deny
  channel); **determinism-first** (no model call on any critical path); **no-lock-in** (the neutral floor always
  works; the bounded high-fidelity layer auto-engages where a grammar/spec/type-system exists; M9 is the one backend
  seam); **strict-superset** (every module degrades to a floor — coa with a feature off is never worse than the raw
  loop; `coa raw` always shows the unfiltered loop); **compose-don't-reinvent** (orchestrate existing
  generators/checkers/SDK features; invent no parallel machinery).

---

## 5. The single most important thing to get right

**The change-event spine (M1) is the only shared mutable substrate.** Two producers write into it (the precise
Mutate tool in M6, and the git-centric reconciler), it appends one canonical change-event to a durable log, and every
other module is a *consumer* that reads projections (graph, flags, staleness, cost, provenance, checkpoint). Producers
and consumers point **only at M1** — never sideways at each other. If you preserve that one discipline, the
decoupling that makes the rest independently buildable holds; if you let two non-kernel modules call each other
directly, you reintroduce the coupling the architecture was designed to prevent.

---

_Last reviewed: 2026-07-05_

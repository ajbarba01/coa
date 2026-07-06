# SPEC.md — coa, the module-organized single source of truth

**Date:** 2026-06-24 · **Status:** the assembled, self-contained SPEC — one of the three handoff docs
(`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`). It is organized by module (M0–M10); each module section states
its responsibility, public interface, dependencies, and every owned decision in final form. Plain language;
synthetic examples only — no real secrets or personal data.

## What coa is

coa is a **local-first, single-user governance/audit layer over a rented Claude Agent SDK loop.** It does
not contain its own model loop; it **rents** a Claude Agent SDK agent loop and governs it — supplying the agent's
context, constraining its tools, grounding its reads against project truth, capping cost, and keeping an honest
record of what it cost and changed. It is a long-lived **daemon** plus thin clients. Its value is **WITH-MODEL**:
it appreciates as the model improves — the better the agent's judgment, the more you want a record, guardrails, and
sound context rather than raw capability. v1 is **attended** (a human is present) and
**Claude-primary** — Claude is the default backend, with the rented loop swappable behind the one
M9 port (DeepSeek and LongCat adapters ship today).

---

## How to read this doc set

There are exactly three handoff docs, and together they are self-contained — **everything a downstream agent needs
to build v1 coa is in these three docs; no planning-corpus file is required.** (A fourth file, `IMPL-SPEC.md`, is a
**provenance record only** — it documents *why* the 2026-06-25 stress-report-closure edits were made and carries the
SDK-fact citations behind them; its content is already folded into these three docs, so it is **not** required to
build.)

- **`SPEC.md` (this doc) — the WHAT, by module.** A module map + dependency graph + cross-cutting invariants,
  indexing one file per module under `spec/` (§C). Build a module from its file plus the published
  interfaces of the modules it depends on.
- **`IMPL-SPEC-BRIEF.md` — the build order + the v0 spike gate.** The topological build order over these modules,
  the build-and-packaging requirements, and the single pre-build calibration spike that gates *magnitude* (never
  soundness). Run the spike before any Context-Engine (M4) milestone.
- **`OPEN.md` — deferred scope + tuning knobs + open risks.** What is NOT in v1 (and what would promote it), the
  numbers the v0 spike calibrates, the named open risks, and the one thing rejected outright. Build nothing in
  `OPEN.md` for v1; check it before adding scope.

---

## §A. The module map

### A.1 The eleven modules (one line each)

| ID | Module | Responsibility (one line) | Durability |
|---|---|---|---|
| **M0** | Shared Schema | define the canonical wire/record types every module agrees on, so no two modules invent their own | SUBSTRATE |
| **M1** | Change Kernel | be the single source of truth for "what changed" — the durable WAL + the live typed dependency graph and its symbol index | SUBSTRATE |
| **M2** | Code Lens | turn source bytes into structure (parse / canonicalize / extract symbols / decide tier) — the one pure, graph-free byte→structure function | SUBSTRATE |
| **M3** | Constraint & Flag System | run every check as a pluggable producer into one pipeline; tag, dedup, and surface flags to two audiences; own the one constraint block | WITH-MODEL |
| **M4** | Context Engine | keep the agent working against project truth — generate SSOTs, assemble capped context, ground in-flight, detect residual drift | WITH-MODEL |
| **M5** | Config Compiler | compile composed Pieces + capability frame into one backend-NEUTRAL config, cache-stably | WITH-MODEL |
| **M6** | Workbench | present the governed tool surface the loop calls, and route every precise write into the kernel as a change-event (producer ①) | WITH-MODEL |
| **M7** | Governance & Audit | bound and record what the loop costs and changes — the cost cap, the secret-clean ledger, the visibility floor, the Decision log | WITH-MODEL + NEUTRAL |
| **M8** | Daemon Orchestration | be the always-on process shell — transport, session lifecycle, worktree binding, subagent orchestration, the daemon host | SUBSTRATE |
| **M9** | Runtime Adapter | be the one place backend-specific behavior lives — implement the capability ports and render M5's neutral config to backend-native | NEUTRAL |
| **M10** | Console | present coa to the human — CLI verbs first, the pull/inspector GUI, and the honest `coa raw` escape | NEUTRAL |

### A.2 The dependency graph (one line per module; acyclic)

Read `A → B` as "A depends on / calls into B." Producers and consumers point *into* the kernel (M1); nobody points
sideways.

```
M0  Shared Schema         → (nothing)                                   [root]
M2  Code Lens             → M0                                          (PURE byte→structure; graph-free)
M1  Change Kernel         → M0, M2          (M1 calls M2.parse/extract to BUILD its graph+index; M2 never reads back)
M3  Constraint & Flag     → M0, M1, M2      (+ handed an M9 ref BY M8 for the deny/reminder channel — injected, not compile-time; M4 registers producers INTO M3)
M4  Context Engine        → M0, M1, M2, M3
M5  Config Compiler       → M0, M4, M1       (M1 = consume-only graph read for versionGate.walkRoleDeps; backend-NEUTRAL output only)
M6  Workbench             → M0, M1, M2, M3, M4, M7   (M6→M7 = get_decision/why/context_status reads; M6→M4 also = get_spec)
M7  Governance & Audit    → M0, M1           (consumer of projections AND sanctioned governance producer via appendGovernance)
M9  Runtime Adapter       → M0   (+ handed M3/M4/M5/M6/M7 refs BY M8 at session build — not compile-time deps)
M8  Daemon Orchestration  → M0, M1, M4, M5, M7, M9   (the hub; calls M5.compile, has M9 render, wires closures; holds M3/M6 refs to inject)
M10 Console               → M0, M8
```

**The verified topological order (acyclic):**

```
M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10
```

(M7 before M6 because M6→M7; M5 after M4 because M5→M4; M9 after everything it is handed because those refs are
runtime-injected by M8, not compile-time — M9 itself depends only on M0 + the `spi` port types.) The two edges that
could have cycled are both resolved: **M1↔M2** (the symbol table / fuzzy index / piece-resolver live in M1 as graph
projections, so the single edge is M1→M2 and M2 never reads back — which is why M2 sorts *before* M1); and **M9's
fan-in** (resolved by dependency injection at the M8 session boundary — M9 stays a swappable leaf, not a hub).

### A.3 The high-level architecture diagram (described — the change-event-spine hourglass)

**Legend:** box = module · solid arrow = compile-time dependency · double-line = the change-event spine · dashed
arrow = a runtime injection wired by M8 · ⬡ = the one deny channel. Layout top to bottom:

1. **Top band — Console.** One box **M10 Console (CLI · Inspector · `coa raw`)**, a single solid arrow down to M8
   labeled "OS socket · JSON-RPC/Zod."
2. **Second band — the orchestration hub + the compile/render pair.** **M8 Daemon Orchestration** (Session Manager,
   Worktree Manager, JSON-RPC server, daemon host). Beside it, **M5 Config Compiler** (Pieces → backend-NEUTRAL
   config) with a solid arrow M8→M5 ("compile"), and **M9 Runtime Adapter** ⇄ **Claude Agent SDK** (the only
   backend-specific box; the SDK drawn outside the daemon boundary) with a dashed arrow M8→M9 ("constructs
   per-session adapter + renders M5's neutral output to backend-native"). The neutral config flows M5→(M8)→M9.
3. **Third band — the governed loop's surfaces, all injected into the loop by M8.** Three boxes: **M6 Workbench**,
   **M4 Context Engine** (four stacked sub-cells: GENERATION · ASSEMBLY · GROUNDING · DETECTION), and **M3
   Constraint & Flag System**. Dashed arrows from M8 to each. A ⬡ on the arrow M3→M9 labeled "the ONLY deny:
   close-gate Type-1 + cost-cap." A thin arrow M3→M9 labeled "D133 reminder: M3 decides, M9 delivers on
   role:system."
4. **Fourth band — the kernel (the waist).** The double-lined box **M1 Change Kernel** spanning the width: the two
   producers feeding the waist ("Mutate (precise, M6)" and "Reconciler (git-centric, authoritative)"), then the
   double-line spine "one canonical change-event · WAL writer," then the commit-point outputs "append-log (WAL) ·
   in-mem graph · SQLite projections," then the consumer fan-out "graph · **symbol table · fuzzy index ·
   piece-resolver** · flags · staleness · cost · provenance · checkpoint · signal-bus · idle-scheduler." Every
   band-3 box and M7 draws a solid arrow *into* the waist (consume) or *up from* a producer (emit) — never sideways.
5. **Left margin — M7 Governance & Audit** (cost cap ⬡ · ledger · visibility floor · sandbox + process-isolation
   posture · Decision log), a solid arrow into M1, dashed arrows to M8 (cap/sandbox at launch) and M3
   (visibility-floor surfaces). A thin arrow M6→M7 ("get_decision / context_status reads").
6. **Bottom margin — the two SUBSTRATE leaves.** **M2 Code Lens** (tree-sitter tiers · G0 · per-file extraction ·
   neutral-floor tiering) with arrows *up into* its callers: M1 builds the graph/index via M2, and M3 (`canonicalize`),
  M4, and M6 (`parse`) also call M2's byte-pure functions directly. Acyclicity holds because M2 reads no graph
  (depends only on M0), so any module may call its pure functions.
   **M0 Shared Schema** as a thin base under everything.

**The reading:** the double-line spine (M1) is the only thing in the middle and now also holds the symbol index;
producers above-left emit into it, consumers draw from it; M5 compiles neutral config that M9 renders to the one
backend; the human (M10) only ever talks to M8. That hourglass *is* the two-producer change-event thesis.

### A.4 The logical → physical package map

| Logical module | Physical home |
|---|---|
| M0 Shared Schema | `shared` package |
| M1 Change Kernel | `core` — the **spine** ring (WAL, bus, graph, symbol table / fuzzy index / piece-resolver, projections) |
| M2 Code Lens | `code-intel` package (the child-process parser seam) — purely byte→structure |
| M3 Constraint & Flag | `core` — a **consumer/projection** (flags) + the gate service |
| M4 Context Engine | `core` — **consumer/services** (staleness consumer + context-engine/assembly/grounding/generation services) |
| M5 Config Compiler | `core` — its own `core/compiler/` service boundary (`compile(pieces) -> NeutralConfig`); NOT in `adapter-claude-sdk` because its output is backend-neutral; promotable to a standalone `compiler` package if it grows |
| M6 Workbench | `core` — the **producer** (Mutate) + the `mcp/` outer-ring surface |
| M7 Governance & Audit | `core` — **consumers** (cost ledger, provenance, decision log) + policy service (sandbox/process-isolation posture) |
| M8 Daemon Orchestration | `core` — the **services + `rpc/`** outer ring (transport, session, worktree, daemon host) |
| M9 Runtime Adapter | `spi` (ports) + `loop-driver` (the shared pure-API loop driver) + `adapter-claude-sdk` (the SDK backend: the neutral→native renderer, the TS-LSP backend, the SDK loop) + `adapter-deepseek` (the thin DeepSeek backend) + `adapter-longcat` (the thin LongCat backend) — see `docs/REPO_LAYOUT.md`, `docs/adr/0002` |
| M10 Console | `app` (Electron) + `cli` packages |
| Build & Packaging | not a runtime package — `tsdown` config, the probe specs, supply-chain CI gates, `pnpm-lock.yaml` (see `IMPL-SPEC-BRIEF.md` §3) |

The logical arrows obey the `producers → spine ← consumers` rule: M6 (producer), M1 (spine), and M3/M4/M5/M7
(consumers) never point sideways — they point at the spine or downward. This map is what a `dependency-cruiser`
ruleset would assert.

---

## §B. Cross-cutting invariants (every module honors these)

These are owned by no single module; every module honors them.

- **P1 — determinism-first.** No model call on any critical path. M1/M2 are deterministic; M5's `compile` is
  deterministic; M3's only model use is the user-invoked validator (CF-5), the Type-2 confirm, and the
  wired-but-OFF D143 classifier (all off the critical path); M4's grounding/assembly are deterministic, the only
  model call is the F4 G5 confirm.
- **P2 — one flag pipeline.** Every check (typecheck, format, custom rule, staleness, grounding, generation-drift)
  is a pluggable producer emitting into one pipeline against one schema; there are no per-producer side channels.
  Realized in M3.
- **P3 — atomic pieces.** Pieces are atomic and compose rather than concatenate; realized in M5's compiler.
- **P4 — one structure, many views.** The typed dependency graph is one structure viewed many ways (cache prefix,
  staleness graph, provenance, agent-linking); realized in M1.
- **P5 — defense-in-depth.** Prompt authority is necessary-but-not-sufficient; anything that truly matters is also
  backed deterministically (e.g. by M3's gate), never by prose alone.
- **P6 — pull-diff-aware.** coa is aware of what changed via the git-centric reconciler and the WAL diff.
- **P7 — mutation chokepoint.** Every write — file change, graph edge, *and* governance event — becomes a
  change-event via `M1.emit` (the typed `assertEdge`/`declareSymbols`/`appendGovernance` methods funnel through it);
  there is no side-door write. Realized jointly in M1 + M6 (+ M4/M7 as sanctioned producers, D81).
- **P8 — compose, don't reinvent.** Orchestrate existing generators/checkers/SDK features; invent no parallel
  machinery. M4 GENERATION orchestrates existing generators; M9 reuses the SDK sandbox; M5 composes over the D104
  assembly line, not a naive concat.
- **SC-1 — help-not-cage.** coa is advisory everywhere. The ONLY two blocks in the whole system are **M3's Type-1
  close-gate** (unresolved Type-1 ∧ high-severity flags) and **M7's cost-cap**; **M9 is the single owner** of both,
  realized on **two SDK hooks** — the close-gate on the **`Stop` hook** (`interceptStop`) and the cost-cap on
  **`canUseTool`** (`interceptTool`). (There is no "finish" tool to deny, so one `canUseTool` cannot carry both —
  verified SDK fact; one owner, two hooks. **The cost-cap is a *seam*, not a default ceiling:** under the
  subscription model (the v1 default) it imposes no ceiling of its own — the loop runs until the plan's own usage
  limit stops it (D85 floor) — and only on the optional/maybe **API route** does it plug in the SDK's native
  `maxBudgetUsd` hard stop as a per-user, per-daemon **local** cap. Budget is **local-only**; coa pursues no
  shared/team budget — see M7's D35/D93-simple and OPEN.md §1.1.) Everything else — grounding, detection, reminders,
  the SemVer gate, the visibility floor — is advisory or surfacing, never blocking.
- **D85 — strict-superset.** coa is a strict superset of the bare Claude Agent SDK loop: every feature either adds
  value or degrades to a literal pass-through. Every module degrades to a floor (coa with a feature off is never
  worse than the raw loop), and **`coa raw` never hides the raw loop** (M10's floor that proves the superset).
- **The change-event spine (M1) is the only shared mutable substrate.** Two producers write into it (the precise
  Mutate tool in M6 and the git-centric reconciler in M1); it appends one canonical change-event to the durable
  log; every other module is a *consumer* that reads projections. Producers and consumers point **only at M1**,
  never sideways at each other. This is the single discipline that keeps the rest independently buildable.

---

## §C. The module specifications

Each module's full specification — identity · public interface · depends-on · owned decisions in final form —
lives in its own file under [`spec/`](spec/). Build a module from its file plus the published interfaces of the
modules it depends on (§A.2).

| Module | Spec file |
| --- | --- |
| M0 Shared Schema | [spec/M0.md](spec/M0.md) |
| M1 Change Kernel | [spec/M1.md](spec/M1.md) |
| M2 Code Lens | [spec/M2.md](spec/M2.md) |
| M3 Constraint & Flag | [spec/M3.md](spec/M3.md) |
| M4 Context Engine | [spec/M4.md](spec/M4.md) |
| M5 Config Compiler | [spec/M5.md](spec/M5.md) |
| M6 Workbench | [spec/M6.md](spec/M6.md) |
| M7 Governance & Audit | [spec/M7.md](spec/M7.md) |
| M8 Daemon Orchestration | [spec/M8.md](spec/M8.md) |
| M9 Runtime Adapter | [spec/M9.md](spec/M9.md) |
| M10 Console | [spec/M10.md](spec/M10.md) |

---


_Last reviewed: 2026-07-06_

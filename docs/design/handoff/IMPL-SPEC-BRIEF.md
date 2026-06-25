# IMPL-SPEC-BRIEF.md — how to build coa from the SPEC

**Date:** 2026-06-24 · **Status:** the executor brief — one of the three self-contained handoff docs
(`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`). It tells a downstream agent **what to build, in what order, and what
to measure first.** It assumes only these three docs; it does not reference the planning corpus.

> **What coa is (one paragraph, so the builder has the frame).** coa is a **local-first, single-user governance/audit
> layer over a rented Claude Agent SDK loop.** It does not replace the agent; it governs it — running deterministic
> checks, keeping the agent working against the project's real symbols/specs/tests, capping cost, and keeping an
> honest record. Its value is **WITH-MODEL** (it appreciates as the model improves: the better the agent's judgment,
> the more you want a record, guardrails, and sound context rather than raw capability). v1 is **attended**
> (a human is present) and **Claude-locked** (one backend, behind a swappable port). See `SPEC.md` for the module
> definitions; this doc is the build plan over them.

---

## 1. The ONE pre-build gate — the v0 calibration spike (run this FIRST)

Almost every _magnitude_ claim in the design is deferred to a single cheap spike; **soundness does not depend on it.**
Run it before committing to any Context-Engine (M4) milestone:

- **What it measures** (all observable from M7's minimal ledger): structure-first retrieval vs. raw-read-with-caching
  net of coa's own spend (the token thesis); cheap-graph vs. cheap-subagent staleness rate+cost (the detection
  shrink); grounding suggestion precision + uptake; the context-package's selection precision/recall + the position
  effect + the **[LOOP]** token/turn win; the confidence-tier calibration (severity×confidence); the capture-quality
  of intent/rationale.
- **What it gates: MAGNITUDE, not soundness.** These hold regardless of the result and you can build them without the
  spike: deterministic checks are facts; generation regenerate-diff is sound; grounding existence-checks are sound;
  nothing is hidden from the user; only deterministic constraints block; every layer degrades to a floor (never
  worse than the raw loop); the inspectable artifacts are byte-stable.
- **The decision rule:** if the spike shows the **[LOOP]** win is marginal, the upstream layers (M4) stay **thin** and
  justify themselves on soundness/inspectability/governance — the _shape_ of the build does not change, only how much
  to invest in selection sophistication.

**This is the cheapest way to de-risk ~1/3 of the v1 surface. Do not skip it.**

---

## 2. Build order (topological — what's independently buildable, and why)

The order follows the module dependency graph in `SPEC.md`. The verified topological order is
`M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10`. Modules in the same phase are independently spec-able and
buildable in parallel.

| Phase | Build                                                              | Why here                                                                                                                                                                                                                                                                                                                                                                              | Parallel?                                   |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **0** | **M0 Shared Schema**                                               | the root types every module imports (the change-event frame, the flag record, the Piece type, the capability-profile, the JSON-RPC payloads, the graph schema). Pure types.                                                                                                                                                                                                           | n/a (it's types)                            |
| **1** | **M2 Code Lens**, then **M1 Change Kernel**                        | M2 is a pure function of bytes (parse + canonicalize/G0 + per-file symbol extraction; depends on M0 only). M1 then builds the WAL + typed graph + the symbol table / fuzzy index / piece-resolver from M2's output. **This pair is the D81/D120 first prototype** — get the change-event spine + the graph working before anything else.                                              | M2 fully standalone; M1 once M2 stubs exist |
| **2** | **M3 Constraint & Flag System** · **M7 Governance**                | both sit directly on M1 (flags + ledger are change-event consumers); M3 also needs M2's deterministic checkers.                                                                                                                                                                                                                                                                       | M3 ∥ M7                                     |
| **3** | **M4 Context Engine**                                              | needs M1+M2+M3. **Stage its four sub-layers in DEPENDENCY order:** shared substrate (graph + G0 + the authored/derived tag, already in M1/M2) → existence-grounding + the SSOT-constraint producer (highest leverage, standalone) → the spec-tier grounding (needs generation's `declared_symbols()`) → detection shrinks to the residual. **Gate the M4 milestone on the §1 spike.** | sub-layers stage internally                 |
| **4** | **M5 Config Compiler** · **M6 Workbench** · **M9 Runtime Adapter** | M5 needs M4's stable context slice; M6 needs M1–M4; M9 needs only M0 + the port types (everything else is injected).                                                                                                                                                                                                                                                                  | M5 ∥ M6 ∥ M9                                |
| **5** | **M8 Daemon Orchestration**                                        | the hub — wires the M1/M4/M5/M6/M7/M9 closures into a running session (it owns lifecycle + transport + the worktree manager, not domain logic).                                                                                                                                                                                                                                       | last of the daemon side                     |
| **6** | **M10 Console**                                                    | the leaf — CLI verbs + the inspector + `coa raw`; talks only to M8's JSON-RPC catalogue.                                                                                                                                                                                                                                                                                              | n/a                                         |

**The load-bearing build-phase probe — D-PROBE-1** (run at Phase 4/5): N concurrent isolated in-process `query()`
sessions in one daemon process. It is **security-load-bearing**, not just performance — it tests whether the
in-process session model leaks cross-session state (the surface the v2 process-isolation seam will close). Its
pass/fail tells you how urgently the v2 isolation work is needed; it gates the multi-agent (M8) work.

---

## 3. Build & Packaging (not runtime modules, but required)

- **Bundler (D142):** `tsup` is officially unmaintained → use **`tsdown`** (Rolldown+Oxc, tsup-compatible), **pinned to
  an exact version** (it is pre-1.0), with **`tsc`+esbuild` documented as the fallback** if the 0.x cadence churns.
  The bundler must emit the Code-Lens parser (M2) as a **separate runnable process entry** (so the parser-as-child-
  process isolation is a build flag, not a re-tooling).
- **Supply-chain hygiene (D142):** commit `pnpm-lock.yaml`; verify integrity (lockfile + content hashes); gate CI on
  **`pnpm audit` / `osv-scanner`**; default **`-ignore-scripts`** with an explicit native-addon allowlist for the
  packages that legitimately need build scripts (`better-sqlite3`, `@parcel/watcher`, the tree-sitter binding) —
  rebuilt deterministically for the daemon's Node ABI, never Electron's. Install-time `postinstall` runs _before_ any
  sandbox, so this is the highest-leverage supply-chain control.
- **Dependencies, live-verified:** the secondary backend path is `ai@^6` (Vercel AI SDK) + `@ai-sdk/anthropic@^3`
  (version-coherent, behind the M9 port). Do **not** jump to the unstable `ai@7` / `@ai-sdk/anthropic@4`. Re-confirm
  the exact pins at build time.

---

## 4. How to read the doc set

- **`SPEC.md`** is organized by module (M0–M10). Each module section gives its responsibility, public interface,
  dependencies, and every owned decision in final form. Build a module from its section + the interfaces of the
  modules it depends on.
- **`OPEN.md`** is what is _deferred_ (v2/v3), the _tuning knobs_ (the numbers the spike calibrates), and the _open
  risks_. Do not build anything in `OPEN.md` for v1; check it before adding scope.
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
other module is a _consumer_ that reads projections (graph, flags, staleness, cost, provenance, checkpoint). Producers
and consumers point **only at M1** — never sideways at each other. If you preserve that one discipline, the
decoupling that makes the rest independently buildable holds; if you let two non-kernel modules call each other
directly, you reintroduce the coupling the architecture was designed to prevent.

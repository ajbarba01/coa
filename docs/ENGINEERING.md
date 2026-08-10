# Engineering Principles

> CORE doc — project-agnostic where it can be; product facts live in the handoff docs, project facts in
> [DESIGN.md](DESIGN.md), physical layout in [REPO_LAYOUT.md](REPO_LAYOUT.md).

> Authority for **how code is structured and what "good" means** in this repo. Read before writing or refactoring
> any non-trivial code. For formatting/naming/docs see [CODE_STYLE.md](CODE_STYLE.md); for the dev loop see
> [WORKFLOW.md](WORKFLOW.md).

coa is a long-lived **daemon** plus thin clients, built as a TypeScript monorepo. It must stay **professional,
modular, and swappable** — the no-lock-in thesis depends on it. Scope does not lower the bar. Each principle below
is a **rule + why + example**. When a principle is violated, fix the root cause or surface it (see _Critical
Findings_) — never silently work around it.

These principles **realize the cross-cutting invariants** stated in [SPEC §B](design/handoff/SPEC.md) and the
[AGENTS.md](../AGENTS.md) Constitution. Where a principle restates an invariant, the SPEC wins on any conflict.

---

## Architecture

### 1. Modules are packages; the dependency graph is acyclic and topological

Each logical module (M0–M10) has a **physical home** ([REPO_LAYOUT.md](REPO_LAYOUT.md)). Code lives with the
module it serves; there is **no catch-all `utils/`**. New responsibility = its module's directory, not a shared
dumping ground.

- **Why:** module boundaries make the codebase navigable, independently buildable, and refactor-safe. The build
  order (`M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10`) only holds if the dependency graph stays acyclic.
- **Example:** the staleness consumer belongs to M4's context services, not scattered into M1's spine.
- **Check:** `dependency-cruiser` enforces the SPEC §A.4 arrows — cross-package cycles fail CI.

### 2. The change-event spine (M1) is the only shared mutable substrate

Two **producers** write into M1 (the precise Mutate tool in M6, and the git-centric reconciler); every other
module is a **consumer** that reads projections (graph, flags, staleness, cost, provenance, checkpoint).
Producers and consumers point **only at M1**, never sideways at each other.

- **Why:** this single discipline is what keeps the rest independently buildable. Two non-kernel modules calling
  each other directly reintroduces exactly the coupling the architecture was designed to prevent.
- **Example:** M3 (flags) and M4 (context) never call each other — M4 _registers producers into_ M3 and both read
  the kernel; the `type` field is producer-stamped on the M0 record so neither holds a map of the other.
- **Check:** every write becomes a change-event via `M1.emit` (P7 mutation chokepoint); there is no side-door write.

### 3. Isolate the backend behind ports (M9 is the one seam)

Backend-specific behavior lives in **exactly one place**: the M9 capability ports (`spi`) + the Claude adapter
(`adapter-claude-sdk`). The core calls a capability **port** and takes a defined **null-fallback** when the port
is absent — never a `which-backend?` branch (D109).

- **Why:** swapping or upgrading the backend is a one-package change, not an app-wide hunt. It is the no-lock-in
  invariant made structural.
- **Example:** the precise TypeScript-LSP path is a port owned by M9; every other language degrades to M2's
  tree-sitter floor through the port's null-fallback. No language is broken by a server's absence.
- **Check:** grep the core packages for backend SDK imports → should be empty; only `adapter-claude-sdk` imports
  the SDK.

### 4. Pure core, IO at the edges, no model on the critical path

Domain logic — canonicalization, the severity projection, assembly selection, the graph update, the compiler — is
**pure functions** over typed inputs: no disk reads, no network, no clock reads, **no model call** inside them
(P1 determinism-first). IO (the WAL, SQLite, the watcher, the SDK loop) happens at the edges and passes data in.

- **Why:** pure logic is unit-testable without mocks and is the part most likely to contain real bugs — so most
  worth isolating. Determinism is also a hard product invariant: the only model calls in the system are off the
  critical path (the user-invoked validator, Type-2 confirm, the F4 grounding confirm).
- **Example:** `canonicalize(bytes, profile)` is a pure G0 function; the formatter check reads the file at the edge
  and calls it. A pure `transition`/projection returns a result; the daemon persists it.

### 5. Synchronous hot path, asynchronous projections

On a change-event: **synchronous** WAL append → **synchronous** in-memory graph update (the hot read path) →
**asynchronous** heavier projections off idempotent per-consumer WAL cursors (D120). Consumers replay from their
own cursor on restart; projections are rebuildable, the WAL is the source of truth.

- **Why:** the hot read path (graph/symbol lookup) must be cheap and synchronous; everything heavier is deferred
  without blocking it. The single-threaded daemon makes the ordering contract cheap to honor.
- **Example:** `lookup(name)` is an O(1) map read; the fuzzy index is built on idle time and queried only on a miss.

---

## Code quality

### 6. Typed boundaries everywhere; validate external data at the edge

TypeScript `strict`, no `any`. **Parse and validate every external input at the boundary** — tool calls, RPC
payloads, file contents, config, env — with a **Zod schema**. The shared schemas live in **M0** (`shared`) and are
imported, never re-declared.

- **Why:** types catch errors at compile time; runtime validation at the boundary means the rest of the system
  trusts its data. M0 owning the schemas is what lets every module compile against one contract.
- **Example:** each NDJSON change-event line is Zod-validated and frame-schema-migrated before any projector sees it.

### 7. Single responsibility, small composable units

Each function/module does one thing. When a file grows large, that is a signal it is doing too much — split it.

- **Why:** small, well-bounded units are readable, independently testable, and easier to reason about in one pass.

### 8. No stringly-typed patterns; named constants for magic numbers

No string keys where a union/enum fits (`kind: 'deterministic' | 'judgment'`, not loose strings). Reused or
non-obvious numbers get a named, commented constant — especially the **tuning knobs** ([OPEN.md](design/handoff/OPEN.md)
§2): confidence cut-points, the context token cap, the staleness threshold. These are calibratable values, not bare
literals buried in logic.

- **Why:** the knobs self-tune from the ledger; they must be named, centralized, and conservative by default.

### 9. DRY by ownership

Each piece of state has **one** owner; no two systems write the same data, no parallel implementations of one
responsibility. The piece-resolver is one pure resolver both the workbench and the compiler call — not two.

- **Why:** one owner per fact is what makes the projections trustworthy and the record honest.

### 10. Error handling discipline

Handle **expected** absence explicitly (a `lookup` miss, an absent capability port, a not-yet-built projection).
For **invariants that must always hold**, fail loud — throw or surface — rather than swallowing. Crash-tolerance is
designed, not accidental: a torn WAL tail is discarded on startup; a hostile file crashes only the parser child
process, not the daemon. When a defensive guard exists for a real race/recovery case, comment **why**.

- **Why:** silent catches hide bugs; loud failures on broken invariants get fixed. The reconciler doubling as crash
  recovery only works if corruption is surfaced, not masked.

### 11. Events/subscriptions over polling

Prefer the WAL-fed subscription model (`subscribe(cursor, fn)`, the idle scheduler) over polling
loops. Consumers react to change-events; they do not busy-wait on disk.

- **Why:** the daemon is resident precisely so it can pre-compute on idle and react to events — polling wastes that.

### 12. Production-ready or surfaced

No dead or commented-out code, no leftover debug logging, no naked `TODO` without a tracked follow-up. A reliably
bad auto-fix is **proposed for demotion via the visibility floor**, never silently disabled. If something is
temporary, say why and where it is tracked.

### 13. Performance discipline (coa-specific)

- **No model call on any critical path** (P1) — the single most important performance _and_ correctness rule.
- **The hot read path is synchronous and O(1) where it can be** — symbol `lookup` is a map read; fuzzy search runs
  only on a miss and is bounded.
- **Idle precompute** — GENERATION regen, the fuzzy-index build, ASSEMBLY pre-build, and the detection sweep all
  register on the shared idle scheduler. That is why the daemon stays resident.
- **SQLite projections are reconstructible-not-durable** (`synchronous=NORMAL`); durability rides the change-event
  WAL (one `fsync` per coalesced batch). Keep the `-wal` file co-located with its DB.
- **The context package has a hard token ceiling** ([OPEN.md](design/handoff/OPEN.md) §2) — the assembler is
  binary-searched to budget, net of the always-loaded kernel; default leans low.

---

## Agent behavior

These govern how an AI agent works in this repo.

- **Read first, ground claims in inspection.** Inspect the relevant module section (handoff SPEC) and code before
  proposing changes; no speculation presented as fact. Where the SPEC is genuinely ambiguous, **ask** — do not
  invent a decision.
- **Surface root cause — Critical Findings.** On discovering any of the following, list it under a **Critical
  Findings** heading _before_ proceeding; do not silently work around it:
  - an architectural violation (a consumer calling another consumer sideways instead of through M1; backend SDK
    imports leaking into the core; a model call on a critical path),
  - hidden coupling (a module holding a map of another module's responsibility),
  - duplicated responsibility (two systems owning the same projection/state),
  - scope creep into something deferred in [OPEN.md](design/handoff/OPEN.md),
  - temporary logic becoming permanent (a knob hardcoded as a bare literal, a stub in a shipping path).
- **Communicate high-level changes** after edits — what changed and why, briefly.
- **Bias:** root-cause fixes over shortcuts. Industry-standard, modular, swappable, neat. Production-ready or
  surfaced as a finding.

---

_Last reviewed: 2026-06-24_

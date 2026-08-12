# Engineering Principles

> Authority for **how code is structured and what "good" means** in this repo. Read before writing or
> refactoring any non-trivial code. What the system _is_ — its parts and the constraints between them — lives in
> [ARCHITECTURE.md](ARCHITECTURE.md). For formatting and naming see [CODE_STYLE.md](CODE_STYLE.md); for the
> dev loop [WORKFLOW.md](WORKFLOW.md); for the physical tree [REPO_LAYOUT.md](REPO_LAYOUT.md).

coa is a long-lived **daemon** plus thin clients, built as a TypeScript monorepo. It must stay **professional,
modular, and swappable** — the promise that you are never locked into one backend depends on it. Scope does not
lower the bar. Each principle below is a **rule + why + example**. When a principle is violated, fix the root
cause or surface it (see _Critical findings_) — never silently work around it.

Where a principle restates an architectural constraint, **ARCHITECTURE.md wins on any conflict**.

---

## Architecture

### 1. Responsibilities are packages; the dependency graph is acyclic and topological

Every unit of responsibility has exactly **one physical home** ([REPO_LAYOUT.md](REPO_LAYOUT.md)). Code lives
with the thing it serves; there is **no catch-all `utils/`**. A new responsibility gets its own directory, not a
shared dumping ground.

- **Why:** clear boundaries make the codebase navigable, independently buildable, and refactor-safe — and only an
  acyclic graph can be built in a stable order at all.
- **Example:** the staleness consumer belongs to the context services, not scattered into the spine.
- **Check:** `dependency-cruiser` enforces the arrows; a cross-package cycle fails the gate.

### 2. The change-event spine is the only shared mutable substrate

Two **producers** write into the spine: the workbench's precise edit tool, and the git-centric reconciler that
catches changes coa did not execute itself. Every other part is a **consumer** that reads projections (graph,
flags, staleness, cost, checkpoint). Producers and consumers point **only at the spine**, never sideways at each
other.

- **Why:** this single discipline is what keeps everything else independently buildable. Two consumers calling
  each other directly reintroduces exactly the coupling the architecture exists to prevent.
- **Example:** the flag pipeline and the context engine never call each other — context _registers producers
  into_ the pipeline and both read the kernel, so neither holds a map of the other's responsibility.
- **Check:** every write becomes a change event through the kernel's append path. There is no side-door write.

### 3. Isolate the backend behind ports

Backend-specific behavior lives in **exactly one place**: the capability port types in `spi`, plus the adapter
packages that implement them (the Claude Agent SDK adapter, and one thin adapter shared by every
OpenAI-compatible HTTP provider). The core calls a **port** and takes a defined **fallback** when the port is
absent — never a `which-backend?` branch.

- **Why:** swapping or upgrading a backend is a one-package change, not an app-wide hunt. It is the no-lock-in
  promise made structural.
- **Example:** a precise language-server path can be a port owned by an adapter; every language without one
  degrades to the tree-sitter floor through the port's fallback. No language is broken by a server's absence.
- **Check:** `dependency-cruiser`'s backend-isolation rule — only the SDK adapter may import a backend SDK, and
  the core may not import an adapter at all (concrete backends are injected by the app composition root).

### 4. Pure core, IO at the edges, no model on the critical path

Domain logic — canonicalization, the severity projection, the graph update, the compiler — is **pure functions**
over typed inputs: no disk reads, no network, no clock reads, **no model call** inside them. IO (the log, the
watcher, the backend loop) happens at the edges and passes data in.

- **Why:** pure logic is unit-testable without mocks and is the part most likely to contain real bugs, so it is
  the part most worth isolating. Determinism is also a product promise: a check the daemon must finish before it
  can answer never waits on a model. The model calls that do exist are ones the user asked for and can skip.
- **Example:** `canonicalize` answers "are these two artifacts equal modulo formatting?" as a pure function; the
  formatter check reads the file at the edge and calls it. A pure projection returns a result; the daemon
  persists it.

### 5. Synchronous hot path, asynchronous projections

On a change event: **synchronous** log append → **synchronous** in-memory graph update (the hot read path) →
**asynchronous** heavier projections driven off idempotent per-consumer cursors. Consumers replay from their own
cursor on restart; projections are rebuildable, the log is the source of truth.

- **Why:** the hot read path (graph and symbol lookup) must be cheap and synchronous; everything heavier is
  deferred without blocking it. A single-threaded daemon makes the ordering contract cheap to honor.
- **Example:** a symbol lookup is a map read. The SQLite mirror is an in-memory projection rebuilt by replaying
  the log on start — it is never consulted to make the hot path correct.

---

## Code quality

### 6. Typed boundaries everywhere; validate external data at the edge

TypeScript `strict`, no `any`. **Parse and validate every external input at the boundary** — tool calls, RPC
payloads, file contents, config, environment — with a **Zod schema**. The shared schemas live in `@coa/shared`
and are imported, never re-declared.

- **Why:** types catch errors at compile time; runtime validation at the boundary means the rest of the system
  can trust its data. One package owning the schemas is what lets everything else compile against one contract.
- **Example:** each newline-delimited change-event line is Zod-validated before any projector sees it.

### 7. Single responsibility, small composable units

Each function and module does one thing. When a file grows large, that is a signal it is doing too much — split
it.

- **Why:** small, well-bounded units are readable, independently testable, and easier to reason about in one
  pass.

### 8. No stringly-typed patterns; named constants for magic numbers

No string keys where a union fits (`kind: 'deterministic' | 'judgment'`, not loose strings). Reused or
non-obvious numbers get a named, commented constant — especially the **calibratable ones**: confidence
cut-points, token budgets, staleness thresholds.

- **Why:** these are values meant to be tuned against real evidence later. They can only be tuned if they are
  named, centralized, and conservative by default — not buried as bare literals inside logic.

### 9. DRY by ownership

Each piece of state has **one** owner. No two systems write the same data; no two implementations of one
responsibility. The piece resolver is one pure resolver that both the workbench and the compiler call, not two.

- **Why:** one owner per fact is what makes the projections trustworthy and the record honest.

### 10. Error handling discipline

Handle **expected** absence explicitly (a lookup miss, an absent capability port, a not-yet-built projection).
For **invariants that must always hold**, fail loud — throw or surface — rather than swallowing. Crash-tolerance
is designed, not accidental: a torn log tail is discarded on startup; a hostile file crashes only the parser
child process, not the daemon. When a defensive guard exists for a real race or recovery case, comment **why**.

- **Why:** silent catches hide bugs; loud failures on broken invariants get fixed. The reconciler doubling as
  crash recovery only works if corruption is surfaced, not masked.

### 11. Events and subscriptions over polling

Prefer the log-fed subscription model over polling loops. Consumers react to change events; they do not busy-wait
on disk.

- **Why:** the daemon is resident precisely so it can react to events and pre-compute while idle — polling wastes
  that.

### 12. Production-ready, surfaced, or parked

No dead or commented-out code, no leftover debug logging, no naked `TODO` without a tracked follow-up. If
something is temporary, say why and where it is tracked.

Code that was built but never wired to a caller does not sit half-alive in the tree: it moves to `archive/` with
a row recording what it was, why it was parked, and what would revive it. `archive/` is compiled by nothing and
imported by nothing, so a parked feature cannot quietly become load-bearing.

- **Why:** a never-called code path reads as working software to the next reader and to every agent that greps
  the tree. Parking it makes the honest state legible without throwing the work away.

### 13. Performance discipline

- **No model call on any critical path** — the single most important performance _and_ correctness rule.
- **The hot read path is synchronous and cheap** — a symbol lookup is a map read; anything heavier is bounded or
  deferred.
- **Durability rides the change-event log**, one `fsync` per coalesced batch. The SQLite projection is an
  in-memory mirror rebuilt by replaying the log, so it is reconstructible rather than durable and never needs its
  own flush discipline.
- **Idle precompute is the reason the daemon stays resident.** The kernel exposes a priority-ordered idle
  scheduler for exactly this, and nothing registers on it yet — an open roadmap item, so the heavier
  regeneration and detection sweeps still run inline or not at all.

---

## Agent behavior

These govern how an AI agent works in this repo.

- **Read first; ground claims in inspection.** Read the relevant architecture section and the code before
  proposing changes. No speculation presented as fact. Where the architecture is genuinely ambiguous, **ask** —
  do not invent a decision.
- **Surface root cause — Critical findings.** On discovering any of the following, list it under a **Critical
  findings** heading _before_ proceeding; do not silently work around it:
  - an architectural violation (a consumer calling another consumer sideways instead of through the spine; a
    backend SDK import leaking into the core; a model call on a critical path),
  - hidden coupling (one module holding a map of another module's responsibility),
  - duplicated responsibility (two systems owning the same projection or state),
  - scope creep into something the roadmap deliberately defers,
  - temporary logic becoming permanent (a knob hardcoded as a bare literal, a stub in a shipping path),
  - a claim in the docs that the code contradicts.
- **Communicate high-level changes** after edits — what changed and why, briefly.
- **Bias:** root-cause fixes over shortcuts. Modular, swappable, neat. Production-ready or surfaced as a finding.

---

_Last reviewed: 2026-08-11_

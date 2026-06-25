# SPEC.md — coa, the module-organized single source of truth

**Date:** 2026-06-24 · **Status:** the assembled, self-contained SPEC — one of the three handoff docs
(`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`). It is organized by module (M0–M10); each module section states
its responsibility, public interface, dependencies, and every owned decision in final form. Plain language;
synthetic examples only — no real secrets or personal data.

## What coa is

coa is a [PLANNED] **local-first, single-user governance/audit layer over a rented Claude Agent SDK loop.** It does
not contain its own model loop; it **rents** a Claude Agent SDK agent loop and governs it — supplying the agent's
context, constraining its tools, grounding its reads against project truth, capping cost, and keeping an honest
record of what it cost and changed. It is a long-lived **daemon** plus thin clients. Its value is **WITH-MODEL**:
it appreciates as the model improves — the better the agent's judgment, the more you want a record, guardrails, and
sound context rather than raw capability. v1 is **attended** (a human is present) and **Claude-locked** (one
backend, behind a swappable port).

---

## How to read this doc set

There are exactly three handoff docs, and together they are self-contained — **everything a downstream agent needs
to build v1 coa is in these three docs; no planning-corpus file is required.**

- **`SPEC.md` (this doc) — the WHAT, by module.** The eleven modules M0–M10, each with its responsibility, public
  interface, dependencies, and owned decisions in final form. Build a module from its section plus the published
  interfaces of the modules it depends on.
- **`IMPL-SPEC-BRIEF.md` — the build order + the v0 spike gate.** The topological build order over these modules,
  the build-and-packaging requirements, and the single pre-build calibration spike that gates _magnitude_ (never
  soundness). Run the spike before any Context-Engine (M4) milestone.
- **`OPEN.md` — deferred scope + tuning knobs + open risks.** What is NOT in v1 (and what would promote it), the
  numbers the v0 spike calibrates, the named open risks, and the one thing rejected outright. Build nothing in
  `OPEN.md` for v1; check it before adding scope.

---

## §A. The module map

### A.1 The eleven modules (one line each)

| ID      | Module                   | Responsibility (one line)                                                                                                                  | Durability           |
| ------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| **M0**  | Shared Schema            | define the canonical wire/record types every module agrees on, so no two modules invent their own                                          | SUBSTRATE            |
| **M1**  | Change Kernel            | be the single source of truth for "what changed" — the durable WAL + the live typed dependency graph and its symbol index                  | SUBSTRATE            |
| **M2**  | Code Lens                | turn source bytes into structure (parse / canonicalize / extract symbols / decide tier) — the one pure, graph-free byte→structure function | SUBSTRATE            |
| **M3**  | Constraint & Flag System | run every check as a pluggable producer into one pipeline; tag, dedup, and surface flags to two audiences; own the one constraint block    | WITH-MODEL           |
| **M4**  | Context Engine           | keep the agent working against project truth — generate SSOTs, assemble capped context, ground in-flight, detect residual drift            | WITH-MODEL           |
| **M5**  | Config Compiler          | compile composed Pieces + capability frame into one backend-NEUTRAL config, cache-stably                                                   | WITH-MODEL           |
| **M6**  | Workbench                | present the governed tool surface the loop calls, and route every precise write into the kernel as a change-event (producer ①)             | WITH-MODEL           |
| **M7**  | Governance & Audit       | bound and record what the loop costs and changes — the cost cap, the secret-clean ledger, the visibility floor, the Decision log              | WITH-MODEL + NEUTRAL |
| **M8**  | Daemon Orchestration     | be the always-on process shell — transport, session lifecycle, worktree binding, subagent orchestration, the daemon host                   | SUBSTRATE            |
| **M9**  | Runtime Adapter          | be the one place backend-specific behavior lives — implement the capability ports and render M5's neutral config to backend-native         | NEUTRAL              |
| **M10** | Console                  | present coa to the human — CLI verbs first, the pull/inspector GUI, and the honest `coa raw` escape                                        | NEUTRAL              |

### A.2 The dependency graph (one line per module; acyclic)

Read `A → B` as "A depends on / calls into B." Producers and consumers point _into_ the kernel (M1); nobody points
sideways.

```
M0  Shared Schema         → (nothing)                                   [root]
M2  Code Lens             → M0                                          (PURE byte→structure; graph-free)
M1  Change Kernel         → M0, M2          (M1 calls M2.parse/extract to BUILD its graph+index; M2 never reads back)
M3  Constraint & Flag     → M0, M1, M2      (+ handed an M9 ref BY M8 for the deny/reminder channel — injected, not compile-time; M4 registers producers INTO M3)
M4  Context Engine        → M0, M1, M2, M3
M5  Config Compiler       → M0, M4          (reads M4's assembled context; backend-NEUTRAL output only)
M6  Workbench             → M0, M1, M2, M3, M4, M7   (M6→M7 = get_decision/why/context_status reads)
M7  Governance & Audit    → M0, M1
M9  Runtime Adapter       → M0   (+ handed M3/M4/M5/M6/M7 refs BY M8 at session build — not compile-time deps)
M8  Daemon Orchestration  → M0, M1, M4, M5, M7, M9   (the hub; calls M5.compile, has M9 render, wires closures)
M10 Console               → M0, M8
```

**The verified topological order (acyclic):**

```
M0 < M2 < M1 < M3 < M4 < M5 < M7 < M6 < M9 < M8 < M10
```

(M7 before M6 because M6→M7; M5 after M4 because M5→M4; M9 after everything it is handed because those refs are
runtime-injected by M8, not compile-time — M9 itself depends only on M0 + the `spi` port types.) The two edges that
could have cycled are both resolved: **M1↔M2** (the symbol table / fuzzy index / piece-resolver live in M1 as graph
projections, so the single edge is M1→M2 and M2 never reads back — which is why M2 sorts _before_ M1); and **M9's
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
   band-3 box and M7 draws a solid arrow _into_ the waist (consume) or _up from_ a producer (emit) — never sideways.
5. **Left margin — M7 Governance & Audit** (cost cap ⬡ · ledger · visibility floor · sandbox + process-isolation
   posture · Decision log), a solid arrow into M1, dashed arrows to M8 (cap/sandbox at launch) and M3
   (visibility-floor surfaces). A thin arrow M6→M7 ("get_decision / context_status reads").
6. **Bottom margin — the two SUBSTRATE leaves.** **M2 Code Lens** (tree-sitter tiers · G0 · per-file extraction ·
   neutral-floor tiering) with a single arrow _up into_ M1 (only M1 calls M2 now, since the index moved to M1).
   **M0 Shared Schema** as a thin base under everything.

**The reading:** the double-line spine (M1) is the only thing in the middle and now also holds the symbol index;
producers above-left emit into it, consumers draw from it; M5 compiles neutral config that M9 renders to the one
backend; the human (M10) only ever talks to M8. That hourglass _is_ the two-producer change-event thesis.

### A.4 The logical → physical package map

| Logical module          | Physical home                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 Shared Schema        | `shared` package                                                                                                                                                                                                      |
| M1 Change Kernel        | `core` — the **spine** ring (WAL, bus, graph, symbol table / fuzzy index / piece-resolver, projections)                                                                                                               |
| M2 Code Lens            | `code-intel` package (the child-process parser seam) — purely byte→structure                                                                                                                                          |
| M3 Constraint & Flag    | `core` — a **consumer/projection** (flags) + the gate service                                                                                                                                                         |
| M4 Context Engine       | `core` — **consumer/services** (staleness consumer + context-engine/assembly/grounding/generation services)                                                                                                           |
| M5 Config Compiler      | `core` — its own `core/compiler/` service boundary (`compile(pieces) -> NeutralConfig`); NOT in `adapter-claude-sdk` because its output is backend-neutral; promotable to a standalone `compiler` package if it grows |
| M6 Workbench            | `core` — the **producer** (Mutate) + the `mcp/` outer-ring surface                                                                                                                                                    |
| M7 Governance & Audit   | `core` — **consumers** (cost ledger, provenance, decision log) + policy service (sandbox/process-isolation posture)                                                                                                   |
| M8 Daemon Orchestration | `core` — the **services + `rpc/`** outer ring (transport, session, worktree, daemon host)                                                                                                                             |
| M9 Runtime Adapter      | `spi` (ports) + `adapter-claude-sdk` (impl: the neutral→native renderer, the TS-LSP backend, the SDK loop)                                                                                                            |
| M10 Console             | `app` (Electron) + `cli` packages                                                                                                                                                                                     |
| Build & Packaging       | not a runtime package — `tsdown` config, the probe specs, supply-chain CI gates, `pnpm-lock.yaml` (see `IMPL-SPEC-BRIEF.md` §3)                                                                                       |

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
- **P7 — mutation chokepoint.** Every write becomes a change-event via `M1.emit`; there is no side-door write.
  Realized jointly in M1 + M6.
- **P8 — compose, don't reinvent.** Orchestrate existing generators/checkers/SDK features; invent no parallel
  machinery. M4 GENERATION orchestrates existing generators; M9 reuses the SDK sandbox; M5 composes over the D104
  assembly line, not a naive concat.
- **SC-1 — help-not-cage.** coa is advisory everywhere. The ONLY two blocks in the whole system are **M3's Type-1
  close-gate** (unresolved Type-1 ∧ high-severity flags) and **M7's cost-cap**; both are issued through **M9's
  single `interceptTool` / `canUseTool` deny channel**. Everything else — grounding, detection, reminders, the
  SemVer gate, the visibility floor — is advisory or surfacing, never blocking.
- **D85 — strict-superset.** coa is a strict superset of the bare Claude Agent SDK loop: every feature either adds
  value or degrades to a literal pass-through. Every module degrades to a floor (coa with a feature off is never
  worse than the raw loop), and **`coa raw` never hides the raw loop** (M10's floor that proves the superset).
- **The change-event spine (M1) is the only shared mutable substrate.** Two producers write into it (the precise
  Mutate tool in M6 and the git-centric reconciler in M1); it appends one canonical change-event to the durable
  log; every other module is a _consumer_ that reads projections. Producers and consumers point **only at M1**,
  never sideways at each other. This is the single discipline that keeps the rest independently buildable.

---

## §C. The module specifications

The eleven module specifications follow in module order (M0, M1, M2 → M3, M4 → M5, M6 → M7, M8 → M9, M10). Each is
a uniform subsection: **identity · public interface · depends-on · owned decisions in final form.** Every owned
decision is restated in final form and is self-contained.

### M0 — Shared Schema (`shared`)

#### Identity

- **ID:** M0 · **Responsibility:** define the canonical wire/record types every module agrees on, so no two modules
  invent their own. · **Durability:** SUBSTRATE. The acyclic-graph root.

#### Public interface

Type definitions only — **no behavior**. Imported by every other module. The exported type families:

- `ChangeEvent` — the change-event log line frame (see D126 clause 1 below) and its in-memory form.
- `FlagRecord` — the SARIF-subset flag record (see D11 below).
- `Piece` — the composable content-atom type (Knowledge / Protocol / Behaviour / Role).
- `CapabilityProfile` — the adapter capability-profile manifest shape.
- `RpcPayload` schemas — the JSON-RPC 2.0 request/response/notification payload shapes, as Zod schemas.
- `GraphNode` / `GraphEdge` / `EdgeType` / `SymbolRecord` / `GraphView` — the typed-dependency-graph and
  symbol-table schema (types only; M1 owns the live runtime).
- The JSON-RPC + tool-return **byte-grammar types** — the schema half of the wire grammar (the _policy_ over that
  grammar lives in the daemon module M8; the human-facing command grammar lives in the console M10).

#### Depends-on

Nothing. M0 is the acyclic-graph root.

#### Owned decisions (final form)

- **Flag record schema (D11 + CF-1/CF-2/CF-7) — LOCKED.** The one record every check-producer emits and every
  consumer reads, a SARIF-subset:
  `{ ruleId, location, severity, message, fix?, fingerprint, type, confidence, concern-key }`. **M0 owns these
  fields; the LOGIC that assigns `severity`, `confidence`, `type`, and `concern-key` is M3's** (D134 severity
  projection + CF-2 two-axis assignment + CF-7 dedup — see M3 below). The field semantics M0 fixes:
  - `severity` and `confidence` are **two independent axes** (CF-2): severity = how bad if real; confidence = how
    sure it is real. A flag is never collapsed to one number. _The values are assigned by M3, not M0._
  - `type ∈ {1, 2}` is **producer-stamped** (the producer that emits the flag sets it; no consumer holds a
    `producerId → type` map). Type-1 = deterministic, gate-eligible; Type-2 = judgment/advisory, never blocks.
  - `concern-key` is the **cross-producer dedup key**: two producers flagging the same underlying concern collapse
    to one feed item via this key. _The dedup logic that uses it is M3's CF-7._
  - `fingerprint` is the stable identity used for baselining/suppression (a suppression is keyed on it).
  - `fix?` is an optional deterministic auto-patch payload.
  - The `severity` slot is fed by M3's **spec-drift severity projection** (D134); M0 owns only the slot.

- **Change-event log line frame — D126 clause 1 — LOCKED.** The durable
  log is **NDJSON**: one Zod-validated change-event per `\n`-terminated line, single-writer (the daemon). Each
  frame:

  ```jsonc
  {
    "schema_version": 1, // every frame self-describes; the reader upcasts before any projector sees it
    "seq": 4711, // monotonic per-log; the consumer cursor key + gap detector + projector ordering key
    "ts": "2026-06-23T22:00:00.000Z", // recorded, NEVER the dedup boundary
    "kind": "modify|create|delete|rename|confirm",
    "path": ".../redact.md",
    "pre_hash": "<sha256|null>", // the causal transition key (null for create)
    "post_hash": "<sha256|null>", // (null for delete)
    "op_id": "<ulid|null>", // stamped by the precise Mutate producer; null for a pure reconciler observation
    "provenance": "declared|inferred|gated", // the provenance quality spectrum
    "generated": false, // true ⇒ a reconcile-include gitignored path (lower trust, inferred)
    "worktree": "<id>", // attribution / rewind unit
    "actor": "<session|reconciler|human>",
  }
  ```

  Three rules baked into the frame for the two-producer log: (a) **causal dedup, not time-window** — a disk
  observation matches a precise event as a _confirmation_ on `(path, pre_hash, post_hash)`; the wall-clock `ts` is
  a coalescing hint only, never the correctness boundary; (b) **schema evolution** — `schema_version` lets the
  reader run an upcaster chain (called **"frame schema migration,"** not "upcaster" — word-collision with a cut
  CQRS term avoided) before any projector sees an event; (c) the frame is consumed strictly in ascending `seq`.

- **Piece type (D101 / D5-as-renamed) — LOCKED.** A `Piece` is one composable content atom of kind
  `knowledge | protocol | behaviour | role`. On disk a piece is YAML front-matter + a Markdown body, a strict
  superset of a Claude Code `SKILL.md`. Front-matter carries CC-native keys that round-trip verbatim (`name`,
  `description`) plus coa-only keys: `kind`; `force: authority | reference` (Knowledge only — **authority** = a
  rule the agent must obey, **reference** = info read on demand); `persistence: ephemeral | resident` (Protocol
  only); `triggers`; `scope`; `provenance: {source, version|hash, trust}`; `bundle: <name>@<version>` (SemVer).
  **No volatile keys** (timestamps/counters/IDs) ever appear in front-matter — that would bust the prompt cache.
  The Markdown body IS the content. M0 owns only the _type_; composition/compilation is the config-compiler M5.

- **Capability-profile manifest shape (D62 / D109) — LOCKED.** The `capability-profile.yaml` shape: the set of
  capability **ports × {present | absent + declared null-fallback}**, per runtime × model, plus an `spi_version`
  string. (D109 is the rule that the core calls capability ports and takes a defined null-fallback when a port is
  absent, never a `which-backend` branch — M9 implements the ports against the Claude Agent SDK.) A `degradation:`
  block reports each fallback relative to the integrity floor (the provenance-blind reconciler), so a missing port
  reads as _honest-and-safe_, never as a recipe to disable a control. M0 owns the manifest _shape_; M9 owns the
  ports.

- **JSON-RPC payload Zod schemas (D124) — LOCKED.** The request/response/notification payload schemas for the
  daemon protocol: OS-socket transport carrying JSON-RPC 2.0 + Zod-validated payloads, with notifications for
  server→client push. M0 owns the _schemas_; the transport and lifecycle are the daemon module M8.

- **Graph / symbol-table schema + `GraphView` (minor-pin F) — LOCKED.** The node/edge/symbol-record types and the
  read-only `GraphView` interface, **types only**. The graph is a typed dependency graph (D16): nodes = pieces,
  project files, constraints, code, tool/library versions, derived artifacts, work-artifacts, scopes; edge types =
  `documents | covers | imports | derived-from | depends-on | watches`. `depends-on` is a DAG (D50: a declared edge
  that would create a cycle is rejected; inferred code-import cycles collapse into a strongly-connected-component
  super-node; `watches` may cycle freely). A `SymbolRecord` is the per-symbol fact (name, signature, defining
  location, scope). Defining these types in M0 (not M1) is what lets M2 and every consumer compile against the
  schema without depending on M1's runtime.

- **JSON-RPC + tool-return byte-grammar TYPES (D127, schema half) — LOCKED.** The TYPES of the command / JSON-RPC /
  tool-return byte grammar. The _wire policy_ over this grammar (collision defense, distilled-return discipline,
  the guardrail that a `listChanged` notification does not mutate the cached prefix) is owned by the daemon M8; the
  _human-facing_ `coa <verb>` command grammar is owned by the console M10. M0 owns only the byte-grammar types —
  the schema third of the three-way D127 split.

**Fold-ins applied (M0).** D126 re-scoped at SPEC time to the **internal D109 port** (cleanup M-2): the
on-disk/byte format encodes the internal capability port, NOT the public/semver'd SPI, which is deferred. The
`spi_version` string remains but the public adapter SPI/registry/marketplace are out of v1 scope. "upcaster"
renamed to **"frame schema migration"** (word-collision with a cut CQRS term).

---

### M1 — Change Kernel (the narrow waist) — `core`/spine ring

#### Identity

- **ID:** M1 · **Responsibility:** be the single source of truth for "what changed in the repo" — append every
  change to a durable log, and serve the live typed dependency graph **and its name/symbol index** that every
  consumer reads. · **Durability:** SUBSTRATE (and the moat: ambient persistent private memory + time-travel live
  here).

#### Public interface (the only contract that matters)

- `emit(changeEvent) -> seq` — producer-side append. The two producers: the precise Mutate path (the workbench M6)
  and the git-centric reconciler (owned here, producer ②).
- `subscribe(cursor, consumerFn)` — consumer-side feed. Idempotent; each consumer keeps its own per-log WAL cursor
  (the `seq`) and replays from it on restart.
- `graph.query(...)` — synchronous hot-graph reads: proximity, depends-on, provenance, symbol-presence, recency.
- `lookup(name) -> SymbolFacts | miss` — O(1) symbol-table read (the graph's node-set index).
- `fuzzyMatch(name) -> ranked candidates` — the miss-path nearest-match over the fuzzy index.
- `resolvePiece(ref) -> Piece` — the pure piece-resolver over the graph + symbol table.
- `scheduleIdle(job)` — register an idle-time job on the daemon idle scheduler.
- `checkpoint() -> handle` / `rewind(scope)` — pointer-tuple checkpoints + git-pathspec-scoped restore.

#### Depends-on

- **M0** (the types).
- **M2** — M1 calls `M2.parse` + `M2.extractSymbols` to BUILD its graph and index on reparse. This is the ONLY
  M1↔M2 edge and it points M1→M2; M2 never reads back.
- Producers (M6) and consumers (M3/M4/M5/M6/M7) depend on M1; M1 depends only on M0 + M2. This is the
  `producers → spine ← consumers` invariant made a logical rule.

#### Owned decisions (final form)

- **D81 two-producer change-event model — LOCKED.** Every repo change becomes ONE canonical change-event with
  **two producers** feeding one narrow waist: ① the **optimistic precise** producer (the typed Mutate tools —
  cheap, attributed, preferred but not mandatory) and ② the **authoritative reconciler** (provenance-blind,
  universal — catches manual edits, formatters, bash). N consumers read the resulting log. Integrity is guaranteed
  by the reconciler, NOT by tool-exclusivity — "all interaction routes through tools" is explicitly NOT the
  guarantee. Provenance is a quality spectrum (`declared | inferred | gated`), not a boolean.

- **D120 event-sourced spine — LOCKED.** On a change-event: **synchronous** WAL append → **synchronous** in-memory
  graph update (the hot read path) → **asynchronous** heavier projections off idempotent per-consumer WAL cursors.
  Two-producer dedup is reconciler-authoritative: a disk observation matching a recent precise event by
  `(path, post_hash)` is a _confirmation_; an unmatched observation is an _inferred_ event. The daemon is
  single-threaded JS, which makes the projector ordering contract cheap to honor: every projector consumes in
  strictly ascending `seq`; coalescing may drop superseded events for the same `path` but must never reorder across
  two paths that share a graph edge.

- **D94 WAL durability + crash recovery — LOCKED.** The change-event log is the **durable WAL** and the source of
  truth: ordered append + `fsync` at the reconcile-batch boundary (one fsync per coalesced batch), with a
  torn-tail-tolerant reader (a trailing line lacking its `\n` is discarded on startup). Segment
  rotation/compaction (and only that) uses write-new-segment-then-`rename`. All graph/flag/staleness/recency state
  are **rebuildable projections**. The provenance-blind reconciler **doubles as crash recovery**: on restart it
  re-observes disk and replays the WAL; an orphaned git anchor (rebase/force-pull) triggers a full rescan; event
  storms debounce/coalesce.

- **D116 storage realization — LOCKED.** Append-only change-event log file (the WAL) + **SQLite projections** + an
  **in-memory hot graph**. Committed config = plain files. The SQLite projection DB runs in SQLite's own WAL
  journal mode; the recommended default is to treat the projection as **reconstructible-not-durable**
  (`synchronous=NORMAL`) and lean on the change-event log + reconciler for durability — a power-loss rollback of
  the projection is harmless because a replay re-derives it. The SQLite `-wal` file must stay co-located with its
  DB (separating them can corrupt it) — a constraint any backup/copy of the projections must honor.

- **D123 git-centric reconciler (producer ②) — LOCKED.** Truth resolution is git-centric: a file watcher scopes
  dirty paths → a scoped `git status`/`git diff` → content-hash dedup → emit change-events. It **respects
  `.gitignore`** by default (so engine internals are excluded for free — the property that lets coa handle any
  project type), is provenance-blind, and its crash-recovery is WAL replay + full disk rescan.

- **D136 reconcile-include — LOCKED.** For gitignored _generated_ files the user opts in via a `reconcile-include`
  glob: the reconciler **skips the `.gitignore` filter** for those globs (watch + hash the path) and stamps the
  resulting events and graph nodes/edges `generated: true` (lower trust, `inferred` provenance). This is what lets
  the grounding layer treat generated-but-not-committed symbols as existent.

- **The typed dependency graph (D16, D49–D54, P4) — LOCKED.** The graph (schema in M0) is M1's central projection,
  viewed many ways (P4: cache prefix, staleness graph, provenance, agent-linking are one structure from different
  angles). Decisions:
  - **D49 persistence:** declared semantic edges are authored → **committed** (the portable bundle); inferred
    structural edges are derived from code → **local**, rebuilt (`.coa/local/`); re-entry rebuilds the inferred
    half from the git diff.
  - **D51 inference limits (honest):** per-language AST/import parsing gives the cheap ~80% structural graph; it
    cannot see dynamic imports, DI, string-keyed lookups, reflection, or codegen — those gaps are filled by
    declared edges.
  - **D52 identity/lifecycle:** pieces/artifacts/scopes/tool-versions have stable IDs; code nodes key on
    path + rename-tracking (git rename detection, content-hash fallback) so edges follow renames; deleting a node
    flags its dependents with a "dependency removed" staleness flag.
  - **D53 granularity — TWO LAYERS:** (1) the **dependency/staleness graph is file/module-level** (drives
    constraints + staleness + spec-conformance); (2) a **symbol-level index is a separate layer** used for
    navigation/grounding and does NOT drive staleness.
  - **D54 propagation — confirmation-gated transitive:** direct (1-hop) dependents flag eagerly and cheaply;
    propagation past a node happens only once it is confirmed actually affected, or the full cone is computed
    lazily on demand; edge-type + semver rules can stop a hop. Prevents one small change cascading 50 nodes stale.
  - **D32 scopes — named, glob-now / graph-later:** a **scope** is a named file-set, declared
    `@payments = [globs]` (with `!exclude`), that becomes a first-class graph node. Scopes target constraints,
    permissions, concurrency, and context selection; concurrency overlap is the set-intersection of their file-sets.
    Other modules read scope membership as a deterministic graph query (M3's confidence axis, M4's ASM-1 seed/S2
    signal, M8's coupling-aware fan-out all consume it).

- **The graph's index — symbol table + fuzzy index + piece-resolver (in M1) — LOCKED.**
  - **Symbol table:** the resident `name → SymbolRecord` map the daemon holds. It **IS the graph's node-set
    index** — that is precisely why it lives in M1 and not in M2. M1 builds it by calling `M2.extractSymbols` on
    each reparse and indexing the per-file records into the live graph. `lookup(name)` is an O(1) hash-map read.
  - **Fuzzy index:** a BK-tree / trigram structure over the symbol identifier strings, built/maintained on the
    daemon's **idle time** (registered via `scheduleIdle`). It is queried **only on a `lookup` miss** (the hit
    path is one map lookup; only the rare miss pays for fuzzy search). `fuzzyMatch` ranks candidates by a composite
    of cheap deterministic signals: edit distance, graph/scope proximity, **rename provenance from the WAL** (the
    strongest signal — coa _knows_ a name moved, e.g. `chargeCard → capturePayment` in a logged rename, so it isn't
    guessing), and signature similarity. Each candidate carries an explicit confidence.
  - **Piece-resolver (D101):** `resolvePiece(ref)` is a **pure resolver over the graph + symbol table** —
    byte-identical output regardless of caller (the workbench's `get_piece` tool and the config compiler call the
    same resolver). It reads M1's own graph, which is why it is an M1 projection, not an M2 byte function.

- **Checkpoint / rewind (D76 / D97 / D98) — LOCKED.** A **per-worktree non-destructive undo-tree** over the
  substrate that already exists (git + the WAL + the conversation layer + the typed graph) — no new primitive. A
  checkpoint is a **pointer-tuple** pinning a WAL retention floor; `checkpoint()` auto-fires at prompt boundaries.
  - **D97 git-primary substrate:** git is the primary, integrity-grade, provenance-blind rewind substrate (it
    catches bash/manual/external changes); rewind **re-materializes the working tree and NEVER rewrites
    committed/pushed git history** (history-rewrite is an explicit escape action). Rewind is re-entry
    reconciliation sharing the D94 WAL + reconciler substrate.
  - **Scoped rewind:** `rewind(scope)` is a **git pathspec over one tree** (`code | artifacts | conversation` +
    path); projections always rebuild to follow; dangling refs become staleness flags. The escape set (outward
    side effects) is the **per-effect rewind boundary** — below it rewind is free and total; crossing it rewinds
    local state only and **never auto-undoes an outward action** (compensation is a fresh, gated action — the Saga
    pattern).
  - **D98:** the timeline is a hidden-ref DAG distinct from git branches; the agent never marks or prunes; `pin`
    is **human-only** (bookmark + anti-prune); forks are anonymous-by-default with a 30-day scratch prune; the
    checkpoint→eval-corpus feed is a deferred dormant seam.

- **The minimal signal bus (D75 / D83) — LOCKED, kept minimal.** A WAL-fed projection that exposes a queryable
  stream of events (the sensor layer for the adaptability and self-improvement loops). Events conform to
  **OpenTelemetry** semantic conventions, emitted by a lightweight in-house emitter (no OTel SDK/collector in v1;
  an exporter is a later capability).

- **The daemon idle scheduler — LOCKED.** A `scheduleIdle(job)` service. The shared idle primitive has
  three-plus registered consumers: GENERATION regen, GROUNDING fuzzy-index build, ASSEMBLY pre-build (all in M4),
  and the detection sweep. Idle pre-compute is exactly why the daemon is kept resident.

**Fold-ins applied (M1).** The symbol table, fuzzy index, and piece-resolver are **in M1** (post-stress-test):
they all read the graph, so placing them in M2 would create a hidden M2→M1 back-edge. They are graph projections;
M1 builds them by driving M2's byte-pure functions. D135 ledger-privacy / prose-bearing fields: change-event frames
may carry prose-bearing path/actor data and stay **WAL-local**; only an allow-listed projection (owned by the
governance module M7) is sync-eligible.

---

### M2 — Code Lens (pure byte→structure) — `code-intel`

#### Identity

- **ID:** M2 · **Responsibility:** turn source bytes into structure — parse to a tree, canonicalize, extract
  per-file symbols, and decide the language tier — as the one deterministic, language-tiered, **graph-free**
  function of bytes every higher layer shares. · **Durability:** SUBSTRATE.

#### Public interface (graph-free, byte-pure)

- `parse(file) -> CST` — produce a concrete syntax tree.
- `canonicalize(artifact, profile) -> CanonicalForm` — the **G0** shared "equal modulo formatting?" primitive.
- `extractSymbols(CST) -> SymbolRecord[]` — per-file, byte-local symbol records (M1 builds the resident table from
  these; M2 itself never holds a resident table).
- `tierFor(file | profile) -> Tier` — the neutral-floor / bounded-layer tier decision for a file or profile.

#### Depends-on

**M0 only.** Every method takes bytes / a CST / an M0 type and never reads the graph. (The graph-dependent methods
that earlier drafts placed here — the symbol table, fuzzy index, piece-resolver — are M1's now.)

#### Owned decisions (final form)

- **D112 extractable code-intel seam — LOCKED.** The code-intel engine sits behind an extractable module boundary
  and runs the tree-sitter parser as a **separate child process** (a Rust-sidecar seam, kept-not-built in v1; the
  v1 build uses a TypeScript host driving tree-sitter in a worker/child process). The seam exists so the parser
  can be swapped or isolated without touching callers, and so a native-addon crash on a hostile file does not take
  down the whole daemon.

- **D115 tree-sitter tiers + pluggable format adapters — LOCKED (handles any project type, incl. Godot/GDScript).**
  Code-intel is **tiered**: Tier 0 = universal (works on any text), Tier 1 = outline, Tier 2 = tags/refs where a
  grammar exists. Format adapters are pluggable. Fuzzy-refs are backed by the flag/gate pipeline; LSP is deferred
  to a capability port with a null-fallback. The explicit v1 goal: handle any project type, including non-code /
  game-engine projects — mechanisms unchanged, only the goal is on the record.

- **G0 AST-canonicalizer — LOCKED.** `canonicalize` is the single 4-consumer shared primitive: it answers "are
  these two artifacts equal modulo formatting?" deterministically. The four consumers are: the detection
  formatter-null path, the regenerate-diff check, grounding normalization, and assembly freshness. It is a pure
  function of bytes + a profile; no model, no graph. (The detection layer's G0 suppression-pragma carve-out is
  owned by M4; M2 owns only the canonicalizer.)

- **Per-file symbol _extraction_ — LOCKED.** `extractSymbols(CST)` walks a parsed CST and emits the **byte-local**
  per-file `SymbolRecord[]` (name, signature/arity where the grammar affords it, defining location, scope). This
  is the byte-local half of the symbol story; the **resident symbol table that indexes the graph is M1's** — M1
  calls this function on reparse and builds the table from the records. M2 holds no resident state.

- **Neutral-floor / bounded-layer tiering — D146 clause 3 — LOCKED (the no-lock-in answer).** `tierFor` implements
  the language-agnostic contract: a **neutral floor that always works** (text/keyword/embedding retrieval +
  universal-ctags across 40+ languages + the tree-sitter _engine_) **plus a bounded high-fidelity layer that
  auto-engages where a grammar / language server / IDL exists and silently degrades — never breaks, just less
  precise.** coa never _assumes_ a stack; type-grounding and signature checks are **capabilities that light up**
  where the language affords them, not prerequisites. (The GENERATION layer's _use_ of this tiering is in M4; M2
  owns the _tiering decision_ itself.)

- **D144 tree-sitter fallback — LOCKED (the M2 half of the port/fallback split).** D144's precise
  **TypeScript-LSP backend** (runs `tsserver` as a managed subprocess for exact references/types) is a capability
  port owned by M9. **M2 owns the null-fallback floor:** every language for which the LSP port is absent degrades
  to M2's tree-sitter code-intel via the port's defined null-fallback. So the precise path is additive (TypeScript
  gets exact refs); every other language keeps M2's tree-sitter floor — no lock-in, no language is broken by the
  absence of a server.

**Fold-ins applied (M2).** The earlier placement of the symbol table / fuzzy index / piece-resolver in M2 is
**overturned** (they read the graph → they are M1's). M2 keeps only `parse` / `canonicalize` / `extractSymbols` /
`tierFor`, all genuinely byte-pure (M0-only dependency) — which is what makes M2 fully standalone and buildable
before M1. D144 split applied: port → M9, tree-sitter fallback floor → M2. D146 clause 3 (neutral-floor /
bounded-layer **tiering**) is M2's; the GENERATION re-bill _use_ of it is M4's.

---

### M3 — Constraint & Flag System

#### Identity

- **ID:** M3 · **Responsibility:** run every check as a pluggable producer into **one** pipeline (P2), tag each
  flag with a **type** and a **two-axis severity×confidence**, dedup across producers, and surface results to **two
  audiences** under one contract — the user always sees everything (progressive disclosure), the agent gets a
  gated, grouped injection. M3 owns the single legitimate constraint **block** (the close-session gate) and
  **decides** the authority reminder; the physical delivery of both is M9's. · **Durability:** WITH-MODEL.

**Coordination note (flag-record fields vs assignment logic).** The flag-record FIELDS
(`severity` / `confidence` / `type` / `concern-key`) are **M0's** schema (see M0's D11 block). The **LOGIC that
assigns them** — the D134 severity projection and the CF-2 two-axis assignment, plus the CF-7 concern-key dedup —
is **M3's**, stated below. M0 owns the slots; M3 fills them. No duplication, no contradiction.

#### Public interface

M3 exposes exactly these methods. All flag records conform to the M0 schema.

- `registerProducer(producer)` — admit a producer of shape
  `{ id, kind, activation, run(scope|change-event|tool-call) -> Flag[], fix?(flag) -> Patch, envelope?(flag) -> ContextSlice }`.
  The add-path is gated by the validation pipeline (CF-6); there is no raw drop-in. `kind ∈ {deterministic, judgment}`.
- `ingest(flag)` — a producer emits one flag; the pipeline dedups by `concern-key`, assigns the severity/confidence
  axes (CF-2), and fans out to the two audiences.
- `flagsForUser(scope) -> FeedView` — crit/high severity expanded; med/low **collapsed-but-counted, never hidden**.
- `flagsForAgent(scope) -> InjectionBundle` — high-confidence ∧ (crit|high severity) flags only, grouped, deduped
  by concern-key. Consumed by M4 (for the assembled-package header) and M6 (for tool-return enrichment).
- `gate(sessionCloseRequest) -> allow | block(flags)` — the **one** deny: blocks only on unresolved **Type-1 ∧
  high-severity** flags, with a cost-cap on its own checking. Type-2 never blocks.
- `runValidator(selection)` — the user-invoked flag-validator (CF-5): judges a selection of Type-2 flags,
  auto-grouped by shared context.
- `submitFeedback(flag, reason)` — the typed-reason triage channel (D131) that records why a flag was acted on /
  dismissed; seeds future constraint proposals.
- `reminderFor(escapeEvent) -> {rule, reason}` — the authority-reminder **decision** (D133): which rule to inject
  and when. M9 physically delivers it on `role:system`.

#### Depends-on

- **M0** — the flag-record schema and `GraphView` types.
- **M1** — flags are change-event consumers via `subscribe`; an auto-patch emits a change-event back via `emit`;
  Type-1 checks read `graph.query` and the symbol index.
- **M2** — `canonicalize` for Type-1 byte-compares.
- **M9 (injected, not compile-time)** — M3 issues the only `canUseTool` deny and decides the D133 reminder, but
  reaches the adapter through an M9 reference **handed to it by M8** at session construction (D121 closures). M3 has
  no compile-time edge to M9.
- M4 **registers producers into** M3; M3 does **not** depend on M4. The `type` field is **producer-stamped on the
  M0 record** — M3 reads it and holds no `producerId → type` map, so the M3↔M4 inversion does not leak.

#### Owned decisions (final form)

**P2 — one pipeline, pluggable producers.** Locked invariant, realized in M3. Every check (typecheck, format,
custom rule, staleness, grounding, generation-drift) is a producer emitting into one pipeline against one schema;
there are no per-producer side channels. Fold-in: `registerProducer` is the only add-path; `ingest` is the only
emit-path.

**The F3 pipeline core (D9–D17, D30, D31, D38, D40).** Locked. This IS the constraint/checker engine — SARIF-subset
flag records, a registration gate that requires golden examples (a good case + a bad case) before a constraint is
admitted, a baseline/suppress mechanism (D17: an existing violation can be baselined so only _new_ divergence
flags), and within-producer flapping/dedup (D34/D38). Fold-in: registration-gate and baseline live inside
`registerProducer` and `ingest`; D31 trust signals feed the confidence axis. The cited member decisions, in final
form (each is one producer/rule into this one pipeline):

- **D30 — the verification producer:** a distinct producer that runs the repo's tests / typecheck / build / linters
  and turns failures into flags; it is **diff-scoped + flake-tolerant** ("done" = conforms + fresh + works). It is
  the canonical Type-1 deterministic producer.
- **D31 — provenance-based trust:** trust is a field on a Piece/artifact's provenance — **local = trusted;
  cloned/imported = untrusted until reviewed/approved**; untrusted _executables_ run sandboxed until promoted (D148).
  This trust signal feeds the confidence axis and the sandbox policy; passive text is not treated as hostile.
- **D34 — failure/oscillation handling:** a terminal producer failure checkpoints + escalates (bounded auto-retry
  first); a patch↔counter-edit loop on one fingerprint is caught by the **flapping detector** and auto-demoted
  (CF-3). It is the oscillation half of the dedup story.
- **D38 — constraint-conflict detection:** at authoring time a new constraint is run against the existing set on a
  calibration corpus to surface contradictions/fix-interference _before_ acceptance; at runtime overlapping
  auto-fixes never blind-apply (they surface to the agent) and A↔B fix loops are caught by D34. An unresolved
  conflict becomes a flag a human resolves (disable / set precedence / narrow scope).
- **D40 — supported constraint-authoring pipeline:** authoring is a first-class, scaffolded pipeline (project facts +
  AST tooling + the existing-constraint catalog + a fixture sandbox), not raw hand-editing — the substrate CF-6's
  preconfigured authoring-agent runs on.

**D11 flag schema + CF-7 cross-producer dedup.** Locked (CF-7 adopted). The record is the SARIF subset
`{ruleId, location, severity, message, fix?, fingerprint, type, confidence, concern-key}` — **the fields are
defined in M0; M3 assigns the values.** CF-7 IS the rule that the `fingerprint` is extended with a `concern-key` =
`(normalized-location, problem-kind)`, so two producers flagging the **same underlying problem** (the typechecker
and grounding both flag a missing symbol at `charge.ts:42`) collapse to **one** flag carrying all contributing
`ruleId`s, surfaced once, tiered at the **highest** contributing severity/confidence. Fold-in: dedup runs in
`ingest` before fan-out; the concern-key is conservative — collapse only when problem-kind matches, accepting
occasional under-dedup over a wrong merge.

**CF-1 — two-audience surfacing (the centerpiece; replaces silent-until-confirmed).** Adopted. The old model hid a
flag from everyone until a silent agent confirmed it; that hid agent work from the user and let the agent judge
problems the user never saw. CF-1 separates the audiences: the **user** sees **everything** via **progressive
disclosure** (crit/high expanded; med/low collapsed into a counted, one-click-expandable group header — _collapsed
is not hidden, the count is always present, nothing is ever silently dropped_); the **agent** gets a **gated,
grouped** injection (only high-confidence crit/high enter the standing injection; med/low are withheld from the
agent's budget but remain fully visible to the user and available on `run_checks`). Fold-in: `flagsForUser` and
`flagsForAgent` are the two views; this supersedes the surfacing models of F4/grounding/assembly (their detection
machinery is untouched — only the visibility contract changes).

**CF-2 — two-axis severity × confidence (amended) — the assignment logic for M0's `severity`/`confidence`
fields.** Adopted. A single crit/high/med/low tier conflated _how much it matters_ with _how sure coa is_. CF-2
splits them into two deterministically-assigned axes (no model on the assignment path):

- **SEVERITY** {crit/high/med/low} — drives the **user's** prioritization and **gate-blocking** (only Type-1 ∧
  high severity blocks). A producer may bias a default (a tsc error defaults high; a formatting nit defaults low)
  but the **system** owns the final value — a producer cannot self-stamp crit.
- **CONFIDENCE** {high/low} — drives **agent-injection gating** (inject high-confidence) and **validation-need**
  (low-confidence Type-2 flags are the validator's targets).
- **Type-1 is always high-confidence** (its verdict is a fact); its severity is per-rule. **Type-2** confidence
  varies (rename-provenance from the WAL → high; a bare lexical near-miss → low) and severity varies.
- The projection composes cheap signals coa already has: verdict-type, **D134 severity** (below),
  evidence-determinism, cross-producer corroboration (the concern-key), measured per-rule precision (D135 ledger),
  and scope match (D32).
  Fold-in: agent injection ≈ high-confidence ∧ (crit|high severity); the exact cut-points are conservative starting
  numbers that self-tune as a Tier-2 knob (D107) off measured precision. Mechanism fixed; numbers calibratable by the
  v0 spike — the spike gates magnitude, not soundness.

**D134 — cheap severity projection (feeds CF-2's severity axis; fills M0's `severity` slot).** Locked. D134 IS a
deterministic structural score over the WAL — `lines_changed / node_size` plus a structural-shake signal (a
signature/arity/export change outranks a body-only edit). Fold-in: it is one input to the severity axis, never
load-bearing alone.

**Two constraint TYPES (fills M0's producer-stamped `type` field).** Locked (Ruling 17). **Type-1 —
deterministic:** verdict is a fact (parse/compare/match — prettier, eslint auto-fixable, tsc, a regenerate-diff, a
spec parser); the fix is often deterministic → **auto-patchable**; it **may block** the gate. **Type-2 —
judgment:** verdict is a probabilistic opinion (a staleness confirm, a grounding "did-you-mean", a
semantic-contradiction check); it **cannot auto-solve** and **never blocks**. The line is determinism-first (P1): a
producer is Type-1 **iff both its verdict and its fix are deterministic given the tooling present in this repo**,
else Type-2 — computed **per repo** (spec-conformance is Type-1 where a deterministic parser covers the symbol,
Type-2 where coverage is only guessable). **Tool-absent:** no deterministic tool for a concern → no Type-1 producer
for that repo; it falls to the floor (D85: coa without the check is coa, never worse) or to a Type-2 producer.
Fold-in: `type` is the producer-stamped M0 field.

**CF-3 — visible Type-1 auto-patch.** Adopted. When a Type-1 producer carries a deterministic `fix`, the patch
applies **visibly and coherently**: every auto-patch is a WAL change-event **and** a feed item ("formatted
`charge.ts`; eslint fixed 2 import-order issues") with a diff and a **one-action revert**; the agent is told via
PostToolUse `additionalContext`; a fix that the agent immediately re-reverts (a patch→counter-edit oscillation on
the same fingerprint, detected by the flapping detector) **auto-demotes** from auto-patch to a plain flag; a Type-1
fix only ever touches the **span of its flag** (a formatter formats, it does not refactor). Fold-in: auto-patch is
a `fix?(flag)` call wired through M1's `emit`; "deterministic" ≠ "correct," so a reliably-bad fix is proposed for
demotion via the visibility floor (D147, M7), never silently disabled.

**CF-4 — mid-session patch coherence.** Adopted (coherence-favoring policy). The danger: a background patch
rewrites a file the agent is mid-edit on → a clobber. The policy: (1) patch the agent's **own** writes at the
**Stop** turn-boundary, so the common case (format-on-save) is coherent by construction; (2) the patch is a
change-event, so the next read returns the patched content (read-your-writes); (3) if a background idle patch
unavoidably hits a file the agent still holds, the **next tool return carries a freshness notice** ("`charge.ts`
was auto-patched since you last read it @ WAL r-1188; re-read before editing") and forces a re-read; (4) **defer**
any patch to a file with an open uncommitted edit from the current turn to the next Stop boundary. Fold-in: the
brief within-turn view of un-patched output is harmless (the patch lands visibly at turn end); a clobber is
unrecoverable, so coherence wins.

**CF-5 — user-invoked flag-validator + auto-grouping.** Adopted. This **replaces** the silent auto-confirm. The
user points the validator at a **selection** of Type-2 flags (`coa validate <selection>`); nothing judges a Type-2
flag un-prompted. Before running, the validator **auto-groups by shared context** — flags whose `envelope()`
overlaps (same artifact / changed-symbol slice / spec) batch into **one** call with the union of their context (30
staleness flags across 5 docs → 5 calls), and flags needing different slices are **not** lumped even at the cost of
more calls (correctness beats token-saving). Per group it re-reads the bounded envelope and returns, per flag, a
verdict+confidence+one-line reason that updates the flag (confirmed stays/escalates, refuted resolves, uncertain
stays with the reason attached). Every run is a **feed event**. coa **proposes** the grouping with a token estimate
the user confirms/re-groups/trims; the total is bounded by selection × per-group cap and runs under the M7 cost
cap, degrading by coverage if the grouped spend would breach the cap.

**CF-6 — authoring via preconfigured agent + mandatory validation; NO raw drop-in.** Adopted. v1 constraint
authoring goes through a **preconfigured constraint-authoring agent + a validation pipeline**; constraints
**cannot** be raw-hand-authored. Flow: the user expresses intent in natural language → the authoring agent produces
a candidate checker (Type-1 if it can be made deterministic, else Type-2) **plus the golden examples** the
registration gate requires → the pipeline runs it against its golden pair (must pass the good case, must catch the
bad case), against the real repo (measures fire-volume + a precision estimate), classifies its type and an initial
severity/confidence, and **rejects back** anything that fails its golden gate or fires on everything. The loader
admits **only** constraints carrying the validation stamp; a hand-dropped raw rule file is **quarantined as
un-registered**. Cold-start value: v1 auto-wraps the repo's **existing** deterministic tooling
(eslint/prettier/tsc) as Type-1 producers needing no authoring. Smart/auto constraint-mining is **deferred** (the
seam is kept — the ledger records the patterns — but v1 does not auto-mine).

**CF-8 — the agent-awareness channel.** Adopted. The agent learns the constraints through **two existing**
channels, no new injection channel: (1) **standing** — the M4 assembled package carries the scope's
`active_constraints[]` + `open_flags(crit|high)[]`, injected at SessionStart and refreshed at UserPromptSubmit on
the D108 delivery channel, so the agent writes constraint-aware code from the start; only crit/high inject (med/low
ride a **count line** — "4 medium flags open in @payments — `run_checks`"); (2) **in-flight** — grounding's tool
return carries the symbol-specific constraint at the point of action. Fold-in: M3 produces `flagsForAgent`; M4 and
M6 carry it.

**The close-session gate (D108 enforcement authority + D17 baseline/suppress).** Locked. The gate IS the one place
coa blocks "done." It blocks **only** on unresolved **Type-1 ∧ high-severity** flags; Type-2 — however confident —
advises, never blocks. The block is issued as the M9 `canUseTool` deny on a "finish" action (or a Stop block), with
a cost-cap on the gate's own checking. D17 baseline/suppress lets a pre-existing violation be excluded so only new
divergence blocks. Fold-in: `gate(sessionCloseRequest)`; the only other legitimate deny in the whole system is M7's
cost cap.

**D107 — Tier-0 / Tier-A reminders; Tier-B wired-but-OFF.** Locked (Ruling 10). **Tier-0** IS the deterministic
re-surfacing of critical invariants via the native `role:system` channel (a research-validated floor). **Tier-A**
IS the deterministic trigger-term match (a named entity in the prompt activates the relevant reminder). The learned
**Tier-B** salience classifier is **wired but OFF** — not built until a measured A/B (D143) shows net-positive,
because the model is already good at attention and a salience predictor races a native channel. Fold-in: Tier-0/A
are the standing-injection selection logic behind `flagsForAgent`; Tier-B is a dormant hook.

**D108 enforcement (the M3 half).** Locked. D108 splits into delivery authority (M9: _where_ in the transcript,
head + tail-reinforce + non-spoofable `role:system`) and **enforcement authority (M3: the gate)**. M3 owns the gate
and **decides** _which_ flags block and _how insistently_ reminders fire; M9 owns only the physical delivery.
Fold-in: see `gate` and `reminderFor`; the minor-pin is **M9 = mechanism, M3 = decision**.

**D139 — determinism→judgment promotion trigger.** Locked. D139 IS the meta-review rule that watches a producer's
measured behavior and, when a Type-2 judgment check turns out to be reliably deterministic in a scope (or a
constraint is dismissed ~80% of the time), **proposes** promotion/demotion/scope-narrow. Fold-in: it is a proposal
into the D131 feedback channel and the visibility floor — never a silent reclassification.

**D131 — structured flag-feedback channel.** Locked (R8-restated). D131 IS the typed-reason triage that records why
a flag was acted on or dismissed (`intentional-historical-reference` / `doc-is-aspirational` / `wrong-guess` /
`rule-too-blunt` / `wont-fix-by-policy`), seeding future constraint proposals (the deferred D63 meta-review /
constraint-mining producer — **deferred, see `OPEN.md`** "Smart/auto constraint-mining"). It is an
instance of the generalized flag system. Any **subtractive** governance change it drives (mute/weaken/scope-narrow)
is **surfaced/reviewed + sandboxed** (D147/D148), never a two-key ceremony. Prose-bearing reason fields stay
**WAL-local**, never in the sync-eligible ledger (secret guard). Fold-in: `submitFeedback`.

**D133 — escape-gate-anticipating Tier-0 reminders (the reminder-DECISION half).** Locked (split per F-4). The
**decision** — _which_ authority rule to inject and _when_, anticipating an escape-gate event (extends D107
Tier-0) — is M3's. The physical `role:system` **delivery** is M9's. Fold-in: `reminderFor(escapeEvent) ->
{rule, reason}`; M3 decides, M9 delivers.

**D143 — Tier-B A/B harness (the producer + metric-decision half).** Locked (hardened; split per F-4 three ways).
M3 owns the **Tier-B classifier producer (wired OFF)** and the **A/B metric definition**
(tokens-per-resolved-flag). The cheap-model classifier **call** is M9's (rides the D117 secondary direct-call
port); the A/B cost **record** on the ledger is M7's. Tier-B cannot self-enable in-session. Fold-in: the producer
is a dormant `registerProducer` entry; the metric is a definition consumed by M7's ledger.

**D66 — vouch axis.** Stubbed. A reserved confidence/trust axis (human-only `/vouch`, owned operationally by
M7/D137); present in the schema, not load-bearing in v1. Fold-in: a stub field; no v1 behavior.

---

### M4 — Context Engine

#### Identity

- **ID:** M4 · **ONE** module with **four internal sub-layers.** **Responsibility:** keep the agent working against
  project truth by **generating** sound single-sources-of-truth (L-GEN), **assembling** a capped starting context
  (L-ASM), **grounding** the agent in-flight at the tool boundary (L-GND), and **detecting** the residual drift
  (L-DET). M4 **emits three producers into M3** and does **not** surface flags itself. · **Durability:** WITH-MODEL
  (the appreciating spine — it gets more valuable as the model gets better at using sound context, grounding, and
  constraints).
- **Why one module:** the sub-layers are **not** independent — a dense `declared_symbols()` / `governed-by` seam
  binds L-GND's spec tier to L-GEN. M4 stages **in dependency order**, never in parallel; that non-independence is
  the reason it is one module.

#### Public interface

- `assembleContext(scope|seed) -> Package` — produces the **ephemeral, byte-stable, inspectable** context package.
  The package header carries `active_constraints[]` + `open_flags(crit|high)[]` (the CF-8 standing-awareness header,
  read from `M3.flagsForAgent`). Consumed by M5 (which compiles it), M8/M9 at session start, and M10's
  `coa context`. **Not** a committed git artifact.
- `ground(toolCall) -> groundingBlock | none` — synchronous, in-process, zero model tokens; appended only on a
  miss. Consumed by M6 on the tool return.
- `declared_symbols() -> set<symbol>` and the `generated-from` / `governed-by` edge — published to M1's graph (the
  L-GEN↔L-GND seam). `declared_symbols()` lists symbols generation _will_ produce, so grounding does not false-miss
  a not-yet-generated type.
- `generate(name)` / `regenerate(scope)` — idle jobs registered on M1's scheduler; also reachable synchronously as
  the `coa generate` verb.
- **Producer registration:** M4 registers **three** producers with M3 — GENERATION-drift = **Type-1**; GROUNDING =
  **Type-2**; F4/DETECTION = **Type-2**. All flags flow out through `M3.ingest`; M4 surfaces nothing directly.

#### Depends-on

- **M0** — schema types.
- **M1** — the graph + WAL + idle scheduler + **the symbol table / fuzzy index / piece-resolver** (these live in
  M1). This is M4's whole structural floor.
- **M2** — `parse`, `canonicalize` (G0), per-file `extractSymbols`, `tierFor`.
- **M3** — M4 registers its three producers and reads `flagsForAgent` for the package header.
- M4 does **not** depend on M5/M6/M8/M9 (those consume M4's outputs).

**Build-order note (intra-module staging, dependency order — NOT parallel).** (1) shared substrate is already built
(M1 graph + index + M2 G0 + the `authored`/`derived` tag); (2) **L-GND existence tier + L-GEN SSOT-constraint**
stage first — both standalone and highest-leverage (the existence tier rides the symbol index alone, needs no
generation); (3) **L-GND spec tier** sequences **after** L-GEN ships `declared_symbols()` + the `governed-by`
edge — its soundness rests on that seam, so it cannot be built in parallel; (4) **L-DET** last — it shrinks to
whatever the first three did not already make true. A cheap **v0 calibration spike** runs before any M4 milestone
to size magnitude (token win, selection precision, grounding uptake, tier calibration); it gates magnitude, not
soundness.

#### Owned decisions (final form)

##### Sub-layer L-GEN — GENERATION

**Responsibility:** make and verify project truth at rest — generate sound SSOTs and flag drift as a **Type-1**
producer into M3.

**The `coa generate` runner (GEN-2, P8).** Locked. A typed registry **`.coa/generate.yaml`** (committed) maps each
generator: `{source, target, command, version (pinned), run_on: [source-change|idle|demand], normalize:
[strip-banner|sort-keys], ignore_regions: []}`. The runner **orchestrates existing generators** (openapi-generator,
protoc, prisma, TypeDoc, rustdoc) — it **never reimplements codegen**. It is **idle-first** (the daemon runs
generators on idle time; debounced on source-change; `coa generate [name]`/`--all` on demand; a synchronous
gate-time fallback if the daemon is off), writes `depends-on` edges, runs in **topological DAG order** (re-running
only the transitively affected subtree), coalesces a regenerate into **one transaction** of change-events tagged
`generated:true` + `cause:regenerate(<source-event-id>)`, and stamps every target `reconcile-include` (watched even
if gitignored — D136). Fold-in: `generate(name)`/`regenerate(scope)` are these entry points.

**SSOT-as-constraint (GEN-3, the Type-1 producer).** Locked. A producer that, per declared relation: **regenerate**
target from source into a temp dir (pinned version) → **canonicalize** both fresh output and checked-in copy (M2
G0) → **byte-compare** → if different, emit `{ruleId: "generated-stale:<name>", location: <target>, fix: <write
fresh output>}`; if identical, PASS (zero tokens, zero judgment). It is **sound** because it runs the same
generator+version the build uses and is purely deterministic — the rank-1 replacement for the staleness _guess_.
Two postures: generate-and-commit (guard the committed copy) or generate-on-demand (smoke-check the generator
runs). Fold-in: this is the **Type-1, may-block, auto-patchable** producer M4 registers with M3; its `fix` is the
visible auto-patch (CF-3).

**The non-determinism fix (GEN-8 — the soundness centerpiece).** Locked. False drift is eliminated before soundness
is claimed: **(a)** volatile banners/timestamps → `strip-banner` (Go's `// Code generated … DO NOT EDIT.` family +
per-generator regexes); **(b)** unstable ordering → `sort-keys` canonical-form (parse → re-serialize sorted);
**(c)** environment leakage → fixed-environment regenerate (`C`/`UTF-8` locale, relative paths,
`SOURCE_DATE_EPOCH`); **(d)** binary/non-canonicalizable output → no byte-diff, exits the generation path to an
`origin_anchor` mechanical notice. **Pin the generator version** (a declared input; a bump is a separate attributed
event). **Ignore-regions** are gated, named, bounded anchor-pairs, audited, **default empty**, and any addition is
surfaced/reviewed + sandboxed (D147/D148), never two-key. **Reproducibility self-test (the lie-detector):** when a
relation is declared the daemon regenerates twice from unchanged source; if the canonical forms differ the relation
is non-reproducible → coa **refuses to ship the SSOT-constraint** and falls back to a detection-only mechanical
notice. Soundness is proven before it is claimed.

**D146 — GENERATION re-bill (the use half).** Locked (Ruling 6). The honest finding: generation-as-agent-
effectiveness is real but narrow. **Demote** "generate prose/API-docs/NL summaries and prepend as standing context"
to at most an **on-demand retrieval index, never always-on prompt text** (SWE-bench data shows more prepended
context _lowers_ resolve rate). **Elevate** the **deterministic context-package assembler** (L-ASM) to the headline
agent-effectiveness deliverable — its value is selection+ordering+hard-cap. Drift-soundness (the GEN-* slate) is
untouched. Fold-in: L-GEN keeps its drift-soundness billing; agent-effectiveness reduces to "feed grounding/tests
sound truth + build a great selector." (The clause-3 neutral-floor *tiering decision* is M2's `tierFor`; L-GEN
merely *uses\* it.)

**The `authored` vs `derived-from-code` provenance tag (GEN-7 / the joint catch).** Locked. Every SSOT carries a
provenance tag. **`authored`** = hand-written or human-approved; GENERATION enforces it as SSOT and GROUNDING may
ground against it. **`derived-from-code`** = generated _from_ code (describes what-is, not what-was-intended); it is
**never** auto-promoted to SSOT and GROUNDING **may not** ground against it (else a code-derived spec cements
current behavior as the contract — circular). Fold-in: the tag is a minor graph field; L-GND reads it before
grounding spec coverage.

**The seam L-GEN publishes (GEN-7).** Locked. To L-GND: a `generated:true`, freshness-guaranteed symbol set;
`declared_symbols()`; and the **`generated-from` / `governed-by`** edge that makes spec-coverage a deterministic
fact. Fold-in: published to M1's graph; consumed by L-GND's spec tier.

**GEN-1 / GEN-4 / GEN-5 / GEN-6.** Locked. **GEN-1 discovery:** a generated-header stamp auto-records
`generated:true`; an un-stamped file gets a one-keystroke auto-proposal on strong evidence; no declared relation →
coa does nothing (SC-1). **GEN-4 brownfield on-ramp:** adopting generation on a drifted repo shows the current diff
and offers adopt-now / **baseline** (flag only new divergence) / walk-away — never a forced day-one edit. **GEN-5
doc-comments-as-source:** the in-AST docstring is the SSOT; its rendered prose is a `coa generate` target that
travels with `rename_symbol`; narrative/rationale prose stays hand-authored and falls to L-DET. **GEN-6 the honest
boundary:** generation applies **iff** the artifact is a deterministic, canonicalizable function of an identifiable
source; a hand-drawn `.drawio` (layout is information), behavior/rationale prose, and raster/binary output are
out — they route to L-DET / `origin_anchor`. The partition test: "can you name a canonicalizable source?"

**GEN-BS-\* (amplifiers).** **GEN-BS-1 recommend-now** = the deterministic context-package assembler realized as
L-ASM (the D146 headline). **GEN-BS-3 recommend-now** = one-shot scaffolding-from-spec that then graduates out of
generation. **GEN-BS-2 / GEN-BS-4 = v2-v3 bets** (tests-from-spec; "generate the missing half," hard-gated and
marked `derived-from-code`). **GEN-BS-5 / GEN-BS-6 = cut** (round-trip/bidirectional generation violates the
acyclic `depends-on` premise; mechanical `.drawio`-from-graph discards layout information). Fold-in: only
GEN-BS-1/3 are v1.

##### Sub-layer L-ASM — ASSEMBLY

**Responsibility:** assemble a capped, ordered, inspectable starting context — a **thin deterministic selector** in
front of D104's existing assembly line; it adds no new tool, channel, or renderer.

**D104 — the deterministic assembly line (what L-ASM composes over).** Locked. D104 IS coa's context-engine
pipeline: a fixed sequence of **pure-function producer "stations"** (no agent tokens) that turn resolved Pieces +
graph facts into a **backend-neutral layout**, which M9's renderer then translates to backend-native (the only
backend-specific step). The line has a **build-time byte-stable prefix + a runtime injection loop**, runs over M1's
one D101 piece-resolver, and each station `depends-on` its inputs (D16) so a changed internal re-compiles only the
affected station. L-ASM does **not** replace this line — it adds a **thin selection brain in front** of it (rank +
cap + seed), feeding the line's late station ("Station 6") and its overflow "reference bin." (M5 owns the _full_
seven-station rendering + cache-stability machinery, D145; L-ASM owns only the selection that feeds it.)

**D106 — mid-session-change policy (the assembly-line side).** Locked. When a stable input changes mid-session the
default is a **cache-perfect sticky-note** appended via `inject_runtime` (never an edit to the cached prefix);
severity escalates by D73 bucket; a tightened rule is backed by deterministic enforcement (M3's gate) so the
cache-perfect path is also safe (P5); notes fold in at re-hydration; a **structural** change surfaces a user choice
(D92 attended). This is the assembly-line counterpart of M3's CF-4 mid-session patch-coherence policy.

**ASM-1 — selection mechanism.** Adopted. Rank the context pieces D101 (M1's piece-resolver) already resolves by a
composite of seven deterministic signals **S1–S7**, relative to a **seed ladder**, with a **bounded one-hop recall
floor** (the seed files plus their direct dependency neighbors are always included if budget allows).

**The S1–S7 signals (ASM-3 floor/bounded tiering).** Adopted. **Neutral-floor (always work, no parser/IDL
needed):** **S2** scope membership (D32), **S3** recency (the WAL), **S6** lexical/keyword (SQLite FTS/BM25), **S7**
ctags symbol presence (universal-ctags, 40+ languages). **Bounded-layer (auto-engage where a grammar/spec exists,
contribute nothing where they don't):** **S1** graph proximity (M1 `depends-on`), **S4** grounding-relevant facts
(signature, spec-coverage edge, pinning tests), **S5** test/spec edges. Fold-in: coa never assumes a stack — the
floor always produces a ranking; the bounded layer sharpens it.

**The seed ladder (ASM-1, most-specific-first).** Adopted. (1) declared scope (D32 `@payments = [globs]`,
strongest) → (2) a named context manifest for the scope (curated beats computed) → (3) the prompt's named
entities → (4) recent WAL activity (weak) → (5) **nothing** (an un-scoped/interactive agent: seed empty → emit
**only** the always-on floor, project head + kernel; **no ceremony, no nag** — SC-1).

**ASM-2 — ordering + hard cap.** Adopted (cap is a per-scope knob, default leans **low**). **Edges-first ordering**
(Lost-in-the-Middle: highest-ranked pieces at the prefix head + recency tail, lower-ranked in the middle).
**Binary-search the piece count to a hard token cap net of the D100 kernel** (land within ~15% of budget; the
assembler budgets only the project-context slice, never re-budgets tools). Overflow is **demoted to a pullable
reference bin**, never silently dropped.

**ASM-4 + D105 — freshness and cache-stability.** Adopted. Pre-build the package on **daemon idle** (zero latency);
**read-your-writes** over M1's optimistic graph (an agent edit is selectable before the next assembly, and a
deleted piece drops out); carry a **WAL-position freshness stamp**; rebuild **only on material input change**
(post-G0-canonicalization, so a formatter/comment change does not rebuild). It **composes over D104** (the manifest
is a _selection_ feeding D104's Station 6 + reference bin — no reinvented rendering) and honors **D105
cache-stability** (byte-stable within a scope across turns; freshness deltas **append**, never edit the cached
prefix).

**ASM-5 (AMENDED) — the ephemeral inspectable package.** Adopted (amended per Ruling 7). The package is a
**byte-stable, deterministic, inspectable in-memory cache — NOT a committed git artifact.** `coa context <scope>`
shows it, its per-piece rank+reason, and a diff since the last build; the WAL freshness stamp answers "is it
current?". The old committed `.coa/context/*.pkg` file and its `generated-stale:context@<scope>` SSOT-constraint are
**dropped** (no git/review noise for an internal cache); only a metadata register may live in `.coa/generate.yaml`.

**ASM-6 — degradation ladder (D85 never-worse).** Adopted. Full → no-scope (floor only, no ceremony) → cold-graph
(the floor still carries) → daemon-off (synchronous build) → no-parser (floor). With everything off the assembler
is **≤** the pre-assembler D104 baseline — never worse.

**ASM-7 — the SC-1 contract (inviolable).** Adopted. The package is **starting** context, never **bounding**: the
agent keeps full native retrieval and on-demand pull; the manifest names the rest of the repo as reachable;
under-selection recovers in-flight in one tool call via the L-GND seam.

**ASM-8 — the seam record.** Adopted (with a watch). L-ASM **selects** (preferentially from `authored` SSOTs),
L-GND **corrects + tops-up** in-flight, L-GEN **makes-and-verifies**; they share M1's piece-resolver + graph + the
M2 canonicalization profile. **Watch:** never present a `derived-from-code` artifact as authoritative starting
context.

**ASM-9 — the disposition + the precision contract.** Adopted. Build a **thin** selector, **not** a heavyweight
bespoke retriever — its defensible value is a cheap deterministic head-start, a hard-cap discipline the raw loop
lacks, and a reproducible inspectable artifact; a capable native loop + L-GND top-up already covers "find the
file." **Precision contract:** **fail toward under-selection** (over-stuffing is unrecoverable — tokens and
attention spent; a missed file is one cheap tool call away). Quality is **measured and shown** (precision = fraction
of selected pieces the agent used; recall = in-flight top-ups per task), riding the kept minimal D135 ledger, honest
that the oracle is unknowable and quality scales with parseability. The `[LOOP]` magnitude is the v0-spike's to
measure — the spike gates magnitude, not soundness.

**ASM-BS-\* (amplifiers).** **recommend-now:** the realized package (ASM-BS-1), the `coa context` inspector
(ASM-BS-2), the selection-quality dashboard line (ASM-BS-3), graph/import/dataflow as a **retrieval index** not a
raw dump (ASM-BS-4). **v2-v3 bets:** auto-propose a scope's manifest (ASM-BS-5), a local-embedding floor signal
(ASM-BS-6). **Cut:** a learned/ML re-ranker (ASM-BS-7 — judgment where arithmetic suffices, non-deterministic) and
an always-on whole-repo prose dossier (ASM-BS-8 — the exact SWE-bench anti-pattern this layer replaces). GraphRAG
is explicitly out of v1 (LLM-built graph breaks P1; coa already has a sound deterministic code graph).

##### Sub-layer L-GND — GROUNDING

**Responsibility:** hold the agent to project truth in-flight at the tool boundary — a deterministic, zero-token,
**advisory** enrichment that **never blocks**, registered as a **Type-2** producer into M3.

**The core mechanism (G-1).** Adopted (highest anti-drift build priority). On each symbol-naming tool call, **hit
path** = one O(1) hash-map lookup against M1's live `name → symbol-record` index (>95% of calls; latency
indistinguishable from native; returns the symbol's resolved facts). **Miss path** (rare) = does **not** fail the
call; appends an advisory grounded correction. The fuzzy/nearest-match index (BK-tree/trigram) is **idle-built**
and consulted **only** on a miss, so the hit path stays sub-millisecond. No new tool — it enriches existing M6
returns (`get_symbol`, `edit_symbol`, `apply_patch`, `find_references`, `rename_symbol`, `outline`).

**G-2 — the help-not-cage contract (inviolable, SC-1).** Adopted. Grounding is **advisory-only, never blocks**;
three-way grading (new / weak / stale); **fails toward proceed** (a genuinely new-looking name gets **no**
correction); suppressible to determinism; precision measured. The miss payload carries an explicit
`if_intentional: "if you are creating a new symbol, proceed"` escape so the agent never reads it as a refusal.

**The three check-tiers, language-gated (CL-9 boundary).** Adopted. **EXISTENCE** — is the name in the symbol
table's visible set? Works for every parseable language (tree-sitter CST). **SIGNATURE/ARITY** — does the call's
argument shape match? Typed or statically-analyzable languages (arity is checkable even without types). **TYPES /
SPEC-CONFORMANCE** — type/contract conformance, **only where an F3 constraint or L-GEN's `governed-by` edge covers
the symbol**. The spec tier is the **hard dependency on L-GEN's seam** (`declared_symbols()` + the `governed-by`
edge) — this is why L-GND's spec tier sequences after L-GEN. **Honest-silence:** a dynamic/un-typed file gets
existence-only; a metaprogramming/`eval`/reflection file demotes existence checks to a whisper — coa **never asserts
a check the language cannot soundly perform**.

**Rename-provenance (the coa-only signal).** Adopted. The miss-path nearest-match ranks four deterministic signals
(no model, no embeddings): edit distance (Damerau-Levenshtein), scope/graph proximity, **rename-provenance from the
WAL** (`chargeCard → capturePayment` in rename r-1187 — a deterministic **fact**, the highest-confidence
suggestion, which no stateless LSP has), and signature similarity. Fold-in: rename-provenance is the headline
candidate and the reason a grounding suggestion can be high-confidence rather than a guess.

**The tool-return `grounding` block.** Adopted. It rides the F6 tool return (not a new tool, not a hook, not
async), is in-process/synchronous and **zero model tokens**, and is appended **only on a miss**. Shape:
`{ status, named, checked_against: "project-symbol-graph @ <wal-position>", suggestions: [{symbol, signature,
defined_in, confidence, why}], if_intentional }`. Load-bearing properties: `checked_against` gives freshness
transparency; every suggestion carries a `why`; `if_intentional` is the in-payload escape hatch.

**G-3 / G-4 / G-5 / G-6 / G-7.** **G-3 spec/contract grounding** = adopted; carry the contract always on edit, flag
a violation only on the **settled** edit (not a transient partial), coverage **only** from a deterministic edge,
**never** a name-mention guess. **G-4 external scope** = adopted; project symbols are ground truth,
external/3rd-party symbols are **out of scope by default** (never a miss — prevents catastrophic over-grounding);
stub-grounding is a v2-v3 opt-in. **G-5 BS-1+BS-2 composition** = recommend-now (below). **G-6 calibration spike** =
the v0 measurement of suggestion precision, agent uptake, hit-rate, coverage split. **G-7 decision/rationale
grounding** = v2-v3 bet with a near-v1 **structural-deletion floor** (ground on deletion of a decision-bound symbol
when capture ships); defer the semantic-contradiction half to the shared CL-7 contradiction engine (**deferred —
see `OPEN.md`**).

**BS-1 / BS-2 (recommend-now amplifiers).** Adopted. **BS-1 ground-against-tests:** on `edit_symbol`, the return
notes which tests assert on the symbol ("3 tests pin `validateRefund`'s 201 status + audit-write; changing the
return shape breaks them") — the test→symbol edge is structural (the call graph), not guessed. **BS-2 proactive
grounding:** on `get_symbol` resolution, the envelope proactively includes the symbol's contract, pinning tests,
governing decision, and recent change-events — a positive "here is the truth around what you asked," bounded by the
D57 envelope budget (no dump). Both are pure compositions over M1's call graph + the bounded envelope.

##### Sub-layer L-DET — DETECTION (the F4 residual)

**Responsibility:** catch the residual drift the upstream layers did not make true — a budgeted, ambient,
**Type-2** producer into M3 that **never blocks**; its detection machinery is LOCKED (Ruling 4 substrate).

**The G0→G5 gauntlet (determinism-first ordering — cheap filters first, the one model call last).** Locked. **G0**
semantically-null pre-filter — drop whitespace/formatting/comment-only changes by AST-equality + normalized-token
hash (M2 G0), **except** the suppression-pragma carve-out below. **G1** structural-shake classify — body-only vs
signature/arity/export (D134; ranks confirm priority); cheap. **G2** tier-1 deterministic checkers run and emit
flags directly; free. **G3** resolve affected links — structural `depends-on` (direct-only) + guesses + tier-2
hand-declared edges, minus suppressed, minus G1-null-shaken. **G4** batch + coalesce by artifact, debounced. **G5**
the cheap AI confirm — the **only** token spend on the fast path; reads a bounded envelope (artifact + symbol slice

- the specific claim) and returns a stale/fresh verdict + confidence into M3's emit-gate.

**The G0 suppression-pragma carve-out.** Locked. Comment-only changes that are **suppression directives**
(`@ts-ignore`, `eslint-disable`, `# type: ignore`, build pragmas) are **NOT** dropped as null — they are
semantically loud and double as the intent-ledger "a suppression was added" signal (feeds D131/D139).

**Async batch-by-artifact at the prompt boundary (PD-3).** Locked. The confirm queue is per-artifact and
accumulates the **union** of changed symbols per artifact; it drains on the earliest of prompt-boundary (default —
freshness within the turn, off the keystroke/critical path), commit, idle, or a debounce ceiling. **Coalescing
math:** confirms = distinct artifacts with ≥1 survivor, not changed-symbols and not guesses — 300 renames across 5
docs = at most 5 confirms.

**The daemon-idle "is everything still true?" sweep (PD-4, the budgeted backstop).** Locked. On idle, drain a
dirty-set priority queue (artifacts whose named/depended symbols changed since `verified-at`, ranked by D134). It
(1) catches un-named/conceptual drift the guesser missed, (2) second-opinions false-passes, (3) does periodic
full-truth maintenance. Budget = a small fixed fraction of the daily cap; interactive confirms have priority; it is
preemptible; coverage is **announced** ("verified N of M watched artifacts; last full sweep T") — **degrade by
coverage**, never a false green.

**Tier-2 hand-declared edges (`coa link`).** Locked. Three creation paths to the same typed edge:
`coa link <artifact> <symbol> [--why "..."]` (a D72 verb), an inspector "+ link", or an in-artifact annotation
(`<!-- coa:covers src/.../file.ts#symbol -->`, PD-1, travels in the repo and is reviewable in the diff). The
**ability** to declare a high-value un-guessable edge is kept; the **obligation** to maintain a comprehensive
semantic map is cut (the dashboard never says "undeclared edges"; edges self-maintain across renames via symbol ID

- git `-M`; a stale-but-undeleted edge degrades to a one-action notice). An agent-proposed edge is gated — it
  surfaces as a D131-style triage item with a diff that a human approves; the agent never self-approves.

**PD-1…8 (the locked slate).** Locked (Ruling 4 substrate). **PD-1** the in-artifact edge-annotation syntax
(HTML-comment / YAML front-matter / `.drawio` node-attribute). **PD-2** a conservative confirm-confidence threshold

- precision-proxy floors, self-tuning as a D107 knob. **PD-3** default drain = prompt-boundary (above). **PD-4** the
  budgeted sweep (above). **PD-5** an embedding guesser is a seam, **default OFF** — enabled only if measured recall
  is insufficient **and** a cost-ledger A/B proves net-positive. **PD-6** raster-artifact confirm is a mechanical
  notice-only in v1 ("symbol changed — eyeball it"); multimodal is a seam. **PD-7** the judgment confirm **never**
  blocks the close-gate — only tier-1 deterministic freshness blocks; probabilistic results advise. **PD-8** tier-2
  edges + suppressions are committed `.coa/` (they travel); `verified-at` / confirm-results are `.coa/local/`
  (session state).

**L-DET as a Type-2 producer.** Locked. Outputs are flag records into M3's one pipeline; **never blocks**. Its old
"silent-until-confirmed" surfacing is **superseded** by M3's two-audience contract (CF-1) — the detection machinery
here is untouched; only the visibility contract changed. Severity surfaces as blocking (tier-1 only) / notice
(confirmed-stale, default) / whisper (low-confidence, inspector-only).

---

### M5 — Config Compiler (`core/compiler/`)

#### Identity

- **ID:** M5 · **Responsibility:** compile a set of composed **Pieces** (Knowledge / Protocol / Behaviour / Role)
  plus the **capability frame** into **one backend-NEUTRAL config object** — the single place the _Pieces → config_
  translation algorithm lives. It enforces **cache-stability** as a global invariant over the whole output. It is
  **backend-blind**: it never emits `.claude` files or SDK-native options. M9 takes M5's neutral output and renders
  it to backend-native; M5 never imports M9. · **Durability:** WITH-MODEL — composition logic that appreciates as
  the Piece taxonomy grows.
- **Two terms used throughout.** A **Piece** is coa's unit of composable agent content — four atoms: **Knowledge**
  (facts/rules the agent must know — split into _authority_ "must obey" and _reference_ "look up when needed"),
  **Protocol** (a procedure the agent follows), **Behaviour** (a judgment-style disposition), and **Role** (a named
  bundle of the above + a capability frame). (Historically the Knowledge atom was called "Skill"; it is
  **Knowledge** now.) A **capability frame** is the per-(sub)agent set of which tools/built-ins are allowed or
  denied.

#### Public interface

The whole module is three functions. All are **deterministic** (no model call on any path).

```
compile(pieces: Piece[], frame: CapabilityFrame) -> NeutralConfig
    The core translation. Maps each Piece onto a neutral delivery slot per the taxonomy (D5/D68/D69), composes
    them per the atomic-pieces rules (D82/D87/D88), lays them out cache-stably (D105), and packs the capability
    frame as neutral allow/deny tool intents. Returns a NeutralConfig (defined in M0).

importBundle(bundle: SKILL.md text) -> Piece[]
    v1, ONE-DIRECTIONAL: decompose an existing SKILL.md bundle into coa Pieces. The lossless bidirectional
    round-trip (write Pieces back out as a byte-faithful SKILL.md) is v1.1, NOT v1 (D145).

versionGate(bundle, priorBundle?) -> { bump: MAJOR|MINOR|PATCH, blastRadius: Role[] }
    The SemVer breaking-change gate over a bundle's declared public surface (D132). WARNS; never blocks a
    human-approved adopt.
```

`NeutralConfig` (the contract M5 emits and M9 consumes) is a backend-neutral, option-shaped record owned by **M0**.
Its shape (informative — M0 owns the exact schema):

```
NeutralConfig = {
  prefixHead:        OrderedPiece[]   // most-stable-first; the byte-stable cacheable head (authority Knowledge,
                                      //   resident Protocol). NEVER contains volatile/interpolated content.
  systemReminders:   Reminder[]       // authority rules to re-assert on role:system (M9 delivers; M3 decides which)
  onDemandPullable:  PieceRef[]       // reference Knowledge — NOT in the prefix; fetched via get_piece on demand
  scopePushed:       Piece[]          // Behaviour, pushed at scope boundaries
  toolIntents:       { allow: string[], deny: string[], perAgent: {...} }   // the capability frame, NEUTRAL
  assembledContextSlot?: ContextPackageRef   // appended dynamically AFTER the stable prefix, never interpolated in
}
```

#### Depends-on

- **M0** — for `NeutralConfig`, `Piece`, `CapabilityFrame`, and the bundle-manifest types.
- **M4** — reads `M4.assembleContext(...)` output **only** when the compiled config must carry assembled project
  context. This is M5's single inward read. M5 reads only the **STABLE slice** of the assembled package (the
  byte-stable part), so the cache-stability invariant is preserved — volatile/dynamic context is appended later,
  never compiled into the stable prefix.
- **Does NOT depend on** M8 or M9. M8 _calls_ `M5.compile`; M9 _renders_ M5's neutral output. M5 stays acyclic and
  backend-blind.

#### Owned decisions (final form)

**D5 / D68 / D69 — The Piece-taxonomy → delivery mapping.** ✅ locked. The rule for _where each kind of Piece goes_
in the compiled config. **Authority Knowledge** → the prefix head (the cacheable, byte-stable lead) **plus** a
`role:system` reminder entry (so the must-obey rule is re-asserted, not just stated once). **Reference Knowledge** →
NOT in the prefix; emitted as an on-demand pullable (`get_piece` fetches it only when needed). **Resident
Protocol** → the prefix (the agent follows it every turn). **Behaviour** → scope-pushed. This is the
_force-driven delivery default_: how insistently a Piece is delivered follows its declared force, not a hand-wired
channel. Fold-in: `compile()` walks each Piece, reads its kind + force, and routes it to the matching
`NeutralConfig` slot. The routing is a **default, not a hard-wire** — a Piece can override its slot.

**D82 / D87 / D88 — Atomic-pieces composition + force-driven default + round-trip target.** ✅ locked (composition +
import in v1; full round-trip v1.1). Pieces are **atomic and compose**: `compile()` takes a _set_ of Pieces and
merges them into one config rather than concatenating prose. **D87** is the force-driven delivery default folded
into the D5/D68/D69 mapping above. **D88** is the _bundle invoke/round-trip target_ — a bundle (a Role + its Pieces

- assets) can be composed and invoked as a unit; the **import** half lives here (`importBundle`), and the full
  **bidirectional** round-trip is the v1.1 target (D145). Fold-in: composition is set-merge with deterministic
  ordering; `importBundle` decomposes a SKILL.md into Pieces (one direction). (The _invocation_ of a composed bundle
  at runtime is M6's `invoke_asset` — M5 only compiles.)

**D145 — Config Compiler phasing (the v1 complexity line).** ✅ locked. **v1 ships:** the core taxonomy → an
**option-shaped neutral output** (the four atoms + Role + the capability frame, mapped per D5/D68/D69), the **full
D104 seven-station assembly/compose line** (NOT a naive string-concat), the **D105 cache-stability contract
enforced from the first line**, and **one-directional `importBundle`**. **v1.1 ships:** the full bidirectional
SKILL.md round-trip (the D88 machinery — preserve-verbatim source, binary-asset round-trip, mount-contract assets).
**REJECTED:** the "good-enough v1 = naive concat, real line in v1.1" shortcut — cache-stability is a _global_
invariant over the whole prefix and **cannot be retrofitted** onto a naive builder. **Live-verified constraint
(load-bearing, accessed 2026-06-23):** the Claude Agent SDK has **no programmatic API for registering Skills** (they
are filesystem-only, governed by `settingSources`), and the **`allowed-tools` frontmatter key in a SKILL.md is
IGNORED by the SDK**. Therefore the **capability frame must be delivered structurally** (via the SDK's
`disallowedTools` / `tools` / `canUseTool` options), NOT via SKILL.md keys. This is _why_ M5 emits neutral
`toolIntents` (which M9 renders to those structural options) and why the SKILL.md round-trip is a genuinely separate
v1.1 concern. (Sources: `code.claude.com/docs/en/agent-sdk/skills` and `.../subagents`, 2026-06-23.) Fold-in: v1
implements `compile()` + `importBundle()`; the bidirectional half is a documented v1.1 seam — do **not** build it in
v1.

**D105 — The cache-stability contract (the global invariant).** ✅ locked. The hard rule the compiled output must
satisfy so the backend's prompt cache stays warm. **Four clauses:** (1) **most-stable-first** — order content so
the least-likely-to-change Pieces lead; (2) **byte-stable prefix** — the `prefixHead` must be byte-for-byte
identical across turns when its inputs have not changed (no reordering, no reformatting, no timestamp drift); (3)
**dynamic content appends only** — anything that changes per-turn (assembled context, flags, reminders) is
**appended after** the stable prefix, never spliced into it; (4) **never interpolate volatile content** into the
system prompt / authority head. The backend cache invalidates a level **and everything after it** when that level
changes, so a single volatile byte in the prefix busts the whole cache — hence the discipline. Fold-in: `compile()`
builds `prefixHead` deterministically and refuses to place any field tagged volatile into it; volatile content
flows to `assembledContextSlot` / `systemReminders`, which M9 appends. This is exactly why M5 reads only the stable
slice of M4's assembled context.

**D132 — SemVer + breaking-change gate for bundles.** ✅ locked (WARNS, never blocks a human-approved adopt — so it
cannot reduce access, honoring the strict-superset floor). SemVer 2.0.0 applied to a bundle's version string over a
**declared public surface** = (a) the bundle's **authority-`force` Knowledge** directives, (b) its **exported Role /
Protocol / command names**, (c) its **asset mount-contract hashes**. A change to any of those = a **MAJOR** bump
(removed/loosened authority rule, renamed Role, changed asset contract); additive = **MINOR**; wording-only =
**PATCH**. On a MAJOR bump at adopt/sync time, `versionGate` **walks the graph's `Role → bundle depends-on` edges**
and shows the human the **blast radius** ("this breaks authority rule X that Roles `reviewer`, `tdd-implementer`
depend on") **before** the diff. Fold-in: `versionGate(bundle, prior)` diffs the three-part public surface,
classifies the bump, and (on MAJOR) queries M1's graph for dependent Roles to compute `blastRadius`. It is
consume-only on the graph.

**NOT owned by M5 (explicit boundary).** **D70** (spawner Protocol) and **D77** (spec-crystallization Role) are
**session-orchestration** concerns, not compilation — they stay in **M8**. M5 owns only the Piece→config
compilation. (Stated here because they look compiler-adjacent and were explicitly ruled out.)

**Invariants M5 must honor.** Determinism-first (P1): `compile` has no model on any path. No-lock-in: output is
backend-NEUTRAL; the swap-the-backend seam is M9's renderer, never M5/M8. Strict-superset / F1: content→delivery
routing is a **default, not a hard-wire** — the whole-file/escape paths the rest of coa preserves are not
foreclosed by the compiler.

---

### M6 — Workbench (the governed tool surface)

#### Identity

- **ID:** M6 · **Responsibility:** present the **governed tool interface** the rented loop calls — the Retrieve /
  Mutate / Graph / Flags / Context tools — and route every _precise_ write into the kernel as a change-event. M6 is
  **producer ①** of the two-producer change-event model (the precise-Mutate producer; the other producer is M1's
  git reconciler). Every tool return M6 emits is **enriched** by calling `M4.ground()` and `M3.flagsForAgent()` so
  the agent gets project truth and gated flags inline with its result. · **Durability:** WITH-MODEL.
- **Why this module exists (the quality thesis, informative):** structure-first _retrieval_ + a diff-shaped,
  lenient _edit_ surface is justified primarily on **quality/context-fidelity** (small high-signal context beats a
  big polluted one) and a modest token win, **not** on a clean token multiplier.

#### Public interface

M6's public surface **is the tool catalogue** — the set of MCP tools that M9 registers into the rented loop. Each
tool's return is a **distilled handle + a pointer** (the raw blob stays in the daemon, never inflated into the
agent's context), and each return is enriched with grounding + gated flags before it goes back.

```
The tool catalogue (the MCP surface M9 registers):

  RETRIEVE (read; structure-first, with whole-file fallback)
    get_symbol(name|ref)         -> distilled symbol slice + handle      [reads M1 graph + symbol index]
    outline(file|scope)          -> structural outline                   [reads M2 parse + M1 graph]
    find_references(symbol)      -> reference sites                       [reads M1 graph]
    get_piece(ref)               -> a reference-Knowledge Piece on demand [M1 piece-resolver]

  MUTATE (write; producer ① — emits a change-event to M1)
    edit_symbol(ref, diff)       -> applies a diff-shaped, lenient localized edit  [PRIMARY edit path]
    apply_patch(diff)            -> applies a whole-file / multi-hunk patch         [co-equal escape]
    rename_symbol(old, new)      -> deterministic cross-file rename (AST-op)
    rewrite_structural(pattern)  -> deterministic structural rewrite / codemod (AST-op)

  GRAPH / CONTEXT / FLAGS
    context_status()             -> the assembled-context + cap state    [reads M4 package + M7 cap]
    run_checks(scope?)           -> runs the flag pipeline on demand      [calls M3]
    invoke_asset(bundleRef)      -> invokes a composed Asset/bundle        [D88/D95]
    begin_fork(scope) / exit_fork()  -> enter/leave a sandboxed worktree fork

  EXPLAIN (read the governance/decision record)
    why(target)                  -> the rationale for a constraint/decision   [reads M7 Decision log]
    get_spec(ref)                -> the governing spec for a symbol/scope
    get_decision(id)             -> a numbered Decision-log entry              [reads M7 Decision log]

Every return value R is post-processed:  R.grounding = M4.ground(call);  R.flags = M3.flagsForAgent(scope).
```

#### Depends-on

- **M0** — tool-return + flag-record + piece types.
- **M1** — Mutate **emits** change-events here (producer ①); Graph/Retrieve **read** the graph + symbol index + the
  piece-resolver (all M1).
- **M2** — `parse` for symbol-addressed ops.
- **M3** — `run_checks`, and the per-return flag enrichment (`flagsForAgent`).
- **M4** — the per-return grounding enrichment (`ground`).
- **M7** — `get_decision` / `why` / `get_spec` read M7's append-only **Decision log**; `context_status` reads the
  cap state. (This is the M6→M7 edge — owned here.)
- **Registered into the loop by M9** via dependency injection at the M8 session boundary (closures) — M6 does not
  import M9.

#### Owned decisions (final form)

**F6 / D57 / D58 — The internal tool API.** ✅ locked. The internal API contract for the agent's tools — the
Retrieve/Mutate/Graph/Flags surface above. **D57** fixes that retrieval is **symbol/structure-addressed** (a symbol
slice, an outline, references) and primary, with whole-file read/write a demoted configurable escape hatch — the
small, named catalogue above. **D58** fixes the **default read shape: symbol body + a bounded ambient envelope**
(docstring, file imports, sibling outline, direct refs) + one-call expand pointers (callers/callees/impact). The
**D57/D58 "envelope budget"** is the hard ceiling on how much that ambient envelope may return, so a `get_symbol` /
BS-2 proactive grounding return stays a bounded slice and never inflates into a whole-file dump. F6 is the umbrella
feature ("the governed tool surface"). Fold-in: implement the catalogue above; each tool is one method with a typed
(M0) request/response, and the envelope obeys the budget.

**Ruling 3 — The Mutate surface (diff-shaped lenient primary · whole-file co-equal · deny-Edit demotable · AST-ops
on mechanical correctness).** ✅ locked. Four parts, all final:

1. **Diff-shaped, lenient Mutate is the PRIMARY localized-edit path** (`edit_symbol` / `apply_patch` take a
   diff/search-replace shape, leniently matched). This is the measured win for capable models (a structured _diff_
   format tripled GPT-4-Turbo's edit score 20%→61% and cut "lazy coding" ~3×). **Lenient** is load-bearing: do NOT
   wrap edits in a heavy AST/JSON-schema envelope — code-in-JSON measurably _hurt_ every model (Sonnet worst). Keep
   it a lightweight, program-readable text-diff shape.
2. **Whole-file escape is CO-EQUAL and never punished** (`apply_patch` whole-file form). It is the **default** for
   generated code, thin-grammar/AST-invisible files, large cross-cutting rewrites, and (forward-compat) weaker
   models. It must be cleanly reachable, never penalized.
3. **Deny-built-in-Edit is a DEMOTABLE DEFAULT.** For a capable, Claude-locked v1 on localized edits, denying the
   SDK's built-in whole-file `Edit` (so the model is nudged onto the rigorous diff path) is a _measured win_ — but
   it is a **default the user can demote**, never a hard lock. (The deny itself is issued through M3→M9's one
   `canUseTool` deny channel; M6 _declares_ the demotable default.)
4. **AST-ops (`rename_symbol` / `rewrite_structural`) are KEPT, re-justified on deterministic mechanical
   correctness** — a guaranteed-correct cross-file rename/codemod the model cannot do reliably by hand. They earn
   their place on _determinism_, **not** on the token/quality thesis. (There is no external evidence that AST-_apply_
   beats text-diff editing, so AST-apply superiority is **not** claimed.)
   Fold-in: `edit_symbol` + `apply_patch` accept a lenient diff; `apply_patch` also accepts a whole-file body;
   `rename_symbol` / `rewrite_structural` run deterministic AST transforms; the built-in-Edit deny is a config default
   M6 declares and M9 enforces.

**D99 — The four-gate tool-admission test.** ✅ locked. A candidate tool is admitted only if it (1) is something the
agent genuinely needs, (2) is not already covered by an existing tool, (3) has a clear, enforceable contract, and
(4) pays its standing schema-budget cost (every always-loaded tool schema consumes the agent's context). Tools that
fail go to the on-demand path (D100), not the kernel set. Fold-in: the catalogue is partitioned into the **kernel
set** (always loaded) vs **on-demand** by this test.

**D100 — Kernel vs on-demand schema budget; the MCP-proxy `find_tools` / `load_tool` path.** ✅ locked. A small
**kernel set** of tool schemas is always loaded (the common Retrieve/Mutate verbs); the rest are **on-demand** —
discovered via `find_tools` and pulled in via `load_tool` through an MCP proxy. This is the **PRIMARY on-demand
path**: it keeps the always-loaded tool-schema footprint small. Fold-in: implement the MCP-proxy
`find_tools`/`load_tool` so non-kernel tools are loadable on request; only the D99-passing kernel set ships in the
always-loaded schema.

**D101 / D102 — Push↔pull unification + invocation precedence.** ✅ locked. **D101** unifies pushed content
(delivered into context) and pulled content (fetched via a tool like `get_piece`) under one Piece model — the same
Piece can be pushed or pulled. **D102** fixes the **invocation precedence**: when the same thing is reachable both
ways, the rule for which wins (the explicit pull on demand vs the standing push) is deterministic and stated.
Fold-in: `get_piece` resolves through M1's piece-resolver and obeys the D102 precedence; pushed Pieces come from the
compiled config (M5), pulled ones from this tool — one model, one precedence rule.

**D103 — The session/explain tool verbs.** ✅ locked. The concrete verbs `invoke_asset` · `begin_fork`/`exit_fork` ·
`run_checks` · `context_status` · `why` / `get_spec` / `get_decision`. Each return is a **distilled handle + a
pointer** — the raw payload stays in the daemon and is never inflated into the agent's context. Fold-in: implement
each verb; `why`/`get_spec`/`get_decision` route to M7's Decision log; `context_status` reads M4's package + M7's
cap; `run_checks` calls M3; fork verbs bind/unbind a worktree fork (the worktree itself is managed by M8 — M6 issues
the verb).

**D88 / D95 — Asset / bundle invocation.** ✅ locked. The runtime **invocation** of a composed Asset/bundle (a Role +
its Pieces + mounted assets) as a unit, via `invoke_asset`. (M5 _compiles/imports_ bundles; M6 _invokes_ them —
disjoint halves of D88.) D95 is the asset mount-contract (the hashed contract M5's `versionGate` watches; M6 honors
it at invoke). Fold-in: `invoke_asset(bundleRef)` resolves the bundle, checks its mount-contract, and brings its
Pieces/assets into the session.

**The precise-Mutate producer (producer ①).** ✅ locked (the D81 two-producer model; M6 = producer ①). Every precise
write (`edit_symbol` / `apply_patch` / `rename_symbol` / `rewrite_structural`) **emits a canonical change-event** to
`M1.emit(changeEvent)` so the WAL, graph, flags, and all consumers see the write immediately. (The other producer
is M1's git-centric reconciler, which catches writes M6 did not make.) Fold-in: every Mutate tool, on success,
constructs a change-event (stamped with provenance) and calls `M1.emit`. M6 never writes to disk _and_ the graph
independently — the change-event is the single chokepoint.

**Invariants M6 must honor.** SC-1 (help-not-cage): M6 tools **never deny**; the grounding block on a return is
**advisory** (a "did you mean?" with a proceed-anyway escape) — it never blocks. The _only_ deny in the whole system
is M3's close-gate + M7's cost-cap, both routed through M9's single `canUseTool` channel — not M6. Mutation
chokepoint (P7): every write becomes a change-event via `M1.emit`; there is no side-door write. Distilled returns:
raw blobs stay in the daemon; tool returns carry a handle + pointer. Strict-superset (D85): the whole-file escape
and `coa raw` floor are always reachable; the diff path is preferred, never mandatory.

---

### M7 — Governance & Audit

#### Identity

- **ID:** M7 · **Responsibility:** bound and record what the rented agent loop **costs** and **changes** — and
  nothing more. M7 owns the one hard cost cap, the secret-clean audit ledger, the visibility floor over governance
  changes, the sandboxing posture (the adversarial control), the process-isolation posture (the honest
  blast-radius record), and the append-only Decision log. M7 is **consulted** by other modules and **surfaces
  through** M3; it does not reach into them. · **Durability:** WITH-MODEL (governance/audit is coa's appreciating
  identity) + NEUTRAL (the cap is a stable billing utility).
- **Secrets note (load-bearing).** This module cluster is secret-sensitive. Examples are synthetic only. The ledger is the
  single biggest secret-leak risk surface in coa; its privacy contract (D135) is a hard, deterministic allow-list, not a
  nicety. Treat the allow-list as a build requirement.

#### Public interface

All methods are synchronous and deterministic (no model on any M7 path).

- `chargeAndCheck(cost) -> ok | capHit` — record a unit of spend against the running total and report whether the
  hard cap is reached. A `capHit` is one of coa's only two blocking outcomes. M8 and M9 consult this before and
  during a session.
- `record(event) -> void` — append an **allow-listed** projection of a runtime event to the audit ledger. The
  method rejects (drops + does not persist) any field outside the D135 allow-list. Prose-bearing fields never reach
  this method (DT-5).
- `surfaceSubtractiveChange(diff) -> void` — turn a _subtractive_ governance change (muting/weakening a constraint,
  broadening a scope, adding a suppression region) into a reviewable feed item. This is the D147 visibility floor:
  it notifies/logs, it does **not** block.
- `decisionLog.append(entry) -> id` / `decisionLog.read(id) -> Entry` — the append-only, numbered Decision log
  (D73). `read` is called by M6's `get_decision` / `why` / `get_spec` tools.
- `vouch(human) -> void` — record a human-issued vouch (D137). Only a human caller may invoke this; an agent may
  _request_ a vouch but can never grant one.
- `sandboxPolicy() -> CapabilitySet` — return the per-session capability set (allowed tools, deny-rules, permission
  mode, `denyRead` globs) the adapter (M9) enforces for a session (D148).
- `selfModGuard(promotion) -> allow | needsPinnedSpine` — gate a self-modifying promotion against the
  golden-corpus / pinned-spine rule (D138 guard half).

#### Depends-on

- **M0** (record/ledger/manifest types).
- **M1** — the ledger and the Decision log are WAL-fed projections off M1's append log; cost is a
  change-event-adjacent signal. M7 reads M1 like any other consumer.
- M7 does **not** depend on M3/M5/M6/M8/M9. It is _consulted by_ M6 (Decision-log reads, cap state), M8 (cap +
  sandbox policy at launch), and M9 (sandbox policy + eval-guard, handed to M9 by M8 at session build); and it
  _surfaces through_ M3 (the visibility-floor feed item is rendered as an M3 feed item). None of those create an
  M7→peer compile-time edge.

#### Owned decisions (final form)

**D35 / D93-simple — the hard cost cap (locked; the one non-flag block).** A single, hard ceiling on rented-loop
spend. coa meters every model call's cost and stops the loop when the running total reaches the configured ceiling
(`fail-expensive` — refuse rather than overspend silently). This is **one of only two things in all of coa that
blocks** the agent (the other is M3's close-session Type-1 gate). The cap reaches the loop through M9's single deny
channel (`interceptTool` / `canUseTool`): a `capHit` denies the next tool/model call. **v1 = the simple ceiling**
(`D93-simple`): a single configured ceiling, attended (D92), fail-expensive. The _two-tier regime-aware cap_ (D93
full — ceiling + human-reserve band + fail-expensive) is **deferred to v2** and ships together with autonomous mode;
v1 is attended, so the reserve band buys little. Re-arms with autonomy.

**D135 — the minimal, secret-clean audit ledger (locked; the secret guard).** A local-only billing/audit record defined
by a **strict allow-list (NOT a deny-list)** over the event schema.

- **Allowed fields (the ONLY permitted attributes):** numeric token counts · cost · cache hit/miss · anonymized
  node-IDs (hashed or relative, never an absolute path) · rule-IDs · coarse scope name.
- **Forbidden, by schema (never recorded):** raw file contents · raw flag messages · prompt/response text · full /
  absolute paths. A deterministic redaction station on the ledger writer enforces the allow-list (P1) — a field
  outside the allow-list is dropped, never persisted.
- **Local-only by construction:** the ledger lives under `.coa/local/` (gitignored), written in-process / over the
  OS socket — **never network-exposed** and never leaves the machine in v1.
- **Distilled-handle discipline:** the ledger stores a distilled handle + pointer; the raw blob stays in the daemon.
- **The ledger-sync tripwire (armed):** shipping **any** ledger sync or upload re-arms a tripwire exactly like
  D84's `~/.coa` sync. v1 is local-only-by-construction, so the wire is un-tripped by construction. If ledger-sync
  ever ships, the allow-list is the guard, and the sync must remain an allow-listed projection only.
- **DT-5 pin (non-negotiable):** **prose-bearing fields stay WAL-local and NEVER enter the sync-eligible ledger** —
  specifically the D131 flag-feedback _reason_ text, the D137 _vouch_ note, the D73 Decision-log _entry_ text, and
  the CF-* flag *messages\*. These live only in the kernel's WAL (M1). The ledger's `record()` method must
  structurally exclude them.

**D147 — the visibility floor (locked; REPLACED the heavy two-key TCB for attended v1).** The control that replaced
the originally-designed two-key trusted-computing-base ceremony. The two-key gate ("the agent must not author the
rules that govern it") is an _adversarial_ control, but v1 is single-user, attended (D92), and local-first, so the
adversarial model is weak and the realistic concerns are better handled by sandboxing (D148) and architectural
separation. **What it IS:** _subtractive_ governance changes — muting or weakening a constraint, broadening a scope,
adding a suppression / ignore region — are **SURFACED and reviewable, NEVER silently applied**. This is a notice / a
feed item, **not** a blocking ceremony. The rationale is non-adversarial: the agent makes mistakes, and coa's whole
point is catching drift — so it must never silently switch off the catcher inside a large diff unnoticed. _Additive_
proposals need no gate. **Re-arm:** the heavy two-key TCB (D64 / GAP-A) is **deferred** and **re-couples with
autonomy**. Anywhere a hardened feature previously leaned on the "D64 two-key TCB," it now reads "surfaced/reviewed

- sandboxing (D147/D148)."

**D148 — sandboxing first-class (locked; THE adversarial control).** coa explicitly documents agent sandboxing as a
first-class design assumption and **the** control for adversarial / prompt-injection threats — capability scoping,
Claude-Agent-SDK permission modes, and D85 deny-rules. The D147 downgrade is _valid only because_ sandboxing carries
the adversarial weight. `sandboxPolicy()` returns the per-session capability set the M9 adapter enforces.

- **Honest scope (DT-1, tied to D141(d) — load-bearing):** the SDK OS sandbox bounds **bash subprocesses and their
  children only**. It does **not** sandbox the daemon host process, the in-process MCP tool handlers, the in-process
  hook callbacks, or the built-in Read/Edit/Write tools (those go through the permission layer, not the OS jail),
  and **subagents share the parent's process and sandbox**. So the v1 in-process blast-radius bound is **D92
  (attended) + worktree confinement + the escape-gate + the D96 deny-rule representation** — NOT the OS jail. The
  _true_ in-process fix is per-session process isolation, deferred to v2 (D141).

**D141 — process-isolation posture (locked posture half; host half is M8).** The honest record of coa's
process-isolation reality. **(a) The corrected fact:** under the daemon topology, the agent loop, its in-process MCP
tool handlers, and its in-process hooks all run _inside the one daemon process_ that holds the plaintext provider
key, the WAL + in-memory graph, and the approval/secret socket. The SDK OS sandbox bounds only bash + children. **(c)
v1 hardening (cheap, deterministic — enforced via M9/M8):** validate every in-process MCP tool input and JSON-RPC
payload with Zod _before the handler touches shared state_; set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` on so provider
creds are stripped from bash subprocess env; set the SDK sandbox `denyRead` to include `~/.coa/secrets/**`, `~/.ssh`,
`~/.aws`, `~/.config/gcloud`, re-allowing only the worktree. **(d) Honest scope:** the (c) controls bound **bash,
not the in-process surface**. **(e) v2 prerequisite:** full per-session process isolation is re-labeled a
**security** seam and is a **HARD prerequisite for the v2 autonomous transition**, alongside D91 + D93. **Split:**
M7 owns the **posture / honest-scope record** (this block); **M8 owns the daemon host.**

**D73 — the append-only, numbered Decision log (locked; cheap survivor).** A durable, append-only, numbered log of
governance decisions (diff-categorized sync/adopt entries plus the design Decision records). It is a _visibility /
provenance_ record, not a gate. Survives the D147 downgrade. Read by M6's `get_decision` / `why` / `get_spec`.
Implemented as a WAL-fed M1 projection. The Decision-log _entry text_ is prose-bearing — it stays WAL-local and
never enters the sync-eligible ledger (DT-5).

**D137 — human-only `/vouch` (locked; the GAP-A guardrail that survives).** A human-issued-only `/vouch <node>` verb
that writes a human-confirmation timestamp + commit-hash (`vouched-at=<commit>`) into the (otherwise stubbed) D66
vouch slot, emitted as a change-event so it stamps the graph node's provenance. A node is treated as fresh while its
watched commit equals the vouched commit; a damping rule stops re-nagging a node vouched more recently than its last
low-severity change. No vouch-expiry / decay machinery in v1. **The load-bearing constraint:** the agent may
_request_ a vouch; **only a human may grant** one. Relaxing this re-arms GAP-A. The vouch note is prose-bearing →
WAL-local, never in the sync-eligible ledger (DT-5).

**D84 — secrets-at-rest posture (locked; reworded tripwire).** v1 provider keys remain gitignored, never-committed,
`0600`, under `~/.coa/` (matching the SDK's `~/.claude`). OS-keychain / encrypted-at-rest are deferred D62
capability upgrades. **Reworded hard tripwire:** keys must move to OS-keychain or encrypted-at-rest **before secrets
live in _any_ tree subject to backup or sync — including OS-level sync the user already runs** (OneDrive / Dropbox /
iCloud / Time Machine / corporate backup-EDR), not only before coa's _own_ sync feature ships. **v1 mitigation
(deterministic):** on startup, detect whether `~/.coa/secrets/**` sits under a known ambient-sync root and warn once;
prefer placing secrets in a non-synced location. **Recorded residuals (necessary-not-sufficient):** `0600` does
nothing against a same-uid in-sandbox read (the complementary control is the sandbox `denyRead` set); a
root/admin/MDM/EDR on a managed box can read any `0600` file; on WSL2 the Linux-side `~/.coa` is reachable from
Windows by Windows-side tools whose ACLs may be weaker. Keychain / `age`-SOPS implementation deferred to v2.

**D129 — `~/.coa/` backup/sync policy + the secrets single-glob (locked).** **PATH-1-only is the v1 default** (the
conservative path). The **`~/.coa/secrets/**` single glob** is **one** secrets-confinement decision used three ways,
and all three must reference the *same* glob so they never diverge: (1) **do-not-sync** set (D129), (2) sandbox
**`denyRead`** set (D141(c), enforced via M9), and (3) the tree the co-located **ledger allow-list** (D135) must
keep clean. v1 ships PATH-1-only by default; any richer sync path must adopt the ambient-sync-root detection +
`denyRead` guards or ship PATH-1-only.

**D138 — self-mod guard (locked guard half; eval-gate mechanism is M9).** A self-modifying promotion must pass the
golden-corpus eval gate, and the **pinned-spine-before-it-can-solely-block** rule applies — a promoted rule cannot
become the _sole_ thing blocking the agent without a pinned spine behind it. `selfModGuard(promotion)` returns
`allow` or `needsPinnedSpine`. **Split:** M7 owns the **guard policy** (this block); **M9 owns the eval-gate
mechanism** (running the golden corpus). For attended v1 the guard is the eval gate + surfaced/reviewed approval
(D147), NOT the heavy two-key ceremony. The heavy self-mod guard re-arms with autonomy / F12 (v2).

**D143 — Tier-B A/B cost-ledger record (locked record half; producer is M3, call is M9).** The A/B cost record for
the experimental Tier-B salience-classifier harness rides M7's kept minimal ledger (tokens-per-resolved-flag,
recorded under the D135 allow-list as numeric counts). M7 owns only the **A/B record on the ledger**; M3 owns the
producer + the metric definition; M9 owns the cheap-model classifier call. The Tier-B classifier itself is
wired-but-OFF and never self-enables in-session.

**D78 / GAP-A — the heavy self-improvement gate (deferred; armed tripwire).** The heavy two-key gate /
self-improvement (F12) loop is **deferred** to v2 and re-couples with autonomy. The GAP-A tripwire is **armed**:
auto-merge / rubber-stamp behavior, or relaxing the human-only vouch (D137), re-arms it. v1 is attended, so
un-tripped by construction.

---

### M8 — Daemon Orchestration

#### Identity

- **ID:** M8 · **Responsibility:** be coa's always-on process shell. M8 accepts client connections over the OS
  socket, owns agent-session lifecycle and worktree binding, orchestrates subagents (depth-1), and is the daemon
  **host** process. It is the orchestration hub: it calls `M5.compile()`, hands the neutral config to M9 to render,
  and wires the per-session dependency-injection closures (D121). It owns transport + lifecycle only — the
  Pieces→config translation lives in M5, the backend-native rendering lives behind the M9 port. · **Durability:**
  SUBSTRATE.

#### Public interface

- the **JSON-RPC method catalogue** — the client-facing API surface that M10 (Console) calls over the OS socket
  (JSON-RPC 2.0 + Zod-validated payloads + notifications).
- `createSession(role, scope) -> Session` — start a session: bind a worktree, call `M5.compile(pieces,
capabilityFrame)`, hand the resulting neutral config to M9 to `renderNative`, consult M7 for the cap + sandbox
  policy, construct the per-session M9 adapter, and run the session.
- `closeSession(id) -> void` — tear a session down (checkpoint at the boundary via M1, release the worktree).
- `notify(push) -> void` — server→client notifications: live flags / drift / cost / approvals + streamed tokens.

#### Depends-on

- **M0** (payload + manifest types).
- **M1** — sessions read/emit through the kernel; checkpoint at session boundaries.
- **M5** — M8 calls `M5.compile(pieces)` then hands the **neutral** config to M9 to render.
- **M4** — the assembled context that M5 compiles.
- **M7** — consults the cap + sandbox policy at launch.
- **M9** — constructs the per-session adapter instance and renders M5's neutral output to backend-native.

M8 is the hub that wires the runtime-injection closures (D121): M9 compiles against `spi` + M0 only, and M8 hands it
the live M3/M4/M5/M6/M7 references at session construction. This keeps M9 a swappable leaf rather than a fan-in hub.

#### Owned decisions (final form)

**D112 / D113 — headless lingering TS daemon + thin socket clients (locked).** coa runs as a **headless,
long-lived TypeScript daemon** that holds all state (WAL, in-memory graph, sessions) and serves **thin socket
clients** (the Electron app + the CLI). Sessions live _in-daemon_. The daemon starts on the first `coa open` (like a
language server) and lingers. Code-intel parsing runs behind an extractable child-process seam (per D141(b) — the
tree-sitter parser is a separate `code-intel` process so a native-addon crash on a hostile file does not take down
the whole daemon).

**M8 owns the daemon host (D112/D113 + D141 host-half) (locked).** M8 owns the **daemon host process** — the
process inside which the future D141 per-session child-process isolation will run. (M7 owns the isolation _posture /
record_; M8 owns the _host_.) The v1 daemon is a single process; the v2 isolation seam runs child sessions under
this host over IPC.

**D124 — OS socket + JSON-RPC 2.0 + Zod (locked).** The daemon↔client transport is an **OS socket** (Unix domain
socket / Windows named pipe) speaking **JSON-RPC 2.0**, with all payloads **Zod-validated** at the trust boundary
(validate-before-touch — see D141(c)) and server→client **notifications** for live push (flags / drift / cost /
approvals / streamed tokens). Whatever can reach the daemon can approve a push or a secret read — so the socket is
defended like the keys are (see D140).

**D127 — wire protocol policy (locked; M8's half of a 3-way split).** The JSON-RPC / tool-return **protocol policy**
over the M0 byte grammar. M8 owns the _policy over the wire_: collision defense via live `slash_commands`
enumeration (so coa commands never silently shadow the backend's); the distilled-return discipline (a tool return is
a distilled handle + pointer, raw stays in the daemon); and the `listChanged`-doesn't-mutate-prefix guardrail (a
dynamic tool-list change must not invalidate the byte-stable cached prompt prefix). **Split:** M0 owns the
byte-grammar **types**; **M8 owns the wire policy** (this block); M10 owns the human-facing client grammar. Three
disjoint concerns.

**D140 — OS-socket security & lifecycle contract (locked; the approval/secret gate).** One contract covering socket
placement, peer authentication, and crash-safe lifecycle. The socket IS the approval gate and the secret-read gate,
so a lifecycle bug (stale-socket squat) and a security gap (no peer-cred) are the _same_ attack — a non-owner
process speaking JSON-RPC and approving a push.

- **Unix (macOS / Linux / WSL2):** (1) **Placement:** socket at `$XDG_RUNTIME_DIR/coa/coa.sock` (Linux, when set),
  falling back to `~/.coa/run/coa.sock`; parent directory created `0700` (owner-only). The **directory perms are
  the load-bearing filesystem control** — POSIX does not portably enforce the socket-file's own mode. The socket
  file is `0600` as defense-in-depth, not relied on alone. (2) **Mandatory peer-cred:** on `accept()`, read the
  connecting peer's uid (`SO_PEERCRED` / `struct ucred` on Linux; `LOCAL_PEERCRED` at `SOL_LOCAL` / `xucred.cr_uid`
  on macOS/BSD; `getpeereid(2)` where available) and **reject any uid ≠ the daemon owner's uid**. This is the real
  guarantee; it is mandatory, not belt-and-suspenders. (3) **`sun_path` budget:** keep the absolute socket path
  **≤ 104 bytes** (the safe portable floor). Reject/relocate a deep path that would overflow.
- **Windows (named pipe — the advisory/degraded tier):** (4) **Explicit custom DACL:** create the pipe with a
  `SECURITY_ATTRIBUTES` carrying a custom DACL scoped to the current user via the **logon SID** — the Windows
  default SD is **NOT owner-only**, so an explicit DACL is required. (5) **`PIPE_REJECT_REMOTE_CLIENTS`:** set
  `dwPipeMode |= PIPE_REJECT_REMOTE_CLIENTS` (0x8) so remote clients are auto-rejected; pair with
  `FILE_FLAG_FIRST_PIPE_INSTANCE` so a squatter cannot pre-create the pipe name.
- **Lifecycle (both OSes):** (6) **Exclusive-create + liveness probe, NEVER blind-unlink-then-bind:** on startup,
  if the path/pipe exists, _connect-and-ping_ first; only if no live daemon answers, unlink and re-bind. A blind
  `unlink`+`bind` is a TOCTOU socket-squat. (7) **Single-daemon lock:** an advisory `flock` on a separate lock file
  under `~/.coa/local/` (`~/.coa/local/daemon.lock`), **not** the socket-as-lock, so the lock is crash-safe.
  First-writer-wins; a second `coa open` attaches to the running daemon instead of racing a spawn.
- **socket-auth sub-tripwire (armed):** if coa ever ships a **multi-user or remote-daemon** mode, the single-uid
  peer-cred check is no longer sufficient and **per-connection authentication becomes mandatory**. v1 is
  single-user-local → un-tripped by construction.

**D121 — the Session Manager (locked; the per-session lifecycle).** The per-session adapter lifecycle, in order:
**create → attach-worktree → compile → run → distill → close.** `createSession(role, scope)` binds a worktree
(D90/D96), calls `M5.compile(pieces, capabilityFrame)`, has M9 `renderNative` the neutral config, consults M7 for
the cap + sandbox policy, constructs the per-session M9 adapter, runs the loop, distills tool returns (distilled
handle + pointer), and `closeSession` checkpoints at the boundary (via M1) and releases the worktree. The Session
Manager is also where the per-session dependency-injection **closures** are wired (M9 is handed live
M3/M4/M5/M6/M7 references).

**D122 — harness-orchestrated subagents, depth-1 (locked).** Subagents are orchestrated by the harness, bounded to
**depth-1** by **withholding the spawn capability** from the subagents themselves (a subagent cannot spawn its own
subagents). This keeps the fan-out a single, attributable, cost-bounded layer.

**D90 / D96 — coupling-aware fan-out + worktree-per-writer (the worktree manager) (locked).** The **worktree
manager**: each writing session gets its own git worktree (worktree-per-writer), and fan-out is **coupling-aware** —
M8 checks the dependency graph before parallelizing so it does not fan two sessions out onto coupled regions that
would collide. D96 hardens native-workflow governance: one attribution/rewind/cost unit per session, deny-rule
escape representation, the harness owns the SDK launch-approval, and cost is bounded pre-launch — all
**attended-only** in v1 (D92).

**D70 / D77 — spawner Protocol + spec-crystallization Role (locked; session-orchestration, kept in M8).** These are
**session-orchestration** concerns and live in M8 (explicitly NOT in M5 — they are not config _compilation_). **D70
— spawner Protocol:** the agent-proposal Protocol for spawning a subagent is a _Protocol_ (a coa piece delivered
into the loop), **not** a hardcoded harness feature — the agent proposes a spawn; the harness orchestrates it
(depth-1, D122). **D77 — spec-crystallization Role:** the "crystallize this loose request into a spec" capability is
a _Role_ (a composable piece), **not** a built-in feature. It is now unblocked by checkpoint/rewind (D76) being
resolved.

**D72 — command surface as pieces (locked).** The coa command surface (the `coa <verb>` kernel verbs the agent and
human invoke — e.g. `/vouch`, `coa link`, `coa generate`) is composed of **pieces**, not a frozen built-in menu.
Commands are delivered like any other coa piece, so the surface is extensible and composable rather than hardcoded.

**D89 — don't-contradict-CC command grammar (policy half) (locked).** M8's command/RPC policy must not shadow or
contradict the backend's (Claude Code's) own command grammar — coa enumerates the backend's live `slash_commands`
(the D127 collision defense) and maps its own verbs so they never silently override a backend command. **Split:** M8
owns the **grammar-policy** half (this block); M10 owns the human-facing client grammar.

---

### M9 — Runtime Adapter (`spi` + `adapter-claude-sdk`)

#### Identity

- **ID:** M9 · **Responsibility:** Be the **one place backend-specific behavior lives.** M9 implements the
  capability ports against the Claude Agent SDK and renders M5's backend-neutral config into backend-native form
  (SDK options + `.claude` files), so every other coa module stays model-blind. Swapping the backend means editing
  M9's renderer and port implementations — nothing else. · **Durability:** NEUTRAL — the no-lock-in seam.
- **Conventions.** A **port** is a narrow capability interface the core calls. The core NEVER branches on which
  backend is active; if a backend lacks a capability, the port returns a **null-fallback** (a defined "not
  available, degrade gracefully" result), never a thrown error or a `if (backend === …)`.

#### Public interface (the ports — the null-fallback contract)

The core depends on these **port type signatures only** (defined in `spi` + M0); the concrete Claude-SDK
implementation is handed in at runtime. Every port a future backend might lack has a defined null-fallback.

- `runLoop(sessionConfig)` — drive one rented agent turn-loop for a session.
- `registerTools(catalogue)` — register M6's governed tool catalogue (the MCP surface) into the loop.
- `denyBuiltins()` — disable the backend's built-in tools that coa demotes (e.g. the built-in `Edit`, demoted in
  favor of coa's diff-shaped Mutate — a demotable default, never a hard ban).
- `interceptTool(canUseTool)` — **the one and only deny channel.** A single predicate hook the loop calls before
  any tool runs. M9 OWNS the channel (the SDK `canUseTool` wiring); M3 and M7 DECIDE what it returns. Two deny
  reasons only: M3's close-session Type-1 gate and M7's cost-cap.
- `injectSystem(role:system)` — physically inject a non-spoofable `role:system` line mid-conversation (delivers the
  reminder M3 decides — D108/D133).
- `renderNative(neutralConfig) -> backendConfig` — render M5's backend-neutral config to SDK-native options
  (`systemPrompt`, `disallowedTools`, `tools`, `canUseTool`) plus `.claude` files.
- `render_context` / `inject_runtime` / `cache_control` — the three context-delivery ports the M4 context engine
  touches (and the ONLY M9 surface it touches): place assembled context, inject runtime context, set cache
  breakpoints. M4 never sees a backend name.
- `usageTelemetry() -> usage` — report token/cost usage for the cap and ledger.
- `capabilityProfile() -> manifest` — report what this backend supports (null-fallback = the barebones profile).
- `refs(symbol) -> references | null` — the TypeScript-LSP port (D144). Returns precise references when `tsserver`
  is available; **null-fallback** otherwise, and the caller degrades to M2's tree-sitter floor.
- `runEval(corpus) -> result` — run the golden-corpus eval (D138 eval-gate mechanism; D61 gate).

#### Depends-on

- **M0** (shared schema) + the `spi` port types — the ONLY compile-time dependencies.
- At session construction, M8 **hands M9 live references** to M3 (the deny predicate + the D133 reminder decision),
  M4 (the `render_context` source), M5 (the neutral config to render), M6 (the tool catalogue), and M7 (the sandbox
  policy + eval guard). These are **runtime injections (D121 closures), not compile-time dependencies.** M9 stays a
  swappable leaf; the wiring is M8's job.

#### Owned decisions (final form, self-contained)

**D109 — The capability-port contract (the backend boundary). ✅** The core calls **capability ports and takes a
null-fallback when a capability is absent** — it NEVER writes a `which-backend` branch. A fixed set of narrow port
interfaces implemented once per backend; a missing capability yields a defined "degrade gracefully" null result.
This is the single seam that keeps every other module model-blind. Fold-in: the context engine (M4) touches only
`render_context` / `inject_runtime` / `cache_control`; all other backend behavior is reached through the other ports.

**D126 — On-disk / port byte formats, re-scoped to the INTERNAL D109 port. ✅** The
byte-format and shape definitions for the runtime-adapter seam. An earlier draft baked the shape of the **public,
semver'd D110 SPI** into these formats. The public SPI is **deferred** (defer the public contract + conformance kit
until a real second consumer exists). Therefore D126 is re-scoped at SPEC time to the **internal D109 port only**,
NOT the public SPI. M9 implements the internal port shape; there is no externally published, version-stable adapter
contract in v1. (Also: the WAL frame-migration term is "frame schema migration," not "upcaster.")

**D110 — The public, semver'd Runtime Adapter SPI. ⏸ deferred.** An externally targetable, versioned adapter
contract + conformance kit that a third party could implement to plug a new backend in. Explicitly out of v1; v1
ships only the internal D109 port. Recorded here so the downstream builder does NOT build a public SPI surface.

**D117 — Backend selection: Claude Agent SDK is the v1 backend; Vercel AI SDK is the secondary path. ✅** The
**Claude Agent SDK** is the primary, v1 turn-loop backend (it owns the rented loop, tools, hooks, `canUseTool`,
subagents). A **secondary direct-call path** sits behind a D109 port for own-API-stub work and eval / cheap direct
calls: the **Vercel AI SDK** pinned at **`ai@^6`** with the **`@ai-sdk/anthropic@^3`** provider. _Live-verified (npm
registry + ai-sdk.dev docs, 2026-06-24):_ `ai@6.0.209` is the current stable major; `@ai-sdk/anthropic@3.0.86` is
the v6-paired major; the two are version-coherent (shared `@ai-sdk/provider@3.x`); minimal call shape is
`import { anthropic } from '@ai-sdk/anthropic'` then `generateText({ model: anthropic('claude-…'), prompt })`. Do
NOT jump to the unstable `ai@7` / `@ai-sdk/anthropic@4`. The secondary path is the rail D143's cheap-model
classifier call rides.

**D118 — Reuse the SDK's OS sandbox. ✅** coa does NOT build its own OS sandbox; it reuses the Claude Agent SDK's
sandbox (bubblewrap on Linux, Seatbelt on macOS, plus `sandbox-runtime`). _Honest scope:_ the OS sandbox bounds
**bash + child processes** on Linux/macOS/WSL2; on **native Windows it is advisory** (no equivalent OS primitive).
Tied to M7's D148 and D141(d) — the in-process blast-radius bound in v1 rests on attended operation (D92) + worktree
isolation, not full per-session OS isolation. Fold-in: M9 wires the SDK sandbox from M7's `sandboxPolicy()` at
session launch.

**D108 — Delivery authority (the DELIVERY half; M3 owns enforcement). ✅** Models do not natively honor a
system > user > tool trust order, so coa makes authority **structural**, not a trusted label. The delivery
mechanism: **head placement** (authority content at the front of the prompt) + **tail-reinforce** (re-surfacing it
near the end / at high recency) + a **non-spoofable `role:system` channel** the agent cannot forge. **M9 owns the
DELIVERY mechanism** — _where in the transcript_ the line lands and the physical `role:system` injection. **M3 owns
ENFORCEMENT** — _which_ flags/rules and _how insistently_. The minor-pin: **M9 = mechanism, M3 = decision.** Why:
prompt authority is necessary-but-not-sufficient (P5) — anything that truly matters is also backed deterministically
by M3's gate, never by prose alone. Fold-in: M9 implements `injectSystem` and the head/tail placement.

**D133 — `role:system` reminder DELIVERY (the delivery half; M3 decides). ✅** An escape-gate-anticipating Tier-0
reminder — when the agent is about to do something a critical invariant forbids, the governing rule is re-surfaced
on the non-spoofable `role:system` channel at max recency. **M3 DECIDES** which authority rule to inject and when
(`M3.reminderFor(escapeEvent)`); **M9 physically DELIVERS** it via `injectSystem(role:system)`. M9 owns no salience
logic — it injects the line M3 hands it, at the transcript position D108 dictates.

**D107 — Reminder/trigger model; Tier-B wiring OFF. ✅ / 🟡** Tier-0 (deterministic invariant re-surfacing) and
Tier-A reminders are ON. The judgment-based **Tier-B classifier is wired-but-OFF** — it never runs by default. M9's
half: M9 carries the Tier-B _wiring_ (the plumbing through which a cheap-model classifier call would route if
enabled) in the OFF state; it is never on a critical path. The decision to enable it is M3's, gated by a measured
A/B (D143) + human approval. The reminders themselves deliver via the non-spoofable `role:system` channel.

**D143 — Tier-B A/B cost-ledger harness: the cheap-model CALL (M9's third of a 3-way split). 🟡** The apparatus that
lets D107's Tier-B deferral ever resolve — an opt-in A/B comparing Tier-A-only vs Tier-A+B on
tokens-per-resolved-flag. M3 owns the producer + the A/B metric definition; M7 owns the A/B record on the cost
ledger; **M9 owns the cheap-model classifier CALL** — when (and only when) the Tier-A+B arm is active, M9 routes
`(user prompt × active-context list)` to a cheap model **via the D117 secondary direct-call port** (`ai@^6` +
`@ai-sdk/anthropic@^3`) and returns which active rules are relevant. _Conditions (non-negotiable):_ the classifier
is OFF by default; promotion to on-by-default requires a net-positive A/B AND a human-approved proposal — there is
NO in-session self-enable. M9 adds no new dependency — the call composes over the already-decided D117 secondary
path.

**D138 — Eval-gate MECHANISM (M9's half; M7 owns the guard policy). ✅** The D61 eval/promotion gate runs a **golden
corpus** against a candidate change and returns a pass/fail result. **M9 owns the MECHANISM** — `runEval(corpus) ->
result` actually runs the corpus through the backend. **M7 owns the GUARD policy** — the self-mod guard that decides
what a result is allowed to do (and the pinned-spine-before-it-can-solely-block rule). M9 just runs the eval and
reports; it does not decide promotion.

**D61 / D62 — Eval/promotion gate + capability-addressed profile. ✅** (D61) a gate that evaluates a candidate
(model/profile/promotion) before it is trusted. (D62) coa addresses behavior by **capability** ("does this backend
support X?"), not by backend identity — formalized by D109's `capabilityProfile()`. Fold-in: `capabilityProfile()`
returns the manifest; absent capabilities resolve to the **barebones baseline** (a pinned minimal profile that
always works), so deferring or lacking a capability never removes a feature outright — it degrades it to the floor
(D85 strict-superset).

**D144 — TypeScript-LSP backend (the PORT half; M2 owns the fallback). ✅** A precise reference/resolution capability
for TypeScript backed by a real language server. **M9 owns the PORT/backend** — `refs(symbol)` runs `tsserver` as a
managed subprocess and returns precise references. **M2 owns the null-FALLBACK floor** — its tree-sitter code-intel.
`refs()` returns null when `tsserver` is unavailable or the language is not TypeScript, and the caller degrades to
M2's tree-sitter floor. The LSP is **additive** — every non-TS language keeps M2's floor; nothing is locked to
TypeScript.

**The neutral→native renderer. ✅** The backend-shaped half of config compilation that the structural stress-test
ruled must live behind the port. `renderNative(neutralConfig)` turns M5's backend-NEUTRAL `NeutralConfig` into
SDK-native options (`systemPrompt` / `disallowedTools` / `tools` / `canUseTool`) plus `.claude` files. _Why here,
not M5:_ M5's output is deliberately backend-neutral so M5 stays swappable; the backend binding happens ONLY in M9.
Swapping the backend edits this renderer, never M5 or M8. _Cache invariant honored:_ the renderer keeps the
most-stable-first byte-stable prefix M5 produced and never self-busts the prompt cache (no mid-conversation
`systemPrompt` edits; dynamic context goes through `inject_runtime` / `role:system`).

**The barebones baseline. ✅** A pinned, minimal capability profile guaranteed to work on any backend (D109). It is
the floor `capabilityProfile()` falls back to — the null-fallback contract always has a defined "least-common
behavior" to land on.

**The one deny channel (F-6 — issued through M9, DECIDED by M3/M7). ✅** `interceptTool(canUseTool)` is the SINGLE
place anything can cage the agent. It returns a deny for exactly two reasons: M3's close-session **Type-1 gate** and
M7's **cost-cap** hit. _Why concentrated:_ it makes the entire "what can stop the agent?" surface auditable in one
place (SC-1). M3 and M7 each hand M9 an independent predicate at session build; there is no M3↔M7 edge, and M9 holds
no policy of its own. Every other coa behavior is advisory and never denies.

---

### M10 — Console (`app` + `cli`)

#### Identity

- **ID:** M10 · **Responsibility:** Present coa to the human — **CLI verbs first**, a **pull/inspector GUI**, and
  the honest **`coa raw`** escape — without ever owning logic the daemon owns. It is a thin, leaf client. ·
  **Durability:** NEUTRAL.

#### Public interface

**None inward — M10 is a leaf consumer.** It exposes no API to other modules. It TALKS ONLY to **M8's JSON-RPC
method catalogue** over the OS socket, and renders M8's server→client notifications. Everything else (the kernel,
flags, cost, context, graph) is reached _through_ M8. M10 never reaches into M1/M3/M4/M7 directly.

#### Depends-on

- **M0** (shared schema, for the JSON-RPC payload types) and **M8** (the only module it talks to).

#### Owned decisions (final form, self-contained)

**Ruling 12 — CLI-first; the inspector GUI; silent/opt-in push-alerting. ✅** The console ships **core CLI verbs
first.** The GUI is a **pull/inspector** — the human opens it to look, it does not nag. **Push-alerting is silent
and opt-in:** it surfaces a notification only on a **cost-cap hit** or a **high-severity flag**, and rides M3/M4's
precision contract so it can never become alert-noise. The always-on Electron **push-dashboard is DEFERRED.**
Fold-in: the pull/inspector GUI stays in v1 (it is the home of `coa context`, the precision dashboards, and the
graph/scope/agent views); only the _push_ surface is held to cap-hit + high-severity.

**`coa raw` — the strict-superset floor (D85). ✅** A discoverable verb that honestly prints what coa is doing to the
rented loop and **what it cannot turn off** — the raw rented loop is never hidden. coa is a **strict superset** of
the bare Claude Agent SDK loop — every coa feature must either add value or degrade to a literal pass-through; `coa
raw` is the floor that proves it. Fold-in: `coa raw` is the v1 realization of the D74 rigor-preset dial's floor —
the _floor_ (a literal raw pass-through) ships in v1; the **dial itself** (named presets above the floor —
prototype/tool/product — binding the governance axes) is **deferred machinery, see `OPEN.md`**.

**D114 — Electron + React shell, Tauri-swappable. ✅** The inspector GUI is an **Electron + React** desktop app, with
**Tauri** named as a later swappable alternative. Desktop-only in v1. It is a pure client of M8's JSON-RPC catalogue

- notifications; it holds no daemon logic.

**D128 — UI information architecture + renderer-isolation + diff-fidelity. ✅ (sits with D114)** Three zones — a
**conversation pane**, an **urgency-ordered dashboard rail**, and an **event-driven approval surface** — plus a
**renderer-isolation contract** (the Electron renderer process is isolated from node/privileged APIs),
**byte-faithful diff-fidelity** (diffs are rendered exactly as the bytes are; no silent truncation or
normalization), and **notification batching** (so alerts coalesce, never storm). Fold-in: the byte-faithful,
no-silent-truncation diff render _strengthens_ M7's D147 visibility floor — subtractive/governance changes are shown
honestly, never masked by the UI.

**The inspector content (what the pull GUI shows). ✅** The inspector is the home of:

- `coa context [scope]` — show + diff the **ephemeral, byte-stable assembled context package** (the package is M4's;
  the inspector renders it). It is an inspectable cache, NOT a committed git artifact; the WAL freshness stamp
  answers "is it current?".
- the **precision dashboards** — precision/recall for flags/grounding, riding M3's kept minimal secret-clean ledger
  (counts + anonymized IDs only; never raw prompts/secrets).
- the **graph / scope / agent views** — read-only views of M1's dependency graph, declared scopes, and live agents.
  All of this is rendered from data pulled over M8's JSON-RPC catalogue; the console computes nothing authoritative.

**D89 — Don't-contradict-Claude-Code command grammar. ✅** coa's command grammar must NOT shadow or contradict Claude
Code's. Mapping rules: coa verbs don't reuse a Claude Code verb name with a different meaning, and coa never
silently overrides a Claude Code command. Shared between M10 (the human-facing grammar) and M8 (the wire policy
half); M10 owns the surface a human types.

**D127 — Client command grammar (M10's third of a 3-way split). ✅** M10's half is the **`coa <verb>` human-facing
command surface** + the **in-session reservation token** (the mechanism by which a verb typed mid-session is
recognized as a coa command, not agent input). The 3-way split: **M0** owns the byte-grammar TYPES; **M8** owns the
wire POLICY (collision defense via live `slash_commands` enumeration, distilled-return discipline); **M10** owns
this human-facing command grammar. M10 defines what the human types and how it is recognized; it sends the parsed
call over M8's JSON-RPC catalogue.

---

_End of SPEC.md. The eleven module specifications above are the complete WHAT, by module. For the build order and
the v0 calibration spike that gates it, see `IMPL-SPEC-BRIEF.md`; for deferred scope, tuning knobs, and open risks,
see `OPEN.md`. These three docs are the complete, self-contained handoff._

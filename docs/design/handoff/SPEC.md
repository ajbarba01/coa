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
to build v1 coa is in these three docs; no planning-corpus file is required.** (A fourth file, `IMPL-SPEC.md`, is a
**provenance record only** — it documents *why* the 2026-06-25 stress-report-closure edits were made and carries the
SDK-fact citations behind them; its content is already folded into these three docs, so it is **not** required to
build.)

- **`SPEC.md` (this doc) — the WHAT, by module.** The eleven modules M0–M10, each with its responsibility, public
  interface, dependencies, and owned decisions in final form. Build a module from its section plus the published
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
| M9 Runtime Adapter | `spi` (ports) + `adapter-claude-sdk` (impl: the neutral→native renderer, the TS-LSP backend, the SDK loop) |
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
- `Piece` — the ONE composable content-atom type, configured by three orthogonal axes (the TAX-* collapse; **Role**
  stays a separate type — see `BundleManifest`).
- `CapabilityProfile` — the adapter capability-profile manifest shape.
- `RpcPayload` schemas — the JSON-RPC 2.0 request/response/notification payload shapes, as Zod schemas.
- `GraphNode` / `GraphEdge` / `EdgeType` / `SymbolRecord` / `GraphView` — the typed-dependency-graph and
  symbol-table schema (types only; M1 owns the live runtime).
- The JSON-RPC + tool-return **byte-grammar types** — the schema half of the wire grammar (the *policy* over that
  grammar lives in the daemon module M8; the human-facing command grammar lives in the console M10).

#### Depends-on
Nothing. M0 is the acyclic-graph root.

#### Owned decisions (final form)

- **Flag record schema (D11 + CF-1/CF-2/CF-7) — LOCKED.** The one record every check-producer emits and every
  consumer reads, a SARIF-subset:
  `{ ruleId, location, severity, message, fix?, fingerprint, type, confidence, concernKey }`. **M0 owns these
  fields; the LOGIC that assigns `severity`, `confidence`, `type`, and `concernKey` is M3's** (D134 severity
  projection + CF-2 two-axis assignment + CF-7 dedup — see M3 below). The field semantics M0 fixes:
  - `severity` and `confidence` are **two independent axes** (CF-2): severity = how bad if real; confidence = how
    sure it is real. A flag is never collapsed to one number. *The values are assigned by M3, not M0.*
  - `type ∈ {1, 2}` is **producer-stamped** (the producer that emits the flag sets it; no consumer holds a
    `producerId → type` map). Type-1 = deterministic, gate-eligible; Type-2 = judgment/advisory, never blocks.
  - `concernKey` is the **cross-producer dedup key** (camelCase, matching `ruleId`): two producers flagging the same
    underlying concern collapse to one feed item via this key. *The dedup logic that uses it is M3's CF-7.*
  - `fingerprint` is the stable identity used for baselining/suppression (a suppression is keyed on it).
  - `fix?` is an optional deterministic auto-patch payload.
  - The `severity` slot is fed by M3's **spec-drift severity projection** (D134); M0 owns only the slot.

- **Change-event log line frame — D126 clause 1 — LOCKED.** The durable
  log is **NDJSON**: one Zod-validated change-event per `\n`-terminated line, single-writer (the daemon). Each
  frame:
  ```jsonc
  {
    "schema_version": 2,          // every frame self-describes; the reader runs frame-schema-migration before any projector
    "seq": 4711,                  // monotonic per-log; the consumer cursor key + gap detector + projector ordering key
    "ts": "2026-06-23T22:00:00.000Z", // recorded, NEVER the dedup boundary
    "worktree": "<id|@global>",   // attribution / rewind unit ("@global" for daemon-wide governance events)
    "actor": "<session|reconciler|human>",
    "op_id": "<ulid|null>",       // non-null for all precise + edge + governance kinds; null ONLY for a reconciler file obs
    "provenance": "declared|inferred|gated",
    "cause": null,                // optional { "kind":"regenerate", "sourceEventSeq":<n> } — survives the WAL (M4 stamps it)

    // discriminated `kind`:
    "kind": "modify|create|delete|rename|confirm",   // (1) FILE change — + path / pre_hash / post_hash / generated
    "path": ".../redact.md",
    "pre_hash": "<sha256|null>",  // the causal transition key (null for create)
    "post_hash": "<sha256|null>", // (null for delete)
    "generated": false            // true ⇒ a reconcile-include gitignored path (lower trust, inferred)
    // kind = "assert-edge" | "retract-edge"  ⇒ payload { from, to, type:EdgeType, why? }   (graph edge writes)
    // kind = "declare-symbols"               ⇒ payload { symbols:SymbolRecord[], from:<source> }  (L-GEN seam)
    // kind = "governance"                    ⇒ payload GovernancePayload  (M7 — see DT-5 prose-bearing rule)
  }
  ```
  Four rules baked into the frame: (a) **causal dedup, not time-window** — a disk observation matches a precise FILE
  event as a *confirmation* on **`(worktree, path, pre_hash, post_hash)`** (the canonical key, stated here; D120
  defers to this; the reconciler, which may lack `pre_hash` for a bare observation, matches on
  `(worktree, path, post_hash)` as a *confirmation candidate* and upgrades when the precise 4-tuple arrives); the
  wall-clock `ts` is a coalescing hint only; (b) **dedup scope** — causal dedup applies **only to the five FILE
  kinds**; `assert-edge`/`retract-edge`/`declare-symbols`/`governance` frames always carry a non-null `op_id` and
  `declared|gated` provenance, are never reconciler-observed, and pass through with no dedup; (c) **schema evolution**
  — `schema_version` lets the reader run the **frame-schema-migration** chain (M1's WAL reader owns it; on a *higher*
  unknown version the reader refuses to start and quarantines the segment — never silently skips) before any projector
  sees an event; (d) the frame is consumed strictly in ascending `seq`. **Prose-bearing governance bodies**
  (decision-log entry text, vouch note, flag-feedback reason) stay WAL-local and never reach the sync-eligible ledger
  (DT-5); the ledger records only the allow-listed numeric/anonymized projection of a `cap-record`.

- **Piece type (D101 / the TAX-* collapse) — LOCKED.** A `Piece` is the **ONE** composable content atom (the former
  kinds `knowledge | protocol | behaviour` collapse into it; **Role** stays a separate type — see `BundleManifest`,
  TAX-6). On disk a piece is YAML front-matter + a Markdown body, a strict superset of a Claude Code `SKILL.md`.
  Front-matter carries **CC-native keys that round-trip verbatim** (`name`, `description`, and any other CC/plugin
  keys observed in the field — `disable-model-invocation`, `version`, `compatibility`, `license`, `metadata`, …)
  plus coa-only keys — the **three orthogonal axes** whose semantics M5's TAX-* family owns:
  - **`delivery: pull | push`** — `pull` = not in the prefix, body pulled on demand (`get_piece`); `push` =
    delivered into context, **optionally scope-gated** via `scope`. (`push`+no-scope = resident; `push`+`scope` =
    scope-triggered = SCO-4.)
  - **`salience: never | <cadence>`** — reminder eagerness (never → every-turn); v1 cadence = "tokens since last
    reminder" (== Tier-0).
  - **`provenance: authored | derived-from-code`** — the GEN-7 trust axis (grounding may use `authored`, never
    `derived-from-code`).
  **Authority is NOT a front-matter flag** — it is a **`governed-by` graph edge** from the Piece to a constraint
  (TAX-2); the dissolved `force`/`persistence`/`kind` keys are reproduced by the axes + this link. Other coa keys:
  `scope`; `bundle: <name>@<version>` (SemVer); `source: {origin, version|hash, importTrust}` (the D31 import-trust
  descriptor — **renamed from the earlier `provenance:{…}` object at fold-in to end the word-collision with the
  GEN-7 `provenance` axis**, same convention as upcaster→frame-schema-migration). **Empty config == vanilla skill**
  (load-bearing): a SKILL.md with no coa keys is `delivery=pull, salience=never, provenance=authored, no link` =
  today's skill behavior exactly. **No volatile keys** (timestamps/counters/IDs) ever appear in front-matter — that
  would bust the prompt cache. The Markdown body IS the content. M0 owns only the *type + axis fields*; the
  axis→slot compilation + normalization is M5's TAX-* family.

- **Capability-profile manifest shape (D62 / D109) — LOCKED.** The `capability-profile.yaml` shape: the set of
  capability **ports × {present | absent + declared null-fallback}**, per runtime × model, plus an `spi_version`
  string. (D109 is the rule that the core calls capability ports and takes a defined null-fallback when a port is
  absent, never a `which-backend` branch — M9 implements the ports against the Claude Agent SDK.) A `degradation:`
  block reports each fallback relative to the integrity floor (the provenance-blind reconciler), so a missing port
  reads as *honest-and-safe*, never as a recipe to disable a control. M0 owns the manifest *shape*; M9 owns the
  ports.

- **JSON-RPC payload Zod schemas (D124) — LOCKED.** The request/response/notification payload schemas for the
  daemon protocol: OS-socket transport carrying JSON-RPC 2.0 + Zod-validated payloads, with notifications for
  server→client push. M0 owns the *schemas*; the transport and lifecycle are the daemon module M8.

- **Graph / symbol-table schema + `GraphView` (minor-pin F) — LOCKED.** The node/edge/symbol-record types and the
  read-only `GraphView` interface, **types only**. The graph is a typed dependency graph (D16): nodes = pieces,
  project files, constraints, code, tool/library versions, derived artifacts, work-artifacts, scopes, symbols; edge types =
  `documents | covers | imports | derived-from | depends-on | watches | generated-from | governed-by | calls | inherits`
  (`generated-from`/`governed-by` are the L-GEN/L-GND seam edges — `generated-from` = target⇐source regenerate provenance,
  `governed-by` = symbol⇐governing spec/decision; the `coa:covers` annotation syntax in M4/L-DET creates a `covers` edge;
  **`calls`/`inherits` are the GRF-4 symbol-level coupling edges** that feed the HLT-* coupling metrics and the cycle finder).
  Every edge carries an **`EdgeProvenance`** (`declared | inferred | convention | gated`, GRF-3) and an optional coupling
  **`weight`**. `depends-on` is a DAG **at the declared layer** (D50: a declared edge that would create a cycle is rejected;
  `watches` may cycle freely). **Inferred code-import cycles are NOT destructively collapsed (GRF-1, reshaped):** every
  intra-cycle edge is retained and stamped with its `inScc` id; the strongly-connected-component super-node is a
  **propagation VIEW** computed on demand (staleness reads the SCC as one unit), while the **cycle itself is a first-class
  HLT-* finding** (health reads the retained edges and surfaces the specific back-edge to cut). A `SymbolRecord` is the
  per-symbol fact (name, signature, defining location, scope). Defining these types in M0 (not M1) is what lets M2 and
  every consumer compile against the schema without depending on M1's runtime.

- **JSON-RPC + tool-return byte-grammar TYPES (D127, schema half) — LOCKED.** The TYPES of the command / JSON-RPC /
  tool-return byte grammar. The *wire policy* over this grammar (collision defense, distilled-return discipline,
  the guardrail that a `listChanged` notification does not mutate the cached prefix) is owned by the daemon M8; the
  *human-facing* `coa <verb>` command grammar is owned by the console M10. M0 owns only the byte-grammar types —
  the schema third of the three-way D127 split.

- **D-CAT — the M0 type catalogue (LOCKED).** M0 is the root every module compiles against, so **every type a
  consuming interface uses is defined here or explicitly delegated** (the live graph/symbol *runtime* is M1's; flag
  *values* are M3's — M0 owns the schema/slots). Three `Capability*` names are disambiguated once: **`CapabilityFrame`**
  = pre-compile per-(sub)agent allow/deny tool intents; **`CapabilityProfile`** = the backend port manifest;
  **`CapabilitySet`** = the enforced per-session sandbox set. `M1.lookup` returns **`SymbolRecord`** (the one symbol
  type — the name "SymbolFacts" is not used). The authoritative shapes (TypeScript-with-Zod; `NeutralConfig` lives
  here, not M5):
  ```ts
  type WorktreeId = string;  // "@global" = reserved daemon-wide sentinel       type SessionId = string;
  type ScopeExpr = { tag:string } | { glob:string } | { dependsOn:string } | { reachableFrom:string }  // SCO-1 leaf bases
            | { scope:ScopeRef } | { any:ScopeExpr[] } | { all:ScopeExpr[] };                          // composition + ∪/∩ set algebra
  type Scope = { name:string; include:ScopeExpr; exclude?:ScopeExpr;                                   // SCO-1 (supersedes glob-only D32)
            attach?:PieceRef[]; mayDependOn?:ScopeRef[] };               // attach = SCO-4 delivery · mayDependOn = SCO-6 (deferred-enforce)
  type ScopeRef = string;   // D32
  type ScopeResolution = { scope:ScopeRef; members:string[]; walPosition:number; degraded?:string[] };  // SCO-2 cached projection + freshness
  type ScopeActivation = { scope:ScopeRef; trigger:'read'|'edit'|'mention'|'session'; injected:PieceRef[]; suppressed:PieceRef[]; why:string }; // SCO-4/5
  type SymbolRecord = { name:string; signature?:string; definedIn:string; scope?:ScopeRef; kind?:string; generated?:boolean };
  type RankedCandidate = { symbol:SymbolRecord; confidence:number; why:string };           // M1.fuzzyMatch
  type EdgeType = 'documents'|'covers'|'imports'|'derived-from'|'depends-on'|'watches'|'generated-from'|'governed-by'
            | 'calls'|'inherits';                       // GRF-4: symbol-level coupling edges (calls/inherits) feed CBO/RFC + the cycle finder
  type GraphNode = { id:string; kind:'piece'|'file'|'constraint'|'code'|'version'|'artifact'|'work'|'scope'|'symbol' };
            // ^ GRF-2: the THIRD (architectural/module) granularity tier is the existing kind:'scope' node, not a new kind (rides SCO-*)
  type EdgeProvenance = 'declared'|'inferred'|'convention'|'gated';   // GRF-3: convention = a deterministic per-ecosystem extractor (codegen markers / registry call-sites / build-config), distinct from a bare AST `inferred` import
  type GraphEdge = { from:string; to:string; type:EdgeType; provenance:EdgeProvenance; why?:string;
            weight?:number;                             // GRF-4: coupling weight (e.g. call count); default 1; consumed by HLT-* coupling metrics, never by staleness
            inScc?:string };                            // GRF-1: SCC id IFF this edge is inside a cycle — retained, NEVER deleted by collapse (the collapse is a VIEW)
  type GraphView = { /* read-only query surface; minor-pin F */ };
  type MetricId = 'cycle'|'propagation-cost'|'core-size'|'cbo'|'rfc'|'fan-in'|'fan-out'              // HLT-* signals; a PROFILE, never summed (HLT-2)
            |'cognitive-complexity'|'churn'|'hotspot'|'change-coupling'|'size-loc'|'instability'|'lcom4';
  type MetricGranularity = 'symbol'|'file'|'scope'|'system';                                          // HLT-1 the four tiers a metric reports at
  type MetricSample = { metric:MetricId; granularity:MetricGranularity; target:string;               // target = node id / scope ref
            value:number; sizeLoc:number;                                                             // sizeLoc ALWAYS reported alongside (HLT-3 confound control)
            basis:'graph'|'ast'|'wal'|'graph+wal'; confidence:'high'|'low'; walPosition:number };     // basis = where computed (HLT-1); confidence low where the parser/edge is partial
  type HealthProfile = { target:string; granularity:MetricGranularity; samples:MetricSample[];        // a NON-compensatory vector (HLT-2), not a rolled-up score
            worst:MetricId[] };                                                                       // the worst-of signals that drive the advisory (no weighted sum can hide a hotspot)
  type ToolCall = { tool:string; args:Record<string,unknown>; ref?:SymbolRef; sessionId:SessionId };
  type SymbolRef = { name:string } | { path:string; symbol?:string };
  type DiffSpec = { form:'search-replace'; hunks:{find:string;replace:string}[] }            // Ruling-3 lenient edit grammar
            | { form:'unified'; patch:string } | { form:'whole-file'; body:string };
  type Patch = { target:string; diff:DiffSpec };  type ContextSlice = { ref:SymbolRef; bytes:string; truncatedTo:number };
  type FlagRecord = { ruleId:string|string[]; location:string; severity:'crit'|'high'|'med'|'low'; message:string;
            fix?:Patch; fingerprint:string; type:1|2; confidence:'high'|'low'; concernKey:string };
  type FeedView = { expanded:FlagRecord[]; collapsed:{concernKey:string;count:number;severity:string}[] };
  type InjectionBundle = { groups:{concernKey:string;flags:FlagRecord[]}[]; countLine?:string };
  type ContextPackage = { header:{activeConstraints:string[];openFlags:FlagRecord[]};                 // = `Package`
            pieces:{ref:PieceRef;rank:number;reason:string}[]; referenceBin:PieceRef[];
            freshness:{walPosition:number;builtAtSeq:number} };
  type ContextPackageRef = { scope:ScopeRef; walPosition:number };
  type PieceRef = string;  type OrderedPiece = { piece:Piece; order:number };
  type ContentAxes = { delivery:'pull'|'push'; scope?:ScopeRef;                                 // TAX-1 (scope set ⇒ scope-gated push)
            salience:'never'|{ cadenceTokens:number }; provenance:'authored'|'derived-from-code'; manualOnly?:boolean }; // manualOnly = CC disable-model-invocation
  type Piece = { name:string; description:string; body:string; axes:ContentAxes;               // the collapsed content atom (TAX-1)
            governedBy?:string[]; bundle?:string; source?:{origin:string;version?:string;importTrust:'trusted'|'untrusted'};
            ccKeys?:Record<string,unknown> };   // governedBy = the TAX-2 authority link (a `governed-by` edge to a constraint); ccKeys round-trip verbatim
  type Reminder = { rule:string; reason:string; tier:0|'A'|'B' };                            // M3 decides; M9 delivers
  type BundleManifest = { role:string; pieces:PieceRef[]; frame:CapabilityFrame;
            assetContractHashes:Record<string,string>; version:string };                     // Role-as-bundle (D95/D132)
  type CapabilityFrame = { allow:string[]; deny:string[]; perAgent?:Record<string,{allow:string[];deny:string[]}> };
  type NeutralConfig = { prefixHead:OrderedPiece[]; systemReminders:Reminder[]; onDemandPullable:PieceRef[];
            scopePushed:Piece[]; toolIntents:CapabilityFrame; assembledContextSlot?:ContextPackageRef };
  // ^ slot set UNCHANGED by TAX — the axes are a front-end over these same slots (D105 intact). The TAX-3 static
  //   slotFor(piece) maps axes→slot: push+no-scope→prefixHead(+systemReminders iff salient)(+active_constraints iff
  //   governedBy); push+scope→scopePushed (SCO-4 runtime trigger); pull→onDemandPullable.
  type CapabilityProfile = { ports:Record<string,{present:boolean;nullFallback:string}>; spiVersion:string;
            degradation:Record<string,string> };
  type CapabilitySet = { allowedTools:string[]; denyRules:string[]; permissionMode:string; denyRead:string[] };
  type SessionConfig = { role:string; scope:ScopeRef; worktree:WorktreeId; capabilityFrame:CapabilityFrame };
  type Session = { id:SessionId; config:SessionConfig; worktree:WorktreeId };
  type Push = { kind:'flag'|'drift'; flag:FlagRecord }
            | { kind:'cost'; sessionId:SessionId; spent:number; remaining:number; capHit:boolean }
            | { kind:'approval'; requestId:string; sessionId:SessionId; summary:string;      // CHAT-3 ⚠: a NATIVE-SDK tool-permission surfaced for a human decision (NOT a coa block — SC-1)
                tool?:string; input?:Record<string,unknown>; diffHandle?:string }            //   enriched: WHAT is being approved (tool/args/diff handle), answered via M8.respondApproval
            | { kind:'tokens'; sessionId:SessionId; delta:string }                           // best-effort FLOOR (M8 §lifecycle); the structured `turn` kind is the high-fidelity layer (D85 strict-superset)
            | { kind:'turn'; sessionId:SessionId; worktree:WorktreeId; seq:number;           // CHAT-5 ⚠: the structured turn-event taxonomy — RELIABLE + sequenced (gap-detectable so the client reconciles after a drop)
                parentTurn?:{ sessionId:SessionId; seq:number }; frame:TurnFrame }            //   parentTurn links a subagent's frame to the spawning turn (CHAT-2); never back-pressures the loop (SC-1)
            | { kind:'status'; sessionId:SessionId; worktree:WorktreeId;                      // CHAT-5 ⚠: session/subagent lifecycle — answers "what is it waiting on?" (the dominant legibility pain)
                state:'running'|'idle'|'blocked-approval'|'blocked-tool'|'done'|'error' }
            | { kind:'compaction'; sessionId:SessionId; worktree:WorktreeId; atSeq:number;    // CHAT-6 ⚠: the compaction-SEAM MARKER — keeps reloadConversation honest (replay can't silently diverge)
                preTokens:number; summaryHandle:string; kept:string[]; dropped:string[] }     //   kept/dropped = "what survived compaction" honesty (no black box)
            | { kind:'graph'|'health'; scope?:ScopeRef; deltaHandle:string };                // CON/VIZ ⚠: a VIEW-SCOPED live delta — emitted ONLY to a client that subscribed an OPEN view (interactive-pull), never ambient push
  type TurnFrame =                                                                            // CHAT-5 the discriminated turn-event union; raw `tokens` is the floor, this is the bounded high-fidelity layer
              { t:'thinking'; text:string }
            | { t:'text'; text:string }
            | { t:'tool_use'; tool:string; input:Record<string,unknown>; handle:string }      // handle → M8.getToolDetail for the diff/args (CHAT-4); raw stays in the daemon (D57 distilled-handle)
            | { t:'tool_result'; handle:string; ok:boolean; pointer:string }                 // distilled handle+pointer (D57); the byte-faithful diff is fetched on demand, never inlined
            | { t:'reconcile'; changeSeq:number; pointer:string }                            // CHAT-9 ⚠: the AUTHORITATIVE reconciler/WAL change-event for this turn — the agent's CLAIM checked against ground truth (D81)
            | { t:'error'; message:string; origin:'tool'|'loop'|'daemon' }
            | { t:'permission'; requestId:string }                                           // pairs with the `approval` Push + M8.respondApproval (CHAT-3)
            | { t:'subagent'; childWorktree:WorktreeId; event:'spawn-proposal'|'spawn'|'running'|'idle'|'done'|'rollup' }  // CHAT-2 nested-subagent linkage + lifecycle
            | { t:'turn-boundary'; role:'user'|'assistant'; stop?:string };                  // segments turns; `stop` carries the stop-reason (end_turn/max_tokens/refusal/…)
  type ToolRequest = { tool:'get_symbol'; ref:SymbolRef } | { tool:'edit_symbol'; ref:SymbolRef; diff:DiffSpec }
            | { tool:'apply_patch'; diff:DiffSpec } | { tool:'run_checks'; scope?:ScopeRef }
            | { tool:'invoke_asset'; bundleRef:PieceRef } | { tool:'why'; target:string } /* …exhaustive… */;
  type ToolResponse<R> = { result:R; grounding?:GroundingBlock; flags?:InjectionBundle; handle:string; pointer:string };
  type GroundingBlock = { status:'new'|'weak'|'stale'; named:string; checkedAgainst:string;
            suggestions:{symbol:string;signature?:string;definedIn:string;confidence:number;why:string}[]; ifIntentional:string };
  type CST = { lang:string; tree:unknown /* opaque, serializable across the D112 child boundary */; bytesHash:string };
  type CanonicalForm = { lang:string; canonicalBytes:string };  type Tier = 0|1|2;          // pinned vs D115 prose
  type CanonicalizationProfile = { lang:string; stripBanner?:boolean; sortKeys?:boolean; ignoreRegions?:[number,number][] };
  type EscapeEvent = { kind:'pre-tool'|'prompt'; tool?:string; scope?:ScopeRef };            // M3.reminderFor param
  type GovernancePayload = { sub:'decision'|'vouch'|'cap-record'|'subtractive-change'; /* typed body; see M1 frame */ };
  type CoaError = { code:string; message:string };                                          // core throws this (house convention)
  ```
  `CST`/`CanonicalForm`/`Tier`/`CanonicalizationProfile` are M0-owned (so M2 and M1 both compile against them and
  `CST` serializes across the D112 child boundary). The `ChangeEvent` frame (below in M1, schema_version 2) and its
  `kind` discriminants are M0 schema; M1 owns the runtime.

**Fold-ins applied (M0).** D126 re-scoped at SPEC time to the **internal D109 port** (cleanup M-2): the
on-disk/byte format encodes the internal capability port, NOT the public/semver'd SPI, which is deferred. The
`spi_version` string remains but the public adapter SPI/registry/marketplace are out of v1 scope. "upcaster"
renamed to **"frame schema migration"** (word-collision with a cut CQRS term). The **D-CAT type catalogue** (above)
was added at fold-in time to close the under-enumerated-type defect; `NeutralConfig` is authoritative here and M5's
copy is a cross-reference. **TAX-* collapse (fold-in):** the `Piece` kind-enum (`knowledge`/`protocol`/`behaviour`)
is dissolved into the three `ContentAxes` + the `governed-by` authority link; `Role` is kept as a separate type
(`BundleManifest`); the `NeutralConfig` slot set is **unchanged** (axes are a front-end over the same slots —
D105 intact). The former `provenance:{source,version,trust}` import object is renamed `source:{…}` to free the word
`provenance` for the GEN-7 authored/derived axis. The full family is M5's TAX-* block; M0 owns only the type.
**GRF-\* graph hardening (fold-in):** `EdgeType` gains `calls`/`inherits` (GRF-4 coupling edges); `GraphEdge` gains
`EdgeProvenance` (adds `convention` — GRF-3 deterministic extractors), an optional coupling `weight`, and an `inScc`
marker (GRF-1 cycles-retained). The third granularity tier (GRF-2) is the existing `kind:'scope'` node — no new node
kind. **HLT-\* health (fold-in):** `MetricId`/`MetricGranularity`/`MetricSample`/`HealthProfile` are added as M0
schema; the metric *values/thresholds* are computed by the M4 L-HLT producer (parallel to flag values being M3's), and
the profile is a non-compensatory vector (HLT-2), never a single rolled-up score. M1 owns the live metric *projections*;
M0 owns only the record shape.
**CHAT-\* / CON-\* console (fold-in):** the `Push` union gains five kinds the console requires — `turn` (the CHAT-5
structured turn-event, carrying the `TurnFrame` discriminated union), `status` (CHAT-5 session/subagent lifecycle),
`compaction` (the CHAT-6 seam marker), and `graph`/`health` (the CON/VIZ view-scoped live delta) — plus the existing
`approval` kind is **enriched** (CHAT-3: `tool`/`input`/`diffHandle` + `sessionId`, so the console can show *what* is
being approved). `tokens` is retained unchanged as the **degrade-to-floor** raw stream (D85). The new wire types are
**M0 schema** (so M8 and M10 compile against them); M8 owns the runtime emission + the reliable-vs-best-effort policy
(see M8's **CON-CAT** + **CON-PUSH** below), M1/R-7 owns the persisted turn store. **Every new console RPC return shape
is defined inline in M8's catalogue (CON-CAT), not duplicated here** — M0 owns only the cross-module wire records
(the `Push`/`TurnFrame` union above).

---

### M1 — Change Kernel (the narrow waist) — `core`/spine ring

#### Identity
- **ID:** M1 · **Responsibility:** be the single source of truth for "what changed in the repo" — append every
  change to a durable log, and serve the live typed dependency graph **and its name/symbol index** that every
  consumer reads. · **Durability:** SUBSTRATE (and the moat: ambient persistent private memory + time-travel live
  here).

#### Public interface (the only contract that matters)
- `emit(changeEvent) -> seq` — producer-side append: **the one append path; every write funnels here** (P7). The
  reconciler (producer ②, owned here) and the precise Mutate path (M6, producer ①) call it; the typed write methods
  below construct a frame and call it internally (ergonomics over `emit`, not a second door).
- `assertEdge(edge: GraphEdge) -> seq` / `retractEdge(from,to,type) -> seq` — typed graph-edge writes (emit an
  `assert-edge`/`retract-edge` frame). Used by M4's L-GEN and `coa link`.
- `declareSymbols(symbols: SymbolRecord[], from: string) -> seq` — the L-GEN seam write (emit `declare-symbols`).
- `appendGovernance(g: GovernancePayload) -> seq` — M7's governance write path (emit `governance`).
- `subscribe(cursor, consumerFn)` — consumer-side feed. Idempotent; each consumer keeps its own per-log WAL cursor
  (the `seq`) and replays from it on restart. Delivery contract: **at-least-once + idempotent** (dedup on `seq`),
  coalesced for superseded same-path events, never reordered across a shared graph edge.
- `graph.query(...)` — synchronous hot-graph reads: proximity, depends-on, provenance, symbol-presence, recency,
  **and the GRF-\* views: `cycles()` (retained-edge SCCs + the min-feedback-arc back-edges, GRF-1), `coupling(node)`
  (typed/weighted `calls`/`inherits` fan, GRF-4), and `temporal(node, walWindow)` (the WAL⨝structure churn /
  co-change join, GRF-5).** The SCC condensation is a *view* this returns, never a stored collapse (GRF-1).
- `graph.coverage(scope?) -> { declared, inferred, convention, unresolved }` — the GRF-3 anti-false-graph honesty
  read (per-provenance edge counts + unresolved convention sites); the M10 inspector renders it, HLT-\* weights on it.
- `registerExtractor(extractor)` — admit a deterministic per-ecosystem **convention extractor** (GRF-3); it runs on
  reparse beside `M2.extractSymbols` and emits `assert-edge` frames stamped `convention`. Pluggable; degrades to the
  tree-sitter floor where no extractor matches (D85).
- `exportScip() -> bytes` — the GRF-6 one-way **SCIP** interop export of the symbol/nav layer (string symbol IDs);
  an export verb, never an internal dependency. v1 emits; consume/round-trip is deferred (`OPEN.md`).
- `graph.walkRoleDeps(role) -> Role[]` — the `Role → bundle depends-on` blast-radius walk M5's `versionGate` reads.
- `lookup(name) -> SymbolRecord | miss` — O(1) symbol-table read (the graph's node-set index).
- `fuzzyMatch(name) -> RankedCandidate[]` — the miss-path nearest-match over the fuzzy index.
- `resolvePiece(ref) -> Piece` — the pure piece-resolver over the graph + symbol table.
- `resolveScope(ref) -> ScopeResolution` — the **pure scope-resolver** (SCO-1/SCO-2): evaluate a scope's `ScopeExpr`
  (tag/glob/graph leaves + `∪`/`∩`/`exclude` + composition) over the graph + symbol table to its member set, with a
  WAL freshness stamp. Cached; rebuilt only on material input change. The glob/tag floor always resolves; graph
  leaves contribute nothing where no parser exists (recorded in `degraded`) — never empty-by-failure.
- `scopesFor(path) -> ScopeRef[]` — the inverse membership read: which scopes a touched file belongs to. The SCO-4
  delivery trigger (M4/M6) and M8's coupling-aware fan-out consume it.
- `scheduleIdle(job, {priority, preemptible}) -> IdleHandle` — register an idle-time job (the handle supports
  `.cancel()`); priority/preempt satisfy PD-4 + M4 regen consumers.
- `pin(handle) -> void` / `unpin(handle) -> void` / `listTimeline() -> Checkpoint[]` — **human-only** timeline
  controls (the D98 bookmark/anti-prune; the agent never marks or prunes).
- `checkpoint() -> handle` / `rewind(scope)` — pointer-tuple checkpoints + git-pathspec-scoped restore.

#### Depends-on
- **M0** (the types).
- **M2** — M1 calls `M2.parse` + `M2.extractSymbols` to BUILD its graph and index on reparse. This is the ONLY
  M1↔M2 edge and it points M1→M2; M2 never reads back.
- Producers (M6) and consumers (M3/M4/M5/M6/M7) depend on M1; M1 depends only on M0 + M2. This is the
  `producers → spine ← consumers` invariant made a logical rule.

#### Owned decisions (final form)

- **D81 two-producer change-event model — LOCKED (producer set clarified at fold-in).** Every repo change becomes
  ONE canonical change-event. The **two producers of FILE-change events** are ① the **optimistic precise** producer
  (the typed Mutate tools — cheap, attributed, preferred but not mandatory) and ② the **authoritative reconciler**
  (provenance-blind, universal — catches manual edits, formatters, bash). File-change **integrity** is guaranteed by
  the reconciler, NOT by tool-exclusivity. In addition, two **sanctioned non-file producers** write through the same
  `emit` chokepoint: ③ the **edge-writers** (M4's L-GEN `declareSymbols`/`assertEdge`, and `coa link`) and ④ **M7's
  governance writer** (`appendGovernance`). ③ and ④ only ever write `declared|gated` frames the reconciler is not
  responsible for, so the file-integrity guarantee is untouched and P7 still holds for every write. Provenance is a
  quality spectrum (`declared | inferred | gated`), not a boolean.

- **D120 event-sourced spine — LOCKED.** On a change-event: **synchronous** WAL append → **synchronous** in-memory
  graph update (the hot read path) → **asynchronous** heavier projections off idempotent per-consumer WAL cursors.
  Two-producer dedup is reconciler-authoritative and keyed on the frame's **canonical key
  `(worktree, path, pre_hash, post_hash)`** (stated in M0's frame block; supersedes any 2-tuple wording): a disk
  observation matching a recent precise event is a *confirmation*; an unmatched observation is an *inferred* event.
  **Write-then-emit race:** M6 Mutate emits the precise event before (or atomically with) the observable disk write;
  if the reconciler nonetheless observes first and emits an `inferred` event, the later precise event (full 4-tuple)
  **upgrades** it. **Reconciler worktree attribution:** M8 hands M1 a `path-prefix → WorktreeId` map at each worktree
  bind; the reconciler derives a bare observation's `worktree` from the longest matching prefix. The daemon is
  single-threaded JS, which makes the projector ordering contract cheap to honor: every projector consumes in
  strictly ascending `seq`; coalescing may drop superseded events for the same `path` but must never reorder across
  two paths that share a graph edge.

- **D94 WAL durability + crash recovery — LOCKED.** The change-event log is the **durable WAL** and the source of
  truth: ordered append + `fsync` at the reconcile-batch boundary (one fsync per coalesced batch), with a
  torn-tail-tolerant reader (a trailing line lacking its `\n` is discarded on startup). Segment
  rotation/compaction (and only that) uses write-new-segment-then-`rename`. All graph/flag/staleness/recency state
  are **rebuildable projections**. The provenance-blind reconciler **doubles as crash recovery**: on restart it
  re-observes disk and replays the WAL; an orphaned git anchor (rebase/force-pull) triggers a full rescan; event
  storms debounce/coalesce. **Retention floor (compaction safety):** compaction may delete only segments entirely
  below `floor = min(lowest live consumer cursor, oldest pinned-checkpoint WAL floor, oldest live fork-ref WAL
  floor)` — so a lagging consumer (e.g. M7's async ledger) or a human pin is never compacted out from under. M1 owns
  the floor and recomputes it each compaction boundary. **Frame-schema-migration owner:** M1's WAL reader owns the
  migration chain; a *higher* unknown `schema_version` makes the reader **refuse to start and quarantine the
  segment** (never a silent skip/downgrade).

- **D116 storage realization — LOCKED.** Append-only change-event log file (the WAL) + **SQLite projections** + an
  **in-memory hot graph**. Committed config = plain files. The SQLite projection DB runs in SQLite's own WAL
  journal mode; the recommended default is to treat the projection as **reconstructible-not-durable**
  (`synchronous=NORMAL`) and lean on the change-event log + reconciler for durability — a power-loss rollback of
  the projection is harmless because a replay re-derives it. The SQLite `-wal` file must stay co-located with its
  DB (separating them can corrupt it) — a constraint any backup/copy of the projections must honor. The projection
  carries its **own projector-schema version** (distinct from the frame's); **rebuild rule:** on a coa upgrade that
  changes projection columns (projector-version bump), M1 **drops and replays from the WAL — no in-place migration**
  (safe because the WAL is the source of truth). **Memory envelope (R-10):** v1 is resident-by-design within a
  stated repo-size envelope (a Tier-2 knob); the confirm/dirty queues are **bounded** with a drop-superseded /
  idle-drain policy; beyond the envelope M8 logs a degradation notice (D85 floor) rather than growing unbounded.

- **D123 git-centric reconciler (producer ②) — LOCKED.** Truth resolution is git-centric: a file watcher scopes
  dirty paths → a scoped `git status`/`git diff` → content-hash dedup → emit change-events. It **respects
  `.gitignore`** by default (so engine internals are excluded for free — the property that lets coa handle any
  project type), is provenance-blind, and its crash-recovery is WAL replay + full disk rescan.

- **D136 reconcile-include — LOCKED.** For gitignored *generated* files the user opts in via a `reconcile-include`
  glob: the reconciler **skips the `.gitignore` filter** for those globs (watch + hash the path) and stamps the
  resulting events and graph nodes/edges `generated: true` (lower trust, `inferred` provenance). This is what lets
  the grounding layer treat generated-but-not-committed symbols as existent.

- **The typed dependency graph (D16, D49–D54, P4) — LOCKED.** The graph (schema in M0) is M1's central projection,
  viewed many ways (P4: cache prefix, staleness graph, provenance, agent-linking are one structure from different
  angles). Decisions:
  - **D49 persistence:** declared semantic edges are authored → **committed** (the portable bundle); inferred
    structural edges are derived from code → **local**, rebuilt (`.coa/local/`); re-entry rebuilds the inferred
    half from the git diff.
  - **D51 inference limits (honest) — hardened by GRF-3:** per-language AST/import parsing gives the cheap ~80%
    structural graph; it cannot see dynamic imports, DI, string-keyed lookups, reflection, or codegen — and the
    real-repo stress test showed those gaps are **concentrated at the architectural seams** (not a random long tail)
    and are sometimes *wrong*, not merely missing (k8s `go.work`/`replace` makes a bare import parse resolve to the
    published module, drawing a false edge). So "fill the gaps with hand-declared edges" is insufficient at scale
    (React's host-config is one-to-seven; k8s has thousands of codegen markers). **GRF-3** adds deterministic,
    per-ecosystem **convention extractors** (`convention` provenance) over those declared edges.
  - **D52 identity/lifecycle:** pieces/artifacts/scopes/tool-versions have stable IDs; code nodes key on
    path + rename-tracking (git rename detection, content-hash fallback) so edges follow renames; deleting a node
    flags its dependents with a "dependency removed" staleness flag.
  - **D53 granularity — evolved to THREE TIERS by GRF-2 (was two layers):** (1) the **file/module dependency/staleness
    graph** (drives constraints + staleness + spec-conformance); (2) the **symbol-level index** used for
    navigation/grounding and NOT driving staleness — **but GRF-2 makes it also carry health signal** (per-function
    complexity, CBO/RFC), so it is no longer nav-only; (3) the **NEW architectural/module tier = the SCO-\* `scope`
    node** (coupling, layering, cycles between scopes — Martin's per-module metrics ride here). The stress test showed
    real problems live predominantly at tiers 3 and 1 and *inside* tier-2 symbols (a 5,000-line function), which the
    old two-layer split could neither aggregate-up nor score — see GRF-2.
  - **D54 propagation — confirmation-gated transitive:** direct (1-hop) dependents flag eagerly and cheaply;
    propagation past a node happens only once it is confirmed actually affected, or the full cone is computed
    lazily on demand; edge-type + semver rules can stop a hop. Prevents one small change cascading 50 nodes stale.
  - **D32 scopes — named file-set, hardened to a composable membership expression (the SCO-* family below):** a
    **scope** is a named, first-class graph node (`kind:'scope'`) whose membership is **no longer glob-only**. The
    D32 "glob-now / graph-later" intent is realized: membership is a `ScopeExpr` (M0) over **tag / glob / graph-query**
    leaves with `∪`/`∩`/`exclude` set algebra and scope composition (SCO-1), resolved deterministically and cached
    (SCO-2). Consumers are unchanged in spirit — M3's confidence axis, M4's ASM-1 seed / S2 signal **and the new
    SCO-4 in-flight delivery trigger**, and M8's coupling-aware fan-out all read membership via
    `M1.resolveScope`/`scopesFor`; concurrency overlap is still the set-intersection of resolved member-sets (now also
    edge-aware, SCO-6). The full model is the **SCO-* decision block** immediately below.

- **The graph hardening — the GRF-\* family (M1 owns the graph + its projections; M4's L-HLT consumes them; M10
  renders them) — LOCKED (the v1 line is GRF-8).** The grounding pass (prior art: SCIP/LSIF, Kythe, Glean, Stack
  Graphs, CPG/Joern, Sourcetrail; real-repo stress test: vscode, kubernetes, react, next.js) **reshaped four
  load-bearing graph claims** and added the seams the health engine (HLT-\*) and the visualization (M10) ride. The
  honest finding up front: coa's node/edge **vocabulary** is mostly right, but its **tree-sitter-only population
  strategy** misses two whole edge classes (runtime/registry/DI wiring; build-time/codegen/config wiring) that, in
  every repo examined, are exactly where the real architecture lives — and the SCC-collapse and two-layer-granularity
  decisions were lossy for the health goal. GRF-\* fixes these while preserving P1 (every extractor is deterministic),
  P4 (one structure, more views), D85 (degrade to the tree-sitter floor), and the WAL-as-temporal-substrate invariant.
  **No language lock-in (load-bearing — same posture as D146's no-lock-in answer):** every language-specific addition
  here is a **bounded layer that auto-engages where the stack affords it and contributes nothing where it does not**;
  the floor is language-agnostic (the tree-sitter import graph across 40+ grammars, plus the WAL, which needs no
  grammar at all). The TS-LSP precise edges (GRF-4/D144) and the per-ecosystem convention extractors (GRF-3) are
  **additive precision, never prerequisites** — a repo in an unsupported language keeps the full floor (D115 "any
  project type, incl. non-code/Godot" is untouched), and `graph.coverage` reports what was resolved honestly rather
  than faking completeness. The vscode/react/k8s/next.js names below are **stress-test evidence**, not supported-stack
  restrictions.
  - **GRF-1 — cycles/tangles are FIRST-CLASS findings; SCC-collapse is a non-destructive VIEW (reshapes D50).** The
    staleness goal wants a cycle collapsed (a tangle invalidates as one unit); the health goal wants it **shown** (a
    dependency cycle is the #1 "spaghetti" signal — collapsing it *hides the finding*). The old "inferred import
    cycles collapse into an SCC super-node" resolved this in staleness's favor and **destroyed the health signal**.
    Resolved both ways: **the graph retains every intra-cycle edge** (each stamped `inScc:<id>`, M0); the
    **super-node is a propagation view** computed on demand for D54's staleness cone; the **cycle is a first-class
    HLT-1 finding** (the L-HLT producer reads the retained edges, reports SCC size, and surfaces the **specific
    back-edge(s) to cut** via a minimum-feedback-arc-set heuristic). Stress-test proof: in kubernetes a real cycle is
    *a specific forbidden back-import* (the whole staging/`import-boss` apparatus exists to keep the module graph a
    DAG) — an SCC blob ("modules A,B,C,D tangle") destroys the one fact a maintainer needs (which import to delete).
    Fold-in: collapse is `graph.query` returning the condensation; it is never a write that deletes edges.
  - **GRF-2 — three granularity tiers; the symbol tier carries health (reshapes D53).** The old two-layer model
    (file/module staleness graph + nav-only symbol index) is **two tiers short** for health. (a) A **third
    architectural/module tier is added — and it is the existing SCO-\* `scope` node, not a new kind** (the handoff's
    own insight: a scope *is* coa's module unit, so Martin's per-module coupling metrics ride the scope; cycles
    *between scopes* are the architectural tangle). (b) The **symbol tier stops being nav-only** — it now carries
    per-symbol health signal (cognitive complexity, CBO/RFC), because the stress test found React's real complexity
    lives *inside* mega-functions (`ReactFiberWorkLoop.beginWork`, ~5k LoC) that a file-level metric undercounts and a
    nav-only index could locate but not score. Net tiers: **symbol (nav + local complexity) · file (staleness) · scope
    (coupling/architecture)**. The staleness contract is unchanged — only the file/module tier drives staleness
    (D53(1) intact); the new signal is advisory (HLT-\*), never a staleness driver. Fold-in: health metrics are
    `MetricSample`s keyed by `MetricGranularity ∈ {symbol,file,scope,system}`; scope metrics read `resolveScope`.
  - **GRF-3 — edge provenance + deterministic convention extractors (reshapes D51; the anti-false-graph mechanism).**
    "~80% structural + hand-declared edges" is insufficient: the missing ~20% is **concentrated at the architectural
    seams** and is sometimes a **wrong** edge, not a missing one. Two fixes, both deterministic (P1):
    (a) **every edge carries an `EdgeProvenance`** — `declared` (authored, committed) · `inferred` (a bare
    tree-sitter import) · **`convention`** (a per-ecosystem extractor) · `gated` (human-confirmed) — so every consumer
    (and especially HLT-\* confidence) can **weight an edge by how it was learned**, and the graph never presents an
    inferred guess as a declared fact. (b) **Convention extractors** are deterministic, pluggable, per-ecosystem
    pattern-matchers that populate the two missed classes: **codegen markers** (k8s `+k8s:deepcopy-gen` → a
    `generated-from` edge; React's `inlinedHostConfigs.js`/`forks.js` → the reconciler⇒renderer edge), **registry /
    DI call-sites** (vscode `registerSingleton`/`Registry.as`/`CommandsRegistry`; k8s `runtime.Scheme`/admission
    registry), and **build-config wiring** (k8s `go.work`+`replace` — which *corrects* the false published-module edge
    a bare import parse draws; Next.js fs-routing). They **auto-engage where a known convention exists and contribute
    nothing where one does not** (D85 floor — never break, just less precise; build-config-aware resolution stays the
    deferred SCO-7 seam where it's purely build-only). **Anti-false-graph (the field's #1 failure here — the
    silently-incomplete graph read as complete):** `resolveGraph` reports **coverage honestly** — per-edge provenance
    + a per-scope "N% of edges are `inferred`/`convention` vs `declared`, M edges unresolved" stat in the M10 inspector
    — and **never a false-green**; an unresolvable convention site is a notice, not a silent drop (parallel to SCO-5).
    Fold-in: extractors run on reparse alongside `M2.extractSymbols`, emit `assert-edge` frames stamped `convention`,
    and are registered like producers; HLT-\* down-weights low-provenance edges and labels metrics computed over a
    low-coverage region `confidence:'low'`.
  - **GRF-4 — richer edge semantics: `calls`/`inherits` + coupling weight (the metric substrate).** Coupling metrics
    (CBO, RFC, fan-in/out) need **typed, weighted** symbol edges that the import-only model lacked. Two `EdgeType`
    additions — **`calls`** (symbol→symbol, the call graph; from M9's TS-LSP `refs` where present, M2's tree-sitter
    floor otherwise) and **`inherits`** (the inheritance edge for CBO/DIT inputs) — plus an optional **`weight`** on
    any edge (call count / reference multiplicity). **Staleness ignores `weight` and the new edges' fan** (D54 is
    unchanged — weight is a health-only signal); health consumes them. Fold-in: `calls`/`inherits` populate from
    `refs`-first-then-floor (D144); `weight` defaults to 1.
  - **GRF-5 — the WAL⨝structure join (the temporal substrate; coa's measured differentiator).** coa already has the
    **WAL** (every edit, attributed, finer than a git commit) and the **structure graph** — their **join** yields the
    temporal metrics pure-static tools cannot compute natively: **change-frequency/churn** per node, **hotspots**
    (churn × complexity), and **change/temporal coupling** (nodes that co-change). This is a deterministic M1
    **projection** (P4 — "one structure, many views" gains a *temporal* view), **not** a new history store (the
    WAL-is-the-only-temporal-substrate invariant holds — no parallel git-log mining). It is the substrate HLT-5/6/7
    ride and the single strongest evidence-backed health signal (Nagappan-Ball; Rahman-Devanbu; Tornhill). Fold-in: a
    `graph.query` temporal view keyed on `(node, walWindow)`; the window is a Tier-2 knob (`OPEN.md`).
  - **GRF-6 — adopt-vs-build (the scout verdict; "don't reinvent the wheel"): build bespoke, EMIT SCIP, BORROW the
    mechanisms.** Per category: **(1) navigation/code-intel** — build bespoke internally but **emit SCIP**
    (Sourcegraph's protocol; human-readable string symbol IDs, projects cleanly to SQLite) as coa's **interop export**
    so the index is future-proof and consumable by other tooling; adopt **tree-sitter `tags.scm` as the nav floor**
    and **borrow the Stack-Graphs / scope-graphs name-resolution model** (per-file partial graphs stitched at query
    time — deterministic + incremental, exactly coa's constraints) for the **D144 precise TS layer** (the library is
    archived → borrow the model, don't depend on the crate). **(2) dependency/architecture graph** — **build bespoke;
    no standard models module-level coupling/layering/cycles** (every nav standard stops at symbols; only Sourcetrail
    even persists import edges). **Emulate Sourcetrail's SQLite schema shape** (unified element/node/edge id space;
    `source_location`+`occurrence` split; integer type-enums; first-class include/import edges) for coa's D116
    projection store, and **borrow Glean's ownership-by-unit** concept for WAL→projection invalidation (unit = file).
    **(3) health/metrics** — **build bespoke; no graph standard carries metrics** (they all stop at structure);
    metrics are a projection over coa's own graph (HLT-\*). The coa-domain nodes/edges (`constraint`/`scope`/
    `governed-by`/`watches`/`covers`) have **zero prior art** — necessarily bespoke. Fold-in: SCIP-emit is a v1
    one-way export verb (`coa export-scip`), not an internal dependency; the borrowed models inform the bespoke build.
  - **GRF-7 — the agent-navigation edge (goal 3) — the [LOOP] bet, flagged for the v0 spike.** The claim "the graph
    gives the model an edge it can't get from reading code" is the **navigation analog of the L-ASM [LOOP] bet and is
    UNMEASURED.** The seam already exists (M6's `get_symbol`/`outline`/`find_references`/`why` ride the graph); the
    open question is whether graph-as-agent-tool measurably beats a capable model's **native** retrieval. Honest
    posture (same as ASM-9/L-ASM): **soundness holds regardless** — the graph earns its place on determinism,
    staleness, grounding, and health even if the nav win is marginal; only **how much to invest in nav
    sophistication** rides the result. Fold-in: add "graph-nav-edge vs native-nav (token/turn win)" to the v0 spike's
    measured list (`IMPL-SPEC-BRIEF.md`); if marginal, keep the nav tools thin and justify the graph on the other
    three uses.
  - **GRF-8 — the v1 complexity line.** **v1 ships:** the retained-cycle model + on-demand SCC view (GRF-1); the
    three tiers with the symbol tier carrying health (GRF-2); `EdgeProvenance` + a **starter set of convention
    extractors** for the stressed ecosystems (GRF-3 — TS/JS DI+registry+codegen markers, Go codegen markers +
    `go.work`/`replace`; more are additive); `calls`/`inherits` + `weight` (GRF-4); the WAL⨝structure temporal
    projection (GRF-5); SCIP export + the borrowed Sourcetrail/Stack-Graphs/Glean mechanisms (GRF-6); the
    graph-nav-edge spike hook (GRF-7). **v1 defers (seams kept):** a full **CPG** (AST+CFG+PDG — Joern's vuln-analysis
    depth is out of scope; the seam is the symbol graph), the **public SCIP *consume*/round-trip** (v1 only *emits*),
    convention extractors for **un-stressed ecosystems** (additive, per-stack), and build-config-only resolution where
    it is purely build-derived (the SCO-7 deferral — cross-ref). The mechanisms are sound at the tree-sitter floor;
    the deferred items are reach, not soundness.

- **Scope — the SCO-* family (M1 owns definition + resolution; M4 owns SCO-4 delivery) — LOCKED (the v1 line is
  SCO-7).** Scope is the named unit that drives three things: **in-flight context delivery** (the "second half of
  push"), **staleness bounding**, and **architectural shape**. It is produced/resolved here in M1 (a graph
  projection, like the symbol table) and consumed everywhere scope already appears (the D32 consumer list). The
  hardening replaces the original glob-only `Scope` with a composable expression; the research basis is the
  tags-over-a-graph model proven by Nx + import-linter/ArchUnit + Bazel and explained by DDD (a boundary follows
  meaning/ownership, not directories), plus the field-converged read/edit-triggered delivery pattern (Cursor `globs:`
  / Copilot `applyTo:` / Windsurf / Claude Code `paths:`).
  - **SCO-1 — the composable membership expression.** A scope's membership is a `ScopeExpr` (M0) built from three
    **leaf bases** — ordered by coa's neutral-floor / bounded-layer discipline — plus set algebra and composition:
    - **`glob` (neutral floor)** — path globs (+ top-level `exclude`); always resolves, needs no parser; the bulk
      assignment for clean subtrees. The literal superset of the old glob-only D32.
    - **`tag` (the primary cross-cutting basis)** — explicit, **location-independent, reorg-safe** membership. This
      is the Nx-tags / DDD lesson: a feature/domain scope whose files share no path prefix (e.g. a "payments" feature
      spanning UI + an API route + a DB schema + shared types) can be named **only** by tagging — a glob cannot.
    - **`dependsOn` / `reachableFrom` (the bounded graph layer)** — dependency-closure queries over M1's
      `depends-on` graph; auto-engage where a parser exists, contribute nothing where one does not. Required for the
      closure and staleness-cone jobs globs/tags structurally cannot do (e.g. "what is stale when this schema
      changes" = a reverse-dependency walk).
    - **set algebra (`any` = ∪, `all` = ∩) + `exclude` (difference) + `scope` (compose / include another scope)** —
      carve precise boundaries out of shared trees, e.g.
      `frontend = any([glob "web/**", tag "ui"]) exclude any([glob "**/*.server.ts"])`.
    The bases do not compete: **glob, tag, and graph-leaf are three ways to populate the same member set.** Fold-in:
    `resolveScope` evaluates the expression; `scopesFor(path)` is the inverse membership read.
  - **SCO-2 — deterministic resolution, caching, freshness, degradation (D85 floor).** Membership is a **pure,
    deterministic** function of (expression × graph × WAL) — **no model on any path** (P1). It is a **cached
    projection** carrying a **WAL-position freshness stamp** (ASM-4 / D105 discipline), rebuilt **only on material
    input change** (post-G0, so a formatter/comment edit does not re-resolve), read-your-writes over M1's optimistic
    graph (a new tag/edge is selectable before the next resolve; a deleted member drops out). **Degradation ladder:**
    full → no-parser (graph leaves contribute nothing, glob/tag floor still carries) → cold-graph → daemon-off
    (synchronous resolve). With everything off a scope still resolves to its glob/tag floor — **never
    empty-by-failure**; a leaf resolving to nothing is reported in `ScopeResolution.degraded`, never silently treated
    as "matches nothing" (the #1 field failure — SCO-5).
  - **SCO-3 — on-disk format + tag storage + rename-following.** Scope definitions live in a committed
    **`.coa/scopes.yaml`** (portable, reviewable; same posture as `.coa/generate.yaml`). **Tags** are stored two
    ways, both funneling through `M1.emit` (P7): (a) a `glob → tag` bulk rule in `scopes.yaml`, and (b) a
    per-file/per-symbol annotation recorded as a **declared graph edge** (`assertEdge`, `tag` provenance `declared`)
    — committed, so it travels. Because a file-tag is a graph-node binding (not a path string), it **follows renames**
    via D52 rename-tracking — a tagged file that moves stays in its scope (the failure pure globs cannot survive: a
    relocated feature silently leaves a glob scope). `scopes.yaml` is **validated at load** — a malformed expression,
    an unknown referenced scope, or a cycle in `scope`-composition is **rejected loudly**, never loaded as a silent
    no-op.
  - **SCO-5 — observability + the scope linter (anti-silent-failure, anti-rot — load-bearing, not a nicety).** The
    universal failure of glob-scoped rule systems in the field is **silent non-attachment** (a leaf matches nothing,
    attached docs never deliver, nothing tells you) and **rot** (globs/tags reference moved/deleted paths). coa's
    named scopes + graph close both: (a) `coa scope <name>` shows the **resolved member set + a dry-run diff** and the
    per-leaf contribution; (b) every SCO-4 activation emits a `ScopeActivation` (which scope fired, what was
    injected/suppressed, and **why**) to the M10 inspector — the agent's scope context is never opaque; (c) the
    **scope linter** flags a leaf that resolves to zero members, a `dependsOn` to a deleted node, an `attach` to a
    missing Piece, and a scope whose members no longer share the dependency cluster its definition implies (drift).
    Linter findings are ordinary **Type-2** flags (M3) — surfaced, never blocking.
  - **SCO-6 — scope-as-architecture: the dependency-cone identity + the deferred boundary producer.** The deep
    property: **a scope's staleness cone and its architectural boundary are the same `depends-on` structure viewed
    twice.** A well-modularized scope has a *small* cone, so a change inside it stays inside it (tight staleness, small
    in-flight context); a tangled scope has a large cone, so everything goes stale and context bloats. coa therefore
    makes good modularization **pay** — clean scopes yield tighter staleness (SCO-1's graph leaf feeds D54's
    confirmation-gated cone) and right-sized delivery (SCO-4): a **carrot, not a cage** (SC-1). The optional
    **architectural boundary check** — a producer that flags when code in scope A imports scope B against a declared
    `mayDependOn` allow-list (the Nx `depConstraints` / import-linter / ArchUnit analog) — is a **deferred Type-2
    advisory producer** (the seam is the graph + scope tags; **see `OPEN.md`**). It warns, never blocks, and is **not**
    a permission control — coa does not cage the agent inside the repo. `mayDependOn` rides the M0 `Scope` type as the
    dormant seam.
  - **SCO-7 — the v1 complexity line.** **v1 ships:** the `glob` + `exclude` floor, **explicit `tag`** membership (the
    one addition that unlocks cross-cutting scopes), **one** graph leaf (`dependsOn`), `any`/`all`/`exclude`/`scope`
    composition, deterministic cached resolution with the freshness stamp (SCO-1/2/3), the SCO-5 observability +
    linter, and SCO-4's read/edit-triggered delivery. **v1 defers (seams kept):** `reachableFrom` + richer graph
    queries, the SCO-6 boundary-enforcement producer, build-config-aware resolution (boundaries that live only in
    build aliases / `go.work` / module-federation config — invisible to any filesystem or import-graph query),
    description-tier model-requested delivery, and learned/auto-suggested scopes (**all in `OPEN.md`**). The
    mechanisms are sound at the floor; the deferred items are reach, not soundness.

- **The graph's index — symbol table + fuzzy index + piece-resolver (in M1) — LOCKED.**
  - **Symbol table:** the resident `name → SymbolRecord` map the daemon holds. It **IS the graph's node-set
    index** — that is precisely why it lives in M1 and not in M2. M1 builds it by calling `M2.extractSymbols` on
    each reparse and indexing the per-file records into the live graph. `lookup(name)` is an O(1) hash-map read.
  - **Fuzzy index:** a BK-tree / trigram structure over the symbol identifier strings, built/maintained on the
    daemon's **idle time** (registered via `scheduleIdle`). It is queried **only on a `lookup` miss** (the hit
    path is one map lookup; only the rare miss pays for fuzzy search). `fuzzyMatch` ranks candidates by a composite
    of cheap deterministic signals: edit distance, graph/scope proximity, **rename provenance from the WAL** (the
    strongest signal — coa *knows* a name moved, e.g. `chargeCard → capturePayment` in a logged rename, so it isn't
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
governance module M7) is sync-eligible. **GRF-\* (fold-in):** the graph hardening lands in M1 because the graph,
its cycle/coupling/temporal views, the convention extractors, and the metric projections are all M1 projections (P4).
GRF-1 makes SCC-collapse a non-destructive view (no edge is ever deleted); GRF-2 adds the scope tier (rides SCO-\*)
and lets the symbol index carry health signal; GRF-3 adds `EdgeProvenance` + pluggable convention extractors with an
honest coverage read; GRF-4 adds `calls`/`inherits`/`weight`; GRF-5 is the WAL⨝structure temporal projection (no
parallel history store — the WAL stays the only temporal substrate); GRF-6 keeps the build bespoke while emitting
SCIP and borrowing Stack-Graphs/Sourcetrail/Glean mechanisms. **The health *producer* that consumes these projections
is M4's L-HLT (the HLT-\* family); M1 owns only the projections, M3 owns the flag values — the same M0-owns-schema /
producer-owns-logic split as everywhere else.** P1 holds (every extractor + metric is deterministic — no model on the
build path); D85 holds (degrade to the tree-sitter floor).

---

### M2 — Code Lens (pure byte→structure) — `code-intel`

#### Identity
- **ID:** M2 · **Responsibility:** turn source bytes into structure — parse to a tree, canonicalize, extract
  per-file symbols, extract per-function health metrics (HLT-6), and decide the language tier — as the one
  deterministic, language-tiered, **graph-free** function of bytes every higher layer shares. · **Durability:** SUBSTRATE.

#### Public interface (graph-free, byte-pure)
All four types below — `CST`, `CanonicalForm`, `Tier`, `CanonicalizationProfile` — are **M0-owned** (D-CAT), so M2
and M1 both compile against them and `CST` serializes across the D112 child-process boundary.
- `parse(file) -> CST | { ok:false, reason:'crash'|'timeout' }` — produce a concrete syntax tree; on a child-process
  crash/timeout (the seam the D112 boundary exists to survive) it **returns** the failure (never throws across the
  boundary), and M1 treats that file as tier-0 floor and continues.
- `canonicalize(artifact, profile: CanonicalizationProfile) -> CanonicalForm` — the **G0** shared "equal modulo
  formatting?" primitive.
- `extractSymbols(CST) -> SymbolRecord[]` — per-file, byte-local symbol records (M1 builds the resident table from
  these; M2 itself never holds a resident table).
- `extractMetrics(CST) -> MetricSample[]` — **per-function, byte-local AST health metrics** (HLT-6 `ast` basis:
  cognitive complexity, nesting depth, function length/`size-loc`), parallel to `extractSymbols`. Byte-pure; M1
  indexes the samples onto symbol nodes (GRF-2) and L-HLT composes. Lights up where a grammar exists; **returns the
  size-only floor where it does not** (D85) — coa never asserts a complexity it cannot soundly compute.
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

- **Per-file symbol *extraction* — LOCKED.** `extractSymbols(CST)` walks a parsed CST and emits the **byte-local**
  per-file `SymbolRecord[]` (name, signature/arity where the grammar affords it, defining location, scope). This
  is the byte-local half of the symbol story; the **resident symbol table that indexes the graph is M1's** — M1
  calls this function on reparse and builds the table from the records. M2 holds no resident state.

- **Per-function AST metric *extraction* (the HLT-6 `ast` basis) — LOCKED.** `extractMetrics(CST)` walks the same
  parsed CST and emits **byte-local per-function `MetricSample[]`** — **cognitive complexity** (the one well-validated
  local metric; not raw cyclomatic, which adds nothing over size above method level — HLT-4), nesting depth, and
  function length (`size-loc`, the confound control). Byte-pure and language-tiered like `extractSymbols`: it
  **auto-engages where a grammar affords it and degrades to the size-only floor where it does not** (D85) — coa never
  asserts a complexity it cannot soundly compute. M1 indexes the samples onto the symbol tier (GRF-2); L-HLT composes
  the profile. M2 holds no resident state and computes no graph/temporal metric (those are M1 projections — GRF-\*).

- **Neutral-floor / bounded-layer tiering — D146 clause 3 — LOCKED (the no-lock-in answer).** `tierFor` implements
  the language-agnostic contract: a **neutral floor that always works** (text/keyword/embedding retrieval +
  universal-ctags across 40+ languages + the tree-sitter *engine*) **plus a bounded high-fidelity layer that
  auto-engages where a grammar / language server / IDL exists and silently degrades — never breaks, just less
  precise.** coa never *assumes* a stack; type-grounding and signature checks are **capabilities that light up**
  where the language affords them, not prerequisites. (The GENERATION layer's *use* of this tiering is in M4; M2
  owns the *tiering decision* itself.)

- **D144 tree-sitter fallback — LOCKED (the M2 half of the port/fallback split).** D144's precise
  **TypeScript-LSP backend** (runs `tsserver` as a managed subprocess for exact references/types) is a capability
  port owned by M9. **M2 owns the null-fallback floor:** every language for which the LSP port is absent degrades
  to M2's tree-sitter code-intel via the port's defined null-fallback. So the precise path is additive (TypeScript
  gets exact refs); every other language keeps M2's tree-sitter floor — no lock-in, no language is broken by the
  absence of a server.

**Fold-ins applied (M2).** The earlier placement of the symbol table / fuzzy index / piece-resolver in M2 is
**overturned** (they read the graph → they are M1's). M2 keeps only `parse` / `canonicalize` / `extractSymbols` /
`extractMetrics` / `tierFor`, all genuinely byte-pure (M0-only dependency — `extractMetrics` returns the M0-owned
`MetricSample[]`) — which is what makes M2 fully standalone and buildable before M1. D144 split applied: port → M9,
tree-sitter fallback floor → M2. D146 clause 3 (neutral-floor / bounded-layer **tiering**) is M2's; the GENERATION
re-bill *use* of it is M4's. **HLT-6 (fold-in):** `extractMetrics` is the byte-local AST metric station (cognitive
complexity, nesting, length) — graph/temporal metrics are M1 projections (GRF-\*), never M2's; M2 holds no resident
state and never reads the graph, so the byte-purity that lets it build before M1 is preserved.

---
### M3 — Constraint & Flag System

#### Identity
- **ID:** M3 · **Responsibility:** run every check as a pluggable producer into **one** pipeline (P2), tag each
  flag with a **type** and a **two-axis severity×confidence**, dedup across producers, and surface results to **two
  audiences** under one contract — the user always sees everything (progressive disclosure), the agent gets a
  gated, grouped injection. M3 owns the single legitimate constraint **block** (the close-session gate) and
  **decides** the authority reminder; the physical delivery of both is M9's. · **Durability:** WITH-MODEL.

**Coordination note (flag-record fields vs assignment logic).** The flag-record FIELDS
(`severity` / `confidence` / `type` / `concernKey`) are **M0's** schema (see M0's D11 block). The **LOGIC that
assigns them** — the D134 severity projection and the CF-2 two-axis assignment, plus the CF-7 concernKey dedup —
is **M3's**, stated below. M0 owns the slots; M3 fills them. No duplication, no contradiction.

#### Public interface
M3 exposes exactly these methods. All flag records conform to the M0 schema.
- `registerProducer(producer)` — admit a producer of shape
  `{ id, kind, activation, run(scope|change-event|tool-call) -> Flag[], fix?(flag) -> Patch, envelope?(flag) -> ContextSlice }`.
  The add-path is gated by the validation pipeline (CF-6); there is no raw drop-in. `kind ∈ {deterministic, judgment}`.
- `ingest(flag)` — a producer emits one flag; the pipeline dedups by `concernKey`, assigns the severity/confidence
  axes (CF-2), and fans out to the two audiences. **Idempotency/precedence (R-14):** `ingest` is idempotent on
  `fingerprint`; the two emit paths (a `subscribe`-fed producer vs a direct `ingest`) reconcile by — when both deliver
  the same fingerprint, the most-recent direct `ingest` wins, and cross-path ordering follows `seq`.
- `flagsForUser(scope) -> FeedView` — crit/high severity expanded; med/low **collapsed-but-counted, never hidden**.
- `flagsForAgent(scope) -> InjectionBundle` — high-confidence ∧ (crit|high severity) flags only, grouped, deduped
  by concernKey. Consumed by M4 (for the assembled-package header) and M6 (for tool-return enrichment).
- `gate() -> { allow:true } | { allow:false, message }` — the close-gate predicate. It is wired to the **SDK `Stop`
  hook** by M9 (`interceptStop`), not to `canUseTool` — there is no "finish" tool to deny (verified SDK fact). On
  every Stop event M9 calls `gate()`; M3 reads its own in-memory flag projection and returns `allow` unless an
  unresolved **Type-1 ∧ high-severity** flag exists. The deny `message` is **authored by M3** (it holds the policy)
  and delivered verbatim by M9. `gate()` spends **zero model tokens** — it is a deterministic read (a step-bound, not
  a cost-cap on its own checking), so it is not a third cost-gated stop and M3 needs no M7 reference. Type-2 never
  blocks. *(The undefined `sessionCloseRequest` param is struck.)*
- `perToolDeny?(toolName, input) -> { behavior:'deny', message } | undefined` — the per-tool advisory→deny declared
  by M6 (e.g. the demotable built-in-`Edit` deny). M8 composes this into the one `canUseTool` (after the cost-cap
  check). It is policy M3 declares; M9 only runs it.
- `runValidator(selection)` — the user-invoked flag-validator (CF-5): judges a selection of Type-2 flags,
  auto-grouped by shared context.
- `submitFeedback(flag, reason)` — the typed-reason triage channel (D131) that records why a flag was acted on /
  dismissed; seeds future constraint proposals.
- `reminderFor(escapeEvent: EscapeEvent) -> {rule, reason}` — the authority-reminder **decision** (D133): which rule
  to inject and when. M9 physically delivers it via `deliverReminder` (daemon-authored `additionalContext` /
  `systemPrompt` — there is no programmatic mid-session `role:system` channel; non-spoofability comes from the daemon
  authoring the hook output, and P5 makes the prose non-load-bearing). `EscapeEvent` is M0-owned (D-CAT).

**Console seams (CON-\*, fold-in — no new M3 surface).** The console rides M3's *existing* methods, exposed via M8's
catalogue (CON-CAT): `flagsForUser` is the **user audience** of CF-1 for the CON-2 flag panel (crit/high expanded,
med/low collapsed-but-counted — the console must not invent a parallel surfacing); `submitFeedback` (D131) is the
panel's dismiss/triage action; and **`envelope?(flag) -> ContextSlice` is the seed for CON-3 investigate-dispatch** —
"select a flag → dispatch an agent to investigate it" is `M8.createSession(role, scope, seed = M3.envelope?(flag))`,
so a fresh session opens already grounded in the flag's evidence. The active-constraint half of the CON-2 panel reads
the compiled `NeutralConfig` header (`activeConstraints`), not a new M3 read. All render/dispatch over the two-audience
contract that already exists; M3 gains no console-specific method.

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

**The F3 pipeline core (the defined members D11/D16/D17 + D30/D31/D34/D38/D40).** Locked. *(F-number legend, used as
feature labels across this doc: **F1** = whole-file/escape floor; **F3** = this constraint/flag pipeline; **F4** =
the detection residual; **F6** = the governed tool surface; **F12** = the self-improvement loop, deferred. The
earlier "D9–D17" range is cited by its defined members only; intermediate numbers in that range are not separately
defined.)* This IS the constraint/checker engine — SARIF-subset
flag records, a registration gate that requires golden examples (a good case + a bad case) before a constraint is
admitted, a baseline/suppress mechanism (D17: an existing violation can be baselined so only *new* divergence
flags), and within-producer flapping/dedup (D34/D38). Fold-in: registration-gate and baseline live inside
`registerProducer` and `ingest`; D31 trust signals feed the confidence axis. The cited member decisions, in final
form (each is one producer/rule into this one pipeline):
- **D30 — the verification producer:** a distinct producer that runs the repo's tests / typecheck / build / linters
  and turns failures into flags; it is **diff-scoped + flake-tolerant** ("done" = conforms + fresh + works). It is
  the canonical Type-1 deterministic producer.
- **D31 — provenance-based trust:** trust is a field on a Piece/artifact's provenance — **local = trusted;
  cloned/imported = untrusted until reviewed/approved**; untrusted *executables* run sandboxed until promoted (D148).
  This trust signal feeds the confidence axis and the sandbox policy; passive text is not treated as hostile.
- **D34 — failure/oscillation handling:** a terminal producer failure checkpoints + escalates (bounded auto-retry
  first); a patch↔counter-edit loop on one fingerprint is caught by the **flapping detector** and auto-demoted
  (CF-3). It is the oscillation half of the dedup story.
- **D38 — constraint-conflict detection:** at authoring time a new constraint is run against the existing set on a
  calibration corpus to surface contradictions/fix-interference *before* acceptance; at runtime overlapping
  auto-fixes never blind-apply (they surface to the agent) and A↔B fix loops are caught by D34. An unresolved
  conflict becomes a flag a human resolves (disable / set precedence / narrow scope).
- **D40 — supported constraint-authoring pipeline:** authoring is a first-class, scaffolded pipeline (project facts +
  AST tooling + the existing-constraint catalog + a fixture sandbox), not raw hand-editing — the substrate CF-6's
  preconfigured authoring-agent runs on.

**D11 flag schema + CF-7 cross-producer dedup.** Locked (CF-7 adopted). The record is the SARIF subset
`{ruleId, location, severity, message, fix?, fingerprint, type, confidence, concernKey}` — **the fields are
defined in M0; M3 assigns the values.** CF-7 IS the rule that the `fingerprint` is extended with a `concernKey` =
`(normalized-location, problem-kind)`, so two producers flagging the **same underlying problem** (the typechecker
and grounding both flag a missing symbol at `charge.ts:42`) collapse to **one** flag carrying all contributing
`ruleId`s, surfaced once, tiered at the **highest** contributing severity/confidence. Fold-in: dedup runs in
`ingest` before fan-out; the concernKey is conservative — collapse only when problem-kind matches, accepting
occasional under-dedup over a wrong merge.

**CF-1 — two-audience surfacing (the centerpiece; replaces silent-until-confirmed).** Adopted. The old model hid a
flag from everyone until a silent agent confirmed it; that hid agent work from the user and let the agent judge
problems the user never saw. CF-1 separates the audiences: the **user** sees **everything** via **progressive
disclosure** (crit/high expanded; med/low collapsed into a counted, one-click-expandable group header — *collapsed
is not hidden, the count is always present, nothing is ever silently dropped*); the **agent** gets a **gated,
grouped** injection (only high-confidence crit/high enter the standing injection; med/low are withheld from the
agent's budget but remain fully visible to the user and available on `run_checks`). Fold-in: `flagsForUser` and
`flagsForAgent` are the two views; this supersedes the surfacing models of F4/grounding/assembly (their detection
machinery is untouched — only the visibility contract changes).

**CF-2 — two-axis severity × confidence (amended) — the assignment logic for M0's `severity`/`confidence`
fields.** Adopted. A single crit/high/med/low tier conflated *how much it matters* with *how sure coa is*. CF-2
splits them into two deterministically-assigned axes (no model on the assignment path):
- **SEVERITY** {crit/high/med/low} — drives the **user's** prioritization and **gate-blocking** (only Type-1 ∧
  high severity blocks). A producer may bias a default (a tsc error defaults high; a formatting nit defaults low)
  but the **system** owns the final value — a producer cannot self-stamp crit.
- **CONFIDENCE** {high/low} — drives **agent-injection gating** (inject high-confidence) and **validation-need**
  (low-confidence Type-2 flags are the validator's targets).
- **Type-1 is always high-confidence** (its verdict is a fact); its severity is per-rule. **Type-2** confidence
  varies (rename-provenance from the WAL → high; a bare lexical near-miss → low) and severity varies.
- The projection composes cheap signals coa already has: verdict-type, **D134 severity** (below),
  evidence-determinism, cross-producer corroboration (the concernKey), measured per-rule precision (D135 ledger),
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
judgment/advisory:** it **cannot auto-solve** and **never blocks**. Type-2 covers **two** cases: (a) a probabilistic
opinion (a staleness confirm, a grounding "did-you-mean", a semantic-contradiction check), **and** (b) a
**deterministic-verdict-but-advisory** producer — the **L-HLT health metrics (HLT-\*)** are computed deterministically
(P1 holds — a coupling/complexity/hotspot number is a fact) yet must **never gate** (SC-1: health advises, never
cages) and have **no deterministic fix** ("refactor this" is not auto-patchable). So `type` means **gate-eligibility**,
not "is the number deterministic": Type-1 = deterministic verdict **∧** deterministic fix **∧** gate-worthy; anything
else (probabilistic, fix-less, or advisory-by-policy) is Type-2. The line is determinism-first (P1): a
producer is Type-1 **iff both its verdict and its fix are deterministic given the tooling present in this repo** *and
it is a hard correctness gate*, else Type-2 — computed **per repo** (spec-conformance is Type-1 where a deterministic parser covers the symbol,
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
advises, never blocks. **Mechanism (verified SDK fact):** there is no "finish" tool to deny, so the block is the
**SDK `Stop` hook** returning `{continue:false, systemMessage: <M3's message>}`, wired by M9's `interceptStop`. (The
cost-cap, the *other* block, rides `canUseTool` instead — two SDK hooks, one owner M9; sitting on different hooks,
there is no predicate-composition problem.) `gate()` checking spends zero model tokens (a deterministic step-bound,
not a cost-cap). D17 baseline/suppress lets a pre-existing violation be excluded so only new divergence blocks.
Fold-in: `gate()`; the only other legitimate deny in the whole system is M7's cost cap.

**D107 — Tier-0 / Tier-A reminders; Tier-B wired-but-OFF.** Locked (Ruling 10). **Tier-0** IS the deterministic
re-surfacing of critical invariants via the native `role:system` channel (a research-validated floor). **Tier-A**
IS the deterministic trigger-term match (a named entity in the prompt activates the relevant reminder). The learned
**Tier-B** salience classifier is **wired but OFF** — not built until a measured A/B (D143) shows net-positive,
because the model is already good at attention and a salience predictor races a native channel. Fold-in: Tier-0/A
are the standing-injection selection logic behind `flagsForAgent`; Tier-B is a dormant hook. **These tiers ARE the
target of a Piece's TAX-1 `salience` axis** — `salience>never` selects Tier-0 cadence (v1) / Tier-A trigger (v1);
the deferred learned tier is Tier-B (D143). A Piece becomes authoritative (a re-asserted "rule") by the **TAX-2
`governed-by` link**, not a `force` flag; M3's gate enforces the linked Type-1 high-severity ones, CF-1 surfaces the
rest (the SHOULD tier).

**D108 enforcement (the M3 half).** Locked. D108 splits into delivery authority (M9: *where* in the transcript,
head + tail-reinforce + non-spoofable `role:system`) and **enforcement authority (M3: the gate)**. M3 owns the gate
and **decides** *which* flags block and *how insistently* reminders fire; M9 owns only the physical delivery.
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
**decision** — *which* authority rule to inject and *when*, anticipating an escape-gate event (extends D107
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
- **ID:** M4 · **ONE** module with **five internal sub-layers.** **Responsibility:** keep the agent (and the human)
  working against project truth by **generating** sound single-sources-of-truth (L-GEN), **assembling** a capped
  starting context (L-ASM), **grounding** the agent in-flight at the tool boundary (L-GND), **detecting** the residual
  drift (L-DET), and **measuring** project health/"spaghettiness" to motivate clean code (L-HLT). M4 **emits four
  producers into M3** and does **not** surface flags itself. · **Durability:** WITH-MODEL (the appreciating spine —
  it gets more valuable as the model gets better at using sound context, grounding, constraints, and clean structure).
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
- `scopeDeliver(toolCall) -> {scope:ScopeRef; pieces:PieceRef[]}[]` — **SCO-4** scope-triggered delivery: resolve the
  touched path's scopes (`M1.scopesFor`), select each scope's `attach`ed Pieces, dedupe across the turn and hard-cap,
  and return them for M6 to ride on the tool return / M9 to `inject_runtime`. Synchronous, **zero model tokens**;
  emits a `ScopeActivation` (SCO-5). The in-flight complement to `assembleContext`'s session-start package.
- `declared_symbols() -> set<symbol>` and the `generated-from` / `governed-by` edge — published to M1's graph via
  `M1.declareSymbols(...)` / `M1.assertEdge(...)` (the sanctioned edge-writer path, §M1; the L-GEN↔L-GND seam).
  `declared_symbols()` lists symbols generation *will* produce, so grounding does not false-miss a not-yet-generated
  type.
- `getSpec(ref) -> SpecRef | none` — the governing spec for a symbol/scope (an M4 SSOT concept). This is what M6's
  `get_spec` tool reads — **the spec store is M4's, not M7's** (B6); M6 reaches it over its existing M4 edge.
- `generate(name)` / `regenerate(scope)` — idle jobs registered on M1's scheduler; also reachable synchronously as
  the `coa generate` verb. A regenerate coalesces into one transaction stamped `cause:regenerate(<source-event-seq>)`
  (the M0 frame `cause` field), so the regenerate→source provenance survives the WAL.
- `health(target, granularity) -> HealthProfile` — **L-HLT** (HLT-\*): the deterministic, zero-model **code-health
  profile** for a node/scope (the non-compensatory `MetricSample` vector — never a rolled-up score). Reads M1's
  GRF-\* projections (cycles/coupling/temporal) + M2's AST metric station. Consumed by M10's health views and the
  L-HLT producer; surfaced as **advisory Type-2** flags, never blocking.
- **Producer registration:** M4 registers **four** producers with M3 — GENERATION-drift = **Type-1**; GROUNDING =
  **Type-2**; F4/DETECTION = **Type-2**; **HEALTH/L-HLT = Type-2 (advisory; deterministic verdict, no fix, never
  blocks — SC-1)**. All flags flow out through `M3.ingest`; M4 surfaces nothing directly.

#### Depends-on
- **M0** — schema types.
- **M1** — the graph + WAL + idle scheduler + **the symbol table / fuzzy index / piece-resolver** (these live in
  M1). This is M4's whole structural floor.
- **M2** — `parse`, `canonicalize` (G0), per-file `extractSymbols`, `extractMetrics` (the HLT-6 AST station), `tierFor`.
- **M3** — M4 registers its four producers (L-GEN drift, L-GND, L-DET, L-HLT) and reads `flagsForAgent` for the package header.
- M4 does **not** depend on M5/M6/M8/M9 (those consume M4's outputs).

**Build-order note (intra-module staging, dependency order — NOT parallel).** (1) shared substrate is already built
(M1 graph + index + M2 G0 + the `authored`/`derived` tag); (2) **L-GND existence tier + L-GEN SSOT-constraint**
stage first — both standalone and highest-leverage (the existence tier rides the symbol index alone, needs no
generation); (3) **L-GND spec tier** sequences **after** L-GEN ships `declared_symbols()` + the `governed-by`
edge — its soundness rests on that seam, so it cannot be built in parallel; (4) **L-DET** and **L-HLT** last —
L-DET shrinks to whatever the first three did not already make true; **L-HLT** rides M1's GRF-\* projections (so it
stages **after** the GRF-\* graph hardening lands in M1/Phase 1) and M2's `extractMetrics` station, and is otherwise
independent of L-GEN/ASM/GND (it reads the graph + AST + WAL, registers a Type-2 producer — L-DET's sibling). A cheap
**v0 calibration spike** runs before any M4 milestone to size magnitude (token win, selection precision, grounding
uptake, tier calibration, **the GRF-7 graph-nav-edge win, and the HLT-8 health behavior-change**); it gates
magnitude, not soundness.

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
generator+version the build uses and is purely deterministic — the rank-1 replacement for the staleness *guess*.
Two postures: generate-and-commit (guard the committed copy) or generate-on-demand (smoke-check the generator
runs). Fold-in: this is the **Type-1, may-block, auto-patchable** producer M4 registers with M3; its `fix` is the
visible auto-patch (CF-3).

**The non-determinism fix (GEN-8 — the soundness centerpiece).** Locked. False drift is eliminated before soundness
is claimed: **(a)** volatile banners/timestamps → `strip-banner` (Go's `// Code generated … DO NOT EDIT.` family +
per-generator regexes); **(b)** unstable ordering → `sort-keys` canonical-form (parse → re-serialize sorted);
**(c)** environment leakage → fixed-environment regenerate (`C`/`UTF-8` locale, relative paths,
`SOURCE_DATE_EPOCH`); **(d)** binary/non-canonicalizable output → no byte-diff, exits the generation path to an
**`origin_anchor`** mechanical notice (the L-DET/PD-6 "symbol changed — eyeball it" notice-only flag for output coa
cannot canonicalize; it records the source→artifact anchor but asserts no byte-equality). **Pin the generator
version** (a declared input; a bump is a separate attributed
event). **Ignore-regions** are gated, named, bounded anchor-pairs, audited, **default empty**, and any addition is
surfaced/reviewed + sandboxed (D147/D148), never two-key. **Reproducibility self-test (the lie-detector):** when a
relation is declared the daemon regenerates twice from unchanged source; if the canonical forms differ the relation
is non-reproducible → coa **refuses to ship the SSOT-constraint** and falls back to a detection-only mechanical
notice. Soundness is proven before it is claimed.

**D146 — GENERATION re-bill (the use half).** Locked (Ruling 6). The honest finding: generation-as-agent-
effectiveness is real but narrow. **Demote** "generate prose/API-docs/NL summaries and prepend as standing context"
to at most an **on-demand retrieval index, never always-on prompt text** (SWE-bench data shows more prepended
context *lowers* resolve rate). **Elevate** the **deterministic context-package assembler** (L-ASM) to the headline
agent-effectiveness deliverable — its value is selection+ordering+hard-cap. Drift-soundness (the GEN-* slate) is
untouched. Fold-in: L-GEN keeps its drift-soundness billing; agent-effectiveness reduces to "feed grounding/tests
sound truth + build a great selector." (The clause-3 neutral-floor *tiering decision* is M2's `tierFor`; L-GEN
merely *uses* it.)

**The `authored` vs `derived-from-code` provenance tag (GEN-7 / the joint catch).** Locked. Every SSOT carries a
provenance tag. **`authored`** = hand-written or human-approved; GENERATION enforces it as SSOT and GROUNDING may
ground against it. **`derived-from-code`** = generated *from* code (describes what-is, not what-was-intended); it is
**never** auto-promoted to SSOT and GROUNDING **may not** ground against it (else a code-derived spec cements
current behavior as the contract — circular). Fold-in: the tag is a minor graph field; L-GND reads it before
grounding spec coverage. **It is also the TAX-1 `provenance` axis** — the same authored/derived value surfaces as a
front-matter axis on a Piece, and TAX-4 forbids a `derived-from-code` Piece without a `generated-from` edge (so the
"self-contained derived" corner cannot arise — TAX-5).

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

**GEN-BS-* (amplifiers).** **GEN-BS-1 recommend-now** = the deterministic context-package assembler realized as
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
cap + seed), feeding the line's late station ("Station 6") and its overflow "reference bin." (M5 owns the *full*
seven-station rendering + cache-stability machinery, D145; L-ASM owns only the selection that feeds it.)

**D106 — mid-session-change policy (the assembly-line side).** Locked. When a stable input changes mid-session the
default is a **cache-perfect sticky-note** appended via `inject_runtime` (never an edit to the cached prefix);
severity escalates by the CF-2/D134 severity axis (not a "D73 bucket" — D73 is the Decision log, which has no
bucket concept); a tightened rule is backed by deterministic enforcement (M3's gate) so the
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
is a *selection* feeding D104's Station 6 + reference bin — no reinvented rendering) and honors **D105
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

**ASM-BS-* (amplifiers).** **recommend-now:** the realized package (ASM-BS-1), the `coa context` inspector
(ASM-BS-2), the selection-quality dashboard line (ASM-BS-3), graph/import/dataflow as a **retrieval index** not a
raw dump (ASM-BS-4). **v2-v3 bets:** auto-propose a scope's manifest (ASM-BS-5), a local-embedding floor signal
(ASM-BS-6). **Cut:** a learned/ML re-ranker (ASM-BS-7 — judgment where arithmetic suffices, non-deterministic) and
an always-on whole-repo prose dossier (ASM-BS-8 — the exact SWE-bench anti-pattern this layer replaces). GraphRAG
is explicitly out of v1 (LLM-built graph breaks P1; coa already has a sound deterministic code graph).

**SCO-4 — scope-triggered delivery (the "second half of push"; M4 selects, M6 triggers, M9 delivers).** Adopted
(part of the SCO-* family defined in M1; **it is the runtime face of TAX-7's `delivery=push`+`scope` — one delivery
story, not two**). L-ASM assembles the **session-start** package for the session's *declared*
scope; SCO-4 is its **in-flight** complement — it auto-delivers the docs/Pieces *attached to a scope* the moment the
agent enters that scope, so the agent reads the right project docs **without hunting for them**. This is the literal
second half of "push": authority/resident Pieces push at the prefix head; scope-attached Pieces push **when their
scope becomes active**. It realizes the field-converged pattern (Cursor `globs:` / Copilot `applyTo:` / Windsurf
`trigger:glob` / Claude Code `paths:`), hardened with coa's named scopes + observability:
- **Attachment, not duplication.** A scope carries `attach: PieceRef[]` (M0) — Pieces bound to the scope **once**, not
  a glob restated in every file's front-matter (the incumbents' maintenance failure). One scope, many attached Pieces;
  define the set once (SCO-1), attach many docs.
- **The trigger (the v1-accurate semantics).** Delivery fires when a file that is a **member of the scope enters the
  agent's working set** — concretely on M6's **read/edit** of a matching file (or an explicit `@`-mention), **not**
  merely on a file being open, and **lazily at file-touch, never eagerly at session start**. Fold-in: M6's tool-return
  post-processing calls `M4.scopeDeliver(call)` (alongside `ground` + `flagsForAgent`); it resolves the touched path's
  scopes (`M1.scopesFor`), selects the attached Pieces, and hands them to M9's `inject_runtime` (daemon-authored
  `additionalContext` — the same non-spoofable channel as reminders; **cache-stable**: appended after the prefix,
  never spliced into it, D105). This is the decision that fixes what the spec previously left implicit — *what "a
  scope boundary is crossed" actually means*.
- **Tiered + capped (the over-stuffing guard).** Three resident tiers: a tiny **always-on** baseline; **scope-
  triggered** bodies (this mechanism, the workhorse) — deduplicated across a turn and **hard-capped** at the
  context-package token cap (a per-scope Tier-2 knob); and **manual** `get_piece` pull. (The description-tier
  model-requested delivery — only a Piece's description resident, body on request — is **deferred**, see `OPEN.md`.)
  Overflow demotes to the pullable reference bin, never silently dropped (ASM-2 parity).
- **Precision contract (ASM-9 parity) — fail toward under-delivery.** Over-stuffing a scope's docs is unrecoverable
  (tokens + attention spent — the exact SWE-bench anti-pattern); a missed doc is one `get_piece` away. Quality is
  **measured and shown** (precision = fraction of delivered Pieces the agent used; recall = in-flight pulls), riding
  the D135 ledger and surfaced via the SCO-5 `ScopeActivation` stream. The `[LOOP]` magnitude is the v0 spike's to
  measure (gates magnitude, not soundness).
- **Relation to `scopePushed` (M5) — ONE story under TAX-7.** After the taxonomy collapse there is a **single**
  scope-delivery mechanism: a Piece with `delivery=push` + a `scope` (TAX-1). The M5 `NeutralConfig.scopePushed` slot
  (compile-time) and SCO-4's `scopeDeliver` (runtime, file-touch-triggered) are **the same Pieces seen at two
  times**, not two halves of two features — the old "Behaviour = compiled half / attach = runtime half" split is
  dissolved (TAX-7). The Scope's `attach: PieceRef[]` (scope-side) and a Piece's `scope` ref (Piece-side) are **dual
  declarations of one scope↔Piece edge**, normalized by `compile()`. Both resolve scope through M1; D102 precedence
  (an explicit `get_piece` pull beats the standing push within a turn) governs the result.

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

**The three check-tiers, language-gated (CL-9 boundary — the rule that each tier lights up only where the language
capability affords it, and is silent where it does not).** Adopted. **EXISTENCE** — is the name in the symbol
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
+ the specific claim) and returns a stale/fresh verdict + confidence into M3's **emit-admission step** (renamed from
"emit-gate" to avoid colliding with M3's close-session *gate* — this one only admits flags into the pipeline; it
never blocks the agent).

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
+ git `-M`; a stale-but-undeleted edge degrades to a one-action notice). An agent-proposed edge is gated — it
surfaces as a D131-style triage item with a diff that a human approves; the agent never self-approves. **secret bound on
committed `.coa/` (S-6):** the **committed** edge stores only the structural triple (`from, to, type`); the `--why`
free text and any PD-1 annotation rationale are **WAL-local** (DT-5-style, `.coa/local/`), **never committed** — so a
rationale string can never carry secrets into git. A committed annotation may reference only a bounded id, not arbitrary
free text.

**PD-1…8 (the locked slate).** Locked (Ruling 4 substrate). **PD-1** the in-artifact edge-annotation syntax
(HTML-comment / YAML front-matter / `.drawio` node-attribute). **PD-2** a conservative confirm-confidence threshold
+ precision-proxy floors, self-tuning as a D107 knob. **PD-3** default drain = prompt-boundary (above). **PD-4** the
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

##### Sub-layer L-HLT — HEALTH (the code-health / "spaghetti" engine)
**Responsibility:** measure project health/"spaghettiness" deterministically over M1's GRF-\* graph projections + M2's
AST, surface it as **advisory Type-2** findings + the M10 inspector views, and **motivate clean code without nagging**
— a budgeted, idle-swept producer into M3 that **NEVER blocks** (SC-1). L-DET's sibling (same Type-2, idle,
graph-reading, never-block shape); the difference is L-DET measures "is everything still *true*?" and L-HLT measures
"is the structure *clean*?".

**The HLT-\* family — code-health measurement + surfacing (M4 owns the producer + composite; M1 owns the metric
projections, GRF-\*; M2 owns the AST metric station; M3 surfaces; M7/M10 are the advisory paths). ✅ LOCKED (the v1
line is HLT-9).** The owner is explicitly unsure how to measure health and asked for deep industry grounding; the
metrics pass (cyclomatic/McCabe, cognitive complexity, CK+LCOM, Martin's Ca/Ce/I/A/D, DSM + propagation cost,
CodeScene Code-Health + hotspots, SonarQube SQALE, NDepend, the Maintainability Index — **and crucially the
metric-validity literature**) produced one load-bearing reversal: **most "rigorous-looking" metrics predict little, so
health must be a small validated PROFILE, never a single rolled-up "spaghetti score."** The composite is grounded in
the validity evidence, not numerology, and coa's **WAL is a genuine differentiator** (it can compute the temporal
factor — change-frequency — natively, which pure-static tools cannot). **No language lock-in (inherits GRF-\*'s posture
+ D85/D146):** the profile **degrades by basis, never breaks** — the WAL-native signals (`churn`/`hotspot`/
`change-coupling`, coa's *strongest* health evidence) are **fully language-agnostic** (they read edit history, not a
grammar, and fire even on non-code files); the graph-native signals ride whatever import/coupling graph the floor
affords; only the AST signal (cognitive complexity) needs a grammar, and it falls back to the size-only floor where
none exists (HLT-6). So an unsupported-language project still gets meaningful health (hotspots + cycles + size), never
nothing — coa never asserts a metric it cannot soundly compute.
- **HLT-1 — health is a PROFILE at four tiers, not one number.** A `HealthProfile` (M0) is a **non-compensatory
  vector** of `MetricSample`s, each reported at its **natural granularity** — **symbol** (per-function local
  complexity; CBO/RFC per class), **file** (size, churn, hotspot), **scope** (Martin coupling, cycles-between-scopes —
  rides GRF-2's scope tier), **system** (propagation cost, core-periphery size). Each sample carries its **basis**
  (`graph`/`ast`/`wal`) and **confidence** (`low` where the parser/edge coverage is partial — GRF-3). This answers the
  goal-4 question "can spaghettiness be measured?" — **yes, as a validated multi-signal profile**, not as one scalar.
  Fold-in: `M4.health(target, granularity) -> HealthProfile`.
- **HLT-2 — non-compensatory composition (the anti-numerology core; the field's #1 failure mode).** coa **does NOT
  ship a weighted "spaghetti number."** The validity research is decisive: **no empirically-validated weighting
  exists** (every shipped composite — SonarQube SQALE, NDepend debt, Code Climate, Codacy — uses arbitrary or
  undisclosed weights and the same inherited A–E brackets), most metrics are **partly redundant with size** (so a sum
  double-counts size), and **averaging mathematically masks the hotspots you most want to surface** (van Deursen 2014).
  So coa composes **worst-of, not weighted-sum**: each signal can **independently** flag; any headline shown is "the
  worst signal," never an average that lets a clean file hide a 5,000-line hotspot. **Always show `size-loc` alongside
  every metric** so the user sees the confound. This is the explicit guard against the "looks-rigorous-but-predicts-
  nothing" trap the handoff names as the central risk. Fold-in: `HealthProfile.worst` drives surfacing; there is no
  `score` field.
- **HLT-3 — the validated signal set (what ships), tagged by basis + validity.** The v1 profile, each with its
  empirical support:
  - **`cycle` / SCC tangle size** (scope+symbol, **graph**) — the consensus #1 structural smell; exact (Tarjan SCC).
    Rides GRF-1's retained-cycle model and surfaces the back-edge to cut. *Validity: STRONG as an anti-pattern.*
  - **`propagation-cost` + `core-size` / core-periphery** (system, **graph**) — the **best-validated architecture-level
    signal** (MacCormack/Rusnak/Baldwin 2006; MacCormack & Sturtevant 2016 — core code ~3× defect density net of
    size). *STRONG.*
  - **`cbo` / `rfc`** (class/symbol, **graph**) — the CK metrics that actually predict faults (Basili 1996; Radjenović
    SLR 2013). *STRONG.* (DIT/NOC/LCOM-as-score deliberately excluded — HLT-4.)
  - **`fan-in` / `fan-out`** (symbol/scope, **graph**) — raw counts only (the Henry-Kafura *squared composite* is
    excluded — HLT-4). *Mild standalone; useful as a god-component locator.*
  - **`cognitive-complexity`** (function, **ast**) — the **one well-validated local metric** (SonarSource; Muñoz Barón
    et al. 2020 — tracks comprehension *time*, r≈0.5), used instead of raw cyclomatic complexity. *MODERATE.*
  - **`churn`** (file/symbol, **wal**) — change-frequency; **repeatedly the single strongest defect-predictor family**
    (Nagappan & Ball 2005 — relative churn R²≈0.8; Rahman & Devanbu 2013 — process > code metrics). *STRONG.*
  - **`hotspot` = churn × complexity** (file, **graph+wal**) — the flagship prioritizer (HLT-5). *STRONG heuristic.*
  - **`change-coupling`** (node-pair, **wal**) — co-change that static edges miss (Zimmermann 2005; D'Ambros 2009).
    *MODERATE.*
  - **`size-loc`** (every tier, **ast/graph**) — **the confound, reported as a control, not a health signal** (most
    other metrics are partly measuring this — Shepperd 1988; Landman 2016).
  - **`instability` (Martin I) / `lcom4`** (scope/class, **graph**) — **shipped as REFACTORING HINTS only, labeled
    "heuristic, unvalidated,"** not as scored health (Martin's Distance-from-main-sequence has no independent defect
    validation; LCOM4 is the least-broken cohesion variant but weak as a score). *WEAK — hint-only.*
  - Fold-in: each is a `MetricSample`; graph-basis metrics are cheap/sound, ast-basis degrade where no grammar (D85),
    wal-basis are coa-native.
- **HLT-4 — the DON'T-SHIP list (numerology guard, explicit — do not let these back in).** Excluded **by decision**,
  with reason: **Maintainability Index** (magic constants from a tiny 1980s HP corpus; redundant with size —
  numerology); **standalone/aggregated cyclomatic complexity** (McCabe CC correlates ~0.9 with LOC above method level —
  adds nothing over size; kept ONLY as a method-level *hotspot input*, never as a health score — Shepperd 1988;
  Landman 2016); **Halstead Difficulty/Effort/"bugs"/"time"** (discredited psychological analogy — numerology);
  **DIT / NOC** (weak, sign-unstable — Radjenović 2013); **LCOM1/2/3 as a score** (definitionally broken); the
  **Henry-Kafura `length×(fan-in×fan-out)²`** composite (the square is unjustified, measurement-theory-invalid —
  track raw fan-in/out instead); **Newman modularity Q / Louvain as a health number** (rigorous math but **zero**
  software-quality validation; communities ≠ packages — use for clustering/viz only); and **any vendor-style single
  debt-ratio grade with the 5/10/20/50% A–E brackets** (inherited convention copied across three tools, not
  empirically derived). Fold-in: HLT-4 is a registration deny-list inside L-HLT — these are not computed as health.
- **HLT-5 — the temporal differentiator (hotspots; coa's measured edge).** The strongest evidence-backed play. Riding
  GRF-5's WAL⨝structure join, L-HLT computes **hotspots = change-frequency × complexity** natively (CodeScene's killer
  metric — Tornhill), where pure-static tools have no change axis. coa's **per-edit WAL is finer than a git commit**,
  which directly addresses a measurement-error limitation Nagappan & Ball named (VCS check-in granularity hides
  intra-session churn). Honest caveat carried: the flashiest evidence (Tornhill & Borg 2022 "Code Red" — red code
  ~15× defects, ~124% more dev time) is **vendor-authored and observational**, so coa **measures on its own ledger**
  (HLT-8), it does not assume the magnitude. Fold-in: `hotspot` is the headline M10 view (the treemap colorant).
- **HLT-6 — deterministic, where computed (P1 + D85).** Every metric is a **pure function of code + history — no model
  on the metric path** (P1 holds: metrics ARE deterministic, which is exactly why this fits). Computed at three
  bases: **graph-native** (M1 GRF-\* projections — cheap, sound, language-agnostic), **AST** (M2's byte-local
  `extractMetrics(CST)` station for cognitive complexity — auto-engages where a grammar exists, **degrades to
  no-local-complexity where it doesn't**, D85), and **WAL** (coa-native temporal). A metric over a low-coverage region
  (GRF-3) is stamped `confidence:'low'` and labeled, never presented as a precise verdict. Fold-in: graph+wal metrics
  are M1 projections; AST metrics ride M2's new `extractMetrics`; L-HLT composes — all idle-swept (M1 scheduler).
- **HLT-7 — surfacing: carrot, not cage (SC-1, inviolable).** Health is **advisory everywhere; it NEVER blocks** (the
  only two blocks in coa remain M3's Type-1 close-gate + M7's cost-cap). It surfaces through the **existing** channels,
  no new one: (a) **the user** sees the full health profile in the **M10 inspector** (the dashboards + the
  graph/scope/health views) via CF-1 progressive disclosure — pull, never push (M10's pull/inspector posture); (b) **the
  agent** gets only **high-confidence, in-flight** health context through the L-GND-style tool return ("you are editing
  `ReactFiberWorkLoop` — a top hotspot; the `payments`→`auth` edge you just added closes a dependency cycle"), gated
  exactly like `flagsForAgent` (high-confidence ∧ crit/high only); (c) any health finding is a **dismissible** Type-2
  flag (D131 feedback). The **carrot** is structural, not a nag: GRF-2/SCO-6 already make clean scopes **pay**
  (tighter staleness cones, smaller in-flight context), so health *advice* aligns with a reward the agent already
  feels. The TAX-2 false-assurance guard applies: a health finding is labeled advisory, never a guarantee. Fold-in:
  L-HLT registers a Type-2 producer; subtractive "mute this health rule" changes ride the M7 D147 visibility floor.
- **HLT-8 — the measured-behavior-change hook (don't ship a nag you can't prove).** A health metric that doesn't
  change behavior is noise. L-HLT **measures its own effect** on the kept minimal D135 ledger (anonymized, secret-clean —
  counts + node-IDs only): did a surfaced hotspot get refactored; did flagged cycles get cut; do health signals trend
  down where coa surfaced them vs where it didn't. This is the carrot's proof and the validity self-check — the v0
  spike sizes whether the composite correlates with anything real **on the user's own repo** (not on a vendor's
  study). Fold-in: a ledger metric set + a spike line (`IMPL-SPEC-BRIEF.md`); behavior-change is magnitude (spike),
  not soundness.
- **HLT-9 — the v1 complexity line.** **v1 ships:** the four-tier `HealthProfile` (HLT-1) with non-compensatory
  worst-of composition (HLT-2); the validated signal set (HLT-3) — cycles, propagation-cost/core-size, CBO/RFC,
  fan-in/out, cognitive-complexity, churn, hotspots, change-coupling, size-as-control, Martin-I/LCOM4 as labeled
  hints; the numerology deny-list (HLT-4); native hotspots off the WAL (HLT-5); deterministic graph/AST/WAL
  computation degrading to floor (HLT-6); advisory two-audience surfacing + the inspector (HLT-7); the
  behavior-change ledger hook (HLT-8). **v1 defers (seams kept):** a **full CPG-depth** semantic health (data-flow /
  taint — the GRF-8 CPG deferral), **per-ecosystem complexity tuning** beyond cognitive complexity, a **learned**
  health model (rejected for v1 — non-deterministic, races P1), and any **single rolled-up score** (rejected outright,
  not deferred — HLT-2/HLT-4). The mechanisms are sound at the floor; the deferred items are reach, not soundness.

---
### M5 — Config Compiler (`core/compiler/`)

#### Identity
- **ID:** M5 · **Responsibility:** compile a set of composed **Pieces** (the one axis'd content type) plus the
  **capability frame** into **one backend-NEUTRAL config object** — the single place the *Pieces → config*
  translation algorithm lives. It owns the **TAX-* family**: the axis→slot compile function + the
  normalization/coercion pass. It enforces **cache-stability** as a global invariant over the whole output. It is
  **backend-blind**: it never emits `.claude` files or SDK-native options. M9 takes M5's neutral output and renders
  it to backend-native; M5 never imports M9. · **Durability:** WITH-MODEL — composition logic that appreciates as
  the Piece corpus grows.
- **Two terms used throughout.** A **Piece** is coa's **one** unit of composable agent content, configured by three
  orthogonal axes — `delivery` (pull | push, push optionally scope-gated), `salience` (reminder eagerness), and
  `provenance` (authored | derived-from-code) — plus an optional **`governed-by` link** to a constraint that makes
  it authoritative (TAX-2). The former kinds (knowledge / protocol / behaviour) are **reproduced by axis values**,
  not declared (TAX-1); **Role** remains a separate type — a named **bundle** of Pieces + a **capability frame**
  (TAX-6). A **capability frame** is the per-(sub)agent set of which tools/built-ins are allowed or denied
  (delivered structurally — the SDK ignores SKILL.md `allowed-tools`, D145).

#### Public interface
The whole module is three functions. All are **deterministic** (no model call on any path).
```
compile(pieces: Piece[], frame: CapabilityFrame) -> NeutralConfig
    The core translation. First NORMALIZES + validates each Piece's axes (TAX-4 coercion table), then maps it onto
    a neutral delivery slot by the static axis→slot function (TAX-3, supersedes D5/D68/D69), composes them per the
    atomic-pieces rules (D82/D87/D88), lays them out cache-stably (D105), and packs the capability frame as neutral
    allow/deny tool intents. Returns a NeutralConfig (defined in M0). Deterministic (P1).

importBundle(text: SKILL.md text) -> Piece
    v1: a WRAP, not a decompose (TAX-8). One SKILL.md → ONE Piece with default axes (pull/never/authored/no link)
    + CC keys passed through verbatim. Because export is now near-identity, the SINGLE-PIECE round-trip ships in v1;
    the bundle/asset (binary assets, mount-contract) bidirectional round-trip stays v1.1 (D145).

versionGate(bundle, priorBundle?) -> { bump: MAJOR|MINOR|PATCH, blastRadius: Role[] }
    The SemVer breaking-change gate over a bundle's declared public surface — now defined as its `governed-by`-linked
    directives + exported Role/command names + asset hashes (D132 / TAX-2). WARNS; never blocks a human-approved adopt.
```
`NeutralConfig` (the contract M5 emits and M9 consumes) is a backend-neutral, option-shaped record **owned by M0
(authoritative in D-CAT)**. The shape below is a **cross-reference copy** for reading convenience — D-CAT is the
source of truth:
```
NeutralConfig = {
  prefixHead:        OrderedPiece[]   // most-stable-first; the byte-stable cacheable head (delivery=push + no scope).
                                      //   NEVER contains volatile/interpolated content.
  systemReminders:   Reminder[]       // salient (salience>never) push Pieces to re-assert (M9 delivers; M3 decides which)
  onDemandPullable:  PieceRef[]       // delivery=pull — NOT in the prefix; fetched via get_piece on demand
  scopePushed:       Piece[]          // delivery=push + scope — runtime-triggered by SCO-4 (TAX-7); inject_runtime append
  toolIntents:       { allow: string[], deny: string[], perAgent: {...} }   // the capability frame, NEUTRAL
  assembledContextSlot?: ContextPackageRef   // appended dynamically AFTER the stable prefix, never interpolated in
}
```

#### Depends-on
- **M0** — for `NeutralConfig`, `Piece`, `CapabilityFrame`, and `BundleManifest` (all authoritative in D-CAT).
- **M1** — **consume-only** graph read: `versionGate` calls `M1.graph.walkRoleDeps(role)` to compute blast radius
  (C10). M1 sorts far before M5, so this adds no cycle; M5 stays acyclic and backend-blind.
- **M4** — reads `M4.assembleContext(...)` output **only** when the compiled config must carry assembled project
  context. This is M5's single inward read. M5 reads only the **STABLE slice** of the assembled package (the
  byte-stable part), so the cache-stability invariant is preserved — volatile/dynamic context is appended later,
  never compiled into the stable prefix.
- **Does NOT depend on** M8 or M9. M8 *calls* `M5.compile`; M9 *renders* M5's neutral output. M5 stays acyclic and
  backend-blind.

#### Owned decisions (final form)

**The TAX-* family — content-taxonomy collapse (M0 owns the axis'd `Piece` type; M5 owns the axis→slot compiler +
normalization; M4 owns the SCO-4 runtime delivery). ✅ locked (the v1 line is TAX-9).** The original four-kind Piece
taxonomy (`knowledge`/`protocol`/`behaviour`, each with a force/persistence-driven delivery default, + `role`)
collapses into **ONE content type configured by three orthogonal axes plus a link**. The kind-enum was a latent
N×M class-explosion (kind × force × persistence); the field-mature tools already derive their "types" from
orthogonal frontmatter flags rather than a `kind:` field (Cursor's four rule-types are points in (delivery × trigger)
space; Windsurf's single `trigger` enum; MCP's model/app/user control taxonomy), and composition-over-inheritance /
entity-component-systems / the GoF Bridge pattern give the general lesson (extract independent dimensions, compose
them; don't enumerate the product). **Role stays a separate type** (the genuine-kind test: it carries a different
*required structure* — a bundle + a capability frame — not merely different flag values). The axes are a **pure
front-end over M5's existing `NeutralConfig` slots** — the D104 assembly line, the D105 cache-stability machinery,
and the slot set are **untouched**; TAX changes only the *mapping into* them.

- **TAX-1 — the three orthogonal axes (the collapse).** ✅ A `Piece` carries three axes (`ContentAxes`, M0;
  default = the empty-config floor):
  - **`delivery: pull | push`** — `pull` (default) = not in the prefix; the description is the resident handle and
    the body loads on demand (the vanilla-SKILL.md / Claude-Skills progressive-disclosure floor; `get_piece` pulls
    the body). `push` = delivered into context, **optionally scope-gated** by a `scope` ref: push+no-scope = resident
    at the prefix head (the old *resident Protocol* / *authority body*); push+scope = scope-triggered at file-touch
    (the old *Behaviour* / scope-attached doc — this IS SCO-4, TAX-7). The pull sub-mode **model-pull** (default;
    the model decides from the description) vs **manual/user-pull** is carried by the round-tripped CC key
    `disable-model-invocation` (`manualOnly`, verified in the field).
  - **`salience: never | <cadence>`** — reminder eagerness, **never → every-turn**. The v1 cadence is "tokens since
    last reminder" (== the existing **Tier-0** deterministic re-surface, D107) and maps onto the reminder tiers —
    Tier-0 cadence (v1), Tier-A keyword/trigger (v1), Tier-B learned (deferred, D143). Defined for **both** delivery
    modes: **push+salience** = re-assert resident content (the D108/D133 tail-reinforce, `M3.reminderFor`);
    **pull+salience** = suggestion-eagerness (an L-ASM rank boost / L-GND bias toward proposing the pull). Default
    `never`.
  - **`provenance: authored | derived-from-code`** — the **trust axis** (== GEN-7). `authored` (default) =
    hand-written/human-approved; GENERATION enforces it as SSOT and GROUNDING may ground against it.
    `derived-from-code` = generated *from* code; **never** auto-promoted to SSOT and GROUNDING **may not** ground
    against it (circularity). *Honesty note:* provenance has **no industry precedent** — no rule/skill format
    surveyed distinguishes authored-vs-derived; it stands on coa's own grounding-soundness argument (GEN-7), not on
    field validation.
  **Granularity is per-unit** (one config per file), matching every field tool (Cursor/Copilot/Windsurf/CC configure
  per-file, never per-section); a file with mixed delivery needs is **split into two Pieces** (atomic-pieces compose,
  P3). Per-section is rejected — it would break D105 (whole-Piece byte-stable placement) and the SKILL.md round-trip
  (per-file). **Empty config == vanilla skill** (load-bearing North Star): a SKILL.md with no coa keys is
  `delivery=pull, salience=never, provenance=authored, no link` → the `onDemandPullable` slot, model-pull,
  description resident = **today's skill behavior exactly** (validated against 96/97 real local skills, which carry
  only `name`+`description`). Fold-in: the kind-enum is deleted; `force`/`persistence` are reproduced by the axes +
  the link below.

- **TAX-2 — authority is a LINK, not a flag (the `force: authority` dissolution).** ✅ "Authoritative" is **not** a
  self-declared boolean — it is a **`governed-by` graph edge** (M0 `EdgeType`, already present) from the Piece to a
  **registered constraint** (an M3 producer). This rides the field-universal pattern that a stated rule is "real"
  only when bound to an executable check, bound **externally** (Sentinel: the enforcement level "is not known by the
  policy body itself"; OPA Gatekeeper: governed-by is an *unforgeable typed reference* — you cannot claim
  governed-by-X unless X exists as a registered check; ADR↔fitness-functions: "a decision record *documents* the
  decision, a fitness function *assures* it"). The link **× the linked constraint's existing Type/severity** yields
  **three honest, check-backed strengths with NO new machinery** — read straight off M3's Type-1/Type-2 axis:
  - **MUST / enforced** = governed-by a **Type-1 high-severity** constraint → M3's close-gate blocks (P5: anything
    that matters is backed deterministically, never by prose alone).
  - **SHOULD / strongly-recommended** = governed-by a **surfaces-but-never-blocks** constraint (a Type-2, or a
    Type-1 below gate severity) → CF-1 surfaces the violation **with the specific reason**, non-blocking, and
    **promotable** to MUST via the existing **D139** ratchet. This is RFC 2119 SHOULD = the warn-level tier every
    system reinvented (ESLint `warn`, Gatekeeper `warn`, k8s `audit`); the two-tier (linked/not) model is the
    degenerate collapse (TypeScript shipped error-only and the ecosystem rebuilt the middle tier as ESLint warnings).
  - **MAY / advisory** = **no link** → pure prose; coa **labels it "advisory (no backing check)"** so it is never
    mistaken for a guarantee — the explicit guard against **false assurance / policy theater**. (`salience` — eager
    delivery — is **orthogonal**: eager delivery is not enforcement.)
  The link drives three things: **enforceability** (the tier above), the **D132 SemVer breaking surface** (the
  linked directives are the bundle's declared public-authority surface — TAX folds this into D132), and the
  **forceful-delivery default** (a linked Piece defaults to `delivery=push` + a `salience`). Fold-in: drop `force`,
  keep `governed-by`; `force=authority` → governed-by + push + salience; `force=reference` → pull, no link.

- **TAX-3 — the axis→slot compile function (supersedes D5/D68/D69).** ✅ `compile()` routes each Piece to a
  `NeutralConfig` slot by a **pure, static function of its declared axes** (no model — P1; no per-turn state — D105):
  ```
  slotFor(piece):
    delivery=push ∧ no scope    -> prefixHead       (+ a systemReminders entry iff salience>never; + active_constraints iff governed-by)
    delivery=push ∧ scope set   -> scopePushed      (runtime-triggered by SCO-4 / M4.scopeDeliver; delivered via inject_runtime APPEND, never the prefix)
    delivery=pull               -> onDemandPullable  (description resident; body via get_piece; manual-only iff disable-model-invocation)
    provenance=derived-from-code-> (orthogonal flag) L-GND may NOT ground against it; ASM-8 watch: never the authoritative starting slice
  ```
  **Cache-stability is preserved by construction (the load-bearing point):** slot membership is fixed **at compile**
  from the static axes; the only runtime variability is *which* `scopePushed` Pieces fire, and they **all** live in
  the post-prefix append region (`inject_runtime`). Per-unit config therefore **never moves content between the
  byte-stable prefix and the dynamic append based on per-turn state** — exactly the D105 invariant. This is the old
  D5/D68/D69 force-driven default restated as an explicit axis function — and it stays a **default, not a hard-wire**
  (a Piece may override its slot, F1).

- **TAX-4 — normalization + the coercion table (the robustness core).** ✅ Before routing, `compile()` **normalizes
  and validates** axis combinations; incoherent or unsound combos are rejected or coerced deterministically, **with
  a surfaced reason — never silently**:
  | Combination | Action | Why |
  |---|---|---|
  | `governed-by` → a missing / unregistered constraint | **reject (loud)** | Gatekeeper unforgeable-link: cannot declare governed-by-X unless X is a registered M3 producer (parallel to SCO-5's "attach to a missing Piece") |
  | `provenance=derived-from-code` with **no `generated-from` edge** | **reject → coerce to `authored` + staleness notice** | fills TAX-5's empty corner *by construction*; a derived Piece with no source edge is a vendored snapshot masquerading as authored truth (the GEN-7/ASM-8 danger) |
  | `provenance=derived-from-code` ∧ `governed-by`-as-SSOT (the Piece is the *authority* of the check) | **reject (drop the authority)** | GEN-7 circularity — a code-derived spec cannot be the authority for the check that validates that same code |
  | `provenance=derived-from-code` ∧ `delivery=push` to the prefix as authoritative start | **warn (allow)** | ASM-8 watch: never *present* derived content as authoritative starting context; grounding already won't use it |
  | volatile content (timestamps/counters) ∧ `delivery=push`+no-scope (prefix) | **reject** | D105 cl.4 — never interpolate volatile bytes into the byte-stable prefix; route to the append region |
  | `governed-by`(Type-1) ∧ `delivery=pull` ∧ `salience=never` (enforced-but-invisible) | **allow + note** | the gate enforces regardless of delivery (enforcement ≠ prose); coa notes "enforced, not shown" — the check is real, not a false guarantee |
  | no link ∧ `salience>never` ∧ `push` (a forceful-but-unchecked rule) | **allow + label "advisory (no backing check)"** | P5 / false-assurance guard (TAX-2) |
  Fold-in: normalization is a deterministic pre-pass in `compile()`; every coercion is a feed item / SCO-5-style
  linter finding, never silent.

- **TAX-5 — doc / skill / artifact unification (graph-participation × provenance).** ✅ There is **no
  doc/skill/artifact *type*** — there is one `Piece`, and two facets place it in a 2×2: **provenance** (axis:
  authored | derived) × **graph-participation** (a graph fact: does the Piece carry `watches`/`depends-on`/
  `generated-from` edges?):
  - **skill** = self-contained (no graph edges) + authored — staleness: **none** (nothing to be stale against).
  - **doc** = in-graph (`watches`/`depends-on`) + authored — staleness: **L-DET** (the F4 confirm; drifts silently,
    so it needs a declared edge to be checkable).
  - **artifact** = in-graph (`generated-from`) + derived-from-code — staleness: **L-GEN** (regenerate + byte-compare).
  - **self-contained + derived** = **forbidden by construction** (TAX-4 row 2), *not* asserted empty — the corner is
    contingent (a vendored snapshot of generated docs would live there), so coa closes it by a validation rule.
  "doc vs skill" is therefore **emergent** from whether you declared watch edges — **not a type you pick** (validated
  on the stress corpus: `vendor-react-ui-components` is a *skill* until someone declares a watch on the upstream
  component list, at which point it becomes a *doc* that can go stale). Staleness **routes by provenance**:
  authored→L-DET, derived→L-GEN. (Boundary: append-only *decision/ADR* records are **not** Pieces — they are M7's
  decision log, D73; TAX's 2×2 does not model governance-record lifecycle.) Fold-in: the edges already exist (M0
  `EdgeType`); TAX-5 adds no type, only the rule that the labels are computed from facets.

- **TAX-6 — Role stays a separate type; capabilities stay structural.** ✅ Role is **not** collapsed (the
  genuine-kind test: it has a different *required structure* — a `BundleManifest` of Pieces + a `CapabilityFrame` —
  not merely different axis values). Capabilities are delivered **structurally** (M9 renders `toolIntents` to the
  SDK's `disallowedTools`/`tools`/`canUseTool`), **not** folded into per-Piece config, because the **SDK ignores
  SKILL.md `allowed-tools`** (verified, D145) and per-content tool grants would be unenforceable theater. Fold-in: a
  Role bundles axis'd Pieces + a frame; the frame is M5's `toolIntents`, untouched by TAX. (Stress-corpus
  confirmation: real skills ship an `agents/` capability variant, and `ticket-report` declares "STRICTLY
  READ-ONLY" — a capability concern coa must deliver structurally, never via a content key the SDK drops.)

- **TAX-7 — ONE scope-delivery story (the SCO-4 reconciliation, load-bearing).** ✅ Scope-gated push (TAX-1
  `delivery=push` + `scope`) **is** the single scope-delivery mechanism; the previous two paths — M5's compiled
  `scopePushed` (the old Behaviour) and M4's runtime SCO-4 `attach` — are **the same Pieces seen at two times**, not
  two features. The Scope's **`attach: PieceRef[]`** (scope-side declaration) and a Piece's **`scope`** ref
  (Piece-side declaration) are **dual declarations of one scope↔Piece edge** (exactly as SCO-1 has three ways to
  populate one member-set and SCO-3 stores a tag two ways); `compile()` normalizes both to that edge. **Compile-time**
  the scope-gated push Pieces land in `NeutralConfig.scopePushed`; **runtime** they are delivered by
  `M4.scopeDeliver`'s read/edit/mention trigger via `inject_runtime` (the cache-stable append, D105). The old
  "Behaviour = compiled half / attach = runtime half" split **dissolves**: one slot, one trigger, one precision
  contract (fail-toward-under-delivery, ASM-9/SCO-4). Fold-in: M4's SCO-4 and M5's `scopePushed` now describe the
  **same** mechanism from the runtime and compile sides; D102 precedence (an explicit `get_piece` pull wins over the
  standing push within a turn) governs both.

- **TAX-8 — `importBundle` as a wrap; single-Piece round-trip promoted to v1.** ✅ With one unified type,
  `importBundle` is no longer a *decompose-into-kinds* — it is a **wrap**: a SKILL.md maps to **one** Piece with
  default axes (`pull/never/authored/no link`) + all CC keys passed through verbatim, i.e. ~the identity function
  (the empty-config North Star makes import near-trivial). Because export is now also near-identity (a default-axis
  Piece **is** a SKILL.md), the **single-Piece round-trip is promoted into v1** — the collapse earns it. The
  **bundle/asset round-trip stays v1.1** (binary-asset round-trip, mount-contract assets, preserve-verbatim source
  are the genuinely hard part, and they are *Role/asset* concerns, not single-Piece content). Fold-in: D145 (below)
  is amended accordingly.

- **TAX-9 — the v1 complexity line.** ✅ **v1 ships:** the three axes (`delivery` pull/push+scope-gate, `salience`
  never/Tier-0-cadence, `provenance` authored/derived), the `governed-by` link with the three check-backed strengths
  read off M3's existing Type-1/Type-2, the **static axis→slot function** (TAX-3) over the **unchanged** D104/D105
  slots, the **normalization/coercion pass** (TAX-4), the doc/skill/artifact unification (TAX-5, no new type),
  Role-kept-separate (TAX-6), the unified SCO-4 delivery (TAX-7), `importBundle`-as-wrap + single-Piece round-trip
  (TAX-8), and round-tripping the CC `disable-model-invocation`/metadata keys. **v1 defers (seams kept):** the
  **lifetime/TTL** fourth axis (turn-count expiry — the old resident/ephemeral is already covered by delivery
  push/pull, so no new axis is needed; a true TTL is reach — `OPEN.md`), **learned Tier-B salience** (D143, already
  wired-OFF), the **description-tier** model-judgment *scope-push* delivery (already deferred, `OPEN.md`), and the
  **bundle/asset bidirectional round-trip** (v1.1, TAX-8). The mechanisms are sound at the floor; the deferred items
  are reach, not soundness.

**D82 / D87 / D88 — Atomic-pieces composition + delivery default + round-trip target.** ✅ locked (composition +
import + single-Piece round-trip in v1; bundle/asset round-trip v1.1). Pieces are **atomic and compose**: `compile()`
takes a *set* of Pieces and merges them into one config rather than concatenating prose. **D87** is the delivery
default — now the **axis-driven** default folded into TAX-3 (a `governed-by`-linked Piece defaults to push+salience;
absent a link, the axes are taken verbatim), superseding the old force-driven phrasing. **D88** is the *bundle
invoke/round-trip target* — a bundle (a Role + its Pieces + assets) can be composed and invoked as a unit; the
**import** half lives here (`importBundle`, now a wrap — TAX-8), the **single-Piece** round-trip ships in v1, and the
full **bundle/asset bidirectional** round-trip is the v1.1 target (D145). Fold-in: composition is set-merge with
deterministic ordering; `importBundle` wraps a SKILL.md into one Piece. (The *invocation* of a composed bundle at
runtime is M6's `invoke_asset` — M5 only compiles.)

**D145 — Config Compiler phasing (the v1 complexity line).** ✅ locked (amended by TAX-8). **v1 ships:** the
collapsed taxonomy → an **option-shaped neutral output** (the three axes + the `governed-by` link + Role + the
capability frame, mapped by the TAX-3 axis→slot function with the TAX-4 normalization pass), the **full D104
seven-station assembly/compose line** (NOT a naive string-concat), the **D105 cache-stability contract enforced from
the first line**, **`importBundle` as a wrap**, and the **single-Piece SKILL.md round-trip** (the collapse makes
export near-identity — TAX-8). **v1.1 ships:** the full **bundle/asset** bidirectional round-trip (the D88
machinery — preserve-verbatim source, binary-asset round-trip, mount-contract assets).
**REJECTED:** the "good-enough v1 = naive concat, real line in v1.1" shortcut — cache-stability is a *global*
invariant over the whole prefix and **cannot be retrofitted** onto a naive builder. **Live-verified constraint
(load-bearing, accessed 2026-06-23):** the Claude Agent SDK has **no programmatic API for registering Skills** (they
are filesystem-only, governed by `settingSources`), and the **`allowed-tools` frontmatter key in a SKILL.md is
IGNORED by the SDK**. Therefore the **capability frame must be delivered structurally** (via the SDK's
`disallowedTools` / `tools` / `canUseTool` options), NOT via SKILL.md keys. This is *why* M5 emits neutral
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
**declared public surface** = (a) the bundle's **`governed-by`-linked directives** (the TAX-2 authority surface —
a Piece linked to a constraint; this replaces the old "authority-`force` Knowledge" phrasing), (b) its **exported
Role / command names**, (c) its **asset mount-contract hashes**. A change to any of those = a **MAJOR** bump
(removed/loosened a linked rule or dropped its link, renamed Role, changed asset contract); additive = **MINOR**;
wording-only (or a pure delivery/salience axis tweak that does not touch a link) = **PATCH**. On a MAJOR bump at
adopt/sync time, `versionGate` **walks the graph's `Role → bundle depends-on` edges** and shows the human the
**blast radius** ("this breaks linked rule X that Roles `reviewer`, `tdd-implementer` depend on") **before** the diff. Fold-in: `versionGate(bundle, prior)` diffs the three-part public surface,
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
  Mutate / Graph / Flags / Context tools — and route every *precise* write into the kernel as a change-event. M6 is
  **producer ①** of the two-producer change-event model (the precise-Mutate producer; the other producer is M1's
  git reconciler). Every tool return M6 emits is **enriched** by calling `M4.ground()` and `M3.flagsForAgent()` so
  the agent gets project truth and gated flags inline with its result. · **Durability:** WITH-MODEL.
- **Why this module exists (the quality thesis, informative):** structure-first *retrieval* + a diff-shaped,
  lenient *edit* surface is justified primarily on **quality/context-fidelity** (small high-signal context beats a
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
    why(target)                  -> the rationale for a constraint/decision   [reads M7.decisionLog.findByTarget(target)]
    get_spec(ref)                -> the governing spec for a symbol/scope      [reads M4.getSpec(ref) — spec store is M4's, NOT M7's]
    get_decision(id)             -> a numbered Decision-log entry              [reads M7.decisionLog.read(id)]

Every return value R is post-processed:  R.grounding = M4.ground(call);  R.flags = M3.flagsForAgent(scope);
  R.scopeDocs = M4.scopeDeliver(call)  (SCO-4 scope-triggered delivery — resolves the touched path's scopes via
  M1.scopesFor and rides their capped attached-Piece set on the return, the in-flight "second half of push").
```

#### Depends-on
- **M0** — tool-return + flag-record + piece types.
- **M1** — Mutate **emits** change-events here (producer ①); Graph/Retrieve **read** the graph + symbol index + the
  piece-resolver (all M1).
- **M2** — `parse` for symbol-addressed ops.
- **M3** — `run_checks`, and the per-return flag enrichment (`flagsForAgent`).
- **M4** — the per-return grounding enrichment (`ground`).
- **M7** — `get_decision` reads `M7.decisionLog.read(id)`; `why` reads `M7.decisionLog.findByTarget(target)`;
  `context_status` reads `M7.capState()` (the **non-mutating** read, never the charging path). (This is the M6→M7
  edge — owned here.) *(`get_spec` reads M4, not M7 — see the M4 edge.)*
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
   diff/search-replace shape, leniently matched). This is the measured win for capable models (a structured *diff*
   format tripled GPT-4-Turbo's edit score 20%→61% and cut "lazy coding" ~3×). **Lenient** is load-bearing: do NOT
   wrap edits in a heavy AST/JSON-schema envelope — code-in-JSON measurably *hurt* every model (Sonnet worst). Keep
   it a lightweight, program-readable text-diff shape.
2. **Whole-file escape is CO-EQUAL and never punished** (`apply_patch` whole-file form). It is the **default** for
   generated code, thin-grammar/AST-invisible files, large cross-cutting rewrites, and (forward-compat) weaker
   models. It must be cleanly reachable, never penalized.
3. **Deny-built-in-Edit is a DEMOTABLE DEFAULT.** For a capable, Claude-locked v1 on localized edits, denying the
   SDK's built-in whole-file `Edit` (so the model is nudged onto the rigorous diff path) is a *measured win* — but
   it is a **default the user can demote**, never a hard lock. (The deny itself is issued through M3→M9's one
   `canUseTool` deny channel; M6 *declares* the demotable default.)
4. **AST-ops (`rename_symbol` / `rewrite_structural`) are KEPT, re-justified on deterministic mechanical
   correctness** — a guaranteed-correct cross-file rename/codemod the model cannot do reliably by hand. They earn
   their place on *determinism*, **not** on the token/quality thesis. (There is no external evidence that AST-*apply*
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
Piece can be pushed or pulled. **D102** fixes the **invocation precedence**, stated as the one rule: **an explicit
pull on demand wins over the standing push for the same Piece within a turn** (the freshest explicit fetch supersedes
the cached pushed copy); absent an explicit pull, the standing push is what the agent sees. Fold-in: `get_piece`
resolves through M1's piece-resolver and obeys this precedence; pushed Pieces come from the compiled config (M5),
pulled ones from this tool — one model, one precedence rule. **D101 is the seed of TAX-1's `delivery` axis:** "the
same Piece can be pushed or pulled" is now an explicit per-Piece axis (`delivery: pull | push`), and D102's
precedence governs both push-from-prefix and scope-push (TAX-7) alike.

**D103 — The session/explain tool verbs.** ✅ locked. The concrete verbs `invoke_asset` · `begin_fork`/`exit_fork` ·
`run_checks` · `context_status` · `why` / `get_spec` / `get_decision`. Each return is a **distilled handle + a
pointer** — the raw payload stays in the daemon and is never inflated into the agent's context. Fold-in: implement
each verb; `why`→`M7.decisionLog.findByTarget`, `get_decision`→`M7.decisionLog.read`, `get_spec`→`M4.getSpec`;
`context_status` reads M4's package + `M7.capState()`; `run_checks` calls M3. **Fork channel (C7):** `begin_fork` /
`exit_fork` reach M8's worktree manager through a **`forkManager` closure injected by M8 at session construction**
(same D121 pattern as the deny channel — M6 has no compile-time M8 edge); M8's surface provides
`bindFork(sessionId,scope)->WorktreeId` / `releaseFork(worktreeId)`. A fork is a child worktree under the session's
attribution unit (it shares the session's cost unit — D96 "one unit per session" holds; the fork's WAL events carry
the child `worktree` id but the parent `sessionId` actor).

**D88 / D95 — Asset / bundle invocation.** ✅ locked. The runtime **invocation** of a composed Asset/bundle (a Role +
its Pieces + mounted assets) as a unit, via `invoke_asset`. (M5 *compiles/imports* bundles; M6 *invokes* them —
disjoint halves of D88.) D95 is the asset mount-contract (the hashed contract M5's `versionGate` watches; M6 honors
it at invoke). Fold-in: `invoke_asset(bundleRef)` resolves the bundle, checks its mount-contract, and brings its
Pieces/assets into the session.

**The precise-Mutate producer (producer ①).** ✅ locked (the D81 two-producer model; M6 = producer ①). Every precise
write (`edit_symbol` / `apply_patch` / `rename_symbol` / `rewrite_structural`) **emits a canonical change-event** to
`M1.emit(changeEvent)` so the WAL, graph, flags, and all consumers see the write immediately. (The other producer
is M1's git-centric reconciler, which catches writes M6 did not make.) Fold-in: every Mutate tool, on success,
constructs a change-event (stamped with provenance) and calls `M1.emit`. M6 never writes to disk *and* the graph
independently — the change-event is the single chokepoint.

**Path-confinement precondition (S-1 — load-bearing security).** Because M6's Retrieve/Mutate handlers are
in-process MCP tools, the SDK sandbox does **not** confine them (verified SDK fact — deny-rules bind built-in/bash
tools, not custom MCP tools). Therefore **every Retrieve/Mutate handler runs a deterministic path-confinement
precondition before touching disk or graph** — parallel to the D141(c) Zod-before-touch rule: resolve symlinks
first, then reject any `ref`/`path` that contains `..` after resolution, is absolute-outside-worktree, or escapes
into `~/.coa`, `~/.claude`, the WAL, or another worktree (or matches the `denyRead` set). A shape-valid
`apply_patch`/`get_symbol` with `ref = ../../.coa/secrets/key` or a symlink is rejected at the handler, not merely at
Zod. Each tool is one method with a **typed (M0) `ToolRequest`/`ToolResponse`** (D-CAT).

**Invariants M6 must honor.** SC-1 (help-not-cage): M6 tools **never deny**; the grounding block on a return is
**advisory** (a "did you mean?" with a proceed-anyway escape) — it never blocks. The *only* two denies in the whole
system are M3's close-gate (the SDK `Stop` hook) and M7's cost-cap (`canUseTool`), both owned by M9 — not M6.
Mutation chokepoint (P7): every write becomes a change-event via `M1.emit`; there is no side-door write. Distilled
returns: raw blobs stay in the daemon; tool returns carry a handle + pointer. Strict-superset (D85): the whole-file
escape and `coa raw` floor are always reachable; the diff path is preferred, never mandatory.

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
- `capState(sessionId?) -> { remaining, capHit }` — **non-mutating** read of the daemon-global cost state. This is
  what the `canUseTool` cost-cap predicate and `context_status` consult (safe to call repeatedly; no double-charge).
- `charge(sessionId, cost) -> void` — **mutating** write, called **exactly once per settled usage** (by M9 at the
  SDK `ResultMessage`, reading `usage`/`total_cost_usd`). Updates the daemon-global running total atomically
  (single-threaded JS), so one session's settled spend correctly reduces every other session's `remaining`.
  *(Read/write are split — replacing the single mutating `chargeAndCheck` — so the cap is concurrency-safe and the
  predicate path never charges.)*
- `record(event) -> void` — append an **allow-listed** projection of a runtime event to the audit ledger. The
  method rejects (drops + does not persist) any field outside the D135 allow-list. Prose-bearing fields never reach
  this method (DT-5).
- `surfaceSubtractiveChange(diff) -> void` — turn a *subtractive* governance change (muting/weakening a constraint,
  broadening a scope, adding a suppression region) into a reviewable feed item. This is the D147 visibility floor:
  it notifies/logs, it does **not** block.
- `decisionLog.append(entry) -> id` / `decisionLog.read(id) -> Entry` / `decisionLog.findByTarget(target) -> Entry[]`
  — the append-only, numbered Decision log (D73). `read(id)` serves M6's `get_decision`; `findByTarget(target)` serves
  M6's `why(target)` (keyed by an arbitrary target, not a numeric id). `append` writes via `M1.appendGovernance` (the
  sanctioned governance-producer path; the entry text is prose-bearing → WAL-local, DT-5). *(`get_spec` is M4's, not
  here.)*
- `vouch(human) -> void` — record a human-issued vouch (D137). Only a human caller may invoke this; an agent may
  *request* a vouch but can never grant one.
- `sandboxPolicy(sessionCtx: {sessionId, trust:'local'|'imported', worktree}) -> CapabilitySet` — return the
  **per-session** capability set (allowed tools, deny-rules, permission mode, `denyRead` globs) the adapter (M9)
  enforces (D148). The `sessionCtx` param (replacing the zero-arg getter) lets two concurrent sessions of different
  trust resolve distinct sets.
- `selfModGuard(promotion, evalResult) -> allow | needsPinnedSpine` — gate a self-modifying promotion against the
  golden-corpus / pinned-spine rule (D138 guard half). Takes the eval `result` (from `M9.runEval`) — M8 orchestrates
  the proposal→runEval→selfModGuard→apply sequence.

#### Depends-on
- **M0** (record/ledger/manifest types).
- **M1** — the ledger and the Decision log are WAL-fed projections off M1's append log; cost is a
  change-event-adjacent signal. M7 is a **consumer** for those projections **and** a **sanctioned governance
  producer** — its writes (`decisionLog.append`, `vouch`, `record`/cap-record, `surfaceSubtractiveChange`) all go
  through `M1.appendGovernance` (the one `emit` chokepoint, preserving P7). It never writes around the spine. (This
  reconciles the earlier "reads M1 like any other consumer" wording — M7 also *writes* governance events, B2/C8.)
- M7 does **not** depend on M3/M5/M6/M8/M9. It is *consulted by* M6 (Decision-log reads, cap state), M8 (cap +
  sandbox policy at launch), and M9 (sandbox policy + eval-guard, handed to M9 by M8 at session build); and it
  *surfaces through* M3 (the visibility-floor feed item is rendered as an M3 feed item). None of those create an
  M7→peer compile-time edge.

#### Owned decisions (final form)

**D35 / D93-simple — the cost cap: a local SEAM, default pass-through (locked).** The cost cap is the *seam* for one
of coa's two blocks, but **by default it does not block.** Under the **subscription model** (the v1 default — the
rented Claude Code / Agent SDK loop runs under the plan's own usage limits), "budget" is **not a dollar cost** and
coa imposes **no ceiling of its own**: the loop runs until it hits its subscription limit (D85 — degrade to the
raw-loop floor). The dollar-cost ceiling becomes meaningful only on the **API route, which is itself a maybe**; if
taken, it plugs into this same seam as a single configured, **per-user, per-daemon, local** hard ceiling — coa meters
each model call and the cap reaches the loop through M9's single deny channel (`interceptTool` / `canUseTool`): a
`capHit` denies the next call (`fail-expensive` — refuse rather than overspend silently). This is **one of only two
things in all of coa that *can* block** the agent (the other is M3's close-session Type-1 gate). Either realization
is **local-only**; coa pursues **no shared/team budget** (a shared ceiling would need escrow / bounded-counter CRDTs
for no benefit here — see OPEN.md §1.1). The *two-tier regime-aware cap* (D93 full — ceiling + human-reserve band +
fail-expensive) remains **deferred to v2** with autonomous mode; v1 is attended, so the reserve band buys little.
Re-arms with autonomy.

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
  specifically the D131 flag-feedback *reason* text, the D137 *vouch* note, the D73 Decision-log *entry* text, and
  the CF-* flag *messages*. These live only in the kernel's WAL (M1). The ledger's `record()` method must
  structurally exclude them.

**D147 — the visibility floor (locked; REPLACED the heavy two-key TCB for attended v1).** The control that replaced
the originally-designed two-key trusted-computing-base ceremony. The two-key gate ("the agent must not author the
rules that govern it") is an *adversarial* control, but v1 is single-user, attended (D92), and local-first, so the
adversarial model is weak and the realistic concerns are better handled by sandboxing (D148) and architectural
separation. **What it IS:** *subtractive* governance changes — muting or weakening a constraint, broadening a scope,
adding a suppression / ignore region — are **SURFACED and reviewable, NEVER silently applied**. This is a notice / a
feed item, **not** a blocking ceremony. The rationale is non-adversarial: the agent makes mistakes, and coa's whole
point is catching drift — so it must never silently switch off the catcher inside a large diff unnoticed. *Additive*
proposals need no gate. **Re-arm:** the heavy two-key TCB (D64 / GAP-A) is **deferred** and **re-couples with
autonomy**. Anywhere a hardened feature previously leaned on the "D64 two-key TCB," it now reads "surfaced/reviewed
+ sandboxing (D147/D148)."

**D148 — sandboxing first-class (locked; THE adversarial control).** coa explicitly documents agent sandboxing as a
first-class design assumption and **the** control for adversarial / prompt-injection threats — capability scoping,
Claude-Agent-SDK permission modes, and D85 deny-rules. The D147 downgrade is *valid only because* sandboxing carries
the adversarial weight. `sandboxPolicy(sessionCtx)` returns the per-session capability set the M9 adapter enforces.
- **Honest scope (DT-1, tied to D141(d) — load-bearing):** the SDK OS sandbox bounds **bash subprocesses and their
  children only**. It does **not** sandbox the daemon host process, the in-process MCP tool handlers, the in-process
  hook callbacks, or the built-in Read/Edit/Write tools (those go through the permission layer, not the OS jail),
  and **subagents share the parent's process and sandbox**. So the v1 in-process blast-radius bound is **D92
  (attended) + worktree confinement + the escape-gate + the D96 deny-rule representation** — NOT the OS jail. The
  *true* in-process fix is per-session process isolation, deferred to v2 (D141).

**D141 — process-isolation posture (locked posture half; host half is M8).** The honest record of coa's
process-isolation reality. **(a) The corrected fact:** under the daemon topology, the agent loop, its in-process MCP
tool handlers, and its in-process hooks all run *inside the one daemon process* that holds the plaintext provider
key, the WAL + in-memory graph, and the approval/secret socket. The SDK OS sandbox bounds only bash + children. **(c)
v1 hardening (cheap, deterministic — enforced via M9/M8):** validate every in-process MCP tool input and JSON-RPC
payload with Zod *before the handler touches shared state*; set `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` on so provider
creds are stripped from bash subprocess env; set the SDK file-read deny-rules (`Read(<glob>)`, the `denyRead` set,
applied to built-in Read/Write/Edit + bash — **not** to in-process MCP tools) to the **completed set**:
`~/.coa/secrets/**`, `~/.ssh`, `~/.aws`, `~/.config/gcloud`, **`~/.claude/**` (the SDK's own credential home — the
omission the stress test caught)**, `~/.gnupg`, `~/.kube`, `~/.docker`, re-allowing only the worktree. **(d) Honest
scope (S-2/C13):** the `denyRead` set covers the **built-in/bash** read path; the **in-process** Retrieve/Mutate path
is NOT covered by it — it is covered by M6's deterministic path-confinement precondition (S-1). `denyRead` is no
longer attributed as "the" complementary control for in-process reads; it is the bash/built-in control, and S-1 is
the in-process control — two distinct controls, each named for what it actually covers. **(e) v2 prerequisite:** full
per-session process isolation is re-labeled a
**security** seam and is a **HARD prerequisite for the v2 autonomous transition**, alongside D91 + D93. **Split:**
M7 owns the **posture / honest-scope record** (this block); **M8 owns the daemon host.**

**D73 — the append-only, numbered Decision log (locked; cheap survivor).** A durable, append-only, numbered log of
governance decisions (diff-categorized sync/adopt entries plus the design Decision records). It is a *visibility /
provenance* record, not a gate. Survives the D147 downgrade. Read by M6's `get_decision` (`read`) and `why`
(`findByTarget`); `get_spec` reads M4, not the Decision log. Implemented as a WAL-fed M1 projection. The Decision-log *entry text* is prose-bearing — it stays WAL-local and
never enters the sync-eligible ledger (DT-5).

**D137 — human-only `/vouch` (locked; the GAP-A guardrail that survives).** A human-issued-only `/vouch <node>` verb
that writes a human-confirmation timestamp + commit-hash (`vouched-at=<commit>`) into the (otherwise stubbed) D66
vouch slot, emitted as a change-event so it stamps the graph node's provenance. A node is treated as fresh while its
watched commit equals the vouched commit; a damping rule stops re-nagging a node vouched more recently than its last
low-severity change. No vouch-expiry / decay machinery in v1. **The load-bearing constraint:** the agent may
*request* a vouch; **only a human may grant** one. Relaxing this re-arms GAP-A. **Principal authentication (S-3 —
how human-only is enforced):** surface-separation alone is insufficient — the agent can reach this verb via
`agent-bash → coa CLI → same-uid socket`, and D140 peer-cred only checks uid (identical for human and agent). So
privileged JSON-RPC methods (`vouch`, `pin`, `coa link --approve`, the D147/D138/D132 approvals) are accepted **only
on a connection presenting a Console-issued capability token** the daemon minted for the interactive human client and
that is **scrubbed from bash subprocess env** (`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`), so an agent-spawned `coa` cannot
read it; **defense-in-depth**, the `coa` binary is added to the session bash deny-rules (`Bash(coa *)`). Peer-cred
(uid) stays the first gate; the token is the human-vs-agent discriminator peer-cred cannot provide. The vouch note is
prose-bearing → WAL-local, never in the sync-eligible ledger (DT-5).

**D84 — secrets-at-rest posture (locked; reworded tripwire).** v1 provider keys remain gitignored, never-committed,
`0600`, under `~/.coa/` (matching the SDK's `~/.claude`). OS-keychain / encrypted-at-rest are deferred D62
capability upgrades. **Reworded hard tripwire:** keys must move to OS-keychain or encrypted-at-rest **before secrets
live in *any* tree subject to backup or sync — including OS-level sync the user already runs** (OneDrive / Dropbox /
iCloud / Time Machine / corporate backup-EDR), not only before coa's *own* sync feature ships. **v1 mitigation
(deterministic):** on startup, detect whether `~/.coa/secrets/**` sits under a known ambient-sync root and warn once;
prefer placing secrets in a non-synced location. **Recorded residuals (necessary-not-sufficient):** `0600` does
nothing against a same-uid in-sandbox read (the complementary controls are the `denyRead` set for bash/built-in
readers and M6's S-1 path-confinement for the in-process tools); a
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
become the *sole* thing blocking the agent without a pinned spine behind it. `selfModGuard(promotion)` returns
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
  capabilityFrame)`, hand the resulting neutral config to M9 to `renderNative`, consult M7 for the sandbox policy
  (`sandboxPolicy(sessionCtx)`) + cost state, **set the SDK `maxBudgetUsd = min(perSessionCeiling?,
  M7.capState().remaining)`** for the native mid-loop hard stop (verified SDK fact), **assemble the one `canUseTool`
  predicate** (cost-cap check via `M7.capState` first, then `M3.perToolDeny`, first-deny-wins, **fail-closed on
  throw**) and hand it to `M9.interceptTool`, **wire `M3.gate` to `M9.interceptStop`** (the close-gate), inject the
  `forkManager` closure into M6, construct the per-session M9 adapter, and run the session.
- `closeSession(id) -> void` — tear a session down (checkpoint at the boundary via M1, release the worktree). At the
  SDK `ResultMessage` M9 reads `usage`/`total_cost_usd` and calls `M7.charge(sessionId, cost)` exactly once.
- `notify(push: Push) -> void` — server→client notifications. **Bridge (R-12):** M8 is itself a WAL consumer
  (`subscribe`) that maps each relevant event to a `Push` and emits it. Flags/drift/cost/approval pushes are
  **reliable** (re-sent until acked); `Push.kind:'tokens'` (streamed model text) is **best-effort, non-blocking** — a
  slow/disconnected client drops token frames and **never** back-pressures the rented loop (SC-1).

#### Depends-on
- **M0** (payload + manifest types).
- **M1** — sessions read/emit through the kernel; checkpoint at session boundaries.
- **M5** — M8 calls `M5.compile(pieces)` then hands the **neutral** config to M9 to render.
- **M4** — the assembled context that M5 compiles.
- **M7** — consults the cap + sandbox policy at launch.
- **M9** — constructs the per-session adapter instance and renders M5's neutral output to backend-native.
- **M3, M6 (runtime-injection edges, C12)** — M8 holds live M3 and M6 references because it hands them to M9 (the
  deny predicate + reminder decision from M3; the tool catalogue from M6) and injects the `forkManager` closure into
  M6. These are D121 closures, not compile-time deps (M8 sorts last on the daemon side), but M8 **does** hold the
  refs — so they are listed. The full runtime closure set M8 wires is `{M1, M3, M4, M5, M6, M7, M9}`.

M8 is the hub that wires the runtime-injection closures (D121): M9 compiles against `spi` + M0 only, and M8 hands it
the live M3/M4/M5/M6/M7 references at session construction. This keeps M9 a swappable leaf rather than a fan-in hub.

#### Owned decisions (final form)

**D112 / D113 — headless lingering TS daemon + thin socket clients (locked).** coa runs as a **headless,
long-lived TypeScript daemon** that holds all state (WAL, in-memory graph, sessions) and serves **thin socket
clients** (the Electron app + the CLI). Sessions live *in-daemon*. The daemon starts on the first `coa open` (like a
language server) and lingers. Code-intel parsing runs behind an extractable child-process seam (per D141(b) — the
tree-sitter parser is a separate `code-intel` process so a native-addon crash on a hostile file does not take down
the whole daemon).

**M8 owns the daemon host (D112/D113 + D141 host-half) (locked).** M8 owns the **daemon host process** — the
process inside which the future D141 per-session child-process isolation will run. (M7 owns the isolation *posture /
record*; M8 owns the *host*.) The v1 daemon is a single process; the v2 isolation seam runs child sessions under
this host over IPC.

**D124 — OS socket + JSON-RPC 2.0 + Zod (locked).** The daemon↔client transport is an **OS socket** (Unix domain
socket / Windows named pipe) speaking **JSON-RPC 2.0**, with all payloads **Zod-validated** at the trust boundary
(validate-before-touch — see D141(c)) and server→client **notifications** for live push (flags / drift / cost /
approvals / streamed tokens). Whatever can reach the daemon can approve a push or a secret read — so the socket is
defended like the keys are (see D140).

**D127 — wire protocol policy (locked; M8's half of a 3-way split).** The JSON-RPC / tool-return **protocol policy**
over the M0 byte grammar. M8 owns the *policy over the wire*: collision defense via live `slash_commands`
enumeration (so coa commands never silently shadow the backend's); the distilled-return discipline (a tool return is
a distilled handle + pointer, raw stays in the daemon); and the `listChanged`-doesn't-mutate-prefix guardrail (a
dynamic tool-list change must not invalidate the byte-stable cached prompt prefix). **Split:** M0 owns the
byte-grammar **types**; **M8 owns the wire policy** (this block); M10 owns the human-facing client grammar. Three
disjoint concerns.

**D140 — OS-socket security & lifecycle contract (locked; the approval/secret gate).** One contract covering socket
placement, peer authentication, and crash-safe lifecycle. The socket IS the approval gate and the secret-read gate,
so a lifecycle bug (stale-socket squat) and a security gap (no peer-cred) are the *same* attack — a non-owner
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
  if the path/pipe exists, *connect-and-ping* first; only if no live daemon answers, unlink and re-bind. A blind
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
M3/M4/M5/M6/M7 references). Fork verbs are served by `bindFork(sessionId, scope) -> WorktreeId` / `releaseFork(worktreeId)`,
exposed here and injected into M6 as the `forkManager` closure (C7).

**Daemon composition root + lifecycle + storage (the dynamic model) — LOCKED at fold-in.** The static module specs
imply but never state the runtime model; M8 owns it.
- **Composition root (R-1):** at daemon start, **before** serving the socket, M8 constructs the daemon-**singleton**
  `core` instances **once** in dependency order: `M1 → M2(child handle) → M3 → M4 → M5 → M7 → M6` (M9 is constructed
  **per session**, not here). It holds them by reference and hands them into each per-session closure set.
- **Registration & first-cursor sequencing (R-3):** after construction and before `accept()`, M8 runs a fixed
  sequence: (1) M1 opens the WAL + rebuilds projections (D94 replay + reconciler rescan); (2) M8 calls
  `M3/M4/M7.subscribe` — **first-registration cursor rule:** a fresh runtime consumer starts **at the WAL tip**,
  except projection-owning consumers (M3 flags, M7 ledger, the graph) which **replay-from-0** to rebuild durable
  state; (3) M8 triggers `M4.registerProducer ×3` into M3 (admitted through CF-6); (4) only then bind the socket.
  Guarantee: every producer/consumer is wired before the first client event.
- **`.coa/` layout authority (R-4):** M8 owns first-run init + a per-module sub-namespace, so writers never collide:
  WAL `\.coa/wal/` (gitignored); declared edges `\.coa/graph/` (committed); inferred edges `\.coa/local/graph-inferred/`;
  `\.coa/generate.yaml` (M4, committed); `\.coa/constraints/` (M3, committed); tier-2 links/suppressions `\.coa/links/`
  (committed, PD-8); ledger/decisions `\.coa/local/{ledger,decisions}/` (gitignored, D135); `verified-at`/confirm
  results `\.coa/local/` (PD-8); `\.coa/local/daemon.lock` (M8). M8 seeds `.gitignore` for the `local/` half on first
  `coa open`. **Committed-half merge contract:** committed `.coa/` files are **append-or-replace-whole, never
  line-merged**; a git conflict surfaces as a D131 flag for the human, never auto-merged; M8 serializes
  committed-`.coa/` writes through the owning singleton so two sessions never write the same committed file at once.
- **Conversation store (R-7):** M8 mirrors each live session's conversation to a **gitignored per-worktree** tree
  `\.coa/local/conversation/<worktree>/` (append-only, prose-bearing → never sync-eligible, DT-5). It exposes
  `reloadConversation(worktree, toSeq)`, the re-materialization interface M1's `rewind(scope='conversation')` calls.
  - **Structured turns (R-7.a — CHAT-5, ⚠ REVIEW):** the store persists the **`TurnFrame` sequence** (thinking /
    text / tool_use / tool_result / reconcile / error / permission / subagent / turn-boundary), each with its `seq` and,
    for a subagent frame, the `parentTurn` link — **not** flat token text. `reloadConversation` therefore returns
    structured turns (the durable analog of the live `turn` Push), so a reconnecting/reopening console renders the full
    turn-by-turn + nested-subagent tree faithfully, and a dropped live frame reconciles against the store by `seq`. The
    raw token text remains recoverable as the floor (D85). **Subagent nesting keys on the existing per-worktree tree:**
    a depth-1 child (D122/D96) writes to its own `\.coa/local/conversation/<childWorktree>/`, and the parent's spawning
    turn carries the child `worktree` id + seq — so parent→child rendering needs **no new store; only the `parentTurn`
    linkage field** (CHAT-2).
  - **Compaction (R-7.b — CHAT-6, ⚠ REVIEW):** `compactConversation(sessionId, throughSeq, focus?)` produces a
    summarize-to-continue checkpoint: it writes a **summary frame** at `throughSeq`, records `{kept, dropped}`
    (the "what survived" honesty list), and emits the `compaction` **seam-marker** Push. The compaction summary is the
    one place a **model** runs in the console story — reconciled with **P1** because it is *not on a render or
    determinism-critical path*: it is an explicit, user-or-threshold-triggered action that produces an **inspectable
    artifact**, the **raw pre-compaction store is retained** (so `reloadConversation(toSeq)` below the seam always
    re-materializes the true history — the floor), and nothing authoritative is computed from the summary. The seam
    marker is the **correctness fix**: without it, compaction would silently change what `reloadConversation` replays
    (the field's documented "context permanently lost / replay diverges" failure). Standing rules/Pieces that must
    survive are re-injected from `.coa/` on the far side (they are not prose in the conversation, so they are never lost
    to a summary). ⚠ REVIEW: the summary-model call is governed-egress (secret-bounded, inside the cost cap, via the D117
    secondary path per S-4) and must honor the D135 allow-list — its input is conversation prose (WAL-local, DT-5),
    never synced.
- **Self-mod eval-gate orchestrator (R-13):** M8 (the promotion path) sequences proposal → `evalResult =
  M9.runEval(corpus)` → `M7.selfModGuard(promotion, evalResult)` → apply on `allow`, else surface (D147). No
  in-session self-enable.
- **Memory envelope (R-10):** owned jointly with M1 (stated in M1's D116) — resident-by-design within a stated
  repo-size envelope; bounded queues; a degradation notice beyond the envelope.

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
**session-orchestration** concerns and live in M8 (explicitly NOT in M5 — they are not config *compilation*). **D70
— spawner Protocol:** the agent-proposal Protocol for spawning a subagent is a *Protocol* (a coa piece delivered
into the loop), **not** a hardcoded harness feature — the agent proposes a spawn; the harness orchestrates it
(depth-1, D122). **D77 — spec-crystallization Role:** the "crystallize this loose request into a spec" capability is
a *Role* (a composable piece), **not** a built-in feature. It is now unblocked by checkpoint/rewind (D76) being
resolved.

**D72 — command surface as pieces (locked).** The coa command surface (the `coa <verb>` kernel verbs the agent and
human invoke — e.g. `/vouch`, `coa link`, `coa generate`) is composed of **pieces**, not a frozen built-in menu.
Commands are delivered like any other coa piece, so the surface is extensible and composable rather than hardcoded.

**D89 — don't-contradict-CC command grammar (policy half) (locked).** M8's command/RPC policy must not shadow or
contradict the backend's (Claude Code's) own command grammar — coa enumerates the backend's live `slash_commands`
(the D127 collision defense) and maps its own verbs so they never silently override a backend command. **Split:** M8
owns the **grammar-policy** half (this block); M10 owns the human-facing client grammar.

**CON-CAT — the enumerated JSON-RPC method catalogue (closes the named-but-empty gap). ✅ / ⚠ REVIEW per net-new method.**
The static specs named "M8's JSON-RPC method catalogue" as M10's *entire* API but only ever gave
`createSession`/`closeSession`/`notify` (+ the implied `reloadConversation`/`bindFork`/`releaseFork`). The console
cannot be built against a phantom, so the catalogue is enumerated here, in its home module. **Discipline:** every
method is **Zod-validated before touch** (D124/D141(c)) and inherits the D140 peer-cred gate; every method is a
**read or an action over data the daemon already owns** — M10 computes nothing (it never calls M6; "show the diff" is
an M8 read over a distilled handle, not `edit_symbol`). Each method is tagged by backend-impact: **(a)** pure render of
data already on the wire · **(b)** render over an existing-but-implied core method (this enumeration is the only new
work — the data exists) · **(c)** a genuinely new backend behavior, **`⚠ REVIEW`**.

```
SESSION LIFECYCLE
  createSession(role, scope, seed?) -> Session        (b)+⚠ — `seed?:ContextSlice` added for CON-3 investigate-from-flag (rides M3.envelope?); base call exists
  closeSession(id) -> void                            (a) — exists
  bindFork(sessionId, scope) -> WorktreeId             (a) — exists (D121)
  releaseFork(worktreeId) -> void                      (a) — exists (D121)
  interruptSession(sessionId) -> void                  ⚠ CHAT-10 — cooperative interrupt of the rented loop (the "stop actually stops" pain); never corrupts an in-flight edit (atomic at the M6 Mutate boundary)
  steerSession(sessionId, msg, when:'inject'|'queue') -> void   ⚠ CHAT-10 — inject-now vs queue-for-after, the user's explicit choice (queued msgs are shown pending, never silently dropped)

CONVERSATION / TURNS
  reloadConversation(worktree, toSeq) -> Conversation  (b) — R-7 interface, named here; returns STRUCTURED turns (TurnFrame[]), not flat text — the persisted analog of the `turn` Push
  subscribeTurns(sessionId) -> void / unsubscribeTurns(sessionId)   ⚠ CHAT-5 — opt-in to the live `turn`/`status` Push stream for a session (the live analog of reloadConversation)
  getToolDetail(handle) -> { tool, input, result, diff?:DiffSpec }  ⚠ CHAT-4 — dereference a distilled tool handle to its byte-faithful detail/diff (D128); a READ, raw stays in daemon
  compactConversation(sessionId, throughSeq, focus?) -> { summaryHandle, kept, dropped }   ⚠ CHAT-6 — summarize-to-continue; emits the `compaction` seam marker; raw retained (floor)
  searchConversations(query, scope?) -> ConversationHit[]   ⚠ CHAT-10 — full-text search across the per-worktree stores (the history pain); secret-bounded read of WAL-local prose (DT-5, local-only)

APPROVALS (CHAT-3 — surfacing the SDK's native permission, NOT a coa block; SC-1 preserved)
  respondApproval(requestId, { behavior:'allow'|'deny', scope:'once'|'session'|'tool-pattern', pattern?, reason? }) -> void   ⚠ — the human's decision routed back to M9's canUseTool; coa adds NO new cage

INSPECTOR READS (the pull GUI; all (b) — wrap an existing core method, this enumeration is the work)
  getContext(scope) -> ContextPackage                  (b) — M4's ephemeral byte-stable package (`coa context`)
  flagsForUser(scope?) -> FeedView                      (b) — CF-1 user audience (the CON-2 flag panel)
  activeConstraints(sessionId) -> Constraint[]          (b) — the active-constraint half of the CON-2 panel (NeutralConfig header)
  graphView(q) -> GraphView                             (b) — cycles()/coupling()/temporal()/coverage() (GRF-*); the VIZ-* read surface
  health(target, granularity) -> HealthProfile          (b) — M4 L-HLT (HLT-*); the VIZ-4 colorant
  capState(sessionId?) -> { spent, remaining, capHit }  (b) — M7 cost surface (the CON model-usage UI part)
  ledgerView(window) -> LedgerProjection                (b) — M7's D135 secret-clean ledger projection (the precision dashboards); counts + anonymized IDs only
  resolveRef(ref:SymbolRef, worktree?) -> RefResolution  ⚠ CHAT-1a — resolve a file/line/symbol mention to a navigable, worktree-qualified location (wraps M1.lookup/fuzzyMatch + M9.refs); robust to renames (resolves over the symbol, not a path string)
  why(target) / getSpec(ref) / getDecision(id)          (b) — the EXPLAIN reads (M7 decision log + M4 spec store); same data M6's tools read, exposed to the human console

TIMELINE (human-only; M1 owns, exposed here — D98)
  listTimeline() -> Checkpoint[]                        (b) — exists on M1; the rewind/undo UI part (coa's git-primary D97 rewind — the robust answer to the field's fragile shadow-git checkpoints)
  pin(handle) / unpin(handle)                           (b) — exists on M1
  rewind(scope:'code'|'artifacts'|'conversation'|'full') -> void   (b) — exists on M1; human-invoked here

FLAG TRIAGE
  submitFeedback(flag, reason) -> void                  (b) — M3's D131 typed-reason channel, exposed to the panel

AGENT / PIECE CONFIG (CON-1; local-only — honors the MU-13/14 shared-config deferral)
  listRoles() / getRole(ref) / getPiece(ref) -> …       ⚠ — reads of committed `.coa/` Roles/Pieces (M5/M1)
  writePiece(piece) / writeRole(bundle) -> seq          ⚠ CON-1 — GUI writes funnel THROUGH M8's `.coa/` layout authority + `M1.emit` (P7); NEVER a side-door write; the `agent-builder` SDD skill is the creation path the UI rides
  invokeSkill(sessionId, pieceRef) -> void              ⚠ CHAT-1g — human-initiated manual skill/asset invocation into a live session (the human analog of M6's invoke_asset)

VIZ LIVE (CON/VIZ — view-scoped; the resolution of the Ruling-12 pull-only tension)
  subscribeView(view, scope?) / unsubscribeView(view)   ⚠ — opt into `graph`/`health` deltas WHILE a view is open; daemon emits the delta ONLY to subscribed clients — never ambient, never a badge when closed (keeps the push-dashboard deferred)

SERVER→CLIENT
  notify(push: Push) -> void                            (a) — exists; the bridge (R-12) + CON-PUSH taxonomy below
```
Fold-in: M10's whole backend contract is this catalogue + CON-PUSH. The **(c)/⚠ REVIEW** methods are collected in the
consolidated "Backend/core changes the console requires" list in `OPEN.md`; the **(b)** methods are a pure enumeration
(the core methods they wrap already exist — `M4.getContext`/`health`, `M3.flagsForUser`/`submitFeedback`,
`M1.graph.*`/`rewind`/`listTimeline`, `M7.capState`/`ledger`/`decisionLog`). Reads are safe-to-call-repeatedly and
non-mutating; the writes (`writePiece`/`writeRole`, `compactConversation`, `submitFeedback`, `respondApproval`,
`steerSession`, `invokeSkill`) funnel through the existing single append path (`M1.emit`) or the SDK adapter — **no
side-door, no new mutable substrate** (the change-event-spine invariant).

**CON-PUSH — the Push taxonomy the console requires + the reliability split. ✅ / ⚠ REVIEW.** M8 is a WAL consumer
(R-12) that maps events to `Push` and emits them. The taxonomy (typed in M0) and its **two reliability tiers**:
- **RELIABLE (re-sent until acked):** `flag`/`drift`/`cost`/`approval` (existing) **+ the new `turn`/`status`/`compaction`**
  and the CON-2 panel feeds. ⚠ Each reliable structured event carries a **monotonic `seq`** so a client that drops a
  frame **detects the gap and reconciles** against `reloadConversation(worktree, toSeq)` — a dropped `tool_result` or
  `permission` frame must never silently corrupt the rendered transcript or deadlock an approval round-trip. *(This is
  the load-bearing constraint on C1: the new structured frames get a stronger delivery guarantee than `tokens`.)*
- **BEST-EFFORT (droppable, never back-pressures the loop — SC-1):** `tokens` (the raw stream, the **floor**) and the
  view-scoped `graph`/`health` deltas (a dropped delta just means the open view repaints on the next pull; no
  correctness loss). The token stream remains exactly as today (D85 strict-superset: with structured `turn` off, the
  console still renders the raw stream — never worse than the bare loop).
Fold-in: the `turn`/`status`/`compaction`/`graph`/`health` kinds + the enriched `approval` are **⚠ REVIEW** (new
producer work in M8's WAL→Push bridge + the M1/R-7 turn store that persists `TurnFrame`s). The reliability tiers and
the SC-1 no-back-pressure guarantee are non-negotiable: enriching the stream must add *typed structure over the same
events*, never a synchronous round-trip that stalls the rented loop. The structured turn-event producer is the single
biggest backend item the console requires and is sequenced in `IMPL-SPEC-BRIEF.md` to land in M8's phase, before M10.

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
- `interceptTool(canUseTool)` — wires the SDK `canUseTool` hook (called before any tool runs, exactly once per tool —
  verified SDK fact). M9 OWNS the wiring; the predicate is **assembled by M8** from M7's cost-cap (`capState`) and
  M3's `perToolDeny`, first-deny-wins, fail-closed. M9 holds no policy.
- `interceptStop(stopPredicate)` — wires the SDK **`Stop` hook** (RX-1): the **close-gate** rides here, not
  `canUseTool` (there is no "finish" tool to deny). M9 calls `M3.gate()` on each Stop event and, on `{allow:false}`,
  returns `{continue:false, systemMessage: <M3's message>}`. The two SC-1 blocks thus sit on **two SDK hooks, one
  owner (M9)** — and because they are different hooks there is no predicate-composition problem.
- `deliverReminder(r: Reminder, at: 'session-start'|'prompt'|'post-tool')` — deliver the reminder M3 decides
  (D108/D133). **There is no programmatic mid-session `role:system` channel (verified SDK fact)**, so: `session-start`
  → folded into the `systemPrompt` (+ re-anchored via project CLAUDE.md/`settingSources`, re-read each request);
  `prompt` → `UserPromptSubmit` hook `additionalContext`; `post-tool` → `PostToolUse` hook `additionalContext` keyed
  to the tool that ran (the v1-accurate trigger — *after* a tool / at prompt boundaries, **not** a mid-turn
  pre-action interrupt, which the SDK does not provide). **Non-spoofable** because the daemon authors the hook
  output; P5 makes the prose non-load-bearing (M3's deterministic gate backs anything that matters). Standing
  reminders are keyed on `{rule}` with tail-replacement (a repeat Tier-0 rule replaces its prior instance, never
  duplicates — R-14).
- `renderNative(neutralConfig) -> backendConfig` — render M5's backend-neutral config to SDK-native options
  (`systemPrompt`, `disallowedTools`, `tools`, `canUseTool`) plus `.claude` files. **`.claude` write location (S-5):**
  written **inside the per-session worktree, gitignored, and reconciler-excluded** (so authored rule text / M4-derived
  context is never re-ingested as a file change or committed), under M6's S-1 confinement; `~/.claude/**` is in
  `denyRead`.
- `render_context(pkg)` / `inject_runtime(slice)` / `cache_control(breakpoints)` — the three context-delivery ports.
  **Direction (C3):** M4 does **not** call these — it produces a `ContextPackage`; **M8 calls `render_context` at
  session start over that package, and M9's own loop calls `inject_runtime` in-flight**. M4 has no edge to M9 (it
  structurally cannot — M9 sorts after M8).
- `usageTelemetry() -> usage` — report token/cost usage (from the SDK `ResultMessage`). **Named caller:** M9's own
  settlement step at session end, which calls `M7.charge(sessionId, cost)` exactly once.
- `capabilityProfile() -> manifest` — report what this backend supports (null-fallback = the barebones profile).
  **Named caller (R-15):** M8 at `createSession`, to pick null-fallbacks before constructing the adapter.
- `refs(symbol) -> references | null` — the TypeScript-LSP port (D144). Returns precise references when `tsserver`
  is available; **null-fallback** otherwise, and the caller degrades to M2's tree-sitter floor. **Named callers
  (R-15):** M6's `find_references` and M1's graph build consult `refs` **first**, null → M2 floor.
- `runEval(corpus) -> result` — run the golden-corpus eval (D138 eval-gate mechanism; D61 gate). Called by M8's
  self-mod orchestrator (R-13).

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
This is the single seam that keeps every other module model-blind. Fold-in: the three context-delivery ports
`render_context` / `inject_runtime` / `cache_control` carry M4's produced `ContextPackage` — **M8/M9 call them over
that package; M4 does not call M9** (C3 direction); all other backend behavior is reached through the other ports.

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
calls: the **Vercel AI SDK** pinned at **`ai@^6`** with the **`@ai-sdk/anthropic@^3`** provider. *Live-verified (npm
registry + ai-sdk.dev docs, 2026-06-24):* `ai@6.0.209` is the current stable major; `@ai-sdk/anthropic@3.0.86` is
the v6-paired major; the two are version-coherent (shared `@ai-sdk/provider@3.x`); minimal call shape is
`import { anthropic } from '@ai-sdk/anthropic'` then `generateText({ model: anthropic('claude-…'), prompt })`. Do
NOT jump to the unstable `ai@7` / `@ai-sdk/anthropic@4`. The secondary path is the rail D143's cheap-model
classifier call rides.

**D118 — Reuse the SDK's OS sandbox. ✅** coa does NOT build its own OS sandbox; it reuses the Claude Agent SDK's
sandbox (bubblewrap on Linux, Seatbelt on macOS, plus `sandbox-runtime`). *Honest scope:* the OS sandbox bounds
**bash + child processes** on Linux/macOS/WSL2; on **native Windows it is advisory** (no equivalent OS primitive).
Tied to M7's D148 and D141(d) — the in-process blast-radius bound in v1 rests on attended operation (D92) + worktree
isolation, not full per-session OS isolation. Fold-in: M9 wires the SDK sandbox from M7's `sandboxPolicy(sessionCtx)` at
session launch.

**D108 — Delivery authority (the DELIVERY half; M3 owns enforcement). ✅** Models do not natively honor a
system > user > tool trust order, so coa makes authority **structural**, not a trusted label. The delivery
mechanism: **head placement** (authority content at the front of the prompt) + **tail-reinforce** (re-surfacing it
near the end / at high recency) + a **daemon-authored, non-spoofable channel** the agent cannot forge. **M9 owns the
DELIVERY mechanism** — *where in the transcript* the line lands and the physical injection. **M3 owns ENFORCEMENT** —
*which* flags/rules and *how insistently*. The minor-pin: **M9 = mechanism, M3 = decision.** **Verified-SDK
mechanism:** there is no programmatic mid-session `role:system` channel; standing authority lands in `systemPrompt`
(+ CLAUDE.md re-read each request) and mid-session reminders land as daemon-authored `additionalContext` (non-
spoofable because the *daemon* writes the hook, not the agent). Why this is enough: prompt authority is
necessary-but-not-sufficient (P5) — anything that truly matters is also backed deterministically by M3's gate, never
by prose alone. Fold-in: M9 implements `deliverReminder` and the head/tail placement.

**D133 — reminder DELIVERY (the delivery half; M3 decides). ✅** An escape-gate-anticipating Tier-0 reminder: **after**
the agent runs a tool that approaches a critical-invariant escape (or at prompt time on a Tier-A trigger match — the
**v1-accurate trigger**, *not* a mid-turn pre-action interrupt, which the SDK does not provide), the governing rule
is re-surfaced at high recency. **M3 DECIDES** which authority rule and when (`M3.reminderFor(escapeEvent)`); **M9
physically DELIVERS** it via `deliverReminder(r, at)` (`PostToolUse`/`UserPromptSubmit` `additionalContext`, or
`systemPrompt` at start). M9 owns no salience logic — it injects the line M3 hands it, at the position D108 dictates.

**D107 — Reminder/trigger model; Tier-B wiring OFF. ✅ / 🟡** Tier-0 (deterministic invariant re-surfacing) and
Tier-A reminders are ON. The judgment-based **Tier-B classifier is wired-but-OFF** — it never runs by default. M9's
half: M9 carries the Tier-B *wiring* (the plumbing through which a cheap-model classifier call would route if
enabled) in the OFF state; it is never on a critical path. The decision to enable it is M3's, gated by a measured
A/B (D143) + human approval. The reminders themselves deliver via the daemon-authored non-spoofable channel
(`deliverReminder` — `systemPrompt` / `additionalContext`; no programmatic mid-session `role:system` exists).

**D143 — Tier-B A/B cost-ledger harness: the cheap-model CALL (M9's third of a 3-way split). 🟡** The apparatus that
lets D107's Tier-B deferral ever resolve — an opt-in A/B comparing Tier-A-only vs Tier-A+B on
tokens-per-resolved-flag. M3 owns the producer + the A/B metric definition; M7 owns the A/B record on the cost
ledger; **M9 owns the cheap-model classifier CALL** — when (and only when) the Tier-A+B arm is active, M9 routes
`(user prompt × active-context list)` to a cheap model **via the D117 secondary direct-call port** (`ai@^6` +
`@ai-sdk/anthropic@^3`) and returns which active rules are relevant. *Conditions (non-negotiable):* the classifier
is OFF by default; promotion to on-by-default requires a net-positive A/B AND a human-approved proposal — there is
NO in-session self-enable. M9 adds no new dependency — the call composes over the already-decided D117 secondary
path. **Governed-egress requirement (S-4):** the D117 secondary `generateText` path has no tool call, so
`interceptTool` never sees it; therefore M9 **calls `M7.capState` before and `M7.charge` after every secondary call**
(so it is inside the cost cap), and the payload `(user prompt × active-context list)` is **secret-bounded** — held to
the same allow-list discipline as the ledger (symbol/rule IDs, never raw file contents/prompt prose). Stated as an
amendment to D117.

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
SDK-native options (`systemPrompt` / `disallowedTools` / `tools` / `canUseTool`) plus `.claude` files. *Why here,
not M5:* M5's output is deliberately backend-neutral so M5 stays swappable; the backend binding happens ONLY in M9.
Swapping the backend edits this renderer, never M5 or M8. *Cache invariant honored:* the renderer keeps the
most-stable-first byte-stable prefix M5 produced and never self-busts the prompt cache (no mid-conversation
`systemPrompt` edits; dynamic context goes through `inject_runtime` / `role:system`).

**The barebones baseline. ✅** A pinned, minimal capability profile guaranteed to work on any backend (D109). It is
the floor `capabilityProfile()` falls back to — the null-fallback contract always has a defined "least-common
behavior" to land on.

**The deny surface (F-6 — owned by M9, DECIDED by M3/M7). ✅** M9 is the SINGLE owner of everything that can cage the
agent, realized as **two SDK hooks** (verified fact — there is no "finish" tool, so one `canUseTool` cannot carry
both): **`canUseTool`** carries M7's **cost-cap** hit (and M3's `perToolDeny`, e.g. the demoted built-in `Edit`),
assembled by M8 first-deny-wins + fail-closed; **the `Stop` hook** (`interceptStop`) carries M3's **close-session
Type-1 gate**. *Why concentrated:* the entire "what can stop the agent?" surface is auditable in one module (SC-1).
Because the two blocks sit on different hooks, there is no predicate-composition problem (the earlier "two predicates
into one channel" framing is superseded); there is no M3↔M7 edge, and M9 holds no policy of its own. Every other coa
behavior is advisory and never denies.

**CHAT-3 (M9's half) — native-SDK tool-permission routing (SURFACING, not caging). ✅ / ⚠ REVIEW.** The SDK's own
**interactive tool-permission** path ("approve this bash / this edit?") is a *different thing* from coa's two SC-1
blocks. It is the **backend's** gate, not a coa policy — so coa must **surface** it to the human, never absorb it into
a coa-owned cage. The mechanism rides the **`canUseTool` hook M9 already owns** (no new hook): M8 assembles the one
predicate as today (cost-cap → `perToolDeny`, first-deny-wins, fail-closed); **if neither coa block fires AND the SDK
requests human approval for the tool**, M9 does not decide — it raises a `Push.kind:'approval'` (enriched with the
tool, its input, and a `diffHandle` for an edit, so the console shows *what* is being approved), emits a
`status:'blocked-approval'`, and **awaits** `M8.respondApproval(requestId, …)`; the human's `{behavior, scope}` is
returned to the SDK as the `canUseTool` result. **Why this is not a third block (SC-1 preserved):** coa adds no new
*coa* deny — the deny here is the *SDK's* native permission, which exists in the bare loop too (`coa raw` shows the
same prompts). coa is the **transport + the surface**, making the decision legible and low-cost (the over-reliance
research: lower verification cost beats blanket-approve). **What coa deliberately does NOT build:** an enforcement
*denylist* of "dangerous commands." The prior-art is decisive — denylists are provably bypassable (`cd x && rm …`,
base64, subshells; a major tool deprecated its denylist as unsound) **and** building one would violate SC-1 (coa does
not cage the agent in-repo). The `scope:'once'|'session'|'tool-pattern'` on `respondApproval` lets the human persist a
grant to fight permission-fatigue, but it is the human's allow-scope, applied by the SDK — not a coa-authored block.
Fold-in: M9 extends the `canUseTool` wiring with the await-human path; M8 owns `respondApproval` + the enriched
`approval` Push (CON-CAT/CON-PUSH); the two coa blocks (`Stop`-gate, cost-cap) are untouched. ⚠ REVIEW: new M9 wiring +
M8 verb; verify against the live SDK `canUseTool` callback contract at build (OPEN.md risk #5 re-confirm).

---

### M10 — Console (`app` + `cli`)

#### Identity
- **ID:** M10 · **Responsibility:** Present coa to the human — **CLI verbs first**, a **pull/inspector GUI**, and
  the honest **`coa raw`** escape — without ever owning logic the daemon owns. It is a thin, leaf client. ·
  **Durability:** NEUTRAL.

#### Public interface
**None inward — M10 is a leaf consumer.** It exposes no API to other modules. It TALKS ONLY to **M8's JSON-RPC
method catalogue** over the OS socket, and renders M8's server→client notifications. Everything else (the kernel,
flags, cost, context, graph) is reached *through* M8. M10 never reaches into M1/M3/M4/M7 directly.

#### Depends-on
- **M0** (shared schema, for the JSON-RPC payload types) and **M8** (the only module it talks to).

#### Owned decisions (final form, self-contained)

**Ruling 12 — CLI-first; the inspector GUI; silent/opt-in push-alerting. ✅** The console ships **core CLI verbs
first.** The GUI is a **pull/inspector** — the human opens it to look, it does not nag. **Push-alerting is silent
and opt-in:** it surfaces a notification only on a **cost-cap hit** or a **high-severity flag**, and rides M3/M4's
precision contract so it can never become alert-noise. The always-on Electron **push-dashboard is DEFERRED.**
Fold-in: the pull/inspector GUI stays in v1 (it is the home of `coa context`, the precision dashboards, and the
graph/scope/agent views); only the *push* surface is held to cap-hit + high-severity.
**RESHAPE (CHAT-\*, 2026-06-29) — chat-client-first, functional-and-helpful.** Ruling-12's "pull/inspector, does not
nag" was written when M10 was conceived as a **thin inspector**. With the `CHAT-*` family, M10 is **chat-client-first +
inspector**, and the posture is reshaped accordingly: the console **pushes and live-updates freely** in service of the
user (the chat stream, an open view, session status, live cost) — "it pulls *and* pushes" is good. The **only**
restraint retained is on **unsolicited ambient _alerting_** — the narrow thing the warning-habituation evidence
actually condemns (alerts you tune out, which then bury the two that matter). So proactive *interruptions* stay limited
to the two silent signals (cap-hit, high-severity); everything **engagement-driven** (tied to what the human is
actively looking at) pushes live. This does **not** un-defer the always-on push-**dashboard** (OPEN.md) — that stays
deferred as a separate *ambient-alerting product*, which is a different thing from live-rendering the surface you are
working in. The chat is **interactive-pull**; the live channel is **view-scoped** (subscribe-on-open, see CON-CAT
`subscribeView`/`subscribeTurns`), so it is helpful, not noisy. SC-1 is preserved throughout: the console still adds
**no block** — the only blocks remain M3's Type-1 gate and M7's cost-cap. See the `CHAT-*` umbrella below.

**`coa raw` — the strict-superset floor (D85). ✅** A **read-only transparency verb** that honestly prints what coa
is doing to the rented loop and **what it cannot turn off** — the raw rented loop is never hidden. **It is a view,
not a mode:** it does **not** disable the loop or coa's governance (so it never contradicts SC-1's two blocks). coa
is a **strict superset** of
the bare Claude Agent SDK loop — every coa feature must either add value or degrade to a literal pass-through; `coa
raw` is the floor that proves it. Fold-in: `coa raw` is the v1 realization of the D74 rigor-preset dial's floor —
the *floor* (a literal raw pass-through) ships in v1; the **dial itself** (named presets above the floor —
prototype/tool/product — binding the governance axes) is **deferred machinery, see `OPEN.md`**.

**D114 — Electron + React shell, Tauri-swappable. ✅** The inspector GUI is an **Electron + React** desktop app, with
**Tauri** named as a later swappable alternative. Desktop-only in v1. It is a pure client of M8's JSON-RPC catalogue
+ notifications; it holds no daemon logic.

**D128 — UI information architecture + renderer-isolation + diff-fidelity. ✅ (sits with D114)** Three zones — a
**conversation pane**, an **urgency-ordered dashboard rail**, and an **event-driven approval surface** — plus a
**renderer-isolation contract** (the Electron renderer process is isolated from node/privileged APIs),
**byte-faithful diff-fidelity** (diffs are rendered exactly as the bytes are; no silent truncation or
normalization), and **notification batching** (so alerts coalesce, never storm). Fold-in: the byte-faithful,
no-silent-truncation diff render *strengthens* M7's D147 visibility floor — subtractive/governance changes are shown
honestly, never masked by the UI.

**The `CHAT-*` family — the agent chat interface (goal 1; evolves D128's conversation pane). ✅** "A really good agent
chat interface — like Claude Code but with improvements." This family is the **internal structure of D128's
conversation zone**: it EVOLVES D128 (the D53-evolve discipline — extend, never silently break), it does not replace
it. D128's three top-level zones (conversation · dashboard rail · approval surface) stay; `CHAT-*` specifies what lives
*inside* the conversation zone and which seams carry it. **Backend contract:** the whole family renders **CON-CAT**
methods + **CON-PUSH** notifications (M8); M10 computes nothing authoritative (it never calls M6 — "show the diff" is
an M8 read over a distilled handle, not `edit_symbol`). **Posture:** chat-client-first + functional/helpful (the
Ruling-12 RESHAPE above); pushes/live-updates freely, restrains only ambient alerting; SC-1 intact (the console adds no
block). The prior-art bar (Claude Code's nested-subagent tree, Cursor/Cline/Zed diff review, the documented failure
modes) is folded into each sub-decision; the goal of this pass is that **every capability is accommodated by a real (or
newly-flagged) seam**, not pixel layout (that lands at M10 build).

- **CHAT-1 — in-chat reference resolution (1a). ✅ ⚠ REVIEW.** A file / line / symbol mentioned in the stream becomes a
  **navigable, worktree-qualified** target. The console linkifies refs in rendered text (pure render) and resolves them
  via the new `M8.resolveRef(ref, worktree?)` (CON-CAT), which wraps `M1.lookup`/`fuzzyMatch` + `M9.refs` — **resolving
  over the symbol/graph, not a path string**, so a ref survives a rename (D52) and disambiguates name collisions. It is
  **worktree-qualified** because depth-1 subagents (D90/D96) run in sibling worktrees — a ref in a child's stream must
  resolve in the child's checkout. The prior-art failure modes this must clear (all real, cross-tool): line-jump
  (open *at* the line, not just the file), paths with spaces, multi-root/multi-worktree, post-rename. Opening the
  resolved target routes out through CON-4 (IDE-routing), never an in-app editor. Fold-in: `resolveRef` (⚠ REVIEW — new
  M8 read over existing M1/M9 surface); refs in the stream arrive structured where possible (the `tool_use`/`reconcile`
  frames carry real paths) rather than scraped from prose.

- **CHAT-2 — the nested-subagent render model (1b). ✅ ⚠ REVIEW.** The owner's explicit ask (unlike the inline VS Code
  extension): the **spawn call shows inline**, but the subagent renders as a **child of the spawning turn** (nesting).
  Validated against the newest prior art — Claude Code renders nested subagents as a **tree** (descendant counts, a path
  back to the root, per-subagent color); Cline renders them as inline flat cards (the owner wants better); Roo uses a
  switch-into task-stack whose documented weakness is **invisible hierarchy + cost roll-up**. So coa's model: the child's
  **own structured turn stream** renders indented under its spawn frame, with a **per-subagent roll-up (tools · tokens ·
  $ · status)** surfaced on the parent frame (closing the Roo gap; ties to D96 one-cost-unit-per-session). **The seam:**
  the per-worktree conversation store (R-7) already keys a child's stream by its `worktree`; the *only* gap was a link
  from the child stream to the spawning turn — supplied by the **`parentTurn` field on the `turn` Push + the `subagent`
  `TurnFrame`** (R-7.a). Depth stays 1 (D122); the render model is depth-general but v1 shows one level. Fold-in:
  `parentTurn` linkage + `subagent` lifecycle frames (⚠ REVIEW, M8 Push + R-7 store); no new orchestration — it renders
  the existing depth-1 fan-out.

- **CHAT-3 — the permission / approval surface (1c). ✅ ⚠ REVIEW.** Native-SDK tool-permission prompts ("approve this
  bash / this edit?") render on **D128's event-driven approval surface**, not as a coa cage. The render half: a
  `permission` `TurnFrame` marks the spot inline; the **enriched `approval` Push** (tool · args · `diffHandle`) drives
  an approval card showing **what** is being approved (the prior-art lesson: the #1 permission complaint is the prompt
  showing a meaningless/`cd:*` action — coa shows the real command/diff); the human answers `M8.respondApproval`
  with a `scope:'once'|'session'|'tool-pattern'` to fight permission-fatigue. The backend half is **CHAT-3 in M9**
  (native-SDK routing — surfacing, not caging). **coa builds no enforcement denylist** (the prior art is decisive:
  denylists are bypassable *and* a denylist violates SC-1). The over-reliance research sets the design target: **lower
  the cost of verifying**, don't add explanation (explanation alone increases blind approval) — so the card leads with
  the diff/command, risk-tiered. Fold-in: `respondApproval` + enriched `approval` (⚠ REVIEW, M9 wiring + M8 verb); the
  two coa blocks (Stop-gate, cost-cap) are untouched — SC-1 preserved.

- **CHAT-4 — tool-usage / diff inspection (1d). ✅ ⚠ REVIEW.** "Pull up the diff, the way the VS Code extension's edit
  does." Each `tool_use`/`tool_result` `TurnFrame` carries a **handle**; the console fetches detail on demand via
  `M8.getToolDetail(handle) -> {tool, input, result, diff?}` — an **M8 read over the distilled handle** (the raw stays
  in the daemon, D57), rendered **byte-faithfully** (D128 — no silent truncation/normalization of a diff or metric).
  This is collapse-by-default, expand-on-demand (the progressive-disclosure lesson). It is **not** an M6 invocation
  (M6 is the agent's surface). Fold-in: `getToolDetail` (⚠ REVIEW — new M8 read); byte-faithful render rides D128.

- **CHAT-5 — the structured turn-by-turn model (1e). ✅ ⚠ REVIEW.** Turn legibility — cleanly separating *used-a-tool /
  generated-output / thinking / …* — requires a **typed turn-event taxonomy**, not the flat `tokens` string (the
  stress-test proved the raw stream cannot carry it). The taxonomy is the **`TurnFrame`** union (M0) delivered on the
  **`turn` Push** (full set per the owner's decision: `thinking · text · tool_use · tool_result · reconcile · error ·
  permission · subagent · turn-boundary`), persisted as structured turns by R-7.a. Each frame is **sequenced + reliable
  + gap-detectable** (CON-PUSH) so a dropped frame reconciles against `reloadConversation` — never silently corrupting
  the transcript. Raw `tokens` is retained as the **degrade-to-floor** (D85: with structured turns off, the console
  still renders the raw stream, never worse than the bare loop). A **`status` Push** (running / idle / blocked-approval
  / blocked-tool / done / error) answers the dominant cross-tool legibility pain — *what is it waiting on?* A
  **focus/denoise density control** (collapse a turn to a one-line tool summary, cf. Claude Code `/focus`) is the
  legibility lever. Fold-in: `turn`/`status` Push + the R-7.a turn store (⚠ REVIEW — the single biggest console backend
  item); raw `tokens` floor unchanged; must **never back-pressure the loop** (SC-1 — typed structure over the same
  events, not a synchronous round-trip).

- **CHAT-6 — conversation reinstantiation / compaction (own UI part; resolves #6). ✅ ⚠ REVIEW.** Rewind +
  `reloadConversation` existed, but **compaction** (summarize-to-continue a long session) was unspecified — and the
  research shows it is a **correctness + trust hazard**, not just a feature (compaction silently mutates what
  `reloadConversation` replays; "context permanently lost" is a documented cross-tool complaint). Per the 1g rule
  (CHAT-8) compaction is a **general + frequent + stateful** capability → its **own UI part**, not a command. The seam
  is **R-7.b** (`M8.compactConversation` + the `compaction` seam-marker Push + the `{kept, dropped}` "what survived"
  honesty list), reconciled with **P1** (the summary-model call is off the render/determinism-critical path, produces an
  inspectable artifact, and the raw pre-compaction store is retained as the floor). Standing rules/Pieces survive by
  re-injection from `.coa/` (they are not conversation prose). Fold-in: `compactConversation` + seam marker (⚠ REVIEW,
  M1/R-7 + M8; governed-egress secret-bounded per S-4).

- **CHAT-7 — clean markdown rendering (1f). ✅ (pure-M10, no backend).** The conversation renders GitHub-flavored
  markdown with syntax-highlighted, copy-able code blocks, honoring the byte-faithful contract for embedded diffs/code
  (D128). This is a pure client capability over text already on the wire (the `text` `TurnFrame` / `tokens`); **no
  backend change** — the only dependency is that the structured taxonomy (CHAT-5) hands the renderer clean *text*
  blocks separated from tool/thinking noise. Fold-in: none beyond CHAT-5; classified **(a)**.

- **CHAT-8 — the in-chat command surface + manual skill invocation + the command-vs-own-UI-part rule (1g). ✅ partial
  ⚠ REVIEW.** CLI-like coa commands are typable mid-chat: recognized via the **D127 in-session reservation token**,
  collision-defended by the **D89/D127 wire policy** (never shadow a backend command), delivered as **D72 pieces** over
  CON-CAT. Manual skill/asset invocation is the human analog of M6's `invoke_asset`: `M8.invokeSkill(sessionId,
  pieceRef)` (⚠ REVIEW). **The command-vs-own-UI-part rule (stated so it is reproducible):** *a capability becomes its
  **own UI part** when it is **general** (not bound to one turn), **frequent**, and **stateful** (you return to it); it
  stays a **command** when it is **contextual** (acts on the current turn/selection), **occasional**, or
  **one-shot/stateless**.* Applying it → **UI parts:** chat reinstantiation/compaction (CHAT-6), model-usage/cost
  (CON-5), agent configuration (CON-1), the flag panel (CON-2), the viz (VIZ-*), the timeline (CHAT-10). **Commands:**
  `why`/`get_decision`/`get_spec`, `coa link`, a one-shot skill invocation, `coa raw`. Fold-in: `invokeSkill` (⚠
  REVIEW); the rest rides D72/D89/D127; the rule is the reusable test that inverts "anything frequent is a command."

- **CHAT-9 — authoritative reconciliation: the agent's claim vs ground truth (discovery, 1h). ✅ ⚠ REVIEW.** The #1
  cross-tool *trust* failure (verified, high-profile: agents reporting edits that never applied; deleting data then
  fabricating records; marking work ✅ unverified). coa **uniquely** has the ground truth — the git-primary reconciler
  + WAL (D81/D97). So the conversation surfaces, alongside the agent's narration, the **authoritative `reconcile`
  `TurnFrame`** (the reconciler's actual change-event for that turn, by `changeSeq`), and **flags divergence** ("agent
  said it edited X; no write to X was recorded"). This is the console expression of coa's whole governance thesis and a
  genuine differentiator; it rides the existing change-event spine + byte-faithful diff (D128). Fold-in: the `reconcile`
  `TurnFrame` (⚠ REVIEW — M8 maps reconciler change-events into the turn stream); computes nothing new (it renders
  M1's authoritative record).

- **CHAT-10 — session control + timeline legibility (discovery, 1h). ✅ ⚠ REVIEW.** Steer/interrupt a running session
  without killing it — `M8.steerSession(sessionId, msg, 'inject'|'queue')` (the explicit inject-now vs queue choice;
  queued messages shown pending, never silently dropped) and `M8.interruptSession` (a *cooperative* interrupt that
  never corrupts an in-flight edit — atomic at the M6 Mutate boundary; the "stop actually stops" pain). The **timeline
  UI part** exposes M1's git-primary rewind/checkpoint (`listTimeline`/`pin`/`rewind`) — coa's D97 substrate is the
  robust answer to the field's fragile shadow-git checkpoints (verified: competitors lose hours of work to no-op
  restores), so the console surfaces *what a checkpoint captures* honestly. `searchConversations` (CHAT-10) gives
  resumable, searchable history. Fold-in: `interruptSession`/`steerSession`/`searchConversations` (⚠ REVIEW, CON-CAT);
  `listTimeline`/`rewind` are (b) (exposing existing M1 methods).

- **CHAT-11 — the v1 complexity line.** **v1 ships:** structured turn-by-turn (CHAT-5) with the full `TurnFrame`
  taxonomy + status; nested-subagent render at depth-1 with cost roll-up (CHAT-2); the permission/approval surface
  (CHAT-3) with `scope` grants; tool/diff inspection by handle (CHAT-4); in-chat reference resolution (CHAT-1); clean md
  (CHAT-7); the in-chat command surface + manual skill invoke + the stated command-vs-UI-part rule (CHAT-8);
  conversation compaction-as-own-UI-part with the seam marker (CHAT-6); authoritative reconciliation (CHAT-9);
  interrupt/steer + the rewind timeline + history search (CHAT-10) — all over CON-CAT/CON-PUSH, byte-faithful,
  computes-nothing. **v1 defers (seams kept):** depth >1 subagent nesting (D122 holds at 1); a learned/Tier-B salience
  for which reconcile-divergences to surface (deterministic divergence only in v1); voice/image input; the
  description-tier model-judged turn denoise (deterministic focus/collapse only). The seams (the `TurnFrame` union, the
  `parentTurn` link, the handles, `resolveRef`) are built at the floor; the deferred items are reach, not soundness.

**The `CON-*` family — the surrounding console surfaces (goal 2; built on the chat family). ✅** The surfaces around the
chat: agent config/creation, the flag/constraint panel + investigate-dispatch, IDE-routing, and the capabilities the
CHAT-8 rule promotes to their own UI part. Same discipline: render over **CON-CAT**; compute nothing; every
backend-touching sub-decision carries `⚠ REVIEW` and points at its home seam.

- **CON-1 — agent configuration + creation UI (2a; local). ✅ ⚠ REVIEW.** Efficiently modify/create agents — and an
  **agent = a Role** (M5: a named bundle of Pieces + a capability frame, TAX-6). The UI edits committed `.coa/` Roles
  and Pieces, and **every GUI write funnels through M8's `.coa/` layout authority (R-4) + `M1.emit` (P7)** — never a
  side-door write (the change-event-spine invariant). Reads: `listRoles`/`getRole`/`getPiece`; writes:
  `writePiece`/`writeRole` (CON-CAT). The existing **`agent-builder` SDD skill is the creation path** the UI rides
  (the UI is a front-end over it, not a parallel writer). **Scope = local only:** the `local-only` vs publishable split
  (OPEN.md §1.1) is the boundary the UI honors — **shared/team agent config is the deferred MU-13/14** and is NOT built
  here (a local Piece/Role never publishes → zero cross-user concern). Fold-in: `listRoles`/`getRole`/`getPiece` +
  `writePiece`/`writeRole` (⚠ REVIEW — writes through R-4 + M1.emit; honor the MU-13/14 boundary).

- **CON-2 — the flag + active-constraint panel (2c). ✅ (b).** A clean panel of open flags + active constraints. It is
  the **user audience of CF-1** — `flagsForUser` (crit/high expanded, med/low collapsed-but-counted, never hidden) —
  *ridden, not re-invented* (the console must not build a parallel surfacing). Active constraints render from the
  compiled `NeutralConfig` header (`activeConstraints`). Triage action: `submitFeedback` (D131). All **(b)** — the data
  exists; CON-CAT exposes it. Fold-in: `flagsForUser`/`activeConstraints`/`submitFeedback` (no new M3 surface — see M3's
  console-seams note).

- **CON-3 — investigate-dispatch from a flag (2c). ✅ ⚠ REVIEW.** Select a flag → click → **dispatch an agent to
  investigate it** = a seeded investigation session: `M8.createSession(role, scope, seed = M3.envelope?(flag))`, so the
  session opens already grounded in the flag's evidence envelope (and `fix?` where present). Rides CF-1 + the existing
  `envelope?` producer hook; the dispatch is one attribution/cost/rewind unit (D96). Fold-in: the `seed?` param on
  `createSession` (⚠ REVIEW — M8 session-spawn extension reading `M3.envelope?`).

- **CON-4 — IDE-routing of editor actions (2d). ✅ (a), through the trusted side.** **No built-in text editor;** actions
  that resolve to an editor (open a file at a ref from CHAT-1, open a diff from CHAT-4) **route out to VS Code / another
  IDE.** Because of D128 **renderer-isolation**, the shell-out happens on the **trusted (Electron main) side**, never
  the renderer — the renderer requests the route, the trusted side executes it (`code --goto file:line`, or the IDE's
  diff). The diff bytes come from `getToolDetail` (CHAT-4), byte-faithful. **(a)** — a pure client/app-architecture
  capability over data already on the wire; no backend change. Fold-in: none on the backend; the isolation boundary is
  D128's.

- **CON-5 — the "own UI part" surfaces the CHAT-8 rule promotes. ✅ (b) + cross-refs.** Per the command-vs-UI-part rule:
  **model-usage / cost** is its own UI part — live spend + remaining + cap, **and per-subagent cost roll-up** (CHAT-2),
  riding `capState` + the D135 secret-clean `ledgerView` (counts + anonymized IDs only; never raw prompts/secrets). The
  research makes this load-bearing, not cosmetic: **cost-surprise / runaway-spend** is a top-tier documented pain (a
  fan-out burning a plan in minutes with no warning); coa's M7 cost-cap is the genuine differentiator, and the surface
  makes spend legible *before* the cap. The other promoted surfaces cross-reference their owning decisions: **chat
  reinstantiation/compaction = CHAT-6**, **agent config = CON-1**, **the flag panel = CON-2**, **the timeline =
  CHAT-10**, **the viz = VIZ-\***. Fold-in: `capState`/`ledgerView` (b); the cost roll-up rides CHAT-2's subagent
  frames; no new authoritative computation.

- **CON-6 — the v1 complexity line.** **v1 ships:** local agent config/creation through the `.coa/` authority (CON-1);
  the CF-1 flag + active-constraint panel with triage (CON-2); investigate-dispatch via the flag envelope (CON-3);
  IDE-routing through the trusted side (CON-4); the model-usage/cost UI part with per-subagent roll-up (CON-5). **v1
  defers (seams kept):** **shared/team agent config** (MU-13/14 — local only in v1); auto-suggested agent/Role scaffolds
  beyond `agent-builder`; a cross-session cost-analytics dashboard beyond the live surface + the ledger projection. The
  writes ride the existing change-event spine; the deferred items are reach, not soundness.

**The inspector content (what the pull GUI shows). ✅** The inspector is the home of:
- `coa context [scope]` — show + diff the **ephemeral, byte-stable assembled context package** (the package is M4's;
  the inspector renders it). It is an inspectable cache, NOT a committed git artifact; the WAL freshness stamp
  answers "is it current?".
- the **precision dashboards** — precision/recall for flags/grounding, riding **M7's** kept minimal secret-clean ledger
  (counts + anonymized IDs only; never raw prompts/secrets).
- the **graph / scope / agent / health views** — read-only views of M1's dependency graph (GRF-\*), declared scopes,
  live agents, and the L-HLT health profile (HLT-\*), rendered per the **VIZ-\* family below** (idiom-per-granularity +
  drill-down). Includes the GRF-3 **coverage stat** so an incomplete graph never reads as complete.
All of this is rendered from data pulled over M8's JSON-RPC catalogue; the console computes nothing authoritative.

**The visualization — the VIZ-\* family (M10 renders; GRF-\* is the graph, HLT-\* is the health payload). ✅ LOCKED
(the v1 line is VIZ-7).** The visualization pass (node-link vs DSM-matrix vs treemap vs code-city; the hairball
literature; LOD/drill-down; what Structure101/Lattix/NDepend/CodeScene/Sourcetrail actually render) produced one
load-bearing finding: **there is no single "graph view" — the right idiom changes per granularity, and a raw
node-link view of a real repo is an unreadable HAIRBALL.** So coa renders a different proven idiom at each GRF-2 tier,
bridged by drill-down. (Evidence class noted per claim — much of this field is practitioner consensus, not controlled
study.)
- **VIZ-1 — idiom per granularity (the core mapping).** **repo →** a **treemap / circle-packing** (size = LOC,
  color = a health metric; **no edges** — the repo-level edge graph is never a useful overview); the proven
  metric-over-structure idiom (Shneiderman 1992; squarified Bruls 2000; CodeScene's hotspot map, NDepend's metric
  view). **scope/module →** a **Dependency Structure Matrix (DSM)** for dense coupling + cycle visibility — matrices
  **beat node-link above ~20 vertices** for everything but path-following (Ghoniem/Fekete/Castagliola 2004/2005,
  controlled experiment), and every serious architecture tool converges here (Structure101, Lattix, NDepend,
  IntelliJ). **file →** an **indented tree / outline** (the reliable, layout-stable spine) + the hotspot leaf.
  **symbol →** a **small node-link ego-graph** (k-hop neighborhood: callers/callees/types) coordinated with the source
  view — the one place node-link is *right* (small, path-following; Sourcetrail's model; van Ham & Perer 2009). Fold-in:
  the idiom is chosen by the tier, never one global graph.
- **VIZ-2 — drill-down via semantic zoom (the tier bridge, mapping onto GRF-2).** The tiers connect by
  **expand/collapse semantic zoom** (Perlin/Fox 1993; aggregation/filtering as *the* scale strategy, Munzner 2014):
  click a treemap region → the scope DSM; click a DSM cell/scope → its file tree; expand a file → its symbol
  ego-graph. **Edge aggregation:** a collapsed scope shows one **weighted** module↔module DSM cell (GRF-4 weight);
  expanding reveals the file/symbol edges underneath. **Focus+context, never the whole graph** (van Ham & Perer 2009
  "search, show context, expand on demand") — the symbol index is queried per-focus (a DOI-pruned k-hop), never
  materialized wholesale. This maps cleanly onto coa's tiers: **symbol/file/scope = GRF-2**; the bridge is the same
  drill-down Sourcetrail pioneered, with the treemap/DSM overview on top.
- **VIZ-3 — cycle/tangle visualization (the #1 spaghetti signal — detect → locate → read).** (1) **Detect:** Tarjan
  SCC over GRF-1's retained edges. (2) **Locate:** mark the SCC cells in the scope **DSM** — after topological
  ordering an acyclic system is triangular, and feedback marks on the **wrong side of the diagonal** are the back-edges
  (orientation-neutral phrasing — the "below-diagonal" convention is order-dependent; NDepend renders cycle cells in
  red). (3) **Read:** on click, **extract the SCC as a small node-link subgraph** (the condensation) with the
  **minimum-feedback-arc back-edge(s) highlighted — the specific edge to cut** (GRF-1). This is exactly where node-link
  excels (a 3–8-node loop, path-following). Fold-in: the cycle view is the bridge from the DSM (locate) to the
  extracted node-link (read); coa never just says "these tangle."
- **VIZ-4 — health overlaid on structure (HLT-\* is the colorant, honestly).** HLT-\* metrics **color** the structural
  views — the **hotspot** treemap (color = churn×complexity, HLT-5), the **coupling** DSM (cell shade = GRF-4 weight),
  per-function **complexity** on the file/symbol tiers. The HLT-2 discipline carries into the UI: **worst-of, never a
  single averaged grade** (no compensatory color that lets a clean module hide a hotspot), and **`size-loc` shown
  alongside** every metric (the confound). The GRF-3 **coverage stat** is always visible so a low-coverage region's
  metrics read as `confidence:'low'`, never as a precise green. Fold-in: the colorant is `MetricSample`; the legend
  states the basis (graph/ast/wal) + confidence.
- **VIZ-5 — anti-patterns (what coa must NOT build).** **No full-repo force-directed node-link** ("the hairball" —
  unreadable past a few dozen–hundred nodes; the #1 thing to avoid). **No 3D code-city** as a comprehension tool (one
  positive experiment vs a *non-visual* baseline — Wettel 2011 — does not beat the occlusion/navigation/disorientation
  cost in a pull-only inspector; eye-candy). **No "overview-first" of the whole graph** (wrong default at scale —
  query/focus-first instead). **No geometric fisheye distortion** (disorienting in a tool reopened repeatedly — use
  expand/collapse, not distortion). **No treemap-with-edges** (containment replaces edges by construction; switch to
  DSM/ego-graph for relationships). **Cap any node-link view at ≲50 nodes** (Ghoniem ~20-vertex crossover); beyond
  that, switch idiom. Fold-in: these are explicit non-goals, not omissions.
- **VIZ-6 — pull-only, byte-faithful, computes-nothing (the M10 contract).** The health/graph viz rides the existing
  M10 posture: **Ruling-12 pull/inspector** (the human opens it to look; it never nags — health is the carrot, not a
  push), **D128** renderer-isolation + byte-faithful (no silent truncation of a diff/metric), **D114** Electron/React,
  and **D85** — coa with the viz off is never worse than the raw loop. M10 **computes nothing authoritative**: every
  metric/edge is pulled from M1/M4 over M8's JSON-RPC catalogue (`M4.health`, `graph.cycles/coupling/temporal`,
  `graph.coverage`). Layout is **stable across reopenings** (expand/collapse state, not force-directed jitter).
- **VIZ-7 — the v1 complexity line.** **v1 ships:** the four idiom-per-tier views (treemap/circle-pack · DSM · tree ·
  ego-graph, VIZ-1), semantic-zoom drill-down + focus+context (VIZ-2), the detect→locate→read cycle view (VIZ-3), the
  health overlay with worst-of + size + coverage (VIZ-4), the anti-pattern non-goals (VIZ-5), all under the pull-only
  byte-faithful contract (VIZ-6). **v1 defers (seams kept):** **hierarchical edge bundling** (cosmetic; DSM does the
  dense-coupling job unambiguously), **3D/code-city** (rejected, not just deferred — VIZ-5), **learned/auto layouts**,
  and a **web/remote** inspector (desktop-only, D114). The idioms are proven at the floor; the deferred items are
  reach, not soundness.

**The VIZ-\* extension — interactive & dynamic (goal 2b). ✅ (extends VIZ-1…7; does NOT recreate them).** VIZ-1…7 stay
**LOCKED and unchanged** — the idiom-per-tier set, the detect→locate→read cycle view, the health colorant, the
anti-patterns, the byte-faithful pull contract. Goal 2b asked for "interactive & dynamic," so this extension adds the
**interaction layer** (VIZ-8) and **live updates** (VIZ-9) *over* those static idioms.

- **VIZ-8 — the interaction layer (the "interactive" half). ✅ (a)/(b), pure client.** Beyond VIZ-2's semantic-zoom
  drill-down, the views gain: **hover → provenance/coverage** (the `EdgeProvenance` + GRF-3 `graph.coverage` behind a
  cell/edge, so a low-coverage region reads as `confidence:'low'`, never false-green); **click a node → resolve →
  open** (rides `resolveRef` + CON-4 IDE-routing — the symbol ego-graph becomes a launch point into the editor);
  **focus/filter** (the DOI-pruned k-hop query VIZ-2 already specifies, exposed as a control); and **cross-highlight**
  of the VIZ-3 minimum-feedback-arc back-edge from the DSM to the extracted node-link. All of this is **client
  interaction over `graphView`/`health` pulls** (CON-CAT) — coa computes nothing new. Fold-in: rides
  `graphView`/`health` + `resolveRef`; classified (a)/(b).

- **VIZ-9 — live updates (the "dynamic" half; view-scoped). ✅ ⚠ REVIEW.** An open graph/health view **updates live** as
  the graph changes (e.g., while a session is editing code), via the **view-scoped `graph`/`health` delta Push**: the
  console `subscribeView(view, scope?)` on open and `unsubscribeView` on close, and the daemon emits a delta **only to a
  client with that view open** (CON-PUSH). This is the Ruling-12 RESHAPE applied to the viz — **live while you watch,
  silent otherwise** — *interactive-pull*, not the deferred ambient push-dashboard (which stays deferred as a separate
  alerting product). Delivery is **best-effort** (a dropped delta just repaints on the next pull — no correctness loss),
  so it never back-pressures M1's graph build (SC-1). **Layout stays stable across deltas** (expand/collapse state
  preserved; no force-directed re-jitter — VIZ-6), and every delta is byte-faithful (computes-nothing). Fold-in:
  `subscribeView`/`unsubscribeView` + the `graph`/`health` delta Push (⚠ REVIEW — M8 view-scoped emission); honors the
  pull-only-when-closed contract.

- **VIZ-10 — the extension's v1 complexity line.** **v1 ships:** the VIZ-8 interaction layer (hover-provenance,
  click-to-open, focus/filter, cycle cross-highlight) and VIZ-9 **view-scoped live updates** over the locked VIZ-1…7
  idioms. **v1 defers (seams kept):** an **always-on / global** live dashboard (that is the deferred push-dashboard, and
  it stays deferred — VIZ-9 is scoped to an open view, not ambient); **animated transitions / time-scrubbing** of the
  WAL⨝structure temporal view (GRF-5) beyond a static window; **collaborative/multi-user** live cursors (rides the
  deferred MU-\* sync). The interaction + view-scoped live channel are the floor; the deferred items are reach, not
  soundness.

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

*End of SPEC.md. The eleven module specifications above are the complete WHAT, by module. For the build order and
the v0 calibration spike that gates it, see `IMPL-SPEC-BRIEF.md`; for deferred scope, tuning knobs, and open risks,
see `OPEN.md`. These three docs are the complete, self-contained handoff.*

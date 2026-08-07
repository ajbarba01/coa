# OPEN.md — deferred scope, tuning knobs, and open risks

**Date:** 2026-06-24 · **Status:** one of the three self-contained handoff docs (`SPEC.md` · `IMPL-SPEC-BRIEF.md` ·
`OPEN.md`). It records what is **NOT in v1** (and why / what would promote it), the **tuning knobs** the v0 spike
calibrates, the **open risks**, and the one thing that is **rejected outright**. Nothing here is a v1 build target — **except the explicitly-marked §0 backend-changes list**,
which is v1 work surfaced here for one consolidated owner sign-off (per the M10/console grounding posture).

---

## 0. ⚠ REVIEW — Backend/core changes the console (M10) requires (owner sign-off)

**Unlike the rest of this doc, this section IS v1 work.** M10 "talks ONLY to M8's JSON-RPC method catalogue," so every
console capability is either (a) a pure render of data already on the wire, (b) a render over an existing-but-implied
core method (the only new work is *enumerating* it as an RPC verb — the data exists), or (c) a genuinely new
backend/core behavior. The (c) items are collected here so the owner signs off explicitly — **no backend change is
buried inside an M10 fold-in.** Each lands in its **home module's phase** (Phases 1–5), *before* M10 is built (Phase 6),
so the console RENDER never forces a backend refactor (the no-refactor guarantee; see `IMPL-SPEC-BRIEF.md`). The surface
is deliberately concentrated in **M8** (the daemon hub) + small touches in M9/M1-R-7/M3 — all of which predate M10.

| # | New backend behavior | Home module(s) | Decision(s) | Notes / invariant guard |
|---|---|---|---|---|
| **C1** | **Structured turn-event Push** — the `turn` kind carrying the `TurnFrame` union (thinking/text/tool_use/tool_result/reconcile/error/permission/subagent/turn-boundary), **reliable + `seq` + gap-detectable** | M8 Push + M1/R-7 store | CHAT-5, CON-PUSH, R-7.a | The single biggest item. **Must never back-pressure the loop (SC-1)** — typed structure over the *same* events, not a synchronous round-trip. Raw `tokens` retained as the degrade-to-floor (D85). |
| **C2** | ~~Subagent-stream linkage — `parentTurn` field + `subagent` lifecycle frames (spawn/running/idle/done/rollup)~~ **SHIPPED, by a different mechanism.** Session lineage (`SessionMeta.parent`/`.root`, M8 D150) + console-side grouping, not the turn-level `parentTurn`/`subagent` `TurnFrame` link this row originally proposed (still schematized, still unwired). A read-time transcript join (`foldTreeToTranscript`) is built and unit-tested but likewise has no caller — a parent reads a child's `events.ndjson` directly. Depth is unbounded (D122 superseded — `docs/adr/0032`), not the depth-1 this row assumed. | M8 D150 (`packages/core/src/session/`) | `docs/adr/0032`/`0034`, CHAT-2 | The tree cost roll-up is implemented and unit-tested but has **no RPC producer** — `listSessions` does not surface it; see ROADMAP.md. |
| **C3** | **Approval round-trip** — `respondApproval(requestId,{behavior,scope,…})` + enriched `approval` payload + M9 native-SDK-permission routing | M9 (wiring) + M8 (verb/Push) | CHAT-3 (M10), CHAT-3 (M9), CON-CAT | **SURFACING, not a coa block (SC-1).** Rides the `canUseTool` hook M9 already owns; coa builds **no enforcement denylist**. Re-confirm the SDK `canUseTool` callback contract at build (risk #5). |
| **C4** | **`getToolDetail(handle)`** — byte-faithful tool/diff fetch by distilled handle | M8 (read) | CHAT-4, CON-CAT | An M8 **read** over the daemon-held handle (D57); NOT an M6 call. Byte-faithful (D128). |
| **C5** | **`resolveRef(ref, worktree?)`** — worktree-qualified ref resolver (over the symbol/graph, not a path string) | M8 (read) | CHAT-1, CON-CAT | Wraps existing `M1.lookup`/`fuzzyMatch` + `M9.refs`. Robust to renames + multi-worktree (subagents). |
| **C6** | **Investigate-from-flag seeded session** — `createSession(role,scope,seed?)` with `seed = M3.envelope?(flag)` | M8 + M3 (existing `envelope?`) | CON-3, M3 console-seam note | Extends an existing verb + reads an existing producer hook. One attribution/cost/rewind unit (D96). |
| **C7** | **Agent-config read+write** — `listRoles`/`getRole`/`getPiece` (read) + `writePiece`/`writeRole` (write) | M8 + M5/M1 | CON-1, R-4 | **Writes funnel through M8's `.coa/` layout authority (R-4) + `M1.emit` (P7)** — never a side-door (the change-event-spine invariant). Local-only (honors the MU-13/14 deferral). |
| **C8** | **Conversation compaction** — `compactConversation(…)` + the `compaction` seam-marker Push + `{kept,dropped}` honesty list | M8 + M1/R-7 | CHAT-6, R-7.b | The seam marker is a **correctness fix** (keeps `reloadConversation` honest). **P1-reconciled** (model summary off the render path; raw store retained as floor). Governed-egress secret-bounded (S-4, D135). |
| **C9** | **Enumerate the full M8 JSON-RPC catalogue** — promote the inspector reads (`getContext`/`flagsForUser`/`graphView`/`health`/`capState`/`ledgerView`/`activeConstraints`/`why`/`getSpec`/`getDecision`/`listTimeline`/`rewind`) to named RPC verbs | M8 | CON-CAT | Mostly **(b)** — the core methods already exist; this is the enumeration that closes the "named-but-empty catalogue" gap. |
| **C10** | **Session control + status** — `interruptSession`/`steerSession` + the `status` Push + `searchConversations` | M8 | CHAT-10, CON-PUSH | `interruptSession` is **cooperative** (atomic at the M6 Mutate boundary — never corrupts an in-flight edit). `status` answers "what is it waiting on?". |
| **C11** | **Authoritative reconciliation frame** — the `reconcile` `TurnFrame` mapping the reconciler/WAL change-event into the turn stream | M8 (maps M1 events) | CHAT-9 | Computes nothing new — renders M1's existing authoritative record (D81/D97) so the agent's *claim* is checked against ground truth. coa's governance thesis, made visible. |
| **C12** | **View-scoped live deltas** — `subscribeView`/`unsubscribeView` + the `graph`/`health` delta Push (emitted ONLY to a client with that view open) | M8 | VIZ-9, CON-PUSH | **Best-effort** (a dropped delta repaints on next pull). Live-while-open, silent-when-closed — NOT the deferred ambient push-dashboard. The Ruling-12 reshape made concrete. |

**Cross-cutting guard (binds C1–C12):** none of these adds a **block** (SC-1 — the only blocks remain M3's Type-1 gate +
M7's cost-cap); none writes outside the **single append path** `M1.emit` (the change-event spine); all inherit the
**D124/D140** Zod-validate-before-touch + peer-cred contract; reliable structured Pushes are sequenced/reconcilable
(CON-PUSH) while best-effort ones (`tokens`, view deltas) never back-pressure the loop; and every rendered diff/metric
is **byte-faithful** (D128). The **degrade-to-floor** holds throughout (D85): with the structured layer off, the console
still renders the raw `tokens` stream + on-demand pulls — never worse than the bare loop / `coa raw`.

---

## 1. Deferred to v2/v3 (cut from v1 with eyes open)

Each was deferred because its cost is not yet justified for an attended, single-user, local, Claude-primary v1. The
"what would promote it" is the concrete force that re-opens it.

| Deferred | Why deferred | What promotes it |
|---|---|---|
| **Public, semver'd SPI + conformance kit** (D110) | no second backend consumer exists; the vendor ships the hosted-governed-agent shape. The *internal* D109 capability port is KEPT (so you can swap backends yourself). | a real second backend consumer arrives |
| **CQRS + upcaster + in-memory hot-graph** atop the WAL | no consumer needs more than the WAL + `git diff`. (The WAL itself is KEPT — it's the memory/time-travel substrate.) | a multi-writer / autonomous / durability-gap-git-can't-cover force — **the worked multi-user design + 2026 feasibility verdict is in §1.1 below** |
| **Hand-curated semantic watches/covers graph + propagation engine** | AGAINST-MODEL + hand-maintenance tax; the cheap structural index + on-demand confirm gets most of the value at ~0 cost. | the cheap signal demonstrably under-warns AND a richer graph clears a measured A/B |
| **Salience-prediction engine** (learned Tier-B classifier) | the model is already good at attention; a predictor races a native channel. The deterministic Tier-0 reminder is KEPT. | the D143 A/B (already built, off) shows Tier-B nets positive on tokens-per-resolved-flag |
| **OTel-shaped signal-bus + automated control loops** | orphaned machinery; the precision dashboards ride the kept minimal ledger, not a bus. | a real second consumer of the event stream appears |
| **Always-on Electron push-dashboard** | net-negative as alert-noise. The pull/inspector GUI + `coa raw` are KEPT; push-alerting is opt-in/silent (cap-hit + high-severity only). | a measured need for ambient awareness the silent channel can't serve |
| **Heavy two-key TCB ceremony** | over-built for attended v1; downgraded to a **visibility floor** (subtractive governance changes are surfaced/reviewed) + **sandboxing**. | coa goes **unattended/autonomous** — then the blocking gate re-arms (its only value over surfaced-to-an-attending-human is the no-human-present case) |
| **Smart/auto constraint-mining (D63 meta-review producer)** — a producer that mines the signal bus, per-rule flag precision, friction artifacts, and eval deltas to **propose** new constraints / rubric Behaviours / edge-prunes (agents propose, a human always gates) | v1 authoring is the preconfigured authoring-agent + validation pipeline; mining is a later convenience. | usage data shows mining would beat hand/agent authoring on a measured basis |
| **GraphRAG-style retrieval** (LLM-built entity graph + community summaries) | non-deterministic (breaks the byte-stable/diffable claim), summary-injection-heavy, heavyweight; coa already has a *true* code graph for free. | a need for whole-repo **global sensemaking** ("themes across the codebase") — and even then, built over coa's *sound* graph, not an LLM-inferred one |
| **Prepended prose dossier / generated-doc dump as standing context** | the evidence shows extra weakly-relevant text *lowers* agent success. | never as a prepend; only ever as an on-demand retrieval index |
| **D74 rigor-preset dial** — named presets (prototype / tool / product) that expand into overridable governance axes (active constraint-sets, verification strictness, autonomy leash, approval-gate size) | a good idea, not integral, cheaply added later. The dial's **floor** — a literal raw pass-through — ships in v1 as `coa raw` (M10); only the preset tiers above the floor are deferred. | demand for one-switch rigor profiles once v1's individual dials are in use |
| **CL-7 shared contradiction engine** — ONE "contradiction-against-project-truth" engine (semantic half of rationale-grounding G-7 + premise/spec-gaming checks), so those checks share one engine, not three features | judgment-layer semantic contradiction-detection is heavyweight and AGAINST-MODEL; v1 ships only the **deterministic structural-deletion floor** (ground on deletion of a decision-bound symbol) where capture exists. | rationale capture ships AND a deterministic symbol→decision binding exists to anchor the semantic layer |
| **P9 egress-chokepoint invariant** — a twin to P7 making *all network egress* flow through one audited module (M9), so "local-only" is a *checkable boundary* rather than the absence of a sync feature | over-built for an attended, single-user, local v1, where "local-only by the absence of any sync/export feature" (D135) is sufficient; the daemon's only egress is the rented model loop + the OFF-by-default D117 secondary path, both already governed. (This is the stress-test's S-7, accepted as a v1 residual — the *other* privacy controls around the ledger are kept.) | **any** of: ledger/`~/.coa` sync, an exporter, a remote-daemon mode, or the v2 autonomous transition ships — at which point local-only-by-absence is no longer a sufficient guarantee |
| **SCO-6 architectural boundary producer** — a Type-2 advisory producer that flags when code in scope A imports scope B against a declared `mayDependOn` allow-list (the Nx `depConstraints` / Python import-linter / Java ArchUnit analog), built over coa's graph + scope tags | v1 makes good modularization *pay* through tighter staleness + delivery (the SCO-6 carrot) without standing up an enforcement surface; the producer is reach, not floor, and adds an authoring/triage burden before scopes are proven. It WARNS, never blocks, and is never a permission control (coa does not cage the agent in-repo). | scope usage matures AND measured boundary-violation volume shows the advisory flag nets positive on a real repo |
| **Build-config-aware scope resolution** — resolving scope membership/edges that exist ONLY in build config, invisible to any filesystem or import-graph query (React's `ReactFiberConfig` build-aliases → host forks; k8s `go.work` + `go.mod replace`; Module-Federation `exposes`/`remotes`) | the floor (glob/tag/import-graph) covers the large majority of real boundaries; parsing per-ecosystem build config is high-cost, per-stack, and churny. v1 names these boundaries with explicit `tag` membership instead. | a target ecosystem's real boundaries live predominantly in build config AND explicit tagging proves too costly to maintain by hand |
| **Description-tier (model-requested) scope delivery** — keep only an attached Piece's one-line description resident and load its body when the model judges it relevant (the Claude-Skills progressive-disclosure tier), layered above SCO-4's deterministic read/edit-triggered tier | v1 ships the deterministic read/edit trigger + always-on + manual tiers (SCO-4); a model-judgment tier races a deterministic channel and is the most token-frugal *optimization*, not a soundness need. | SCO-4 delivery-precision data shows the description-tier nets positive on tokens-per-used-Piece |
| **Lifetime / TTL — a fourth content axis** (TAX-9) — a turn-count / wall-clock expiry on a Piece's delivery (content that auto-evicts after N turns) | the old Protocol resident-vs-ephemeral distinction is **already covered** by the `delivery` axis (push = resident, pull = ephemeral-on-demand), so no fourth axis is needed for v1's cases; a true TTL is reach, and a per-turn-expiring Piece is in tension with D105 cache-stability (its eviction must stay in the append region, never the prefix). | a measured need for content that must auto-expire mid-session (e.g. a one-shot migration playbook) that the pull/push axes cannot express |
| **Description-tier (model-requested) PULL refinement beyond the floor** (TAX-1) — the base `delivery=pull` already IS the vanilla-skill description-gated floor (description resident, body on model judgment); a *richer* model-judgment tier layered on **scope-push** delivery is the separately-tracked SCO-4 deferral above | the pull floor ships in v1 (it is the empty-config behavior); only the model-judgment tier over **scope-push** races a deterministic channel and is deferred (see the SCO-4 "Description-tier… scope delivery" row above) | same promoter as the SCO-4 description-tier row |
| **Auto-suggested scope boundaries** — propose candidate scopes from graph clustering (community detection over `depends-on`) + directory structure + ownership, for a human to ratify | the DDD lesson is load-bearing: a scope encodes meaning/ownership a graph cannot fully infer, so boundaries stay a human declaration; v1 makes *declaring* scopes cheap and rewarding (SCO-5 dry-run, SCO-6 carrot) rather than auto-drawing them. (ASM-BS-5 "auto-propose a scope's manifest" is the related membership-suggestion seam.) | the ledger shows hand-declared scopes are a sustained bottleneck AND clustering proposals clear a measured human-acceptance bar |
| **Full Code Property Graph (CPG) depth** (GRF-8/HLT-9) — AST+CFG+PDG merged for data-flow / taint / semantic-health analysis (the Joern model) | overkill for nav/coupling/health v1 (statement-level data-flow + a non-SQLite custom store, built whole-program for security analysis); coa's symbol+call graph is the right granularity for v1's goals. The seam is the symbol graph (GRF-4 `calls`). | a measured need for data-flow-grade health (taint, deep semantic spaghetti) that the structural+temporal profile cannot surface |
| **SCIP *consume* / bidirectional round-trip** (GRF-6) — ingesting external SCIP indexes or round-tripping coa's graph through SCIP | v1 only **emits** SCIP (a one-way interop export, `coa export-scip`); consuming foreign indexes adds a trust/merge surface no v1 consumer needs. | a second tool in the user's flow produces SCIP coa would benefit from consuming (e.g. a precise indexer for a language coa only floors) |
| **Convention extractors for un-stressed ecosystems** (GRF-3/GRF-8) — per-stack extractors beyond the v1 starter set (TS/JS DI+registry+codegen, Go codegen + `go.work`/`replace`) | additive and per-stack; v1 ships the extractors for the stress-tested ecosystems and **degrades to the tree-sitter floor** everywhere else (D85), so a missing extractor is never a broken graph, just a less-complete one (reported honestly via `graph.coverage`). | a target ecosystem's real architecture lives in an un-covered convention (measured low coverage on a real repo) |
| **Learned / ML health model** (HLT-9) — a trained model scoring health or predicting defect-proneness | non-deterministic (races P1 — coa's metrics are deterministic by construction), and the validity literature does not support a learned composite over the deterministic profile for v1. | strong measured evidence a learned signal beats the deterministic profile on the user's own ledger AND a determinism-preserving way to ship it (e.g. offline-trained, frozen, inspectable) |
| **Hierarchical edge bundling** (VIZ-7) — bundling cross-module edges along the hierarchy to reduce clutter | cosmetic; the DSM does the dense-coupling job unambiguously, and bundling destroys exact-edge readability (the one thing coa's cycle/coupling views need). | a measured need for an all-cross-module-edges overview the DSM cannot serve |
| **Web / remote inspector** (VIZ-7) — the graph/health views outside the desktop Electron app | v1 is desktop-only (D114) and local-first; a web inspector is a transport/auth surface (and a secret-leak surface) the attended single-user v1 does not need. | a remote-daemon / multi-user mode ships (re-arms the D140 socket-auth + D135 sync tripwires) |
| ~~Depth >1 subagent nesting~~ **SHIPPED — no longer deferred** (CHAT-2, M8 D150) — orchestrating and rendering subagents that spawn their own subagents | Superseded: D122's depth-1 bound was dropped in favor of the daemon-global cost cap as the sole fan-out bound (`docs/adr/0032`); the CHAT-2 render model's "depth-general" design is exercised, not just designed — proven against a grandchild fixture. | — (row kept only so a reader of this table's history does not mistake the strikethrough for a deletion; the live gap is discovery — see below — and the cost roll-up's RPC producer, ROADMAP.md). |
| **Voice / image chat input** (CHAT-11) — non-text input to the conversation | v1 is a text chat client; voice/image are reach, not soundness. | a measured need (e.g. design-image-to-code flows) on coa's own ledger. |
| **Model-judged (Tier-B) turn denoise + reconcile-divergence salience** (CHAT-5/CHAT-9) — a learned/cheap-model judge of *which* turns to collapse and *which* claim-vs-truth divergences to surface | v1 ships **deterministic** focus/collapse (CHAT-5) and **deterministic** divergence flagging (CHAT-9); a model judge races a deterministic channel (the D107/D143 lesson). | the D143-style A/B (built, off) shows the judge nets positive on tokens-per-resolved-confusion. |
| **Always-on / global live viz dashboard** (VIZ-10) — an ambient, all-views-live dashboard | this **is** the deferred push-dashboard (below) — VIZ-9 ships only the *view-scoped* live channel (live-while-open, silent-when-closed), which is not ambient alerting. | same promoter as the push-dashboard row (a measured need for ambient awareness the silent channel can't serve). |
| **Cross-session cost-analytics dashboard** (CON-5/CON-6) — historical spend analytics beyond the live cost surface + the D135 ledger projection | v1 ships the live model-usage/cost UI part (CON-5) + the kept minimal ledger; richer analytics is reach. | the ledger accrues enough signal that historical cost analysis changes behavior on coa's own ledger. |
| **Shared/team agent config in the GUI** (CON-1) — the console editing *publishable* shared Roles/Pieces | CON-1 is **local-only**; shared/team layered config is the deferred **MU-13/14** (OPEN.md §1.1). | the multi-user/multi-writer force in the §1.1 row promotes (then the layered-config UI rides MU-13/14). |

**The v2/v3 bets (HARD-FIT, explicitly deferred — build the dormant local write-path in v1 where noted):**
rationale-grounding's *semantic* half (the contradiction engine; the structural-deletion floor is near-v1);
**cross-repo brain** (the platform-proof moat — one developer, many repos, one private index); the **standing
adversarial / red-team verifier** (the only thing that buys down the GAP-A residual; gates v2 autonomy); **behavior-
baseline anomaly detection** (log now, detect with autonomy); **self-tuning context profiles** (after the ledger
accrues signal); **stub-grounding external symbols** + **headless LSP for user projects** + **per-language doc
generators** (bounded high-fidelity, on demand); **offline/air-gapped mode** (a HIGH-value recommend-now the moment a
non-Claude backend ships behind the M9 port). The **autonomy stack** (D91 escape-gate policy + D92 relaxation + D93
two-tier cap + per-session process isolation) is the v2 prerequisite set; all are tripwire-armed and un-tripped by
v1's attended/single-user/local construction.

### 1.1 Multi-user / multi-writer — the worked design (deferred)

**Status:** the worked design for the multi-writer force named in the §1 table (the CQRS/multi-writer row). Nothing
here is a v1 build target; it is recorded so the promotion is ready and the trade-offs are named, not discovered
late. **Verdict: seamless-with-named-tradeoffs** — the whole data / history / metrics / grounding substrate and
layered agent config are seamless; exactly **two** cross-user limits remain, both with clean degradations coa already
uses. Literal "zero boundaries" is unreachable (FLP impossibility + append-only immutability are physics), but coa
lands closer than any shipped local-first system surveyed (2026).

**The reframe + the honest correction.** coa is already most of the CRDT *preconditions* by construction:
append-only op-log (D94), content-addressed events (`pre_hash`/`post_hash`), determinism (P1), per-log `seq` +
per-consumer cursors (a version vector waiting to be named), a hidden-ref DAG timeline (D98). **MU-C1 (the central
obligation):** P1 only guarantees a deterministic *fold*, NOT *convergence* — each projection's merge must
additionally be **proven a join-semilattice** (commutative, associative, idempotent), or redesigned until it is. That
is new work P1 does not discharge. (Triage: metric G/PN-Counters and node-sets are trivial; edges use MU-8;
staleness is LWW-by-causal-order; `rename` stays a first-class op.)

**MU-0 — the visibility axis ("it was never *merge everything*").** Every artifact carries one scope:

| Scope | Holds | Sync |
|---|---|---|
| `local-only` | the **budget seam** (default: run to the subscription limit, MU-W1); sessions + live conversation (`.coa/local/conversation/`); personal config & agents/Pieces/Roles; secrets; runtime projections (hot graph, prompt cache, SQLite — rebuildable); personal suppressions/preferences; the checkpoint/undo timeline; uncommitted worktree state | never published |
| `shared-always` | the **structural WAL** (`modify/create/delete/rename/confirm`, `assert-edge`/`retract-edge`, `declare-symbols`) — repo-relative paths, content hashes, symbol names (already shared via git). The graph + symbol/scope index + metric projections derive from these. | all team feeds |
| `shared-opt-in` | **governance** frames (decision-log, vouch, flag-feedback) — the team audit record | off by default per repo; behind emit-time secret-scan (MU-10) + access control (MU-5) |

**Architecture (MU-1 … MU-12).**
- **MU-1 — Per-user signed feeds.** Each writer owns one append-only Ed25519-signed feed; "the WAL" = the
  deterministic merge of all known feeds (preserves GRF-5 literally — the merged set IS the only temporal substrate).
  Single-user collapses to a one-feed WAL byte-identical to today (D85 holds). Model: SSB feeds /
  Hypercore-Autobase / Merkle-CRDTs.
- **MU-2 — Feed identity = the signing key, not the git userId.** Ref `refs/coa/wal/<feedKeyHash>`; signing
  mandatory even in the no-E2EE tier (integrity, not confidentiality).
- **MU-3 — One feed per writer (not a structural/governance split).** Governance-prose confidentiality is a
  transport/encryption concern; keep the single causal spine + per-feed `seq` as true actor order.
- **MU-4 — Sub-feed per `(human-key, device/worktree)`.** "A human's WAL" = the merge of their own sub-feeds
  (handles laptop + CI + second checkout).
- **MU-5 — Transport = git refs; access control inherited from the host.** Fast-forward-only, single-writer-per-ref
  → no collisions; the ref is an untrusted hint, the real feed is the signed hash-chain. Trusted-host tier: can
  clone ⇒ read; can push ⇒ publish. No new crypto for teams that already trust their host. (Prior art: git-bug,
  git-appraise.)
- **MU-6 — Split clock; order is PROVISIONAL.** Version vector `{feedId→seq}` for causal/concurrency + safety
  (convergence never depends on wall-clock); HLC `(pt,counter,feedId)` as the display/fairness tiebreak only. Keep
  projections recompute-safe; never pin a cross-feed `seq` as final.
- **MU-7 — Reconciler attributes to the git author + SHA, not the observer** (every daemon reconciles the same
  shared repo).
- **MU-8 — Edge conflict policy:** add-wins (OR-Set) for `inferred`; LWW-by-HLC for `declared`/`gated`. The log keeps
  all claims; projections surface disagreement. (D50's emit-time cycle REJECT softens to a surfaced GRF-1 finding for
  the concurrent case — an accepted, named softening.)
- **MU-9 — Snapshot-isolation:** the close-gate, M5's compiled config, and prompt-cache all evaluate against the
  session-start synced frontier (deterministic, offline-safe).
- **MU-10 — Emit-time secret scanning** at the M1/M3/M4 chokepoint (before append, not a pre-publish git hook);
  governance feeds not-published-by-default (a published signed frame is unrevocable — prevention is the only
  control).
- **MU-11 — Schema evolution = canonical-fold + additive-only.** All peers normalize TO one pinned fold-schema before
  merging; additive lenses only (no destructive cardinality change); every frame carries a version-independent core
  envelope so an older peer can still order/relay an unknown-body frame.
- **MU-12 — Content-hash dedup is a local optimization, not a convergence property** — never discards
  per-`(feedId,seq)` provenance; the lattice element is the *set* of observations.

**Layered agent config (MU-13, MU-14).**
- **MU-13 — Shared + local layers.** Team publishes a versioned bundle of Roles/Pieces; individuals layer local
  personal Pieces/Roles; M5 compiles `effective = overlay(shared_frontier, local)`. Personal agents never publish →
  zero cross-user conflict. Rides `Piece` / `BundleManifest` / `bundle:name@version` / M5's P3 compose.
- **MU-14 — Precedence (SC-1 extended):** shared *constraints* are authoritative (cannot be locally weakened); shared
  *Pieces/Roles* are overridable defaults; a local layer may ADD capability, never REMOVE a team constraint. The team
  keeps the cage; everyone brings their own help.

**The walls + degradations (MU-W1 … MU-W3).**
- **MU-W1 — Budget: a local-only seam, default pass-through** (see SPEC M7 D35/D93-simple). No shared/team budget; a
  shared ceiling would need escrow / bounded-counter CRDTs (feasible — claim 3 — but with under-utilization) for no
  benefit. Multi-user impact: none.
- **MU-W2 — Cross-user blocking (close-gate): FRESHNESS-RELATIVE (decision).** The close-gate evaluates shared flags
  as of the session-start synced frontier (MU-9): you ARE blocked by a teammate's Type-1 flag once you've pulled it,
  never by un-synced state. Why not absolute: an absolute gate = total-order/consensus, impossible offline+serverless
  (FLP — claim 2). Clean, deterministic, offline-safe.
- **MU-W3 — Destructive undo of shared history: IRREDUCIBLE → forward compensation.** Can't rewrite a teammate's
  signed frames; rewind is total BELOW the shared frontier, forward-compensate (Saga) ABOVE it. Generalizes
  D97/D98's "never auto-undo an outward action."

**Open problems + mitigations.** Schema-evolution × CRDT unsolved (claim 1) → MU-11; no coordinator-free stable order
(claim 2) → MU-6; group E2EE research-stage (claim 4) → MU-5 host-inherited auth, defer E2EE; feed discovery →
version vector relative-to-known-set, degrade gracefully; cross-feed causal delivery → frames carry transitive
causal-dep hashes; Byzantine/equivocation → out of scope under a trusted host (E2EE/UCAN tier only).

**Feasibility evidence (web-verified, 2024–2026).** (1) schema-evolution × CRDT convergence = **open**
(Cambria/Automerge). (2) no coordinator-free stable global order = **holds** (FLP 1985; Chandra-Toueg 1996; Autobase
stabilizes only via a majority-indexer quorum). (3) hard global budget = **weakened** (escrow/O'Neil 1986; Bounded
Counter/Balegas 2015; AntidoteDB) — but moot under MU-W1. (4) local-first group E2EE = **research-stage**
(Keyhive/Beelay/BeeKEM pre-alpha; MLS RFC 9420 needs a coordinator; DCGKA CCS 2021). (5) shipped systems all
compromise (**holds**): ElectricSQL dropped bidirectional sync (2024); Figma server-LWW; Linear/Jazz/Zero need
servers; **Ditto** alone is serverless-offline CRDT — and enforces no hard global invariant, confirming the walls
live at global invariants, not data.

**Phased plan (when promoted).** (1) future-proof at ~zero cost even single-user — promote `ts` to HLC, add feed/key
id to the frame, generalize the cursor to a version vector (behavior unchanged); (2) prove the semilattices (MU-C1);
(3) ship same-user multi-machine first (one trusted owner, all devices); (4) promote **P9 egress-chokepoint** (§1
table) before any sync — D135 local-only-by-absence ends when feeds publish; (5) team multi-user — governance opt-in
(MU-10), host-inherited access control (MU-5), layered config (MU-13/14); (6) deferred frontier — untrusted/multi-org
E2EE once it matures.

**References.** CRDTs (Shapiro et al. SSS 2011; δ-state Almeida et al. 2018); local-first (Kleppmann et al., Ink &
Switch 2019); clocks (Lamport 1978; Fidge/Mattern 1988; HLC Kulkarni et al. 2014); multi-feed logs (SSB;
Hypercore/Autobase; Merkle-CRDTs Sanjuán et al. 2020); schema (Cambria, Ink & Switch 2020 / PaPoC 2021);
order/consensus (FLP 1985; Chandra-Toueg 1996); numeric invariants (O'Neil escrow 1986; Bounded Counter Balegas et
al. SRDS 2015; CALM Hellerstein & Alvaro 2019); group security (MLS RFC 9420; DCGKA Weidner et al. CCS 2021;
Keyhive/Beelay/BeeKEM, Ink & Switch 2024–2026); transport (git-bug, git-appraise); shipped systems (ElectricSQL
electric-next 2024; Figma multiplayer; Linear sync engine 2024; Rocicorp Zero; Jazz; Ditto).

---

## 2. Tuning knobs (Tier-2 — the numbers the v0 spike calibrates)

The *mechanisms* are fixed and sound; these *starting values* are empirical and self-tune from the minimal ledger.
None gates soundness; all are set conservatively and moved on measured evidence.

- **Confidence-tier cut-points** (the severity × confidence projection): where crit/high/med/low and high/low-confidence
  fall. Default conservative (a flag must clear a high bar to reach crit/high; err toward collapsing to med/low for
  the user and withholding from the agent's budget). Self-tunes on measured per-tier precision.
- **The context-package token cap** (the assembler's hard ceiling): repo- and model-dependent; default leans **low**
  (the evidence says cutting context while improving success is achievable). Binary-searched to budget, net of the
  always-loaded kernel.
- **The F4 staleness confidence threshold** (when a guess is confident enough to surface): conservative default;
  self-tunes on measured staleness precision.
- **The Tier-B A/B promotion threshold** (D143): the net-positive bar (Tier-A+B must beat Tier-A on
  tokens-per-resolved-flag *after* the classifier's own token cost) — and promotion is double-gated on the A/B **plus**
  a human-approved proposal, never in-session.
- **The constraint promotion/demotion threshold** (D139): the false-positive rate (net of wrong-scope dismissals) above
  which a noisy deterministic constraint is proposed for promotion to a judgment Behaviour / auto-demoted.
- **The flag-validator grouping aggressiveness** (CF-5): group-by-shared-context vs. group-harder; the cost/correctness
  trade the user confirms per run.
- **The scope-delivery token cap** (SCO-4): the per-scope hard ceiling on auto-attached doc bytes injected on
  scope-entry; default leans **low** (same evidence as the context-package cap — cut context while improving success).
  Self-tunes on measured per-scope delivery precision.
- **The scope-activation trigger set** (SCO-4): which working-set events fire delivery — read / edit / explicit
  mention. Default = read + edit + mention (the field-converged dependable set; explicitly **not** editor-open).
  Narrowable if delivery proves noisy.
- **The salience cadence threshold** (TAX-1 `salience: <cadence>`): the "tokens since last reminder" interval at
  which a `salience>never` push Piece is re-asserted (the Tier-0 cadence). Default conservative (re-assert sparingly —
  a reminder races the model's own attention, D107); self-tunes off measured tokens-per-resolved-flag, the same
  metric the deferred Tier-B A/B (D143) would use. Never gates soundness (the M3 gate, not the reminder, enforces a
  linked rule).
- **The graph-leaf closure depth** (SCO-1/SCO-2): how far a `dependsOn` leaf walks the `depends-on` graph when
  resolving membership and the D54 staleness cone (direct-only vs. confirmed-transitive). Default = direct +
  D54 confirmation-gated; deepened only on measured under-coverage.
- **The health advisory thresholds** (HLT-1/HLT-3): the per-metric cut-points at which a metric becomes a surfaced
  advisory (SCC tangle size, propagation cost, CBO/RFC, cognitive complexity, the hotspot percentile). Default
  **conservative** (surface sparingly — health races the user's own judgment, and a noisy advisory becomes a nag);
  self-tunes off the HLT-8 behavior-change signal (did surfacing it change anything). **The mechanism is fixed (the
  non-compensatory profile, HLT-2); only the cut-points are knobs, and NONE gates soundness — health never blocks.**
- **The hotspot / temporal WAL window** (GRF-5/HLT-5): the window over which `churn`/`change-coupling` is computed
  (e.g. trailing N edits / days). Default conservative and repo-dependent; a wider window smooths, a narrower one
  reacts. Self-tunes off measured hotspot stability.
- **The edge-provenance coupling weight** (GRF-3/HLT-6): how much a `convention`- or `inferred`-provenance edge is
  down-weighted vs a `declared` one when feeding coupling metrics (so a guessed edge cannot inflate a CBO score into a
  false finding). Default conservative (down-weight low-provenance edges; label the metric `confidence:'low'`).
- **The node-link node cap** (VIZ-5): the node count above which a node-link view switches to a matrix/aggregated
  idiom. Default **≈50** (the Ghoniem ~20-vertex crossover plus headroom for path-following); tunable per the user's
  screen/preference. Never a soundness gate — it only chooses an idiom.
- **The notification-batching window** (D128/CHAT-5): the interval over which the two silent push-alerts (cap-hit,
  high-severity) coalesce so they never storm. Default conservative; widen if alerts cluster. Never a soundness gate.
- **The turn-stream repaint throttle** (CHAT-5/CON-PUSH): the cadence at which the structured `turn`/`tokens` stream is
  flushed to the renderer (the Aider `MarkdownStream` sliding-window prior art). Default a small dynamic delay; purely a
  render-smoothness knob — the daemon never blocks on it (SC-1).
- **The auto-compaction trigger threshold** (CHAT-6/R-7.b): the % of the context window at which compaction is offered/
  fires. Default **conservative** but **not premature** — the field's documented failure is firing at 10–35% and
  destroying the working plan; calibrate against real session lengths. Manual `compactConversation` always available;
  raw store retained regardless (floor).
- **The reconcile-divergence surfacing threshold** (CHAT-9): how large/confident an agent-claim-vs-ground-truth
  divergence must be before it is surfaced. Default surface **all** deterministic divergences in v1 (the trust win is
  large, the cost low); narrow only if it proves noisy. Never gates soundness (it renders M1's record either way).
- **The view-delta coalescing window** (VIZ-9/CON-PUSH): how often an open graph/health view's live deltas are
  batched before repaint. Default conservative; best-effort (a dropped delta repaints on next pull). Never a soundness
  gate — it only affects liveliness.
- **The permission-grant scope default** (CHAT-3): the default `scope` offered on `respondApproval`
  (`once` vs `session` vs `tool-pattern`). Default **`once`** (the safe, habituation-resistant default); the human
  widens deliberately. Tunable per the user's risk posture; never a coa-authored block (the SDK applies the grant).

---

## 3. Open risks (named honestly)

1. **The [LOOP] value of the context engine is asserted, not loop-measured.** The selection/grounding evidence is
   mostly single-shot; whether a pre-built package + in-flight grounding saves a capable tool-using agent enough
   turns/tokens to matter is the central bet → the v0 spike. *If marginal:* keep M4 thin; justify on
   soundness/inspectability/discipline (which the spike does not threaten).
2. **The position effect for a tool-using agent is unmeasured.** Edges-first ordering rests on a general-LLM result,
   not a code-agent measurement. Cheap and plausibly right; calibrate in the spike.
3. **Capture-quality is unproven.** Whether agent-harvested rationale and prose-distilled intent are good enough to be
   durable memory is asserted; the spike measures whether captured intent + pre-flight context changes turns-to-done.
4. **The prose-bearing memory secret surface (binding).** Rationale, decision-log
   entries, flag messages, and `/vouch` notes are free text that can carry secrets. They must stay **WAL-local /
   local-only**, **never** enter the sync-eligible ledger (which is allow-listed to numeric counts + anonymized IDs),
   and **never** sync until keychain/encryption clears the secrets tripwire. Bind this before shipping any
   ledger-sync or `~/.coa` sync feature (both are tripwire-armed).
5. **SDK hook per-event parity.** The loop-location map relies on Claude Code hook semantics that were verified on the
   CLI hooks page; the per-event behavior at the SDK layer was asserted via the shared event type, not re-quoted per
   event. **Re-confirm against the live Agent SDK docs at build time** before relying on a specific hook's
   block/inject behavior. **Partial discharge (2026-06-25):** the *load-bearing* facts were re-verified against the
   live SDK docs and folded in — there is **no "finish" tool** (the close-gate rides the **`Stop` hook**, the
   cost-cap rides **`canUseTool`**, which fires exactly once per tool); usage is reported at the **`ResultMessage`**
   and the SDK has a native **`maxBudgetUsd`** hard stop (the cap's mid-loop enforcement); there is **no programmatic
   mid-session `role:system`** channel (reminders deliver as daemon-authored `additionalContext`/`systemPrompt`);
   file-read denial (`Read(...)`/`denyRead`) binds built-in + bash tools, **not** in-process MCP tools, and **no
   network no-connect rule** is exposed. These are now baked into SPEC.md; re-confirm once more at first build and
   treat any drift as a spec defect to surface.
6. **Confidence-tier calibration** (see §2) and **auto-patch friction** (does the agent re-edit against un-patched
   content; how often does a background patch hit the working set) are unmeasured — calibrate in the spike.
7. **Scope silent-non-attachment and rot are the dominant field failures (mitigated, not eliminated).** Every
   glob-scoped rule system in the field ships the same two bugs: a scope whose leaves match nothing (so attached docs
   never deliver, with no signal) and a scope whose globs/tags rot as code moves. coa's named scopes + graph + the
   SCO-5 observability/linter + D52 rename-following are the mitigations, but the linter's "members no longer match
   the dependency cluster the definition implies" drift heuristic is **unproven** — calibrate its precision in the
   spike before trusting it; until then it is notice-only.
8. **Authority-without-enforcement = false assurance (the TAX-2 residual).** A Piece delivered forcefully
   (`delivery=push` + `salience>never`) but with **no `governed-by` link** is a forcefully-worded rule with no
   backing check — the named industry failure mode (*false assurance / policy theater / aspirational decision*). coa
   mitigates by **labeling** such Pieces "advisory (no backing check)" at compile (TAX-4) and by P5 (anything that
   matters is also backed by the M3 gate), but the residual risk is a user *reading* an eagerly-delivered prose rule
   as a guarantee. The mitigation is honest labeling, not elimination; the deterministic alternative (forbid
   unlinked push) was rejected as over-caging (SC-1 — coa must let a human state an unchecked preference).
9. **Mis-declared provenance poisons grounding (the TAX-1 residual).** The `provenance` axis is **author-declared**;
   a `derived-from-code` artifact mislabeled `authored` would let GROUNDING ground against code-derived content
   (the GEN-7 circularity — current behavior cemented as the contract). coa's structural guards (TAX-4 forbids a
   `derived-from-code` Piece without a `generated-from` edge, and the GEN-2 generator registry stamps `generated:true`
   deterministically) catch the *generated* case, but a hand-authored file that is *secretly* a copy of generated
   output cannot be detected deterministically — it degrades to the same trust as any mislabeled hand-authored doc.
   Calibrate whether the structural guards catch the real cases in the v0 spike; until then, treat an `authored`
   label on a file under a known generator's `target` path as a surfaced anomaly (a GEN-1-style auto-proposal).
10. **Shared-foundation blast radius is irreducible.** A schema SSOT or a design-system component is depended on by
   nearly everything, so a change to it genuinely stales many scopes — scope does **not** (and must not pretend to)
   shrink that cone; SCO-5 reports it honestly (multi-scope membership + the true cone) rather than masking it. The
   residual risk is a user reading honest wide staleness as a coa defect; the precision dashboard must frame a wide
   cone as a property of the *code*, not a coa false-positive.

11. **Metric validity is the central HLT-\* risk (the numerology trap).** Many software metrics *look* rigorous but
   predict little — cyclomatic complexity correlates ~0.9 with LOC above method level, the Maintainability Index rests
   on magic 1980s constants, DIT/NOC/LCOM and Newman-modularity-as-a-score have weak or no defect validation, and
   every shipped vendor composite uses arbitrary/undisclosed weights. **Mitigations (HLT-2/3/4):** ship a
   **non-compensatory profile, never a single weighted score**; an explicit **numerology deny-list** (HLT-4); always
   show **size as the confound**; and **measure behavior-change on coa's own ledger** (HLT-8) rather than trusting
   external studies. **Residual:** even the shipped signals' validity rests partly on external evidence, and the
   strongest temporal result (Tornhill & Borg "Code Red") is **vendor-authored and observational** — so the
   *magnitude* of coa's health value is a v0-spike measurement, not an assumption. If health proves uncorrelated with
   anything actionable on a real repo, keep L-HLT thin (cycles + hotspots + size only) and justify it on
   inspectability, not prediction.

12. **The hairball — a graph view that does not scale.** A raw node-link view of a real repo is unreadable past a few
   dozen–hundred nodes. **Mitigation (VIZ-\*):** idiom-per-granularity (treemap/DSM/tree/ego-graph, never one global
   node-link), the **≲50-node cap** before switching idiom, focus+context drill-down, and an explicit anti-pattern
   list (no full-repo force-directed, no 3D). **Residual:** a pathological tier (e.g. a single scope with hundreds of
   mutually-coupled modules) can still overwhelm even a DSM — surfaced honestly as a finding (that *is* the spaghetti),
   not hidden by the renderer.

13. **Health-as-nag (the SC-1 residual).** An advisory that fires too often becomes pressure — the opposite of the
   carrot-not-cage intent. **Mitigation (HLT-7/8):** health is **pull-only** in the inspector (never pushed), the
   in-flight agent channel is **gated to high-confidence only**, every finding is **dismissible** (D131), thresholds
   default **conservative**, and the structural carrot (GRF-2/SCO-6 — clean scopes pay in tighter staleness) does the
   real motivating. **Residual:** a user may still read an eagerly-shown health number as a judgment; the mitigation
   is honest framing + the HLT-8 measure (if surfacing a class of finding changes no behavior, stop surfacing it), not
   elimination. Health **never blocks** — the only blocks remain M3's gate + M7's cap.

14. **The silently-incomplete-or-wrong graph (GRF-3 residual; subsumes the old SCC-collapse risk).** coa's
   tree-sitter graph misses (and sometimes mis-draws, e.g. k8s `go.work`/`replace` resolving to the published module)
   the registry/DI/codegen/build-config edges where real architecture lives. **Mitigations (GRF-1/GRF-3):** the
   SCC-collapse-hides-cycles tension **is resolved** — GRF-1 retains every intra-cycle edge and makes collapse a
   non-destructive view, so health surfaces the specific back-edge while staleness still gets its super-node;
   `EdgeProvenance` + deterministic **convention extractors** populate and *correct* the missed/wrong edges for the
   stress-tested ecosystems; and `graph.coverage` reports edge provenance **honestly** so an incomplete graph **never
   reads as a false-green**. **Residual:** an un-covered ecosystem's architectural seams are invisible until an
   extractor ships — reported as low coverage (a known gap), not silently treated as "no coupling"; a metric over a
   low-coverage region is labeled `confidence:'low'`, never presented as precise.

15. **The graph-as-agent-edge value (GRF-7) is unmeasured.** That the graph gives the model a navigation edge over its
   own native retrieval is the navigation analog of the [LOOP] bet (#1) and is asserted, not measured. *If marginal:*
   keep M6's graph-nav tools thin and justify the graph on staleness/grounding/health (which the spike does not
   threaten). Calibrated in the v0 spike (the GRF-7 hook).

16. **Chat-as-nag vs SC-1 (the Ruling-12-reshape residual).** Reshaping M10 to chat-client-first + live-pushing
   reopens the alert-fatigue risk the original pull-only posture guarded against. **Mitigation (CHAT-\*/CON-PUSH):**
   proactive *interruptions* stay limited to the two silent signals (cap-hit, high-severity); all other live updates are
   **engagement-driven** (tied to what the human is actively viewing — `subscribeView`/`subscribeTurns`), the
   notification-batching window coalesces alerts, and the always-on push-dashboard stays deferred. **Residual:** a busy
   live surface can still feel noisy; the honest test is the same as health-as-nag (HLT-8) — if a live element changes
   no behavior, stop pushing it. Empirically grounded by the warning-habituation literature (Anderson CHI'15 / Vance
   MISQ'18; Akhawe & Felt 70.2% SSL click-through).

17. **Permission-fatigue → blanket auto-approve (the CHAT-3 residual).** The dominant real-world failure: users tire of
   prompts and enable `--dangerously-skip-permissions`/YOLO, removing the only gate. **Mitigation (CHAT-3):** coa
   **surfaces** the SDK's native permission (it builds no bypassable denylist), shows *what* is being approved (the
   `cd:*`-mis-prompt lesson), offers session/pattern `scope` grants, and **lowers verification cost** rather than adding
   explanation (the over-reliance research — Bansal CHI'21, Buçinca CHI'21, Vasconcelos CSCW'23 — shows explanation
   alone *increases* blind approval). **Residual:** habituation is empirically guaranteed; coa cannot eliminate it,
   only reduce prompt frequency (auto-allow the safe, interrupt the irreversible) and vary high-stakes prompts. The cap
   + the Type-1 gate remain the real backstops (SC-1) — they are not prompts the user can tune away.

18. **Subagent-nesting legibility at depth (the CHAT-2 residual).** Nested rendering can confuse (the documented Roo
   complaint: invisible hierarchy + cost roll-up). **Mitigation, revised:** v1 is depth-UNBOUNDED now (D122's depth-1
   bound was dropped for the cost cap — `docs/adr/0032`; M8 D150), not depth-1 as originally planned; the session
   browser shows a "Root"/"Subagent" badge and nests a matched search hit under its ancestors, and a path-to-root is
   derivable from `session.parent`/`.root`. The per-subagent tools/tokens/$/status roll-up is implemented and tested
   but **not RPC-surfaced** (see ROADMAP.md), so the console shows "Not tracked yet" rather than a number today.
   **Residual, now larger than originally scoped:** nesting with no depth ceiling means a pathological tree (many
   levels, or many siblings) can overwhelm a small pane worse than the one-level case this item was written against
   — surfaced honestly via the focus/denoise control (CHAT-5), not hidden, but no nesting-depth-specific UI
   accommodation has been built or measured yet.

19. **Renderer-isolation vs IDE-routing (the CON-4 residual).** Routing "open this diff in VS Code" out of an
   isolated renderer means the **trusted (Electron main) side** shells out. **Mitigation:** the renderer only *requests*
   a route; the trusted side **validates** the target (a resolved ref / a daemon-held diff handle) and never passes
   renderer-supplied strings verbatim to a shell. **Residual:** the trusted-side router is a small new trust surface —
   it must treat its input as untrusted (the same discipline as D140's socket boundary).

20. **The best-effort token stream drops frames — the structured layer must not (the CON-PUSH residual).** `tokens` is
   droppable (SC-1: never back-pressures the loop); a console rendering *only* `tokens` (the degraded floor) loses turn
   structure. **Mitigation:** the structured `turn` Push is **reliable + `seq` + gap-detectable**, reconciling against
   `reloadConversation` after any drop, so the high-fidelity transcript self-heals. **Residual:** a transient gap can
   briefly mis-render before reconciliation; the floor (raw tokens + on-demand pull) is always correct (D85).

21. **Compaction summary quality (the CHAT-6 / P1 residual).** The compaction summary is model-generated
   (non-deterministic) — the one model on the console story. **Mitigation:** it is **off the render/determinism-critical
   path**, the `{kept,dropped}` honesty list shows what survived, and the **raw pre-compaction store is retained** (so
   `reloadConversation` below the seam always re-materializes the truth — the floor). **Residual:** a poor summary can
   mislead until the user reloads the raw; this is a quality knob (the summary model + threshold), never a soundness
   gate — and standing rules/Pieces survive by re-injection from `.coa/`, not by the summary.

22. **The structured-turn-event producer is the largest new console backend surface (the C1 magnitude risk).** Enriching
   the wire from a flat token stream to a typed, sequenced, reconcilable turn taxonomy (+ the per-worktree turn store)
   is real producer work in M8's WAL→Push bridge and R-7. **Mitigation:** it lands in M8's phase before M10 (no M10
   refactor), reuses the existing WAL-consumer/`subscribe` machinery, and degrades to the `tokens` floor if disabled.
   **Residual:** its throughput/perf at a busy session's frame rate is unmeasured — **added to the v0 spike's measured
   list** (does structured turn-by-turn / nested-subagent / investigate-dispatch change behavior on coa's own ledger;
   see `IMPL-SPEC-BRIEF.md`).

23. **The WebFetch summarizer's spend is audited but uncapped (a named scoped deferral).** The DeepSeek summarizer
   composed at the daemon root records its cost to the M7 audit ledger (scoped `web_fetch_summarizer`) so it is
   never anonymous, but it is **not yet charged against the M7 cost-cap** — charging it needs a live per-session id
   at the daemon-wide catalogue seam, not yet threaded through. **Residual:** summarizer spend cannot trip the cap
   in this increment; promote by wiring `governance.charge` alongside `governance.record` once the per-session id is
   available.

---

## 4. Rejected outright (not merely deferred)

- **Unattended self-authoring of constraints from dismissal stats** — re-arms the GAP-A line (an agent writing the
  rules that govern it) and breaks the governance floor even after the visibility-floor downgrade (which was valid
  *because* v1 is attended). Only a future "propose-a-batch, human-ratifies" form is admissible, and only with
  autonomy + the red-team verifier in place. Fully-unattended self-authoring stays rejected.

---

*These three docs (`SPEC.md` · `IMPL-SPEC-BRIEF.md` · `OPEN.md`) are the complete, self-contained handoff. A
downstream agent should be able to build v1 coa, in the build order above, gated by the v0 spike, from these alone.*

---

_Last reviewed: 2026-07-05_

# coa de-drift refactor — master design

**Status:** design approved (2026-07-05); decomposes into per-phase plans.
**Owner of this arc:** maintainer + Claude (planning); execution split by phase (§5).
**This doc is transient.** Its one durable output — the doc-system convention — graduates to an ADR (`docs/adr/`) and this file is deleted with the rest of the `superpowers/` corpus in Phase 3.

> **Amendment (2026-07-10) — re-sequenced.** Phase 3 (the docs/comments extraction) is **now executed
> by Claude, not coa agents**, and runs **next** — right after the remaining Phase-1 graduation
> artifacts — with **no dependency on Phase-2 hardening**. Completing Phase-1-remainder + Phase 3
> **closes this arc**. The Phase-2 agent-hardening that shipped (H1/H2 interrupt + error resilience,
> steer, barge-in) is recorded in `ROADMAP.md`; the rest (role/capability enforcement, the P1/P2
> packages, P3 CC-mirroring) is **deferred to `ROADMAP.md` "Someday / ideas"** and is not part of
> closing this arc. This supersedes **D8** and the Phase-2→Phase-3 gating in §5. `ROADMAP.md` is the
> authority; this note keeps the historical design intact.

---

## 1. Problem — the drift is structural, not cosmetic

coa's docs, comments, and status have drifted to the point of actively misleading agents. Root cause is not "old files" — it is that **durable project truth lives in three homes that each fail differently**:

- **Claude-private memory** (`~/.claude/.../memory/`) — the de-facto roadmap, but invisible to the non-Claude agents (longcat, deepseek) that will do future work, and **already 2–5 days stale**: it doesn't know `adapter-longcat` exists, treats a merged branch as pending, and predates the rich-tool-card + reasoning-thinking-block workstreams.
- **The `docs/superpowers/` graveyard** — ~24k lines of shipped, write-once, never-pruned play-by-play. Yet it is also the **only** home for load-bearing architecture: the entire multi-backend design, the DC-1..DC-12 core-context/role decisions, owned web tools, multi-account auth, and the console design system.
- **The curated framework docs** — internally contradicted by the code. The authoritative `SPEC.md` still says **"Claude-locked, one backend"** while three backends ship; `UI.md` cites a to-be-deleted file as its authority.

Every finished plan strands its durable decisions in a 2,000-line file nobody re-reads; "current state" exists only in one agent's memory. That is the engine of drift.

**Proof the tax is real (found live during this session's own research):** two research agents inherited stale truth from these sources and reported *fixed* things as broken — the chat cross-talk bug (fixed, still open in `DEV-NOTES.md`) and the green pure-API turn (works, "unproven" in memory). Drift corrupted the de-drift research itself.

### Evidence highlights (from the audit; verify against code before acting)
- **~30 verbatim copies** of the "what coa is" paragraph; the build-order string in 5 places (4 contradicting their own source, which says the string is *not* authoritative); the SC-1 invariant in 6+.
- `SPEC.md` is **3,153 lines**, one flat file, 11 modules — the token/navigation bottleneck. Its M9 title still reads `(spi + adapter-claude-sdk)` vs. the real 5-package M9.
- `WORKFLOW.md`'s own doc-lifecycle rule says specs *stay* as decision records — which **contradicts** the maintainer's extract-then-delete decision. Resolved by adopting ADRs (§4) and updating that rule in the same pass.
- Junk in the tree: 8 safe-delete stray files incl. two OS-path-mangled `.txt` artifacts from a test writing to an unsanitized path; a `.gitignore` gap that *let* them accumulate; one orphan module + one unused dep.

## 2. Goals / non-goals

**Goals**
1. **Agent understanding per token** — one fact, one home; a strong router; docs small enough to be cheap to load.
2. **Anti-drift by convention + strong index** — make drift a convention violation, not an inevitability (maintainer chose convention-first over heavy automation; two cheap scripts approved).
3. **A clear, in-repo path forward** — consolidate all remaining coa work into a single agent-visible artifact.
4. **Set up the architecture phase** — capture inconsistencies/tech-debt as decisions so the next phase builds on a clean baseline.

**Non-goals (this arc)**
- No deep architecture/refactor of product code (that is the *next* phase; findings are logged, not acted on).
- No behavior/interface changes beyond the Phase-2 hardening explicitly scoped here.
- No CHANGELOG, no CI gates, no `llms.txt` (YAGNI for a solo pre-v1 repo).

## 3. Locked decisions (grill outcomes)

| # | Decision |
|---|---|
| D1 | **Extract-then-delete** the graveyard, behind a hard **graduate-before-delete** gate. |
| D2 | Roadmap/status becomes an **in-repo single source** (`ROADMAP.md`); private memory demoted to a pointer. |
| D3 | Scope = **docs + comments + junk + safe moves** (no behavior/interface change; safe = navigation-only relocations). |
| D4 | Anti-drift = **convention + strong index**, plus two runnable scripts: **router/orphan check** and **dead-link check** (not CI). Stale-footer script declined. |
| D5 | New artifacts: **`docs/adr/` (MADR, immutable)** + **`ROADMAP.md`**. No CHANGELOG. |
| D6 | **Full per-module SPEC split**: `docs/design/handoff/spec/M0..M10.md` + a ~200-line `SPEC.md` index. |
| D7 | Design docs are **in scope to restructure freely** as long as no product decision is lost. |
| D8 | **Executor:** coa agents (longcat/deepseek) execute the doc refactor (Phase 3), gated behind Claude-run hardening (Phase 2). Claude authors all high-judgment content. |
| D9 | **Judgment model = transcribe:** Claude pre-decides every durable extraction in a reviewed **manifest**; agents execute file ops against it, they do not decide what is durable. |
| D10 | **Product-truth safety net = plan fidelity.** The manifest's completeness (cross-checked against the audit's durable-decisions list, §Appendix A) is the gate; agents cannot catch what it omits. |

## 4. Target doc-system shape (the "after")

Through-line: **durable *why* → immutable ADRs · current *what* → ROADMAP · everything indexed from the `AGENTS.md` router · plans deleted after extraction.**

```
/AGENTS.md              router/index (role unchanged; stays <200 lines)
/CLAUDE.md              @AGENTS.md alias + Claude-specific notes (unchanged)
/README.md              status corrected (drop "Pre-build")
/ROADMAP.md             ← consolidated path forward; replaces private memory as authority
/docs/
  adr/                  ← NEW: NNNN-title.md (MADR + Y-statements), immutable, README index
    README.md           ← ADR index + the ADR process (status lifecycle, immutability rule)
  design/handoff/
    SPEC.md             ← reduced to ~200-line index: module map + dependency graph + §B invariants
    spec/M0..M10.md     ← NEW: one file per module; tri-backend truth lands in M8/M9
    IMPL-SPEC-BRIEF.md  (silent-on-pivot note fixed)
    OPEN.md             (§0 "built" items retired/reconciled)
  ENGINEERING.md CODE_STYLE.md WORKFLOW.md UI.md DESIGN.md REPO_LAYOUT.md
                        (deduped to cross-links; WORKFLOW doc-lifecycle rule updated for ADRs)
  archive/              ← optional short-lived holding pen; empties as graveyard is deleted
/packages/*/README.md   ← NEW, thin: "this is Mx; public interface; see design/handoff/spec/Mx.md"
/scripts/docs-check.*   ← router/orphan + dead-link (pnpm tasks)
```

**Conventions adopted (mostly already present — codify + enforce):**
- **Router is the index.** Every `docs/**/*.md` reachable from `AGENTS.md`; the orphan script makes this mechanical.
- **Single-source / no-restatement.** Each fact one home; others cross-link. (De-dup the ~30-copy paragraph + build-order string to one canonical home each.)
- **ADRs immutable.** `proposed → accepted → superseded by NNNN`; a changed decision is a *new* ADR. Code seams link their governing ADR (`// see docs/adr/NNNN`).
- **Comment hygiene rule (add to AGENTS.md):** comments state *why*, not *what*; never reference plan phases / ticket IDs; link durable rationale to an ADR.
- **Same-commit rule** (already present) extended: status/roadmap updates ship in the same commit as the work.
- **Last-reviewed footers** on the three handoff docs (currently missing) so they enter the re-audit tripwire.

## 5. Phase decomposition

Phases 0–2 are **Claude**; Phase 3 is **coa agents** (Claude reviews). Phases 0–1 deliver value independently of the Phase-2 → Phase-3 critical path.

### Phase 0 — Housekeeping (Claude, immediate, zero-judgment)
- **Pre-step:** commit or stash the ~18 dirty WIP files currently live in the tree (agent-identity / thinking-toggle / shell) — an unrelated loss hazard, not part of this refactor.
- Delete the 8 junk files (incl. both U+F03A-mangled `.txt`); fix `.gitignore` (`*-out.txt`, scratch `*.md`); fix the `console-viewmodel` test writing to an unsanitized OS path; keep `DEV-NOTES.md` as the maintainer's personal notes (left in place, excluded from the indexed doc set); remove orphan `console-ui/src/dense/group.ts` (+test) + unused `react-virtuoso` dep; rewrite the four "Phase 1" comments in `console.ts` (+ the "to to" typo).

### Phase 1 — Author the graduation artifacts (Claude, judgment-as-text)
All product-truth judgment is frozen here into reviewed documents, before any agent runs. **Verify every item against current code, not against prior reports.**
- **Extraction manifest** — every durable decision → target ADR → exact content (seed list: Appendix A).
- **ADR seed set** — DC-1..DC-12, D85 strict-superset, SC-1 single-deny-channel, the D-P1 reversal ("composition never branches on backend"), the multi-backend architecture, owned web tools, multi-account auth, the console design system.
- **Tri-backend SPEC rewrite content + per-module split map** (§6/D6).
- **ROADMAP.md** — authored from the research synthesis: the M0–M10 status matrix (Appendix B) + the remaining-work inventory (Appendix C) + the Phase-2 hardening backlog. This is the "clear path forward."
- **New conventions** — `docs/adr/README.md` (ADR process), updated `WORKFLOW.md` lifecycle, the two scripts, the AGENTS.md comment-hygiene + router-index rules.

### Phase 2 — Harden coa + stand up the first real packages (Claude, TDD)
This doubles as the **first genuine increment of coa's Pieces/packages/skills system** — not throwaway plumbing.
- **H1 Interrupt** — block-preserving stop: discards only the in-progress block, never the whole user turn.
- **H2 Error resilience** — same block-preserving guarantee for fetch-failed/model errors. (H1+H2 are one capability: *only the incomplete block is ever discarded*; today an error replays from the last user turn and strands the in-turn edits on disk while dropping them from the conversation.) Open Phase-2 with `systematic-debugging` to pin the exact mechanism first.
- **Role/capability enforcement** — wire the already-computed capability frame into the governed loop so a "docs-writer" role physically cannot touch code files. (`permission.ts` + `driver.ts`/`session.ts` wiring.)
- **P1 AGENTS.md-into-context package** — agents auto-load the router like Claude Code auto-loads CLAUDE.md.
- **P2 caveman-skill package** — first skill delivered *as a package*, proving the machinery before the full skills system.
- **P3 Claude-Code behavior mirroring** *(deferred, maintainer-driven)* — maintainer supplies CC leaked-prompt behaviors; decide which bake into which packages/roles. This is the DC-1 prompt-thinness fix. Scoped in its own later plan.
- **Dropped:** cost-cap bind (deprioritized), chat cross-talk (already fixed), green-turn gate (already works).

### Phase 3 — coa agents execute the refactor (longcat/deepseek, Claude reviews)
- Execute against the Phase-1 manifest: create ADR files, apply the per-module SPEC split, add package READMEs, sweep remaining comments, de-dup restated facts.
- **Structural safety net (baked in):** work in **tiny, independently-verifiable units, one git commit per verified unit** — caps context bloat (pure-API replays transcript verbatim), makes crash-recovery trivial, and bounds what any single error/interrupt can lose.
- **Delete the graveyard only after graduation is verified** (Claude review + orphan/dead-link scripts green). This is the D1 hard gate.

## 6. Risks & mitigations
- **Manifest incompleteness (top risk).** Agents can't catch omissions. Mitigation: cross-check the manifest against Appendix A + a Claude re-read of each source file before its deletion; graduate-before-delete gate.
- **Reports are point-in-time.** Two were already stale-wrong. Mitigation: D-verify-against-code principle in Phase 1.
- **Deleting a cited authority (`UI.md` → console spec).** Mitigation: graduate the design-system content into `UI.md` (breaking the dependency) *before* deleting the spec.
- **Pure-API context bloat / long refactor.** Mitigation: Phase-3 tiny-units + commit-per-unit.

## 7. What this session produces / next steps
This design spec (reviewed by the maintainer) → `writing-plans` produces the executable **Phase 0 + Phase 1** plan first (they're the immediate, Claude-run, high-value chunk). **Phase 2** and **Phase 3** each get their own detailed plan when reached (distinct sub-projects with their own gates).

---

## Appendix A — Durable decisions trapped in the graveyard (manifest seed)
Facts that exist ONLY in `research/` + `superpowers/` and must graduate to ADR/SPEC before deletion:
- **Multi-backend architecture** — `research/dual-backend-integration.md`, `research/pieces-and-dual-backend-spec.md`, `superpowers/specs/2026-07-05-longcat-backend-adapter-design.md`, `research/pure-api-base-tools.md`: one backend-blind core, the M9 seam, fat-Claude vs thin-pure-API adapters, the `complete()` primitive + shared `@coa/loop-driver`, credential-blind pointer model, "no core branching on provider." → SPEC M9 identity is now `spi + loop-driver + adapter-claude-sdk + adapter-deepseek + adapter-longcat`.
- **DC-1..DC-12** — `research/core-context-and-roles-spike.md` + `research/2026-07-03-context-format-rewrite-design.md`: structure>prose, layer order, role = prose + skill-Pieces + tool-groups, package demoted to distribution wrapper, "composition NEVER branches on backend" (reverses D-P1). Referenced nowhere durable.
- **Owned web tools + local key store** — `superpowers/specs/2026-07-03-owned-web-tools-design.md`, `-web-tool-routing-design.md`, `-web-tool-routing-increment-2-design.md`, `2026-07-04-local-web-key-store-design.md`: cooldown-aware multi-key provider chains → plain-fetch floor; `~/.coa/web.yaml` + `~/.coa/keys/`; `coa websearch`/`webfetch`. The *why* (egress/governance posture) lives only here.
- **Multi-account auth** — `superpowers/specs/2026-06-30-multi-account-auth-design.md`: credential-blind subscription selection; clear `ANTHROPIC_API_KEY`/`_AUTH_TOKEN` so OAuth billing wins; per-account ledger attribution.
- **Console design system + reversals** — `superpowers/specs/2026-06-30-console-frontend-foundation-design.md` (the file `UI.md` currently cites as authority) + chat-overhaul/rich-tool-card specs: three-tier tokens, component families, the virtualization reversal rationale, the single DenyNotice channel.
- **OPEN.md §0 C1–C12** — now built, not deferred; reconcile status framing.
- **`audits/console-perf.md`** — still-open perf fixes (Vite `optimizeDeps.include`, polling cost) → ROADMAP/issue.

## Appendix B — Module status matrix (ROADMAP seed; reconcile vs code)
M0 Shared Schema — Done (living). M1 Change Kernel — Partial (spine live; GRF-* hardening left). M2 Code Lens — Partial (tree-sitter/canonicalize/symbols/metrics; `refs` floored). M3 Constraint/Flag — Partial (producers + close-gate live; no perToolDeny rules). M4 Context Engine — Partial (grounding + SSOT + origin-anchor live; **L-ASM spike-gated**, G5 model-confirm needs M9 runEval). M5 Config Compiler — Done (interface). M6 Workbench — Partial (governed tools + base tools + M6↔M9 bridge live; AST-ops/fork/diff-engine left). M7 Governance — Partial (cost-cap/ledger/sandbox; subscription cost notional). M8 Daemon — Partial/runnable (`coa serve`/`run`, JSON-RPC over pipe, R-7 store; live deny/R-12 push, worktree mgr, subagents left). M9 Runtime Adapter — Partial (Claude adapter + tri-backend factory + registerTools + model/reasoning seam; runEval/Tier-B, registerMcp resolver left). M10 Console — Partial/rich (Electron shell + kit + live chat + rich tool cards; live approvals/deny, Longform+graph left). Cross-cutting: tri-backend adapters (Partial), multi-account auth (Done), session hardening (Partial), core-context/roles/pieces (Partial, merged to main).

## Appendix C — Remaining-work inventory (ROADMAP seed; A→J, keystones first)
- **A. Live governance surfacing** — R-12 WAL→Push bridge [L] (unblocks live deny/cost/approvals); cost Push [S]; tool-name correlation [S].
- **B. v0 calibration** — the L-ASM decision gate (a clean attended Claude turn) [S]. *(pure-API green turn already proven.)*
- **C. M4 depth (gated on B)** — L-ASM assembly/sizing [L]; per-relation governed-by + `coa link` [M]; G0→G5 gauntlet incl. G5 model-confirm [L]; AST health tiers [M].
- **D. M9 secondary path** — ai/@ai-sdk version decision [S]; runEval + Tier-B [M]; registerMcp resolver [M]; light up deliverReminder/render_context/cache_control [M].
- **E. M6 remainder** — AST-ops rename/rewrite + diff engine [L]; find_tools/load_tool proxy [M]; POSIX-only confine + graph reads [S–M].
- **F. Adapters polish** — real DeepSeek prices [S]; provider-discriminated reasoning union [M]; verify LongCat model IDs/effort live [S].
- **G. Session hardening** — the Phase-2 H1/H2/roles work; system-prompt viewer [M]; apply-as-update injection spike [S].
- **H. Console mock→live** — Longform+graph (React Flow) [M]; console add-account flow [S]; **`apps/cli` has no `build` script** — add one so daemon auto-spawn works [S].
- **I. M8 deferred** — interactive multi-turn REPL [M]; worktree manager [L]; subagents D122 depth-1 [L]; DACL/peer-cred hardening [M].
- **J. M1 graph hardening (GRF-*)** — calls/inherits/weight edges, SCC model, temporal projection [L]; underpins M3 staleness + M4 health.
- **Do NOT build for v1:** OPEN.md §1/§4 (multi-user/multi-writer, credential vault, rejected items).

---

_Last reviewed: 2026-07-05_

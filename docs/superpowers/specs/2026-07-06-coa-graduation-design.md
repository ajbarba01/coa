# coa graduation — design (Phase 1, heavy half)

**Status:** design approved in brainstorming (2026-07-06). Decomposes into two executable plans (§7).
**Owner of this arc:** maintainer + Claude (planning + authoring); Phase-3 file ops are coa agents (later).
**This doc is transient.** Like the master design spec, it graduates nothing of its own and is deleted with the
rest of `docs/superpowers/` in Phase 3. It is the authoring contract for the graduation, not a durable record.

**Parent:** [2026-07-05-coa-dedrift-refactor-design.md](2026-07-05-coa-dedrift-refactor-design.md) — the master
de-drift arc. This doc executes the graduation half of that arc's Phase 1. The doc-system scaffolding half
(`docs/adr/`, `ROADMAP.md`, `scripts/docs-check.mjs`, the WORKFLOW/AGENTS convention edits) is already done and
committed (`ab93a0a..081b8a0`).

---

## 1. What this delivers

Three docs-only deliverables (no code-behavior change), plus a light tone pass:

1. **The extraction manifest** — a completeness ledger mapping every durable graveyard decision to its new home.
2. **The ADR seed set** — eight ADRs (0002–0009) authored now, capturing the durable *why* trapped in the graveyard.
3. **The tri-backend SPEC split + reframe** — `SPEC.md` becomes a ~200-line index over `spec/M0..M10.md`, the
   multi-backend truth lands, and the false "Claude-locked" framing is corrected consistently.
4. **A tone pass** — reframe the roadmap-forward as possibilities, not law (maintainer request, 2026-07-06).

**Division of labor (grill outcome).** Claude *authors* all high-judgment content now (the ADRs, the SPEC split,
the reframe, the UI.md graduation). The manifest is the safety-net **ledger**. Phase-3 coa agents do the
mechanical residue (package READMEs, comment sweeps, restated-fact de-dups), verify graduation against the
manifest, and only then **delete** the graveyard. **We author; we do not delete** (the D1 graduate-before-delete
gate).

## 2. Locked decisions (2026-07-06 grill)

| # | Decision |
|---|---|
| G1 | **Author now, manifest = ledger.** Claude writes ADRs 0002–0009 + the SPEC split this phase; the manifest records every durable decision → home → status; Phase-3 agents do residue + verify + delete. |
| G2 | **Tone: soften framing, keep facts.** Roadmap "remaining work" → a menu of possibilities; soften the ROADMAP header + ADR-README language from "single source of truth / immutable law" → "shared reference / current best understanding." The module status table stays factual (it mirrors code); the Constitution invariants stay firm. |
| G3 | **SPEC home = subsection of the owning module.** Post-SPEC capabilities land as subsections: base/web tools → M6, tri-backend adapter family + auth env-overlay → M9, auth ledger attribution → M7. No new module numbers. |
| G4 | **Two plans, subagent-driven.** Plan A (manifest + ADRs + UI.md) and Plan B (SPEC split + reframe), each with its own review gate; execute via subagent-driven-development, Claude reviews each unit. |
| G5 | **ADR granularity ≈ 8, DC split from the D-P1 reversal.** The DC-1..DC-12 composition model is one ADR; DC-5's "layer on native / never branch on backend" (which reverses D-P1) is its own ADR. Small standalone ADRs for D85 and SC-1. |
| G6 | **UI.md graduation preserves the strictness.** Keep every standing principle + authoring rule in full; remove only redundancy and drift; carry enough design-system *structure* that UI.md no longer needs the console-foundation spec as its authority. Exact token *values* stay in `console-ui` code (pointed to, not copied); the *why* moves to ADR-0007. Minimal edit, maximal strictness retained. |

**Standing rule for all of it (from the master spec §6 + this session's evidence): verify every asserted status
against current code — `packages/`, `git log`, the actual source — never against a report, memory file, or a
spec appendix.** This session already caught three drifts this way (see §3, §4.2).

## 3. Deliverable 1 — the extraction manifest

**File:** `docs/superpowers/specs/2026-07-06-graduation-manifest.md` (transient; deleted in Phase 3 with the
graveyard it indexes).

**Form.** Grouped by source file; one row per durable decision:

> `decision → target home → status → note`
>
> where **target home** ∈ { ADR NNNN · SPEC Mx §y · ROADMAP · code comment (`// see docs/adr/NNNN`) · package
> README · already-in-code (pointer only) } and **status** ∈ { authored-now · residue-for-Phase-3 }.

**Coverage — the source files to mine (each re-read in full before its rows are final):**

- `research/dual-backend-integration.md`, `research/pieces-and-dual-backend-spec.md`,
  `research/pure-api-base-tools.md`, `specs/2026-07-05-longcat-backend-adapter-design.md` → ADR-0002 / M9 / M8.
- `research/core-context-and-roles-spike.md`, `research/2026-07-03-context-format-rewrite-design.md` →
  ADR-0003 (+ DC-5 → ADR-0004).
- `specs/2026-07-03-owned-web-tools-design.md`, `specs/2026-07-03-web-tool-routing-design.md`,
  `specs/2026-07-04-web-tool-routing-increment-2-design.md`, `specs/2026-07-04-local-web-key-store-design.md` →
  ADR-0005 / M6.
- `specs/2026-06-30-multi-account-auth-design.md` → ADR-0006 / M9 / M7.
- `specs/2026-06-30-console-frontend-foundation-design.md` + the chat specs
  (`2026-07-01-console-agents-surface-chat-rail`, `2026-07-02-chat-interface-overhaul`,
  `2026-07-03-chat-polish`, `2026-07-04-chat-professionalization`, `2026-07-05-rich-tool-card`,
  `2026-07-05-rich-tool-card-live-and-enhancements`) → ADR-0007 / UI.md.
- `audits/console-perf.md` → still-open perf items → ROADMAP possibilities (not an ADR).
- `handoff/OPEN.md` §0 (C1–C12, now built) → status reconciliation note (ROADMAP/OPEN), not an ADR.
- The two research baselines (`pieces-phase-claude-code-baseline.md`, `harness-system-prompt-claude-code.md`)
  are *reference*, not decisions — the manifest records them as "reference only, no durable decision to graduate"
  so Phase-3 deletion is justified.

**The completeness gate (D10).** Cross-check the finished manifest against the master spec's Appendix A. A source
file becomes eligible for Phase-3 deletion only when every durable line in it maps to a live home in the manifest.
Agents cannot catch an omission — the manifest's completeness is the only safety net.

**Drift already caught (records itself in the manifest so it isn't re-introduced):**
- Web providers ship as **`firecrawl` / `parallel` / `tavily`** (verified in `packages/core/src/workbench/web/`),
  not the early owned-web-tools spec's `parallel/exa/tavily/brave`. ADR-0005 states the shipped set.
- **D-P1 is reversed in shipped code**: `adapter-claude-sdk/src/sdk-options.ts` uses
  `{ type:'preset', preset:'claude_code', append }` with `PRESET_COVERED_PIECES`. ADR-0004 records the reversal
  as the current truth; the old D-P1 "own the whole prompt" is history, not current.
- The auth core ships as `packages/core/src/auth/registry.ts` (not the spec's naming).

## 4. Deliverable 2 — the ADR seed set (0002–0009)

MADR-lite per `docs/adr/README.md` (Context/problem · Drivers · Considered options · Decision · Consequences).
Small ADRs (0008/0009) may use the one-line Y-statement form. **Every ADR is verified against current code before
it is written.** The ADR README index is updated with all eight (keeps `docs:check` reachability green).

### 4.1 The set

- **0002 — Multi-backend architecture (one core, one seam, adapters differ in shape).** The backend-blind core
  (M0–M8) produces neutral artifacts and never names a backend; the only backend seam is the M9 `RuntimeAdapter`
  port (D109) + the D121 neutral construction seam; the `TurnFrame`/`Push` vocabulary + `string |
  AsyncIterable<string>` input is the one wire; adapters split into **fat (Claude SDK owns the loop)** vs **thin
  (coa owns the loop via the `complete()` primitive + shared `@coa/loop-driver`)**; capability profiles +
  null-fallback mean the core degrades, never branches. Shipped as five packages: `spi`, `loop-driver`,
  `adapter-claude-sdk`, `adapter-deepseek`, `adapter-longcat`.

- **0003 — Core-context & role composition.** DC-1 (structure-first over added prose), DC-2 (role = coa prose
  section + capability refs, additive/stackable), DC-3 (three runtime capability types: skill-Pieces /
  tool-groups / MCP), DC-4 (package/bundle demoted to a distribution wrapper), DC-6 (the ordered slot skeleton),
  DC-7 (project context split by volatility; fidelity ladder), DC-8 (skills always-on first), DC-9 (the
  objective A/B verification, no LLM judge), DC-10 (slot-order snapshot tests + context sanitization), **DC-11
  (no coa-added safety/refusal guardrails — the `baseline-safety` piece removed)**, DC-12 (max configurability
  via `.coa` built-in∪user merge).

- **0004 — Layer on native; composition never branches on backend (reverses D-P1).** DC-5/DC-5a: coa layers its
  rendered scaffold **on** each backend's native preset (Claude: `claude_code` preset + `append` +
  `PRESET_COVERED_PIECES` drop-set; bare models: full standalone scaffold) rather than authoring the whole
  prompt; **all** backend-aware choices live in M9 `renderNative` and nowhere earlier; the composition/compile
  layers stay neutral. Records the **reopened config-leak risk** and its containment (explicit
  `settingSources`/`tools` at the seam, not prompt ownership). Supersedes the prior D-P1 stance.

- **0005 — Owned base + web tools & the local key store.** Why coa must own Read/Glob/Grep/Write/Edit/Bash +
  WebSearch/WebFetch on the pure-API path (Claude gets them from the SDK; a bare model has no executor behind the
  name); the **two orthogonal gates** (backend gate = do these exist for this provider, at composition; role gate
  = which subset may this session call, via the capability frame); **Bash as a named S-2 deviation** (attended,
  local-first, cwd-confined, no OS sandbox on the pure-API path); the egress/governance posture (cooldown-aware
  multi-key provider chains degrading to a plain-fetch floor); `~/.coa/web.yaml` + `~/.coa/keys/` +
  credential-blind pointers + `coa websearch`/`webfetch`. Shipped providers: firecrawl/parallel/tavily.

- **0006 — Multi-account auth (credential-blind subscription selection).** coa stores *pointers* (config-dir
  paths), never secrets; the adapter clears `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` **and** the ambient
  OAuth-token vars (the ambient-token trap) so the selected subscription login wins over API billing; per-account
  ledger attribution; `ant-profile` dropped (Console/API path, not subscription); no vault, no login-from-coa.

- **0007 — Console design system + reversals.** The three-tier token system, the component-family/`intent`-block
  contract, the layout architecture, the visual direction (warm-dark "forge", brass), the **virtualization
  reversal** (`Transcript` renders every row for selection + Ctrl-F; `content-visibility:auto` instead of
  windowing), and the **single `DenyNotice` channel** (renders only a daemon-issued block, never invents one).
  **This ADR + the UI.md graduation (§5) break UI.md's dependency on the console-foundation spec.** Exact token
  values are not copied here — they live in `console-ui` code; this ADR holds the *why*.

- **0008 — Strict-superset (D85).** *Small.* Every feature adds value or degrades to a literal pass-through; coa
  with a feature off is never worse than the raw loop; `coa raw` always shows the unfiltered loop. Already stated
  as an invariant in the Constitution/§B — this ADR records the *why* the Constitution can cite.

- **0009 — Exactly two blocks / single deny channel (SC-1).** *Small.* The only two blocks in the whole system
  are M3's Type-1 close-gate and M7's cost-cap, both issued through M9's single deny channel; everything else is
  advisory. This ADR records the *why* behind "help, never cage."

### 4.2 Authoring discipline for the ADRs

- Present-tense the *current* decision; where a decision reversed an earlier one (0004 vs D-P1), state the
  supersession explicitly and set the narrative to the shipped truth.
- No project-internal churn in the record beyond what's durable: an ADR is a paragraph of *why*, not a plan
  replay. Link code seams back with `// see docs/adr/NNNN` where a seam governs the decision (a Phase-3 residue
  item for the comment sweeps; the manifest lists the seams).

## 5. Deliverable 3 — the SPEC split + reframe, and the UI.md graduation

### 5.1 SPEC split (G3)

- **`SPEC.md` → ~200-line index.** Keep: "What coa is" (reframed, §5.3), "How to read this doc set", **§A** module
  map (A.1 the eleven modules, A.2 dependency graph, A.3 hourglass diagram, **A.4 logical→physical package map
  updated to the 5-package M9**), **§B** cross-cutting invariants. Add a linked index to each `spec/Mx.md`. Drop
  the per-module bodies (they move to the module files).
- **`spec/M0..M10.md`** — one file per module, bodies lifted from the current sections. Same-commit doc rule: each
  module file carries a last-reviewed footer (they enter the re-audit tripwire, which the flat file dodged). The
  three post-SPEC capabilities land as subsections (G3):
  - **M9** — retitled from `(spi + adapter-claude-sdk)` to the real five-package family; add the tri-backend
    adapter subsection (fat/thin, the provider-keyed `createAdapter`, `complete()`/loop-driver) + the auth
    env-overlay (`resolveAuthEnv`) subsection. Cross-links ADR-0002/0004/0006.
  - **M6** — base-tools + web-tools subsection (the six base tools + WebSearch/WebFetch, the backend gate, the S-2
    Bash note). Cross-links ADR-0005.
  - **M7** — per-account ledger attribution subsection. Cross-links ADR-0006.
  - **M8** — the "createSession calls the same port methods in the same order for both backends" truth.
    Cross-links ADR-0002.
- **`docs:check` stays green.** `spec/*.md` are inside the indexed set (only `superpowers`/`research`/`archive`/
  `DEV-NOTES.md` are excluded), so the SPEC index MUST link every module file → reachable. Run `pnpm docs:check`
  after; also update the AGENTS.md router row for the handoff docs if the SPEC path shape changes.

### 5.2 The reframe (synchronized, one pass)

Correct **"Claude-locked / one backend"** → **"Claude-primary, provider-swappable via M9"** in the same commit
across **`SPEC.md`**, **`docs/DESIGN.md`**, **`AGENTS.md`**, and **`README.md`**. Verify each doc's actual current
wording first (grep before editing); do not fix it in one doc alone (the README line was deliberately deferred to
this synchronized pass). AGENTS.md stays under ~200 lines.

### 5.3 "What coa is" — the canonical paragraph

The ~30-copy paragraph gets one canonical home (SPEC.md index intro) with the reframed backend clause; the
manifest records the duplicate locations as Phase-3 de-dup residue (each replaced by a cross-link, not a restate).

### 5.4 UI.md graduation (G6 — preserve strictness, cut only redundancy + drift)

- **Keep in full:** every standing UI principle (control-through-the-catalogue, `coa raw` sacred, catalogue-only
  byte-faithful, component-kit-with-intent, accessibility floor, honest surfacing) and every authoring rule
  (build-from-the-kit, no-raw-values, density-driven sizing, the feedback contract, the Electron gotchas, the
  virtualization reversal note). UI strictness is load-bearing; nothing binding is dropped.
- **Break the spec dependency:** UI.md stops citing `console-frontend-foundation-design.md` as "the authority."
  It carries the design-system **structure** itself at a principles level (the token *tiers*, the component
  *families*, the layout architecture, the visual direction) — enough to stand alone — and points to **code** for
  exact values (`console-ui/src/theme.css`, `tokens/semantic.ts`, the generated `COMPONENTS.md`) and to
  **ADR-0007** for the *why*/reversals.
- **Cut only:** the redundant "see §6/§7/§23 of the spec" pointers and any wording the current code contradicts.
  Do **not** copy the 61k spec in. Minimal diff, same strictness.

## 6. The tone pass (G2)

- **ROADMAP "Remaining work (keystones first)"** → reframe as a menu of **possibilities / candidate directions**;
  drop the "two items gate everything, do them first" imperative register (keep the dependency *facts*, lose the
  "must"). "Someday / ideas" already reads right.
- **Soften the framing language**, not the facts: the ROADMAP header's "single source" and the ADR-README's
  "permanent home / immutable law / source of truth" → "shared reference / current best understanding / decision
  history you supersede rather than rewrite." The module status table stays factual (a mirror of code); the
  Constitution invariants stay firm; the immutability *mechanic* (supersede, don't rewrite) stays — only the
  "law" tone softens.

## 7. Execution — two plans (G4)

**Plan A — Graduation authoring.** The manifest (§3) + ADRs 0002–0009 (§4) + the UI.md graduation (§5.4) + the
ADR-README tone softening (§6). Review gate: manifest completeness cross-checked vs Appendix A; every ADR
verified vs code; `docs:check` green; UI.md still carries every binding rule.

**Plan B — SPEC split + reframe.** The per-module split (§5.1) + the synchronized 4-doc reframe (§5.2) + the
canonical-paragraph home (§5.3) + the ROADMAP tone pass (§6). Review gate: `docs:check` green (all `spec/*.md`
reachable, no dead links); grep confirms no residual "Claude-locked/one-backend" wording; AGENTS.md < 200 lines.

**How.** subagent-driven-development; Claude reviews each unit; work in small, independently-verifiable commits
(human-sized batches, one logical unit each); stage files **by name**; subject-only Conventional Commits (no
body, no trailers, no module/plan IDs in the subject). The `.superpowers/sdd/progress.md` ledger is gitignored
scratch — reuse/overwrite freely.

## 8. Hard rules / gotchas (carried from the master arc)

- **Graduate-before-delete.** Author only; deletion is Phase 3 against the manifest.
- **Verify vs code, never vs reports** — including this doc's own claims and the master spec's appendices.
- **DEV-NOTES.md is the maintainer's WIP** — untouched, excluded from the indexed set. (It is dirty in the tree
  right now; do not sweep it into any commit.)
- **Keep `pnpm docs:check` green** after every doc-structure change.
- Single `main` branch; commit only after verification; stage by name; no `git add -A`.

## 9. Risks & mitigations

- **Manifest incompleteness (top risk).** Mitigation: re-read each source in full; cross-check vs Appendix A;
  graduate-before-delete gate. Agents cannot catch an omission.
- **Losing UI strictness in the UI.md cut.** Mitigation: G6 keeps every binding rule; the cut is redundancy/drift
  only; review gate asserts the rule set is intact.
- **Reframe touches four docs unevenly.** Mitigation: grep each doc's wording first; one synchronized commit; a
  post-grep for residual "Claude-locked" phrasing.
- **A split module file drops a cross-link → `docs:check` red.** Mitigation: SPEC index links every module file;
  run the check as the gate.

## 10. What this session produces / next

This design (maintainer-reviewed) → `writing-plans` produces **Plan A first**, executed and reviewed, then
**Plan B**. Phase 2 (coa hardening) and Phase 3 (agents execute residue + delete) remain separate sub-projects
with their own plans.

---

_Last reviewed: 2026-07-06_

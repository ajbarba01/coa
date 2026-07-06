# Graduation Plan A — Manifest + ADR seed set + UI.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graduate the durable *why* trapped in the `docs/superpowers/` + `docs/design/research/` graveyard into a completeness ledger (the manifest) and eight immutable ADRs, and break `UI.md`'s dependency on the console-foundation spec — all docs-only, no code-behavior change.

**Architecture:** This is the first of two plans executing the graduation half of the de-drift arc's Phase 1 (design: [`docs/superpowers/specs/2026-07-06-coa-graduation-design.md`](../specs/2026-07-06-coa-graduation-design.md)). Claude has pre-decided *what* each ADR captures (the substance seeds below); each task drafts prose from its seed, **verifies every factual claim against current code**, places the file, updates the ADR index, and runs `docs:check`. Plan B (the SPEC split + reframe) follows separately.

**Tech Stack:** Markdown docs; `pnpm docs:check` (Node script `scripts/docs-check.mjs`) is the reachability/dead-link gate; `git` for commits. No product code changes.

## Global Constraints

- **Docs-only. No product-code or behavior change.** If a claim can't be verified in code, it does not go in an ADR as fact — soften it or drop it.
- **Verify every asserted status/fact against current code** (`packages/`, `git log`, actual source) — never against a report, a memory file, or a spec appendix. This session already caught three drifts this way (see the design doc §3).
- **Graduate-before-delete.** This plan AUTHORS. It deletes nothing from the graveyard. Deletion is Phase 3.
- **ADR format:** MADR-lite per [`docs/adr/README.md`](../../adr/README.md) — `## Context and problem` / `## Decision drivers` / `## Considered options` / `## Decision` / `## Consequences (good / bad)`. Small ADRs may use the one-line Y-statement. Header: `# NNNN. <title>` · `- Status: accepted` · `- Date: 2026-07-06`. Every ADR ends with `_Last reviewed: 2026-07-06_`.
- **ADRs are immutable once accepted**, filenames `NNNN-kebab-title.md` zero-padded sequential, and **every new ADR is added to the `docs/adr/README.md` index** in the same commit (this is what keeps `docs:check` reachability green — ADR files are in the indexed set and are reached only via that index).
- **`pnpm docs:check` MUST stay green** after every task that adds/edits an indexed doc (everything under `docs/` except `docs/superpowers`, `docs/design/research`, `docs/archive`, and `DEV-NOTES.md`).
- **`DEV-NOTES.md` is the maintainer's WIP — never stage or edit it.** It is dirty in the tree; stage files **by name** only.
- **Commits:** subject-only Conventional Commits — no body, no `Co-Authored-By`/trailer, no "Generated with" footer, **no module IDs / decision codes / plan numbers in the subject.** One logical unit per commit; `git add <path>` by name, never `git add -A`.
- **Sources are point-in-time.** Where a source spec and the code disagree, **the code wins** and the ADR states the shipped truth (e.g. web providers are `firecrawl`/`parallel`/`tavily`, not the early spec's `exa`/`brave`; D-P1 is reversed in shipped code).

---

### Task 1: The extraction manifest (the completeness ledger)

**Files:**
- Create: `docs/superpowers/specs/2026-07-06-graduation-manifest.md`

**Interfaces:**
- Produces: the authoritative list of durable decisions → target home → status, that Tasks 2–9 pull their per-ADR rows from, and that Phase 3 verifies against before deleting any source file.

This is the top-risk deliverable: its **completeness** is the only safety net (agents can't catch an omission). It requires reading **every** source file in full, even the ones already skimmed.

- [ ] **Step 1: Read every source file in full.** Read each of:
  - `docs/design/research/{dual-backend-integration, pieces-and-dual-backend-spec, pure-api-base-tools, core-context-and-roles-spike, 2026-07-03-context-format-rewrite-design}.md`
  - `docs/design/research/{pieces-phase-claude-code-baseline, harness-system-prompt-claude-code}.md` (reference, not decisions)
  - `docs/superpowers/specs/{2026-07-05-longcat-backend-adapter-design, 2026-06-30-multi-account-auth-design, 2026-07-03-owned-web-tools-design, 2026-07-03-web-tool-routing-design, 2026-07-04-web-tool-routing-increment-2-design, 2026-07-04-local-web-key-store-design, 2026-06-30-console-frontend-foundation-design, 2026-07-01-console-agents-surface-chat-rail-design, 2026-07-02-chat-interface-overhaul-design, 2026-07-03-chat-polish-design, 2026-07-04-chat-professionalization-design, 2026-07-05-rich-tool-card-design, 2026-07-05-rich-tool-card-live-and-enhancements-design}.md`
  - `docs/superpowers/audits/console-perf.md`
  - `docs/design/handoff/OPEN.md` §0 (the C1–C12 "built" items)

- [ ] **Step 2: Write the manifest header + structure.** Create the file with this exact frame:

```markdown
# Graduation extraction manifest

**Status:** transient ledger (deleted in Phase 3 with the graveyard it indexes).
**Purpose:** every durable decision in the graveyard → its new permanent home → status. Phase 3 deletes a
source file only when every durable row from it maps to a live home here (the graduate-before-delete gate).
**Cross-checked against:** the master de-drift spec Appendix A.

## Legend
- **Home:** `ADR NNNN` · `SPEC Mx §y` · `ROADMAP` · `code comment` · `package README` · `already-in-code (pointer)`
- **Status:** `authored-now` (done in Phase 1) · `residue-for-Phase-3` (agents transcribe later)

## <source file path>
| Durable decision | Home | Status | Note |
| --- | --- | --- | --- |
| … | … | … | … |
```

- [ ] **Step 3: Fill one table section per source file.** For each source, enumerate its durable decisions (not play-by-play) and assign each a home + status. Seed rows already established (verify + include):
  - dual-backend / pieces / pure-api / longcat → **ADR 0002**; the M9 5-package identity → **SPEC M9** (Plan B); the DeepSeek/LongCat wire specifics → `already-in-code (pointer)` to `packages/adapter-*`.
  - core-context spike DC-1..4,6..12 → **ADR 0003**; DC-5/5a (the D-P1 reversal) → **ADR 0004**; context-format-rewrite slot skeleton → ADR 0003 + `already-in-code` pointer to `packages/shared/src/render-sections.ts`.
  - owned-web-tools + routing ×2 + key-store → **ADR 0005**; the tool/CLI *what* → **SPEC M6** (Plan B); shipped providers `firecrawl/parallel/tavily` → `already-in-code` pointer to `packages/core/src/workbench/web/`.
  - multi-account-auth → **ADR 0006**; env-overlay → **SPEC M9**, ledger attribution → **SPEC M7** (Plan B).
  - console-foundation + chat specs + rich-tool-card ×2 → **ADR 0007** + **UI.md** (Task 9); exact token values → `already-in-code` pointer to `packages/console-ui`.
  - `console-perf.md` still-open items → **ROADMAP** (possibilities); reconcile against code first (some may be fixed).
  - OPEN.md §0 C1–C12 (now built) → **ROADMAP/OPEN status reconciliation**, `residue-for-Phase-3`.
  - `pieces-phase-claude-code-baseline.md`, `harness-system-prompt-claude-code.md` → one row each: *"reference only, no durable decision to graduate"* (justifies Phase-3 deletion).

- [ ] **Step 4: Cross-check completeness against Appendix A.** Open the master spec's Appendix A; confirm every bullet there has at least one manifest row. Add a short `## Appendix A coverage` checklist at the end mapping each Appendix-A bullet → its rows. Flag any Appendix-A item with no home as an OPEN line for maintainer review (do not invent a home).

- [ ] **Step 5: Verify the flagged drifts are recorded.** Confirm the manifest explicitly records: web providers = `firecrawl/parallel/tavily` (not exa/brave); D-P1 reversed in `adapter-claude-sdk/src/sdk-options.ts`; auth core at `packages/core/src/auth/registry.ts`. Grep to confirm each before writing it as fact:

Run: `rg -n "parallel|firecrawl|tavily|exa|brave" packages/core/src/workbench/web/ | rg "'"` — Expected: only `firecrawl`/`parallel`/`tavily`.
Run: `rg -n "preset|claude_code" packages/adapter-claude-sdk/src/sdk-options.ts` — Expected: the `claude_code` preset + append.

- [ ] **Step 6: Commit.**

```bash
git add docs/superpowers/specs/2026-07-06-graduation-manifest.md
git commit -m "docs: add graduation extraction manifest"
```

---

### Task 2: ADR 0002 — Multi-backend architecture

**Files:**
- Create: `docs/adr/0002-multi-backend-architecture.md`
- Modify: `docs/adr/README.md` (add to the Index)

**Interfaces:**
- Consumes: the manifest's ADR-0002 rows (Task 1).
- Produces: the durable home cited by SPEC M9/M8 (Plan B) and by code comments (`// see docs/adr/0002`).

**Substance to capture (the decision seed — draft prose from this, then verify each claim):**
- One **backend-blind core** (M0–M8) produces neutral artifacts (`NeutralConfig`, `ContextPackage`, governed tool catalogue, governance decisions) and drives sessions **without ever naming a backend**.
- The **only** backend seam is the M9 `RuntimeAdapter` port (D109), compile-time; plus the **D121 neutral construction seam** (`SessionAdapterInit` carries only neutral types) at runtime. No SDK type crosses into the core.
- The **one wire vocabulary**: `TurnFrame`/`Push` out (M0 `push.ts`), `string | AsyncIterable<string>` in. Console + CLI consume frames identically regardless of backend — that identical consumption is the payoff.
- Adapters differ in **shape, not interface**: **fat** (Claude SDK owns the loop/tools/cache/hooks; coa configures + governs) vs **thin** (a bare model has nothing native; coa supplies the loop via the `complete()` primitive + the shared `@coa/loop-driver`, tools, prompt, context).
- **Capability profiles + null-fallback**: the core asks "does this capability exist?" and takes a defined fallback, never `if (backend === …)`.
- **Shipped as five packages**: `spi`, `loop-driver`, `adapter-claude-sdk`, `adapter-deepseek`, `adapter-longcat`.
- Considered options to record: (a) one adapter per backend with a shared driver (**chosen**); (b) a compat-endpoint / `ANTHROPIC_BASE_URL` swap in front of non-Anthropic models (**rejected** — the owned-adapter direction deliberately avoids it); (c) a minimal loop duplicated inside each thin adapter (**rejected** — governance-critical loop belongs in one audited place).
- Consequences: adding a pure API = one adapter class implementing `complete()`, no M8 change; the fat adapter is the outlier needing a parity/delta package; on the thin path coa executes every tool so governance is *tighter*.

- [ ] **Step 1: Verify the seed against code.** Confirm before asserting:

Run: `ls packages/spi packages/loop-driver packages/adapter-claude-sdk packages/adapter-deepseek packages/adapter-longcat` — Expected: all five exist.
Run: `rg -n "complete\(" packages/loop-driver/src | head` — Expected: the `complete()` primitive + `runGovernedLoop`.
Run: `rg -n "provider" apps/cli/src/adapter-factory.ts | head` — Expected: `createAdapter` switches on `provider` (`claude`/`deepseek`/`longcat`).
Correct any seed bullet the code contradicts.

- [ ] **Step 2: Write `docs/adr/0002-multi-backend-architecture.md`** in MADR-lite form from the verified seed. Title: `# 0002. Multi-backend architecture: one backend-blind core, one M9 seam`. Keep it a paragraph-scale *why*, not a plan replay. State the shipped 5-package reality in the Decision section.

- [ ] **Step 3: Add to the ADR index.** In `docs/adr/README.md`, under `## Index`, append:

```markdown
- [0002](0002-multi-backend-architecture.md) — Multi-backend architecture: one backend-blind core, one M9 seam
```

- [ ] **Step 4: Run the docs gate.**

Run: `pnpm docs:check`
Expected: `docs-check OK — N docs, all reachable, no dead links.` (N grows by 1.)

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0002-multi-backend-architecture.md docs/adr/README.md
git commit -m "docs: record multi-backend architecture decision"
```

---

### Task 3: ADR 0003 — Core-context & role composition

**Files:**
- Create: `docs/adr/0003-core-context-and-role-composition.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: manifest ADR-0003 rows; the core-context spike (DC-1..DC-12) + context-format-rewrite.
- Produces: the durable home for the role/context-composition model, cited by M4/M5/M6 and role/piece code.

**Substance to capture (seed):**
- **DC-1 structure-first**: coa's prompt effort prioritizes structural levers it owns (tool declarations/descriptions, output-format contracts, bounded context-shaping) over added identity/safety prose; every always-on Piece is an *adherence cost* to justify, not a free add.
- **DC-2 role model**: a role = a coa-authored **prose section** + capability references; **additive/stackable** (no role ⇒ nothing added; multiple ⇒ deduped union). Supersedes the earlier inert `Role = { packageIds, pieces? }`.
- **DC-3 three runtime capability types**: skill-Pieces (prose, push or on-demand) · tool-groups (named tool-grant sets) · MCP servers (self-describing). **DC-4**: package/bundle demoted to an optional **distribution** wrapper, decomposing into the three types on import.
- **DC-6 ordered slot skeleton** (identity → tone → tool-use → code-discipline → governance → role → project → volatile tail), a fixed named-slot registry; stable prefix first (primacy + cache), volatile last (recency + cache-correctness).
- **DC-7 project context** split by volatility (static AGENTS.md-include after roles; dynamic/retrieved in the volatile tail); fidelity ladder up to a ranked tree-sitter repo map.
- **DC-8** ship always-on skills first, defer trigger/retrieval. **DC-9** the objective A/B verification (frozen hidden-test task set, `coa raw` vs `coa core-on`, resolve-rate **and** cost/token delta, **no LLM-as-judge**). **DC-10** slot-order snapshot tests + injected-context sanitization.
- **DC-11 no coa-added safety/refusal guardrails** — the `baseline-safety` Piece was **removed**; coa does not govern *how* a user uses their agent (only the two SC-1 blocks). Op-sec hygiene ("don't echo secrets") is opt-in in the removable `core` package, never floor.
- **DC-12 max configurability / no lock-in**: every registry (roles, packages, tool-groups, core Pieces) merges built-in defaults with user `.coa/` (add or override, drop-unknown/never-throw); in-app authoring deferred but not designed out.
- The evidence base (Aider edit-format 20%→61%, SWE-bench tool-desc 33%→49%, persona-hurts-accuracy, instruction-density decay) belongs as *drivers*, compressed to 2–3 lines with links — not reproduced wholesale.
- **Note the boundary**: DC-5 (layer-on-native / never-branch-on-backend) is **NOT** in this ADR — it's ADR 0004.

- [ ] **Step 1: Verify the seed against code.** Confirm the model shipped:

Run: `rg -n "slot|SLOTS" packages/shared/src | head` — Expected: the slot skeleton exists.
Run: `rg -n "baseline-safety|baseline-pieces" packages/core/src/session/baseline-pieces.ts` — Expected: no `baseline-safety` in the baseline set (DC-11 removal shipped).
Run: `rg -n "role" packages/core/src/session/assemble-agent.ts | head` — Expected: role union/dedupe.
Soften any DC the code shows as not-yet-built (e.g. DC-8 on-demand, DC-12 `.coa` merge may be partial — state "decided, partially built" honestly, cross-referencing ROADMAP).

- [ ] **Step 2: Write the ADR** from the verified seed. Title: `# 0003. Core-context and role composition`. Compress the twelve DCs into a coherent Decision section (grouped, not a numbered dump); keep drivers tight.

- [ ] **Step 3: Add to the ADR index.**

```markdown
- [0003](0003-core-context-and-role-composition.md) — Core-context and role composition (DC model)
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+1.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0003-core-context-and-role-composition.md docs/adr/README.md
git commit -m "docs: record core-context and role composition model"
```

---

### Task 4: ADR 0004 — Layer on native; composition never branches on backend (reverses D-P1)

**Files:**
- Create: `docs/adr/0004-layer-on-native-never-branch-on-backend.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: core-context spike §5/§7 + context-format-rewrite §6/§10; the shipped `render-native.ts`/`sdk-options.ts`.
- Produces: the reversal record; cited at the M9 `renderNative` seam.

**Substance to capture (seed):**
- **The reversal**: the earlier **D-P1** ("keep the custom-string path; coa owns the *entire* prompt; do not use `preset:'claude_code'`") is **reversed** by **DC-5**. coa now **layers on** the native preset.
- **Two-mode render**: Claude = `{ type:'preset', preset:'claude_code', append }` with a `PRESET_COVERED_PIECES` drop-set (a gentle non-duplication of baseline-conduct generics the preset already ships — identity/tone/tool-use/environment — never a suppression of native behavior); bare models = the **full standalone scaffold** including a taught tool-calling convention.
- **DC-5a invariant**: the composition/compile layers are **backend-neutral and must never branch on backend**. *Every* backend-aware choice — the drop-set, tool serialization (JSON vs XML), MCP wiring — lives in **M9 `renderNative`** and nowhere earlier. "Adapter-agnostic" is softened from "provably byte-identical" to "works well everywhere."
- **The reopened config-leak risk** (honest consequence): leaning on the SDK preset is exactly what let the target repo's config (unset `settingSources`/`tools`) leak into governed sessions. Containment moves to explicit `settingSources`/`tools` control at the M9 seam — **not** prompt ownership.
- Considered options: (a) keep D-P1 own-the-whole-prompt (**rejected** — duplication + work, and it fights the model); (b) layer-on-native with a neutral drop-set in composition (**rejected** — pushes a backend branch a layer too early); (c) layer-on-native with the drop-set inside `renderNative` (**chosen**).

- [ ] **Step 1: Verify the reversal shipped.**

Run: `rg -n "PRESET_COVERED_PIECES|preset" packages/adapter-claude-sdk/src/render-native.ts packages/adapter-claude-sdk/src/sdk-options.ts` — Expected: the drop-set + `claude_code` preset + append.
Run: `rg -n "settingSources|strictMcpConfig|tools" packages/adapter-claude-sdk/src | head` — confirm whether the leak containment is built; state its real status in Consequences (built vs still-floored).

- [ ] **Step 2: Write the ADR.** Title: `# 0004. Layer on the native preset; composition never branches on backend`. In the header/Context, state it **supersedes the prior D-P1 stance** (D-P1 lived only in the graveyard, so there is no earlier ADR to mark `superseded by`; say so in one line). Decision reflects the **shipped** preset+append+drop-set truth.

- [ ] **Step 3: Add to the ADR index.**

```markdown
- [0004](0004-layer-on-native-never-branch-on-backend.md) — Layer on native; composition never branches on backend
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+1.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0004-layer-on-native-never-branch-on-backend.md docs/adr/README.md
git commit -m "docs: record layer-on-native backend-render stance"
```

---

### Task 5: ADR 0005 — Owned base + web tools & the local key store

**Files:**
- Create: `docs/adr/0005-owned-base-and-web-tools.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: pure-api-base-tools + owned-web-tools + routing ×2 + local-web-key-store; the shipped `workbench/base-tools.ts` + `workbench/web/`.
- Produces: the *why* home for M6's base/web-tool subsection (Plan B).

**Substance to capture (seed):**
- **Why coa owns them on the pure-API path**: Claude gets Read/Glob/Grep/Write/Edit/Bash from SDK built-ins and WebSearch/WebFetch as Anthropic *server-side* tools; a bare model has **no executor behind the name**. There is no base-URL/compat swap that gives a non-Anthropic model Anthropic's server-side WebSearch (and that swap is the compat-endpoint routing the owned-adapter direction rejected). So coa supplies them, pure-API path only.
- **Two orthogonal gates** (do not conflate): the **backend gate** (do these executors exist for this provider — composition-set `includeBaseTools`/`includeWebTools`, backend-awareness only in composition/adapter per DC-5a) vs the **role gate** (which subset a session may call — the existing `CapabilityFrame.allow/deny` → `canUseTool` path; each tool is an individually-named catalogue entry with a `read|write|exec` group tag).
- **SC-1 for every handler**: Zod-validate → dispatch → enrich, **never throw, never deny**; a confinement rejection / bad match / spawn failure returns an *unapplied* result the agent retries.
- **Security posture**: S-1 `confinePath` covers reads+writes (in-process MCP tools, not the SDK sandbox); Write/Edit funnel through the M1 `emit` spine (P7, no disk+graph split); **Bash is a named S-2 deviation** — `cwd = worktreeRoot`, no OS sandbox on the pure-API path, authorized because coa is local-first/attended/single-user and Claude Code runs an equivalent shell; full per-session process isolation stays the documented v2 prerequisite.
- **Web egress posture**: cooldown-aware multi-key provider chains degrading to a plain-fetch floor (D85); WebFetch summarizer optional (absent ⇒ raw-markdown mode); no change-events (egress, not worktree mutation) — S-4 domain-policy governance is a placed-but-floored seam.
- **Local key store**: `~/.coa/web.yaml` (credential-blind pointers) + secrets in `~/.coa/keys/web-<label>` (0600) + `coa websearch`/`coa webfetch` CLI twins of `coa auth`, split by chain. **Shipped providers: `firecrawl` / `parallel` / `tavily`** (verify — early spec's exa/brave/parallel-default drifted).

- [ ] **Step 1: Verify against code.**

Run: `rg -n "includeBaseTools|includeWebTools" packages/core/src | head` — Expected: the backend gate.
Run: `rg -n "'firecrawl'|'parallel'|'tavily'|'exa'|'brave'" packages/core/src/workbench/web/` — Expected: only firecrawl/parallel/tavily.
Run: `rg -n "Bash|worktreeRoot|confinePath" packages/core/src/workbench/base-tools.ts | head` — Expected: Bash cwd=worktreeRoot, confinePath on fs tools.
State the shipped provider set and any floored seam honestly.

- [ ] **Step 2: Write the ADR.** Title: `# 0005. Owned base and web tools for the pure-API path`. Lead with the *why coa must own them* asymmetry; record the two gates, the Bash S-2 deviation, and the credential-blind key store as the durable posture.

- [ ] **Step 3: Add to the ADR index.**

```markdown
- [0005](0005-owned-base-and-web-tools.md) — Owned base + web tools & local key store (pure-API path)
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+1.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0005-owned-base-and-web-tools.md docs/adr/README.md
git commit -m "docs: record owned base and web tools posture"
```

---

### Task 6: ADR 0006 — Multi-account auth

**Files:**
- Create: `docs/adr/0006-multi-account-auth.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: multi-account-auth-design; the shipped `packages/core/src/auth/registry.ts` + the adapter env overlay.
- Produces: the *why* home for M9 env-overlay + M7 ledger-attribution subsections (Plan B).

**Substance to capture (seed):**
- **Credential-blind subscription selection**: coa stores *pointers* (`config-dir` paths) in `~/.coa/accounts.yaml`, **never secrets/tokens**. It selects *which login*; the SDK resolves the token.
- **Hard invariant — subscription, not API key**: for any non-ambient account the adapter clears `ANTHROPIC_API_KEY` **and** `ANTHROPIC_AUTH_TOKEN` (both force API billing and outrank OAuth) **and** the **ambient OAuth-token vars** (`CLAUDE_CODE_OAUTH_TOKEN`) — the **ambient-token trap**: a daemon started with a token in-env would otherwise pin every session to one login. Delivered per-session via `options.env = { ...process.env, ...overlay }`; process-local, no daemon `process.env` mutation, so two accounts never race.
- **`ant-profile` dropped** (post-spike): `ant auth login` profiles select Anthropic Console/API (the API-billing path this avoids), not Claude.ai subscriptions. Shipped locator set = `config-dir` + `ambient`.
- **Strict-superset**: no `accounts.yaml` / `active: ambient` ⇒ byte-identical to today (zero auth passed, ambient login wins).
- **Per-account ledger attribution**: the session records which account label it ran under; `M7.charge` attributes spend to it (rides existing session-start metadata, no new event type).
- Non-goals to record: no vault, no token storage, no login-from-inside-coa, no multi-user, no managed API-key accounts.

- [ ] **Step 1: Verify against code.**

Run: `rg -n "config-dir|ambient|ant-profile" packages/core/src/auth/registry.ts packages/shared/src/auth.ts | head` — Expected: `config-dir` + `ambient`, no `ant-profile`.
Run: `rg -n "ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OAUTH|resolveAuthEnv" packages/adapter-claude-sdk/src | head` — Expected: the clearing overlay.

- [ ] **Step 2: Write the ADR.** Title: `# 0006. Credential-blind multi-account auth`. Center the subscription-not-API invariant + the ambient-token trap as the durable *why*.

- [ ] **Step 3: Add to the ADR index.**

```markdown
- [0006](0006-multi-account-auth.md) — Credential-blind multi-account (subscription) auth
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+1.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0006-multi-account-auth.md docs/adr/README.md
git commit -m "docs: record credential-blind multi-account auth"
```

---

### Task 7: ADR 0007 — Console design system + reversals

**Files:**
- Create: `docs/adr/0007-console-design-system.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: console-foundation-design + the chat/rich-tool-card specs; the shipped `packages/console-ui` + `apps/desktop`.
- Produces: the *why* home UI.md points at (Task 9) instead of the console-foundation spec.

**Substance to capture (seed):**
- **Three-tier token system** + the **component-family / typed `intent`-block contract** (Intent / Use-it-when / Don't / Anatomy / Variants & States / Accessibility / Related), lint-enforced, compiled into the generated `COMPONENTS.md`.
- **Layout architecture** (panel registry + versioned console-local `LayoutDescriptor`, drop-unknown/never-throw; imperative `LayoutEngine` port) and the **visual direction** lock (warm-dark "forge", brass accent).
- **The virtualization reversal** (durable *why*): the 2026-07-04 chat rebuild reversed the two prior chat specs (both pinned `react-virtuoso`) — `Transcript` now renders **every** frame (`content-visibility:auto`, native scroll), because full-transcript text selection + in-page Ctrl-F both require every row present. Virtualization is no longer the default for this surface.
- **The single `DenyNotice` channel**: the only surface that renders a block, and it renders **only** a daemon-issued block (close-gate / cost-cap) — never invents one (SC-1 at the GUI).
- `coa raw` is sacred (D85 at the GUI); catalogue-only byte-faithful (the GUI is a second *client*, not a second source of truth).
- **Exact token values are NOT copied here** — they live in `console-ui` code; this ADR holds the *why*.

- [ ] **Step 1: Verify against code.**

Run: `rg -n "content-visibility|virtuoso" packages/console-ui/src | head` — Expected: `content-visibility` in Transcript; confirm `react-virtuoso` is not the transcript default (dep may be removed — cross-check `package.json`).
Run: `rg -n "DenyNotice" packages/console-ui/src | head` — Expected: the single deny member.
Run: `ls packages/console-ui/COMPONENTS.md packages/console-ui/src/tokens 2>/dev/null` — confirm the token + components catalogue exist.

- [ ] **Step 2: Write the ADR.** Title: `# 0007. Console design system`. Capture the token/component/layout/visual system + the two reversals (virtualization, single deny channel) as the durable design decisions. Note it is the authority UI.md cites for *why*.

- [ ] **Step 3: Add to the ADR index.**

```markdown
- [0007](0007-console-design-system.md) — Console design system + reversals
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+1.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0007-console-design-system.md docs/adr/README.md
git commit -m "docs: record console design system decisions"
```

---

### Task 8: ADRs 0008 + 0009 — Strict-superset (D85) and single deny channel (SC-1)

**Files:**
- Create: `docs/adr/0008-strict-superset.md`, `docs/adr/0009-single-deny-channel.md`
- Modify: `docs/adr/README.md`

**Interfaces:**
- Consumes: the Constitution (AGENTS.md) + SPEC §B; the shipped M3 close-gate + M7 cost-cap + M9 deny channel.
- Produces: the *why* the Constitution can cite for its two most-load-bearing invariants.

These are **small** ADRs — a Y-statement plus 2–3 lines of consequence each. They record the *why* behind invariants already stated (not trapped) in the Constitution, so the Constitution has a durable reason to point at.

**0008 seed (Y-statement):** *In the context of a governance layer that must never be worse than the raw loop, facing the risk that added features degrade the agent, we adopt **strict-superset (D85)** — every feature adds value or degrades to a literal pass-through, and `coa raw` always shows the unfiltered loop — to guarantee coa-with-a-feature-off ≤ the raw loop, accepting that every feature must carry a pass-through/off path.*

**0009 seed (Y-statement):** *In the context of "help, never cage," facing the temptation to add blocks throughout the system, we decided the **only two blocks are M3's Type-1 close-gate and M7's cost-cap, both issued through M9's single deny channel (SC-1)** — everything else is advisory or surfacing — to keep the agent uncaged and make every block auditable at one seam, accepting that no other module may deny.*

- [ ] **Step 1: Verify the invariants against code.**

Run: `rg -n "deny|close-gate|cost.?cap|SC-1" packages/core/src --glob '!*.test.ts' | head` — confirm the two blocks + single channel exist as described; adjust wording to the shipped seam names.

- [ ] **Step 2: Write both ADRs** in the short Y-statement form (Context/problem, Decision as the Y-statement, a 2–3 line Consequences). Titles: `# 0008. Strict-superset (feature-off ≤ raw loop)` and `# 0009. Exactly two blocks through a single deny channel`.

- [ ] **Step 3: Add both to the ADR index.**

```markdown
- [0008](0008-strict-superset.md) — Strict-superset: feature-off ≤ the raw loop
- [0009](0009-single-deny-channel.md) — Exactly two blocks through one deny channel (SC-1)
```

- [ ] **Step 4: Run `pnpm docs:check`.** Expected: OK, N+2.

- [ ] **Step 5: Commit.**

```bash
git add docs/adr/0008-strict-superset.md docs/adr/0009-single-deny-channel.md docs/adr/README.md
git commit -m "docs: record strict-superset and single-deny-channel rationale"
```

---

### Task 9: UI.md graduation — break the console-spec dependency, keep the strictness

**Files:**
- Modify: `docs/UI.md`

**Interfaces:**
- Consumes: ADR 0007 (Task 7) — must exist first.

**Goal:** `UI.md` stops citing `console-frontend-foundation-design.md` as "the authority," carries the design-system **structure** itself, and points to **code** for exact values + **ADR-0007** for the *why*. **Preserve every binding rule; cut only redundancy + drift.** UI strictness is load-bearing.

- [ ] **Step 1: Inventory the binding rules currently in UI.md.** Read `docs/UI.md`. List every standing principle (control-through-catalogue, `coa raw` sacred, catalogue-only byte-faithful, component-kit-with-intent, accessibility floor, honest surfacing CF-1) and every authoring rule (build-from-the-kit, no-raw-values, density-driven sizing, feedback contract, the two Electron gotchas, the virtualization reversal note). These ALL stay.

- [ ] **Step 2: Replace the spec-authority header.** The top blockquote currently says the console-foundation spec "is the authority for the GUI's look and structure." Rewrite it to: UI.md is the standing authority for the GUI's principles + authoring rules; the design system's *structure* (token tiers, component families, layout architecture, visual direction) is summarized here; **exact token values live in `packages/console-ui` (`src/theme.css`, `src/tokens/`, the generated `COMPONENTS.md`)**; the durable *why*/reversals are **ADR-0007** (`docs/adr/0007-console-design-system.md`). Do NOT reference the superpowers spec.

- [ ] **Step 3: Fold in just enough structure to stand alone.** Where UI.md previously deferred to "§6 tokens / §7 families / §23 as-built" of the spec, replace those pointers with a 1–2 line in-doc summary of each (the token *tiers* exist and are named in `tokens/semantic.ts`; the component *families* are catalogued in `COMPONENTS.md`; the visual direction is warm-dark "forge"/brass) + the code/ADR pointers from Step 2. No 61k copy-in.

- [ ] **Step 4: Remove only redundancy + drift.** Delete the superpowers-spec citations and any wording current code contradicts (verify the virtualization note still matches `console-ui`). Keep every rule from Step 1 verbatim in substance.

- [ ] **Step 5: Verify strictness intact + gate.** Re-read the edited `UI.md`; confirm every Step-1 rule is still present. Then:

Run: `pnpm docs:check`
Expected: OK — and no dead link to the (still-present) superpowers spec remains from UI.md (grep to confirm):
Run: `rg -n "superpowers/specs" docs/UI.md` — Expected: no matches.

- [ ] **Step 6: Commit.**

```bash
git add docs/UI.md
git commit -m "docs: make the UI doc self-authoritative, cite code and the ADR"
```

---

### Task 10: ADR-README tone softening + final Plan-A gate

**Files:**
- Modify: `docs/adr/README.md`

**Goal:** Soften the "permanent home / immutable law / source of truth" framing toward "shared reference / current best understanding / decision history you supersede rather than rewrite," **without changing the immutability mechanic** (supersede, don't rewrite) or the format rules. (ROADMAP re-toning is Plan B, with the roadmap-forward pass.)

- [ ] **Step 1: Re-tone the README prose.** In `docs/adr/README.md`, soften the opening ("Durable **why**… the permanent home for decisions") and the immutability line to read as decision *history* you supersede, not law. Keep every mechanical rule (immutable-once-accepted = supersede not rewrite, filename, status lifecycle, link-from-code, template) intact.

- [ ] **Step 2: Verify the mechanic survived.** Re-read; confirm the supersede-don't-rewrite rule, the filename rule, and the template are all still present and unchanged in substance.

- [ ] **Step 3: Final Plan-A gate.**

Run: `pnpm docs:check`
Expected: `docs-check OK` with all nine new ADRs (0002–0009 is eight files + the index) reachable, no dead links.
Run: `git status --short`
Expected: only intended files touched; `DEV-NOTES.md` still shows `M` (untouched WIP), never staged.

- [ ] **Step 4: Commit.**

```bash
git add docs/adr/README.md
git commit -m "docs: soften ADR framing toward shared reference"
```

---

## Self-Review (completed by author)

- **Spec coverage:** manifest (design §3) → Task 1; ADRs 0002–0009 (design §4.1) → Tasks 2–8; UI.md graduation (design §5.4, G6) → Task 9; ADR-README tone (design §6, G2) → Task 10. ROADMAP re-toning + the SPEC split/reframe are **Plan B** (out of scope here, by design). ✔
- **Placeholder scan:** each ADR task carries a concrete substance seed + code-verification commands + exact index line + gate + commit — no "TBD"/"add appropriate…". Final ADR prose is drafted-then-verified by the executor (the judgment *what-to-capture* is fixed in the seed). ✔
- **Type/name consistency:** ADR filenames match their index lines; ADR numbers 0002–0009 are sequential and unique; every task adds its file to `docs/adr/README.md` and runs `docs:check`. ✔
- **Ordering:** Task 9 (UI.md) depends on Task 7 (ADR-0007) — sequenced after it. Task 1 (manifest) first so later tasks pull rows. ✔

---

_Last reviewed: 2026-07-06_

# Graduation Plan B — SPEC per-module split + tri-backend reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 3,157-line flat `SPEC.md` into a ~200-line index over `docs/design/handoff/spec/M0..M10.md`, land the multi-backend truth in the module files, and correct the false "Claude-locked / one backend" framing consistently across `SPEC.md`, `DESIGN.md`, `AGENTS.md`, and `README.md` — plus soften the ROADMAP's forward-looking tone. Docs-only, no product-code change.

**Architecture:** Second of two graduation plans (design: [`docs/superpowers/specs/2026-07-06-coa-graduation-design.md`](../specs/2026-07-06-coa-graduation-design.md) §5). Plan A (manifest + ADRs 0002–0009 + UI.md) is done and merged. Per G3, post-SPEC capabilities (tri-backend adapters, auth, base/web tools) land as **subsections of the owning module file**, not new module numbers; the durable *why* already lives in the ADRs, so the module files carry the *what* and cross-link the ADRs.

**Tech Stack:** Markdown; `pnpm docs:check` (`scripts/docs-check.mjs`) is the reachability/dead-link gate; `git`. No product code.

## Global Constraints

- **Docs-only. No product-code or behavior change.**
- **Content preservation is the top risk of the split.** No owned decision may be lost when moving a module section out of `SPEC.md`. Move section bodies **verbatim** first (Task 1), edit second (Task 3) — never both in one step.
- **Verify facts against CURRENT code**, never a report/memory. The shipped M9 is **five packages**: `spi` + `loop-driver` + `adapter-claude-sdk` + `adapter-deepseek` + `adapter-longcat` (confirm in `packages/`; also stated correctly in `docs/REPO_LAYOUT.md:63` — mirror that, not the stale `SPEC.md` §A.4 which still says `spi` + `adapter-claude-sdk`).
- **`pnpm docs:check` MUST stay green** after every task. The new `spec/M0..M10.md` files are in the indexed set (only `docs/superpowers`, `docs/design/research`, `docs/archive`, `DEV-NOTES.md` are excluded), so **every module file MUST be reachable via a link from the reduced `SPEC.md` index** (which is itself reached from the `AGENTS.md` router), and must contain no dead links.
- **The reframe is one synchronized pass (Task 4), not per-doc drift.** The exact target phrase replaces **"Claude-locked (one backend, behind a swappable port)"**: `SPEC.md:15-16`, `README.md:6`, `docs/DESIGN.md:27`, `AGENTS.md:6`. Grep all four before and after.
- **`DEV-NOTES.md` is the maintainer's dirty WIP — never stage or edit it.** Stage files **by name**; never `git add -A`.
- **`AGENTS.md` stays under ~200 lines.**
- **Commits:** subject-only Conventional Commits — no body, no trailers, **no module IDs / decision codes / plan numbers in the subject.** One logical unit per commit.
- **Module section boundaries in the current `SPEC.md`** (verify by header before slicing — line numbers may drift): `### M0 —` L197 · `### M1 —` L467 · `### M2 —` L851 · `### M3 —` L936 · `### M4 —` L1197 · `### M5 —` L1690 · `### M6 —` L1975 · `### M7 —` L2133 · `### M8 —` L2323 · `### M9 —` L2591 · `### M10 —` L2792 · EOF L3157. The front matter to keep as the index = L1–L196 (header · "What coa is" · "How to read" · §A module map A.1–A.4 · §B invariants · §C intro).

---

### Task 1: Extract the eleven module sections into `spec/M0..M10.md` (verbatim)

**Files:**
- Create: `docs/design/handoff/spec/M0.md` … `docs/design/handoff/spec/M10.md` (11 files)
- (Do NOT modify `SPEC.md` in this task.)

**Interfaces:**
- Produces: eleven module files whose bodies are the byte-for-byte current `SPEC.md` module sections, so Task 2 can replace those sections with links and Task 3 can edit the files.

- [ ] **Step 1: Confirm the section boundaries.** In `docs/design/handoff/SPEC.md`, grep the eleven `### M` headers and note each section's start line and the next section's start (the last, M10, runs to EOF):

Run: `rg -n "^### M[0-9]+ — " docs/design/handoff/SPEC.md`
Expected: 11 lines, M0…M10 in order.

- [ ] **Step 2: Create each module file with a header, the verbatim section body, and a footer.** For each module Mx, create `docs/design/handoff/spec/Mx.md` containing:
  - A top line: `# Mx — <the section's title text>` (e.g. `# M0 — Shared Schema (\`shared\`)`), taken from the `### Mx — …` heading.
  - Then the **verbatim** body of that module's section from `SPEC.md` (everything from just after the `### Mx —` heading up to — but not including — the next `### M` heading; for M10, to EOF). Preserve every sub-heading, table, list, and decision line exactly. Demote nothing except that the top `###` becomes the file's `#` title.
  - A blank line then the footer: `_Last reviewed: 2026-07-06_`.

  Do this per file (M0 through M10). Use the actual file content — copy from `SPEC.md`; do not paraphrase or summarize a single line.

- [ ] **Step 3: Verify no content was lost (the critical check).** Concatenate the eleven module-file bodies (strip each file's added `#` title line and `_Last reviewed_` footer) and compare against the original `SPEC.md` module span (L197–EOF). A practical check:

Run (adjust the boundary line to the real `### M0 —` line from Step 1): `awk 'NR>=197' docs/design/handoff/SPEC.md | rg -c "^#### |^### |^\| "` — record the count of sub-headings + table rows in the original module span.
Then run the same class of count across the eleven files: `cat docs/design/handoff/spec/M*.md | rg -c "^#### |^### |^\| "`.
Expected: the second count ≥ the first (the files add only the 11 `#` titles + footers; every original `####`/`###`/table row must survive). If the module-body count is short, a section was truncated — fix before committing.
Also spot-check three high-value owned decisions survive: `rg -n "SC-1|D85|D121|D109" docs/design/handoff/spec/*.md | head` — expect hits in the relevant module files.

- [ ] **Step 4: Commit.**

```bash
git add docs/design/handoff/spec/M0.md docs/design/handoff/spec/M1.md docs/design/handoff/spec/M2.md docs/design/handoff/spec/M3.md docs/design/handoff/spec/M4.md docs/design/handoff/spec/M5.md docs/design/handoff/spec/M6.md docs/design/handoff/spec/M7.md docs/design/handoff/spec/M8.md docs/design/handoff/spec/M9.md docs/design/handoff/spec/M10.md
git commit -m "docs: extract per-module spec files from the flat spec"
```

Note: `docs:check` is **not** expected green yet — the new files are orphans until Task 2 links them from the index. That is fine within this task; Task 2 closes it. (If you prefer a green tree at every commit, you may combine Tasks 1 and 2 into one commit — but keep the verbatim-extract and the index-reduction as separate *steps* so the content-preservation check in Step 3 runs against an unedited SPEC.)

---

### Task 2: Reduce `SPEC.md` to the ~200-line index

**Files:**
- Modify: `docs/design/handoff/SPEC.md` (delete the module-section bodies L197–EOF; replace §C with a linked index)
- Modify (optional, same-commit doc rule): `docs/REPO_LAYOUT.md` — the `design/handoff/` line may note the new `spec/` subdirectory.

**Interfaces:**
- Consumes: the eleven files from Task 1.
- Produces: a ~200-line `SPEC.md` index that links every module file (satisfying `docs:check` reachability).

- [ ] **Step 1: Keep the front matter, drop the bodies.** Preserve `SPEC.md` L1–L190 (header, "What coa is" — leave its wording VERBATIM for now; Task 4 reframes it, "How to read this doc set", §A module map A.1–A.4, §B invariants). Delete everything from `### M0 —` (L197) to EOF.

- [ ] **Step 2: Rewrite §C as a linked index.** Replace the §C section (`## §C. The module specifications` + its intro) with an index that links each module file. Keep the one-line intro, then a table:

```markdown
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
```

- [ ] **Step 3: Update the "How to read" bullet** for `SPEC.md` so it describes the new shape — from "the eleven modules M0–M10, each with its section" to "a module map + dependency graph + cross-cutting invariants, indexing one file per module under `spec/`." (One-line edit; do not rewrite the section.)

- [ ] **Step 4: (Optional) REPO_LAYOUT note.** If `docs/REPO_LAYOUT.md`'s `design/handoff/` line lists the handoff files, extend it to note `SPEC.md` is now an index over `spec/M0..M10.md`. Skip if it doesn't enumerate them.

- [ ] **Step 5: Gate.**

Run: `wc -l docs/design/handoff/SPEC.md`
Expected: roughly 190–230 lines (index only; no module bodies).
Run: `rg -n "^### M[0-9]+ — " docs/design/handoff/SPEC.md`
Expected: no matches (the module sections are gone).
Run: `pnpm docs:check`
Expected: `docs-check OK — N docs, all reachable, no dead links.` (N grows by 11.) If any `spec/Mx.md` is reported as an orphan, the index link is missing/mistyped — fix.

- [ ] **Step 6: Commit.**

```bash
git add docs/design/handoff/SPEC.md docs/REPO_LAYOUT.md
git commit -m "docs: reduce the spec to a per-module index"
```

(If REPO_LAYOUT was not changed, omit it from the `git add`.)

---

### Task 3: Land the multi-backend / auth / tools truth in the module files + package map

**Files:**
- Modify: `docs/design/handoff/spec/M9.md`, `docs/design/handoff/spec/M6.md`, `docs/design/handoff/spec/M7.md`, `docs/design/handoff/spec/M8.md`, and `docs/design/handoff/SPEC.md` (§A.4 package map + any §A M9 title text).

**Interfaces:**
- Consumes: the module files (Task 1) + the reduced index (Task 2) + ADRs 0002/0004/0005/0006 (Plan A).

The current SPEC predates the tri-backend / auth / base-web-tools work, so the module files describe only the Claude adapter and lack these capabilities. Add **concise subsections** stating the current *what* and cross-linking the ADR for the *why*. Do not restate the ADRs — point to them.

- [ ] **Step 1: Verify the shipped shape.**

Run: `ls packages/spi packages/loop-driver packages/adapter-claude-sdk packages/adapter-deepseek packages/adapter-longcat`
Expected: all five exist.
Run: `rg -n "M9 Runtime Adapter" docs/REPO_LAYOUT.md`
Expected: the current 5-package physical-home line (mirror its wording, do not invent).

- [ ] **Step 2: Fix the stale M9 identity in the index.** In `docs/design/handoff/SPEC.md`:
  - §A.1 / §A.4: change M9's physical home from `spi` + `adapter-claude-sdk` to the five-package family (`spi` ports + `loop-driver` shared pure-API driver + `adapter-claude-sdk` + `adapter-deepseek` + `adapter-longcat`), mirroring `REPO_LAYOUT.md:63`.
  - Any `spi + adapter-claude-sdk` parenthetical in the §A tables → the five-package form.

- [ ] **Step 3: Fix the M9 file title + add the tri-backend subsection.** In `docs/design/handoff/spec/M9.md`:
  - Title: `# M9 — Runtime Adapter (\`spi\` + \`loop-driver\` + \`adapter-claude-sdk\` + \`adapter-deepseek\` + \`adapter-longcat\`)`.
  - Add a short subsection: **the tri-backend adapter family** — the fat Claude SDK adapter vs the thin pure-API adapters (DeepSeek, LongCat) over the shared `complete()` primitive + `@coa/loop-driver`; the app-side `createAdapter` switches on `ModelSelection.provider`; unknown provider → an SC-1 error frame. Add **the auth env-overlay** (`resolveAuthEnv` clears the API/auth-token + ambient OAuth-token vars per non-ambient account). One paragraph each; cross-link `see docs/adr/0002` (architecture), `docs/adr/0004` (layer-on-native), `docs/adr/0006` (auth).

- [ ] **Step 4: M6 file — base/web-tools subsection.** In `docs/design/handoff/spec/M6.md`, add a short subsection: the six base tools (`Read`/`Glob`/`Grep`/`Write`/`Edit`/`Bash`) + `WebSearch`/`WebFetch`, offered only on the pure-API path via the composition backend gate (`includeBaseTools`/`includeWebTools`); the `read|write|exec|egress` group tags; Bash as the named S-2 deviation. Cross-link `see docs/adr/0005`.

- [ ] **Step 5: M7 file — per-account ledger attribution.** In `docs/design/handoff/spec/M7.md`, add a line/short subsection: a session records which account label it ran under; `M7.record` attributes spend to that label (rides existing session-start metadata, no new event type). Cross-link `see docs/adr/0006`.

- [ ] **Step 6: M8 file — both-backends-identical note.** In `docs/design/handoff/spec/M8.md`, add a line: `createSession` calls the same M9 port methods in the same order regardless of backend; everything backend-specific lives inside the adapter. Cross-link `see docs/adr/0002`.

- [ ] **Step 7: Gate.**

Run: `rg -n "adapter-deepseek|adapter-longcat|loop-driver" docs/design/handoff/SPEC.md docs/design/handoff/spec/M9.md`
Expected: the five-package family present in both the index map and the M9 file title/subsection.
Run: `rg -n "docs/adr/000" docs/design/handoff/spec/M6.md docs/design/handoff/spec/M7.md docs/design/handoff/spec/M8.md docs/design/handoff/spec/M9.md`
Expected: the ADR cross-links present.
Run: `pnpm docs:check`
Expected: OK, no dead links (the `docs/adr/000N` references are `// see`-style prose pointers, not markdown links — if you wrote any as markdown links, ensure the target file exists so the link isn't dead).

- [ ] **Step 8: Commit.**

```bash
git add docs/design/handoff/SPEC.md docs/design/handoff/spec/M9.md docs/design/handoff/spec/M6.md docs/design/handoff/spec/M7.md docs/design/handoff/spec/M8.md
git commit -m "docs: land the multi-backend and auth truth in the module specs"
```

---

### Task 4: The synchronized "Claude-primary" reframe across four docs

**Files:**
- Modify: `docs/design/handoff/SPEC.md`, `README.md`, `docs/DESIGN.md`, `AGENTS.md`.

**Interfaces:**
- Consumes: nothing new; this is a wording pass. Do all four in ONE commit so the framing can never drift between docs again.

- [ ] **Step 1: Locate every instance first.**

Run: `rg -n "Claude-locked|one backend, behind a swappable port|Claude-locked \(one backend" SPEC.md README.md docs/DESIGN.md AGENTS.md docs/design/handoff/SPEC.md`
Expected: one hit each in `docs/design/handoff/SPEC.md` (~L15), `README.md:6`, `docs/DESIGN.md:27`, `AGENTS.md:6`.

- [ ] **Step 2: Replace with the reframed phrasing** in all four, preserving each sentence's surrounding structure. Replace **"Claude-locked (one backend, behind a swappable port)"** with:

> **Claude-primary, provider-swappable via the M9 port** — Claude (the Agent SDK) is the default, highest-fidelity backend, but the rented loop is swappable behind the one M9 seam; thin pure-API adapters (DeepSeek, LongCat) ship today.

  Adjust tense/punctuation to fit each host sentence (e.g. `README.md:6` reads "v1 is **attended** … and **Claude-locked** (one backend, behind a swappable port)." → "v1 is **attended** … and **Claude-primary** — Claude is the default backend, with the loop swappable behind the one M9 port (DeepSeek and LongCat adapters ship today)."). Keep it a phrase-level swap; do not rewrite the paragraphs.

- [ ] **Step 3: (Optional micro-fix) the `[PLANNED]` tag.** `docs/design/handoff/SPEC.md`'s "What coa is" opens `coa is a [PLANNED] **local-first…**`. If this is a stale editing annotation (it reads as one), drop `[PLANNED] `. If uncertain whether it is load-bearing status, leave it and note it in the report.

- [ ] **Step 4: Gate.**

Run: `rg -n "Claude-locked|one backend" SPEC.md README.md docs/DESIGN.md AGENTS.md docs/design/handoff/SPEC.md`
Expected: **no matches** (the old framing is fully gone).
Run: `wc -l AGENTS.md`
Expected: < 200 lines.
Run: `pnpm docs:check`
Expected: OK, no dead links.

- [ ] **Step 5: Commit.**

```bash
git add docs/design/handoff/SPEC.md README.md docs/DESIGN.md AGENTS.md
git commit -m "docs: reframe backend stance to Claude-primary, provider-swappable"
```

---

### Task 5: ROADMAP tone pass — possibilities, not law

**Files:**
- Modify: `ROADMAP.md`.

**Goal (maintainer intent, 2026-07-06):** the forward-looking sections should read as a **menu of possibilities / candidate directions**, not a committed backlog; the header's "single source" framing softens to "shared reference." The **module status table stays factual** (it mirrors code), the same-commit mechanic stays, and the Constitution stays firm — only the tone of the roadmap-forward softens.

- [ ] **Step 1: Soften the header.** `ROADMAP.md`'s opening ("Single source for **where the project is and what's left.**") → a "shared reference for where the project is and the directions open from here" framing. Keep the "update in the same commit" mechanic line unchanged.

- [ ] **Step 2: Re-tone "Remaining work (keystones first)".** Drop the imperative "Two items gate the most other work and should be picked up first" register; reframe as "Two items, if picked up, unblock the most other work" — keep the dependency *facts* (R-12 unblocks live surfacing; the L-ASM gate precedes M4 depth) but present the list as candidate directions, not obligations. Keep the `[S]/[M]/[L]` size tags (they're information, not commitment). Do not delete any item.

- [ ] **Step 3: Verify facts preserved.** Re-read `ROADMAP.md`. Confirm: the module status table is unchanged; every remaining-work item (A–J + keystones + Coa-agent hardening) still present; the dependency facts intact; only the imperative tone softened.

- [ ] **Step 4: Gate.**

Run: `pnpm docs:check`
Expected: OK, no dead links.
Run: `git status --short`
Expected: only `ROADMAP.md` staged; `DEV-NOTES.md` still `M` (untouched).

- [ ] **Step 5: Commit.**

```bash
git add ROADMAP.md
git commit -m "docs: frame the roadmap forward as possibilities, not a backlog"
```

---

## Self-Review (completed by author)

- **Spec coverage:** SPEC split → Tasks 1–2 (design §5.1); tri-backend/auth/tools subsections + §A.4 package map (G3, design §5.1) → Task 3; the 4-doc synchronized reframe (design §5.2) → Task 4; the canonical "What coa is" home (design §5.3) → its reframe lands in Task 4, and the ~30-copy de-dup is explicitly Phase-3 residue per the manifest (not this plan); ROADMAP tone (G2, design §6) → Task 5. ✔
- **Placeholder scan:** each task has concrete file paths, the exact index table + reframe phrasing, exact grep/`wc`/`docs:check` gates, and a named content-preservation check for the risky split — no "TBD"/"handle appropriately". ✔
- **Consistency:** module file paths (`docs/design/handoff/spec/M0..M10.md`) are identical across Tasks 1/2/3; the five-package M9 wording is defined once (mirror `REPO_LAYOUT.md:63`) and reused; the reframe phrase is defined once in Task 4. ✔
- **Ordering:** Task 1 (verbatim extract) strictly precedes Task 2 (reduce), which precedes Task 3 (edit the files) — preserving the "move verbatim, then edit" safety rule. Task 4/5 are independent wording passes. ✔

---

_Last reviewed: 2026-07-06_

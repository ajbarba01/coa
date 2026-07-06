# De-drift Cleanup + Doc-System Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove tree junk + stale comments, stand up the new doc-system skeleton (`docs/adr/` + conventions + a docs-check script), and author the consolidated in-repo `ROADMAP.md` — the visible foundation the later graduation plan builds on.

**Architecture:** Two blocks. (A) Housekeeping — delete confirmed-junk files, relocate one durable reference, drop an orphan module/dep, rewrite phase-numbered comments. (B) Scaffolding — create the immutable-ADR directory + process (dogfooded with ADR-0001), codify anti-drift conventions, add a runnable router/orphan + dead-link checker, and author `ROADMAP.md` + `docs/BACKLOG.md` from the approved design spec's appendices.

**Tech Stack:** Node ESM script (no new deps), Markdown, pnpm workspaces, Vitest (existing suites only — this plan adds no product code).

## Global Constraints

- **Commit messages: subject-line only.** Conventional Commits; **no body, no `Co-Authored-By`, no "Generated with" trailer**; no phase numbers / plan codenames / module IDs in the subject.
- **Stage files by name** (never `git add -A`). Single `main` branch. Commit only after the task's verification step passes.
- **Scope = docs + comments + junk + safe moves.** No product-behavior or interface changes in this plan.
- **Verify against current code, not against reports** — including this plan's own claims. Two audit findings were already stale; a third (a "test bug") did not exist. If a step's premise doesn't match reality, stop and reconcile.
- **Source of truth for content:** the approved design spec `docs/design/handoff/…` → actually at `docs/superpowers/specs/2026-07-05-coa-dedrift-refactor-design.md` (Appendices A/B/C). Draw ROADMAP content from there.
- Docs carry a `_Last reviewed: YYYY-MM-DD_` footer.

---

### Task 1: Delete confirmed-junk files + close `.gitignore` gaps

Six untracked files are build/redirect scratch with no value (verified: the two mangled files are shell-redirect artifacts, not written by any test — every `writeFileSync` in `packages/` uses a temp-dir `join(root, …)`).

**Files:**
- Delete (untracked): `test-out.txt`, `vm-out.txt`, `vm-test-out.txt`, `TEMP.md`, `packages/console-viewmodel/C:UsersMEcoavm-test.txt`, `packages/console-viewmodel/C:UsersMEcoavm-test2.txt`
- Modify: `.gitignore`

> `LOCAL.md`, `DEV-NOTES.md`, and `harness-system-prompt.md` are handled in Tasks 2 and 8 — **do not delete them here.**

- [ ] **Step 1: Confirm the targets are untracked and junk**

Run:
```bash
git status --porcelain -- test-out.txt vm-out.txt vm-test-out.txt TEMP.md
ls -la packages/console-viewmodel/ | grep -i vm-test
```
Expected: the four root files show as `??` (untracked); the two mangled files exist under `console-viewmodel`.

- [ ] **Step 2: Delete the six files**

Run (the mangled names contain a private-use char; the glob avoids typing it):
```bash
cd "c:/Users/Zander/Documents/Side Projects/coa"
rm -f test-out.txt vm-out.txt vm-test-out.txt TEMP.md
rm -f packages/console-viewmodel/*vm-test*.txt
```

- [ ] **Step 3: Verify deletion**

Run: `git status --porcelain | grep -Ei 'test-out|vm-out|vm-test|TEMP.md'`
Expected: no output.

- [ ] **Step 4: Close the `.gitignore` gaps**

Append to `.gitignore` (so redirect dumps and scratch never accumulate again):
```gitignore

# Scratch / redirect dumps (never committed — see AGENTS.md: scratch → scratchpad)
*-out.txt
test-out.txt
/TEMP.md
/LOCAL.md
```

- [ ] **Step 5: Verify the ignore rules bite**

Run: `git check-ignore vm-out.txt test-out.txt TEMP.md LOCAL.md`
Expected: all four echoed back (each is now ignored).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: remove tree scratch and ignore redirect dumps"
```
(The deletions of untracked files need no staging; only `.gitignore` is tracked.)

---

### Task 2: Relocate the Claude Code prompt reference (durable, not junk)

`harness-system-prompt.md` is a captured Claude Code system prompt used as the parity reference for the later prompt-mirroring work, and it is already cited by a research doc via a broken relative path (it's untracked, so a fresh clone can't follow the link). Make it a tracked reference and fix the citation.

**Files:**
- Move: `harness-system-prompt.md` → `docs/design/research/harness-system-prompt-claude-code.md`
- Modify: `docs/design/research/pieces-phase-claude-code-baseline.md` (the relative link at ~line 8)

- [ ] **Step 1: Find the citation**

Run: `grep -rn "harness-system-prompt" docs/`
Expected: at least one hit in `pieces-phase-claude-code-baseline.md` (a `../../../harness-system-prompt.md` style link).

- [ ] **Step 2: Move the file into tracked research docs**

Run:
```bash
git mv harness-system-prompt.md docs/design/research/harness-system-prompt-claude-code.md 2>/dev/null || mv harness-system-prompt.md docs/design/research/harness-system-prompt-claude-code.md
```
(It's untracked, so `git mv` will fall through to a plain `mv`.)

- [ ] **Step 3: Fix the citation**

In `docs/design/research/pieces-phase-claude-code-baseline.md`, replace the relative path pointing at the old root location with the sibling filename `harness-system-prompt-claude-code.md` (same directory now). Verify by reading the surrounding line and matching the link text.

- [ ] **Step 4: Verify no other reference dangles**

Run: `grep -rn "harness-system-prompt" . --include="*.md" | grep -v "harness-system-prompt-claude-code"`
Expected: no output (every reference now uses the new name).

- [ ] **Step 5: Commit**

```bash
git add docs/design/research/harness-system-prompt-claude-code.md docs/design/research/pieces-phase-claude-code-baseline.md
git commit -m "docs: track the Claude Code prompt reference under research"
```

---

### Task 3: Remove the orphan transcript-group module + unused dep

`packages/console-ui/src/dense/group.ts` is imported only by its own test (confirmed orphan, already earmarked in `REPO_LAYOUT.md`), and `react-virtuoso` is no longer imported anywhere after the virtualization reversal.

**Files:**
- Delete: `packages/console-ui/src/dense/group.ts`, `packages/console-ui/src/dense/group.test.ts`
- Modify: `packages/console-ui/package.json` (remove `react-virtuoso` dependency), `REPO_LAYOUT.md` (drop the now-resolved follow-up callouts)

- [ ] **Step 1: Verify `group.ts` is orphaned**

Run: `grep -rn "dense/group\|from './group'\|from \"./group\"" packages/console-ui/src | grep -v group.test`
Expected: no output (nothing but the test imports it).

- [ ] **Step 2: Verify `react-virtuoso` is unused**

Run: `grep -rn "react-virtuoso" packages/console-ui/src`
Expected: no output.

- [ ] **Step 3: Delete the orphan module + test**

Run:
```bash
git rm packages/console-ui/src/dense/group.ts packages/console-ui/src/dense/group.test.ts
```

- [ ] **Step 4: Drop the dependency**

Remove the `"react-virtuoso": "…"` line from `packages/console-ui/package.json` dependencies. Then refresh the lockfile:
```bash
pnpm install
```
Expected: install succeeds; `react-virtuoso` removed from `pnpm-lock.yaml`.

- [ ] **Step 5: Update `REPO_LAYOUT.md`**

Remove the two follow-up callouts (the orphan-`group.ts` note ~line 28 and the held-back `react-virtuoso` drop ~lines 108–110), since both are now done. Update its `_Last reviewed_` footer to today.

- [ ] **Step 6: Verify the package still builds and tests pass**

Run: `pnpm --filter @coa/console-ui test`
Expected: PASS, with the `group.test.ts` suite gone and no missing-module errors.

- [ ] **Step 7: Commit**

```bash
git add packages/console-ui/package.json pnpm-lock.yaml REPO_LAYOUT.md
git commit -m "chore: drop orphan transcript-group module and unused virtualization dep"
```

---

### Task 4: Rewrite the phase-numbered comments in `console.ts`

Four comments reference "Phase 1" of an old plan — the exact rot the constitution bans from code. Rewrite them to describe behavior; fix the doubled "to to".

**Files:**
- Modify: `apps/desktop/src/renderer/console.ts` (lines ~68, ~69, ~171, ~271)

- [ ] **Step 1: Read the four comment sites**

Run: `grep -n "Phase 1\|to to" apps/desktop/src/renderer/console.ts`
Expected: four "Phase 1" hits (~68, ~171, ~271, and the block header) + the "to to" typo (~69).

- [ ] **Step 2: Rewrite each to state *what the code does*, not a plan phase**

Replace the phase-numbered wording. Examples (match the surrounding style; the intent is behavior-not-phase):
- `// Agents (Phase 1 — console-local identity + launch selection persisting to` → `// Agents — console-local identity + launch selection, persisted to the per-user store`
- fix `// to to the per-user …` → `// to the per-user …`
- `// Agents are persisted (Phase 1). On bootstrap …` → `// Agents are persisted. On bootstrap …`
- `// ---- Agents (Phase 1 — console-local identity + launch selection, persisted to` → `// ---- Agents — console-local identity + launch selection, persisted`

- [ ] **Step 3: Verify no phase references remain in the file**

Run: `grep -n "Phase [0-9]\|to to" apps/desktop/src/renderer/console.ts`
Expected: no output.

- [ ] **Step 4: Verify the renderer still typechecks**

Run: `pnpm --filter @coa/desktop typecheck` (or the desktop package's typecheck script)
Expected: PASS (comments-only change; no type impact).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/console.ts
git commit -m "docs: describe agent-identity behavior instead of a plan phase in comments"
```

---

### Task 5: Create the ADR directory, process, and ADR-0001

Stand up `docs/adr/` (immutable MADR decisions) and dogfood it by capturing *this refactor's own* doc-system decision as ADR-0001.

**Files:**
- Create: `docs/adr/README.md`, `docs/adr/0001-consolidate-docs-into-router-adr-roadmap.md`

**Interfaces:**
- Produces: the ADR convention (filename `NNNN-kebab-title.md`, status lifecycle, immutability) that Task 6's WORKFLOW update and the later graduation plan both rely on.

- [ ] **Step 1: Write the ADR index + process**

Create `docs/adr/README.md`:
```markdown
# Architecture Decision Records

Durable **why**. Each ADR captures one architecturally-significant decision and the reasoning behind it, in [MADR](https://adr.github.io/madr/)-lite form. ADRs are the permanent home for decisions that outlive the plan that produced them.

## Rules
- **Immutable once `accepted`.** Only typo/link fixes thereafter. A changed decision is a *new* ADR that supersedes the old one (set the old one's status to `superseded by NNNN`).
- **Filename:** `NNNN-kebab-title.md`, zero-padded sequential.
- **Status lifecycle:** `proposed → accepted → (deprecated | superseded by NNNN)`.
- **Link from code** at the seam a decision governs: `// see docs/adr/NNNN`.
- **Small decisions** may use a one-line Y-statement: "In the context of X, facing Y, we decided Z, to achieve W, accepting V." Reserve the full template for larger decisions.

## Template
```
# NNNN. <title>

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD

## Context and problem
## Decision drivers
## Considered options
## Decision
## Consequences (good / bad)
```

## Index
- [0001](0001-consolidate-docs-into-router-adr-roadmap.md) — Consolidate project truth into router + ADRs + ROADMAP
```

- [ ] **Step 2: Write ADR-0001 (dogfood the format)**

Create `docs/adr/0001-consolidate-docs-into-router-adr-roadmap.md` capturing the approved design's core decision: durable *why* → ADRs; current *what* → `ROADMAP.md` (replacing private memory as authority); everything indexed from the `AGENTS.md` router; the `docs/superpowers/` graveyard graduated-then-deleted; SPEC split per-module. Use the template. Status `accepted`, Date today. In Consequences, note the tradeoff (more small files; a convention agents must follow) and that this supersedes the implicit "specs stay as decision records" rule in WORKFLOW.md (updated in Task 6).

- [ ] **Step 3: Verify the ADR files are well-formed**

Run: `ls docs/adr/ && grep -c "^## " docs/adr/0001-*.md`
Expected: both files listed; ADR-0001 has the template's section headers.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/README.md docs/adr/0001-consolidate-docs-into-router-adr-roadmap.md
git commit -m "docs: add architecture decision records with the doc-consolidation decision"
```

---

### Task 6: Codify the anti-drift conventions

Update the three framework docs so the new system is *the* documented process: ADR lifecycle in WORKFLOW, comment-hygiene + router-index rules in AGENTS.md, and last-reviewed footers on the handoff docs that currently escape the staleness tripwire.

**Files:**
- Modify: `docs/WORKFLOW.md` (doc-lifecycle section), `AGENTS.md` (operating rules), `docs/design/handoff/SPEC.md`, `docs/design/handoff/IMPL-SPEC-BRIEF.md`, `docs/design/handoff/OPEN.md` (add footers)

- [ ] **Step 1: Update WORKFLOW.md doc-lifecycle**

Rewrite the doc-lifecycle section so it reflects reality: **plans and specs under `docs/superpowers/` are transient**; durable decisions **graduate to `docs/adr/`** (immutable) and status **to `ROADMAP.md`**; the point-in-time artifact is then deleted (git history is the archive). Remove the promise of `plans/archive/`+`specs/archive/` dirs that never existed. Cross-link `docs/adr/README.md`.

- [ ] **Step 2: Add the comment-hygiene + router-index rules to AGENTS.md**

Under "Operating rules → Doc discipline", add two bullets:
```markdown
  - _Comment hygiene_ — code comments state **why**, not what; never reference plan phases or ticket IDs; link durable rationale to an ADR (`// see docs/adr/NNNN`).
  - _Router is the index_ — every `docs/**/*.md` (outside transient corpora) is reachable from this file's navigation table; run `pnpm docs:check` to verify.
```

- [ ] **Step 3: Add the ADR + ROADMAP rows to the AGENTS.md navigation table**

Add rows to the "Doc navigation" table:
```markdown
| [ROADMAP.md](ROADMAP.md)                                           | **Path forward** — module state + remaining work (single source; replaces private notes) | orienting on what's left / next |
| [docs/adr/](docs/adr/)                                             | **Architecture decisions** — immutable WHYs                                    | making/needing a durable decision |
```

- [ ] **Step 4: Add last-reviewed footers to the three handoff docs**

Append `\n---\n\n_Last reviewed: 2026-07-05_\n` to `SPEC.md`, `IMPL-SPEC-BRIEF.md`, and `OPEN.md` (they currently have only an in-body date and escape the >60-day tripwire). Update the AGENTS.md footer date to today.

- [ ] **Step 5: Verify**

Run: `grep -l "Last reviewed" docs/design/handoff/*.md`
Expected: all three handoff docs listed.

- [ ] **Step 6: Commit**

```bash
git add docs/WORKFLOW.md AGENTS.md docs/design/handoff/SPEC.md docs/design/handoff/IMPL-SPEC-BRIEF.md docs/design/handoff/OPEN.md
git commit -m "docs: adopt ADR lifecycle, comment-hygiene and router-index conventions"
```

---

### Task 7: Add the docs-check script (router/orphan + dead-link)

A single zero-dependency Node script that enforces the "strong index" mechanically: every curated doc reachable from the router, and no dead relative links. Scoped to the *permanent* doc set (transient `superpowers/` + `research/` + `archive/` are excluded — they're slated for graduation/deletion).

**Files:**
- Create: `scripts/docs-check.mjs`
- Modify: root `package.json` (add `docs:check` script)

**Interfaces:**
- Produces: `pnpm docs:check` — exits non-zero on any orphan or dead link. Task 8 relies on it going green.

- [ ] **Step 1: Write the script**

Create `scripts/docs-check.mjs`:
```javascript
#!/usr/bin/env node
// Router/orphan + dead-link check for the permanent doc set.
// Transient corpora (superpowers/research/archive) and personal notes are excluded.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY_POINTS = ['AGENTS.md', 'README.md']; // roots of the reachability graph
// Dir prefixes and exact files excluded from the indexed set (the `rel === ig` check handles exact files):
const IGNORE = ['docs/superpowers', 'docs/design/research', 'docs/archive', 'node_modules', 'DEV-NOTES.md'];
const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

const toPosix = (p) => relative(ROOT, p).split(sep).join('/');
const ignored = (p) => {
  const rel = toPosix(p);
  return IGNORE.some((ig) => rel === ig || rel.startsWith(ig + '/'));
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (ignored(p)) continue;
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.md')) acc.push(p);
  }
  return acc;
}

function localLinks(file) {
  const out = [];
  for (const m of readFileSync(file, 'utf8').matchAll(LINK_RE)) {
    let t = m[1].trim().split(/\s+/)[0];        // drop optional "title"
    if (/^(https?:|mailto:|#)/.test(t)) continue; // external / anchor-only
    t = t.split('#')[0];                          // strip anchor
    if (t) out.push(t);
  }
  return out;
}

const rootMd = readdirSync(ROOT).filter((n) => n.endsWith('.md')).map((n) => join(ROOT, n));
const docsMd = existsSync(join(ROOT, 'docs')) ? walk(join(ROOT, 'docs')) : [];
const allDocs = [...rootMd, ...docsMd].filter((p) => !ignored(p));

// Dead-link check
const deadLinks = [];
for (const file of allDocs) {
  for (const t of localLinks(file)) {
    if (!existsSync(resolve(dirname(file), t))) deadLinks.push(`${toPosix(file)} -> ${t}`);
  }
}

// Router/orphan check: BFS from entry points over in-repo .md links
const reachable = new Set();
const queue = ENTRY_POINTS.map((p) => join(ROOT, p));
while (queue.length) {
  const file = queue.shift();
  const key = resolve(file);
  if (reachable.has(key)) continue;
  reachable.add(key);
  if (!existsSync(file) || !file.endsWith('.md')) continue;
  for (const t of localLinks(file)) {
    const r = resolve(dirname(file), t);
    if (r.endsWith('.md') && existsSync(r) && !ignored(r)) queue.push(r);
  }
}
const orphans = allDocs.filter((p) => !reachable.has(resolve(p)));

let failed = false;
if (deadLinks.length) {
  failed = true;
  console.error(`\n✗ Dead links (${deadLinks.length}):`);
  deadLinks.forEach((d) => console.error(`  ${d}`));
}
if (orphans.length) {
  failed = true;
  console.error(`\n✗ Not reachable from the router (${orphans.length}):`);
  orphans.forEach((o) => console.error(`  ${toPosix(o)}`));
}
if (failed) { console.error('\ndocs-check FAILED\n'); process.exit(1); }
console.log(`docs-check OK — ${allDocs.length} docs, all reachable, no dead links.`);
```

- [ ] **Step 2: Wire the pnpm script**

In root `package.json`, add to `"scripts"`: `"docs:check": "node scripts/docs-check.mjs"`.

- [ ] **Step 3: Run it and read the report**

Run: `pnpm docs:check`
Expected: it runs. It will likely report orphans/dead-links (e.g. `ROADMAP.md` doesn't exist yet, or a curated doc links somewhere missing). That's the point — proceed to Step 4.

- [ ] **Step 4: Fix any *genuine* breakage it surfaces**

For each dead link in the **permanent** set, fix the link or the target. Do **not** silence real problems by widening `IGNORE`. (Known-expected: any orphan is resolved in Task 8 when ROADMAP/BACKLOG + router rows land. If the only failures are the not-yet-created ROADMAP/BACKLOG, that's fine — Task 8 closes them.)

- [ ] **Step 5: Commit**

```bash
git add scripts/docs-check.mjs package.json
git commit -m "build: add docs-check for router reachability and dead links"
```

---

### Task 8: Author ROADMAP.md

Produce the consolidated path forward. Fold `LOCAL.md`'s product ideas into ROADMAP's someday section, then remove `LOCAL.md`. **Leave `DEV-NOTES.md` untouched** — it's the maintainer's personal notes, excluded from the indexed doc set (Task 7). Finish with `docs:check` green.

**Files:**
- Create: `ROADMAP.md`
- Delete: `LOCAL.md` (untracked)

**Interfaces:**
- Consumes: the design spec's Appendix B (module status matrix) + Appendix C (remaining-work A→J) + the Phase-2 hardening backlog, at `docs/superpowers/specs/2026-07-05-coa-dedrift-refactor-design.md`.

- [ ] **Step 1: Author `ROADMAP.md`**

Structure (draw the content from the spec's Appendices B + C; transform, don't paste raw):
```markdown
# coa roadmap

Single source for **where the project is and what's left.** Replaces status previously kept in private agent memory. Update in the **same commit** as the work that changes state.

## Module status (M0–M10)
<the Appendix B matrix, as a table: Module | Status | What's real | What's missing>

## Cross-cutting workstreams
<tri-backend adapters · multi-account auth (done) · session hardening · core-context/roles/pieces>

## Remaining work (keystones first)
<the Appendix C A→J inventory, each item with a size tag [S/M/L] and dependency note. Lead with the two keystones: R-12 push bridge; the attended v0 L-ASM calibration turn.>

## In flight
- The de-drift refactor (this arc): see `docs/superpowers/specs/2026-07-05-coa-dedrift-refactor-design.md`.

## Someday / ideas (not scheduled)
<the 5 LOCAL.md ideas: conversation naming, constraint→flag authoring, semantic-connection "graphify", prompt-engineering surface, agent tools (summarize / judgement filtering)>

## Do not build for v1
<OPEN.md §1/§4 pointer: no multi-user/multi-writer, no credential vault, rejected items>

---

_Last reviewed: 2026-07-05_
```

- [ ] **Step 2: Remove the LOCAL.md scratch file**

Run: `rm -f LOCAL.md`
(Its ideas are now captured in ROADMAP's Someday section. `DEV-NOTES.md` is intentionally left in place.)

- [ ] **Step 3: Ensure router coverage**

Confirm `AGENTS.md` links `ROADMAP.md` (added in Task 6). That single row satisfies reachability for the new doc.

- [ ] **Step 4: Run docs-check — must be green**

Run: `pnpm docs:check`
Expected: `docs-check OK — N docs, all reachable, no dead links.` If ROADMAP shows orphaned, fix the router row and re-run. (`DEV-NOTES.md` is excluded via Task 7's ignore list, so it must NOT appear.)

- [ ] **Step 5: Commit**

```bash
git add ROADMAP.md AGENTS.md
git commit -m "docs: add consolidated roadmap and retire scratch notes"
```

---

## Self-Review

**Spec coverage (Phase 0 + scaffolding + ROADMAP portions of the design):**
- Junk deletion + `.gitignore` → Task 1. ✓
- `harness-system-prompt.md` (durable ref, not delete) → Task 2. ✓ (resolves the doc-audit vs. code-audit conflict)
- Orphan `group.ts` + `react-virtuoso` → Task 3. ✓
- "Phase 1" comments → Task 4. ✓
- `docs/adr/` + process + first ADR → Task 5. ✓
- WORKFLOW lifecycle update, comment-hygiene + router-index rules, handoff footers → Task 6. ✓
- Router/orphan + dead-link scripts → Task 7. ✓
- `ROADMAP.md` (Appendices B+C), LOCAL ideas folded in, DEV-NOTES kept as personal notes → Task 8. ✓
- **Deferred to the next (graduation) plan, by design:** extraction manifest, the full ADR seed set (DC-1..DC-12 etc.), the per-module SPEC split + tri-backend rewrite, de-dup of the ~30-copy paragraph. Not gaps — scoped out (§7 of the design spec).

**Placeholder scan:** No "TBD/TODO/handle edge cases". Doc-authoring tasks give structure + exact source (spec appendices) rather than re-pasting 100 lines of matrix — an intentional DRY call for prose deliverables, not a placeholder.

**Type/name consistency:** `pnpm docs:check` ↔ `scripts/docs-check.mjs` ↔ `package.json` script name all agree. ADR filename `0001-consolidate-docs-into-router-adr-roadmap.md` is referenced identically in Task 5's README index and file creation.

**Deviation from the design spec (owner-approved):** the spec's Phase 0 said "promote DEV-NOTES items to ROADMAP then remove"; per the maintainer, `DEV-NOTES.md` is **kept in place as personal notes** and excluded from the indexed doc set (Task 7 ignore list). ROADMAP stays strategic; personal scratch stays personal.

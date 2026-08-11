# Docs consolidation re-run — handoff for a fresh orchestrator session

Written 2026-08-11, by the session that closed the improvement arc and landed the console store
port. **This file is your entry point; read it fully, then work from it.** Background history
(only if you need it): `run/state.md` (the arc's final record + post-arc updates), the last
entries of `run/journal.md`.

## The one task

**Re-run the docs consolidation against current `main`** (tip `362ce6e` at time of writing —
re-verify; the tree may have moved). This is ROADMAP.md's last "Next up" item and the final
committed piece of post-arc work. Nothing else is in your scope: not the deferred features
(Viewer/naming/light-theme — ROADMAP has their specs), not the attended live pass (20-tab heap
measurement — needs the maintainer present).

## What exists and why it can't just merge

Branch `arc/docs` (tag `arc-close/docs`, tip `14b55ac`) holds a COMPLETE, twice-verified doc
consolidation built 2026-08-08 against the architecture-stage tree: it retired the design-era
corpora (-32,874 lines across 141 files — `docs/design/`, `docs/adr/`, `DESIGN.md`, `DEV-NOTES.md`
deleted) in favor of a living set (`docs/ARCHITECTURE.md` + CODE_STYLE/ENGINEERING/REPO_LAYOUT/
UI/WORKFLOW + `docs/recipes/`), with AGENTS.md rewritten as the router over it and PR #3's body
describing it. **It was never merged**, and the tree then moved a long way: the whole feature
stage (project windows, permission modes, model metadata, orchestration + worktrees, the skills
library) plus the console store port all landed AFTER its snapshot, and they kept editing the doc
world it deletes — including ADDING ADRs 0035–0039 into the `docs/adr/` folder it removes.

So this is an EDITORIAL RE-RUN, not a merge: use `arc/docs` as the structural template (what the
living set looks like, what retires, how AGENTS.md routes), re-derive the content against
today's tree, and re-home every fact and rationale recorded since the snapshot. PR #3 (open,
retargeted to `main`) is the workstream's thread — close it with a pointer comment when the
re-run lands (the arc's precedent: land via a fresh branch squashed onto main, not by
force-updating the old branch).

## What must survive the re-run (the non-negotiable content)

- Every ADR's durable WHY. The template folds ADR content into the living docs; ADRs 0035–0039
  postdate it entirely (cost-cap archive, ADR 0036 model metadata + its later correction, 0037/
  0038, 0039 A2A messaging) — they exist ONLY on today's main, and their rationale must land in
  the new structure. The original run's verification caught exactly this class of loss (ADR
  0015's two color exceptions) — expect it again.
- The module facts recorded since: the skills+MCP library (M5/M8/M10 spec updates + the ROADMAP
  workstream entry), orchestration + the worktree manager (M8), permission modes, project
  windows, model metadata, and the **console store architecture that just landed** (push-fed
  slices, materialized transcript hosts, the live-only push id namespace, the provisional
  40-transcript cap pending the attended measurement) — the docs you write must describe THIS
  console, which is why the re-run was sequenced after the port.
- ROADMAP.md is the SSOT for path-forward and holds the deferred features in full detail — the
  re-run reshapes around it, never deletes its content.

## Verification is not optional

The original Stage-4 run used two adversarial lenses and BOTH earned their keep; reuse them:
1. **Prose-vs-tree**: sample the new docs' concrete claims and verify each against the code.
2. **Rationale survival**: for every deleted file, confirm its durable decisions/exceptions
   survived somewhere — the lens that found the one real loss last time.
Cap fix rounds at ~3 (the arc's standing stop-loss). Every verified feature/doc pass this whole
arc surfaced at least one real defect; assume yours will too.

## Standing rules (all binding, all learned the hard way)

- coa is the maintainer's PERSONAL project. No employer/organization references in any committed
  artifact; grep your diffs before committing. This propagates into every subagent prompt.
- Subject-only Conventional Commits, no bodies/trailers, no internal codenames in subjects,
  stage files by name, human-sized batches.
- Gate: `pnpm check && pnpm docs:check`, run UNSANDBOXED (sandboxed shells falsely time out the
  claude-sdk control probes). `docs:check` enforces the router rule — every doc reachable from
  AGENTS.md's nav table — and will be your main gate here. Same-commit rule: doc structure
  changes and the nav table move together. Every doc carries a `_Last reviewed:_` footer.
- `git stash` is DENIED in this harness — a denied call means adapt, never halt.
- Workflow orchestration: run mutating stages SEQUENTIALLY in the shared main tree, each agent
  doing its own explicit `git fetch/checkout/reset` (`isolation: 'worktree'` is unreliable on
  this machine — recurred after a verified fix; do not use it). Pin models explicitly per stage
  (agents inherit the SESSION model otherwise): `opus` is right for writers and verifiers here.
- Never junction/symlink anything from a scratch worktree into the main tree; any bulk delete of
  a dir that might hold reparse points: enumerate them first (`Get-ChildItem -Recurse
  -Attributes ReparsePoint`), remove junction ENTRIES with `rmdir` before any recursive delete.
- Branch off `origin/main` (e.g. `docs-rerun`); push freely; never push `main` without the
  maintainer's explicit go (the arc's two landings were each explicitly authorized).
- The OS watchdog: update `$sessionId` in `C:\Users\Zander\.claude\coa-stage3-watchdog.ps1` to
  YOUR session id early (find it in your session-scoped scratchpad path), and touch
  `C:\Users\Zander\.claude\coa-stage3-heartbeat.marker` every ~50 min or on real progress —
  otherwise it fires `claude -r` at a dead session every 20 minutes.
- Session limits can kill agents mid-run (happened repeatedly): workflows resume loss-free via
  `resumeFromRunId` + push-as-you-go, so push after every stage.

## Bookkeeping

Journal what happens in `run/journal.md` on this branch (`arc/handoff` — transport only, never
merged; codenames are fine here), and update `run/state.md`'s post-arc section when the re-run
lands. Commit+push `arc/handoff` after each meaningful chunk.

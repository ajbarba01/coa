# Arc run state — ARC CLOSED 2026-08-10

> **The arc is closed and landed on `main`.** Maintainer ruling (2026-08-10): cut the arc short
> with the library feature as its last feature; defer the remaining features to the in-repo
> ROADMAP in full detail; squash per stage onto `main`; the console-store port and the docs
> consolidation re-run are the first post-arc work items, starting immediately.

## Final state

| Ref | Tip | What it is |
|---|---|---|
| `main` | `37acd87` | **The arc's outcome.** Three per-stage squash commits over the pre-arc `d97c118`: `d3c55d4` (the knife), `47839e3` (architecture), `37acd87` (the feature stage). Tree byte-identical to `arc-close/stage3`; full gate green on exactly that tree (3625 tests / 30 skipped, depcruise 465 modules / 1406 deps clean, docs-check 64). |
| tag `arc-close/reset-knife` | `cc78b9f` | Stage 0+1 full history (25 commits). PR #1 closed with pointer comments. |
| tag `arc-close/architecture` | `5c232df` | Stage 2 full history (+51). PR #2 closed likewise. |
| tag `arc-close/stage3` | `a11c368` | The feature stage's full history (+81, incl. the close-out's recovered cache-wipe fix). Branch deleted; tag preserves every journaled SHA. |
| tag `arc-close/docs` / branch `arc/docs` | `14b55ac` | Stage 4's verified doc consolidation — **NOT merged** (it retires a doc world the feature stage kept editing). PR #3 retargeted to `main`, open as the live workstream: re-run against current main using the branch as template. ROADMAP "Next up" item 2. |
| tag `arc-close/c4-console` / branch `arc/c4-console` | `48e863f` | C4's verified store rewrite — **NOT merged** (the feature stage built 79 commits on the old store). PR #4 retargeted to `main`, open: port, folded with instant-nav acceptance + the 20-tab memory charter. ROADMAP "Next up" item 1. |
| `backup/f1-f7-core1-wip` | — | Unique salvage from an interrupted build attempt, superseded by the shipped worktree manager. Kept as insurance; delete at will. |
| `backup/pre-squash` (local-only) | `88b6a33` | The pre-arc conversation-canvas archive (431 commits). Untouched. |
| `arc/handoff` | — | This transport branch. Never merges. |
| tag `pre-reset` | `3536c28` | The pre-knife baseline. |

All other arc branches (16 remote, ~20 local) verified contained via `merge-base --is-ancestor`
against `arc-close/stage3` and deleted. **The containment sweep is what caught the lost F3
cache-wipe fix** (see the journal's close-out entry) — `2ef458a`/`c94f029` lived only on the F3
feature branch, were never re-merged after the fix pair reported green, and were recovered into
the final tree before `main` was pushed.

## What shipped in the feature stage (all adversarially verified, every feature found ≥1 real bug)

Q11 (root/home seam), Q14 (close-queue leak), 4 UX-polish clusters, F11 (project selection +
window management), F2 (permission modes), F3 (per-model info / context ring / gated attachments
+ 4 verify bugs), F1+F7 (orchestration finish + worktree manager), F4 (the skills + MCP library
+ 5 verify bugs + a 4-Minor honesty/interop cleanup pass, independently re-verified).

## Deferred (in ROADMAP.md on main, full detail — the SSOT now)

- **Next up (committed):** 1. console store port (+ instant-nav acceptance + 20-tab memory
  charter = old Q15); 2. docs consolidation re-run.
- **Deferred features (specified, unscheduled):** Viewer surface (F8), conversation naming +
  rename (F9), light theme sand-light (F5), the permission-modes live smoke (Q17).
- **Library residuals** folded into the library workstream's "Remaining" line.

## Standing operational facts that outlive the arc

- Gate: `pnpm check && pnpm docs:check`, UNSANDBOXED (sandboxed shells falsely time out the
  claude-sdk control probes). Verify a suspicious failure in isolation before blaming load.
- `git stash` is DENIED in this harness — adapt, never halt. Stage by name, subject-only
  Conventional Commits, no internal codenames in subjects, no employer references anywhere.
- `Workflow`'s `isolation: 'worktree'` is unreliable on this machine (recurred after a verified
  fix) — run mutating workflow stages sequentially in the shared main tree.
- Never junction/symlink from an isolated worktree into the main tree; any bulk delete of a
  dir that may hold reparse points: enumerate them first or use `robocopy /XJ`.
- Workflow agents inherit the SESSION model unless pinned — pin `opus` for core/verify/fix
  stages, `fable` for UI/design halves (the F4 build accidentally ran everything on Fable).
- The OS watchdog (`coa-stage3-watchdog` scheduled task) still points at session
  `bde57b69-2e91-4947-bcaf-c13e87b750a7`; retire it when the post-arc work ends.

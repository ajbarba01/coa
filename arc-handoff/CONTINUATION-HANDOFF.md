# Arc continuation handoff — Stage 3 orchestrator session, Fable-primary

Last rewritten 2026-08-09 (mid-overnight, handing off from a Sonnet-orchestrated session to a
fresh Fable-orchestrated one — the maintainer's own call, since the remaining Stage 3 features are
heavily UX-weighted). **This is the arc's single continuation handoff**; `run/journal.md` and
`run/state.md` carry the detailed record, this file is the orientation layer on top.

**Where the arc stands: Stage 3 is well underway, not "just started."** Q11, Q14, F11, and F2 are
all DONE (built, adversarially verified, merged into `arc/stage3`, gate green, pushed). F3 is
core+UI complete and gate-green but its verify step died on a transient network error mid-session
— NOT a real finding, just needs a clean retry. F1+F7, F4, F8, F9, F5 have not been started. Q15
(F10's unmeasured "done means" clauses) is still open, sized to run once F1/F7/F8 add more
materialized-tab surface.

## Model allocation — Fable is primary for this continuation

The maintainer is on the Max plan; Fable is available and is now the ask for the ORCHESTRATOR
itself (not just UX-sensitive subagents, which is how the prior session used it). The remaining
Stage 3 features (F4 library manager, F8 viewer, F9 naming, F5 light theme) skew UX-heavy, which is
the given reason for this handoff. Keep using `model: 'fable'` for UI-half subagents within each
feature's build (see the pattern below) regardless of which model is orchestrating.

## Restore context first

```
git -C "C:\Users\Zander\Documents\Side Projects\coa" fetch origin arc/handoff
git -C "C:\Users\Zander\Documents\Side Projects\coa" worktree add <your-scratchpad>\handoff-wt arc/handoff
```

(If a worktree at that path already exists from a prior session and its directory is gone, `git
worktree prune` first, or just pick a fresh path.)

Then read, in order:

1. `arc-handoff/run/state.md` — branches, tips, stage status. **This is the most current
   file; trust it over this handoff on any numeric/tip conflict.**
2. `arc-handoff/run/journal.md` — read from the "**Stage 3 orchestrator session opens**" entry
   (2026-08-09) onward — that's tonight's entire session, in order: the four questions' rulings,
   F11's grilling and build, the `isolation:'worktree'` bug discovery and workaround, F2's build
   and its three caught bugs, F3's build. Everything before that entry is prior-session history,
   already fully captured in `state.md`'s summary form.
3. `arc-handoff/run/questions.md` — **Q10 ruled (operational discipline, not a charter), Q11 done,
   Q14 done, Q15 open (size after F1/F7/F8), Q16 is F11's addition (built), Q17 is F2's parked
   live-smoke gap.**
4. `feature-plans.md` (this folder) — F1–F9 + **F11** (a maintainer-added feature this session,
   NOT F10 — F10 is the cross-cutting instant-navigation criterion from the architecture stage,
   already done). F11's full spec/ruling is a new section near the end of this file.

For the UX work (most of what's left):

5. `docs/UI.md` **in the repo** — tokens, the quiet register, the authoring laws (no raw values,
   every state ships, build from the kit). Standing authority for anything visual.
6. `mockups/arc-ui-contract.html` (this folder) — bottom section: mockups are **guidance, not
   contract** — maximum design freedom over placement/layout/craft, only the listed functionality
   is binding.

## Current state, concretely

| Branch | Tip | State |
|---|---|---|
| `main` | `d97c118` | untouched |
| `arc/reset-knife` | `cc78b9f` | done, draft PR #1 |
| `arc/architecture` | `5c232df` | Stage 2 done, draft PR #2 |
| `arc/docs` | `14b55ac` | Stage 4 done + verified, draft PR #3 |
| `arc/c4-console` | `48e863f` | C4 done, draft PR #4 |
| `arc/stage3` | `7a1e6c3` | **Stage 3's rolling integration branch, off `arc/architecture`.** Q11, Q14, the 4 UX-polish clusters, F11, and F2 all merged and gate-green (3117 tests, depcruise 429/1258, docs-check 60 as of this tip). **F3 is NOT yet merged** — see below. |
| `arc/f3-model-info-attachments` | pushed, not yet merged | Core (model-metadata catalog + attachment wire format) and UI (context ring, capability-gated attach, model-picker hover card) both done and gate-green. Verify died on `ENOTFOUND` (transient network, not a real finding) before completing even one real pass — **retry this first.** |
| `arc/handoff` | — | this transport branch, never merged |

`arc/stage3` is NOT yet a draft PR against `arc/architecture` — open one once the stage is
substantially further along, matching PR #1–#4's stacked shape.

## What to actually do, in order

1. ~~Retry F3's verify.~~ **DONE.** Three rounds (the arc's standard cap) found FOUR real bugs —
   context-ring cache-token double-counting, session-unscoped composer attachments, resent-history
   images breaking later plain-text turns on a non-vision model, and a malformed-200 metadata fetch
   silently wiping a good disk cache (this last one hit the round cap before a fix landed; verified
   the finding by hand, then closed it with one focused fix+verify pair rather than restarting the
   loop — see the journal). All four fixed, gate green throughout.
2. ~~Merge F3 into `arc/stage3`, gate-check, push.~~ **DONE** (`cf117c7`, 3252 tests, depcruise
   441/1299, docs-check 61).
3. **F1 + F7** (spawn-with-isolation option; F7's worktree manager) — **NEXT.** Sequenced together
   per the plan (F7 rides F1's spawn option). `isolation: 'worktree'` is usable again as of
   2026-08-09 (see the journal's "RESOLVED" entry and the standing-facts section below) — use it
   for this build's mutating stages, per the new operational rules (sweep leftovers first, cap
   fan-out ≤4).
4. **F4** (Library: skills + MCP manager) — before F8, since F8's viewer needs to show injected
   skills.
5. **F8** (Viewer surface).
6. **F9** (Conversation naming + rename).
7. **F5** (Light theme) — deliberately last, since it needs the final surface set from everything
   above.
8. **Q15** — size once F1/F7/F8 have landed more materialized-tab surface: open 20+ tabs, measure
   the heap curve, settle an eviction/cap policy for materialized transcript hosts.

## The build pattern that has worked all night — reuse it

Every feature this session used the same shape, as a `Workflow` script (see the tool's own
documentation for `agent()`/`phase()`/`log()` — no special coa-specific API):

```
phase('Core')   → one agent (default model) builds the daemon/core half, documents the wire
                  contract precisely (the next agent reads code, not a spec), commits + pushes
                  to a fresh branch off origin/arc/stage3, runs the full gate, reports.
phase('UI')     → one agent, model: 'fable', builds the renderer half against the core agent's
                  ACTUAL committed contract (verify it, don't trust the report blindly), same
                  gate-and-report discipline.
phase('Verify') → one agent adversarially re-verifies BOTH halves against the real diff, re-runs
                  the gate itself, tries to break every ruled requirement with a concrete
                  scenario. If it fails, one fix-round agent (same branch) addresses the real
                  findings, then verify runs again — capped at ~3 total attempts (this arc's
                  standing stop-loss), not looped forever.
```

Every single feature built this way surfaced at least one real bug the implementers' own tests
missed — this is not optional ceremony, it is the thing that has been finding real defects all
night (F11: a daemon-leak-on-swap bug; F2: two related Stop/interrupt bugs plus an architectural
dual-seam double-invocation). **Do not skip the verify phase or shrink the fix-round budget to
save time.**

Write each feature's own `F<N>_SPEC` block into the script the way the journal's entries describe
(condensed from `feature-plans.md`, plus current-tree grounding you gather yourself — the plan
docs describe intent, not always exact file:line, since the tree moves under you all night).

## Standing facts that still apply (all confirmed fresh tonight)

- **`Workflow`'s `isolation: 'worktree'` — broken, reported RESOLVED, then RECURRED same day
  (2026-08-09). Treat it as unreliable; do not use it as the default for the rest of this arc.**
  A debugging session found a real mechanism (paths compared case-sensitively; `c:\...` vs
  `C:\...` never string-match) and verified a fix live — but the very next multi-stage build hit
  the identical `WorktreeIsolationError` on a brand-new worktree path a few stages later, plus a
  SEPARATE problem: the harness doesn't tear down a worktree after its agent finishes if that
  agent made real commits, so a later stage's own explicit `git checkout <branch>` collides with
  an earlier stage's still-registered worktree (git correctly refuses — a branch can't be checked
  out in two worktrees at once). **Standing rule now: run every mutating workflow stage WITHOUT
  `isolation: 'worktree'`, sequentially in the shared main tree, each agent doing its own explicit
  git fetch/checkout/reset** — this is the one pattern that ran without exception all night,
  incident-free. If a future session wants to retry isolation, validate it on something small and
  low-stakes first, never as the default for a multi-stage feature build. Full detail in the
  journal's "isolation: 'worktree' — RESOLVED" and "recurred; reverted to sequential" entries.
- **NEVER junction/symlink an isolated worktree's `node_modules` (or anything else) to the main
  tree.** This caused a real incident (2026-08-09, F1+F7 build, see the journal's "a cleanup
  command deleted 605 tracked files" entry): a `robocopy /MIR` cleanup of a stranded worktree,
  missing the `/XJ` flag, followed a cross-tree `node_modules` junction plus pnpm's own internal
  workspace symlinks straight into the main tree's real `packages/*`/`apps/cli` source and deleted
  605 tracked files (fully recovered via `git restore` — nothing was ever committed over, but it
  was a close call caught only by chance). Just run a real `pnpm install --frozen-lockfile` inside
  an isolated worktree instead — pnpm's global store is warm, so it takes ~10 seconds, not minutes,
  and is completely self-contained. If a stray worktree ever needs manual cleanup and
  `git worktree remove` fails (the known "Filename too long" issue on deep `.pnpm` paths), enumerate
  its reparse points first (`Get-ChildItem -Recurse -Attributes ReparsePoint`) and confirm none
  point outside it, THEN use `robocopy /MIR /XJ` (never bare `/MIR`) or an equivalent junction-safe
  method — never a bulk recursive delete without first ruling out cross-tree links.
- **Merging a feature branch into `arc/stage3` is done BY THE ORCHESTRATOR directly** (not
  delegated to an agent), in the main working tree, sequentially — never while a Workflow is also
  mutating that same tree. Pattern used all night: `git checkout arc/stage3 && git pull && git
  merge --no-ff origin/arc/<branch> -m "merge: ..." `, resolve any conflict by hand (two came up
  tonight, both the expected shape — two feature branches' UI agents independently touching the
  same shared file — resolved by keeping the union of both changes), run the FULL gate
  (`pnpm check && pnpm docs:check`) fresh post-merge before pushing. Never trust a pre-merge gate
  result as proof of a post-merge state.
- **No project-internal codenames (F2, F11, Q17, etc.) in a commit subject that will reach `main`**
  — AGENTS.md's Constitution forbids this. Caught once tonight (a subagent's fix commit said "the
  F2 predicate" in its subject; reworded + force-pushed since it was a solo, unmerged branch). This
  rule does NOT block using those codenames in `arc/handoff` bookkeeping commits (that branch never
  merges anywhere, and the codenames are self-defined by `feature-plans.md`/`questions.md` living
  right there) — only code-repo commits that could reach `main`.
- **The `sdk-control-ledger` memory's headline claim is stale/superseded** (corrected 2026-08-09,
  see the memory file's own top note): `canUseTool` IS consulted live on the Claude SDK path via
  `PreToolUse` — the old "governance never runs on the Claude path" finding no longer holds.
- **An OS-level watchdog is running independently of any session** — Windows Scheduled Task
  `coa-stage3-watchdog`, checks every 20 min whether `C:\Users\Zander\.claude\
  coa-stage3-heartbeat.marker` has gone stale (>90 min unwritten); if so, it runs `claude -r
  <session-id> -p "<recovery prompt>"` as a harness-independent fallback resume.
  **IMPORTANT: `C:\Users\Zander\.claude\coa-stage3-watchdog.ps1`'s `$sessionId` variable currently
  points at the PRIOR (Sonnet) session's ID, which is ending with this handoff.** Update that
  variable to the new session's own ID early on (find it the same way it's always found — session-
  scoped scratchpad/transcript paths embed it), and keep touching the marker file (`(Get-Item
  ...).LastWriteTime = Get-Date`, or recreate it) roughly every 50 min or whenever real progress
  lands, the way the prior session did — otherwise this safety net is aimed at a dead session.
- **Run the test suite UNSANDBOXED** — sandboxed shells falsely time out the claude-sdk control
  probes.
- **`git stash` is DENIED in this harness** — a denied call means adapt (copy files aside), not
  halt.
- **Never push `main`.** Arc branches (including `arc/stage3` and every feature branch) push
  freely.
- **Commit as you go**, subject-only Conventional Commits, no body/trailers/codenames-that-reach-
  main, staged by name. Grep diffs for employer/organization references before every commit —
  personal project, propagates into every subagent prompt.
- **Working in a scratch worktree with junctioned `node_modules`**, running the desktop app, and
  `depcruise`-inside-a-worktree all have the same non-obvious fixes documented in the prior
  session's notes below this line — unchanged, still accurate, worth one read if you touch any of
  those.

## Bookkeeping cadence

Update `run/journal.md` (what happened, verbatim gate results, what's still open), `run/state.md`'s
branch table and stage lines, and `run/questions.md` for anything needing a maintainer ruling.
Update **this file** when the picture changes materially (a feature lands, a new operational fact
is learned). Commit+push `arc/handoff` after each meaningful chunk of progress — it has been the
single most useful artifact for exactly this kind of mid-arc handoff.

---

_Everything below this line is preserved from the prior (2026-08-08) handoff for the still-valid
mechanical detail — desktop app launch fixes, worktree/node_modules junction gotchas, depcruise
quirks. Superseded content above this line (model allocation, current branch table, next actions)
has been removed rather than left to contradict; if something below conflicts with above, above
wins._

- **Working in a scratch worktree with junctioned `node_modules`:** link the main repo's
  `node_modules` per package rather than running `pnpm install` (the repo sets
  `allowBuilds: electron: false`, so a fresh install yields no working Electron binary anyway).
  Two things a prior session learned the hard way: (a) pnpm 11's `verify-deps-before-run` sees the
  foreign workspace path in the shared `.modules.yaml` and tries to **purge and reinstall the main
  repo's tree** — put `verify-deps-before-run=false` in a worktree-local `.npmrc`, or pass
  `pnpm --config.verify-deps-before-run=false <script>`; (b) link `apps/desktop/node_modules/@coa/*`
  to the **worktree's own** packages, not the main repo's, or `tsc -b` silently checks the wrong
  sources. Remove such a worktree with `git worktree remove`, never a recursive delete — the
  junctions point at the real dependency tree.
- **depcruise is meaningless inside a junctioned worktree.** Resolution escapes the worktree, so it
  cruises far more modules than real and reports false `backend-isolation` violations in packages
  never touched. Run it where the install is real (the main repo, detached at your commit) —
  `git checkout --detach <sha>` works even while another worktree holds that branch.
- **Running the desktop app here needs three fixes, none of them obvious.** (a) `electron` is linked
  only into `apps/desktop/node_modules`, so `electron-vite` cannot resolve it — add a root junction
  (`mklink /J node_modules\electron node_modules\.pnpm\electron@34.5.8\node_modules\electron`,
  adjusting the exact pinned version if it differs);
  (b) this shell sets `ELECTRON_RUN_AS_NODE`, so launch under `env -u ELECTRON_RUN_AS_NODE` (the
  tell: `electron.exe --version` prints a Node version); (c) an occluded window stalls
  `requestAnimationFrame` completely, silently invalidating any timing measurement — launch with
  `--disable-background-timer-throttling --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows` and assert a live rAF count before believing a number.
  Driving: CDP `Input.dispatchMouseEvent` (synthetic `.click()` does not drive the tab strip), and
  recompute element rects before every click — selection scrolls the strip, and the title bar's
  `-webkit-app-region: drag` swallows events over anything under it. A NATIVE OS dialog (e.g.
  `dialog.showOpenDialog`) is a separate HWND outside the Chromium render tree — CDP cannot drive
  it; use Win32 UI Automation + `SendMessage(BM_CLICK)` instead (confirmed working, this session,
  for F11's live verification).

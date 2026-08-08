# Arc run state — REWRITE THIS FILE after every stage and ~every 30 min

> **RUN INTERRUPTED 2026-08-07 ~07:20 — individual spend limit hit mid-C2.**
> Everything is on GitHub. This file is written for a FRESH SESSION ON A NEW MACHINE.

> **RESUMED 2026-08-07 ~13:15 on the maintainer's Windows machine** (Fable 5 CLI,
> bypass permissions, subscription account — no spend ceiling per Q4). Maintainer
> answered the question queue: Q1 archive-anyway, Q3 keep-Cost, Q5 gate-and-keep,
> Q7 archive-orphans/fold-codenames-into-Stage-4/fix-flakes-early; **Q2 still open.**
> See the answers section at the bottom of `questions.md`. Local-file restore done
> (CLAUDE.local.md + exclude entries; settings.local.json skipped — bypass makes it
> moot). Next action unchanged: gate the WIP adapter, then C2 part 3, plus the newly
> ruled R1 execution and Q7 cleanups.

## Resume protocol (new machine, from zero)

1. `git clone https://github.com/ajbarba01/coa.git ~/dev/coa`
2. Restore the arc steering files outside the repo:
   `git -C ~/dev/coa fetch origin arc/handoff && git -C ~/dev/coa worktree add /tmp/arc-handoff arc/handoff`
   then `cp -R /tmp/arc-handoff/arc-handoff ~/dev/coa-arc` (or just read them in place).
   The arc folder is NEVER merged into main — it is a transport artifact.
3. Read `~/dev/coa-arc/coa-arc-plan.md` fully, then this file, then `journal.md`
   (what happened), `questions.md` (what needs the maintainer), `ledger.md` (what the
   knife did).
4. Do the machine setup in `arc-handoff/MACHINE-SETUP.md` (Node 22, the node-gyp
   python workaround, the gitignored files, the two skills). **`pnpm install` will fail
   on Node 24 / Python 3.14 without it.**
5. `git checkout arc/architecture` — that is the live work branch.
6. Continue from "Next action" below.

## Where the work lives (all pushed to origin)

| Branch | Tip | State |
|---|---|---|
| `main` | d97c118 | untouched, as the arc found it |
| `arc/reset-knife` | cc78b9f | Stage 0+1 complete, **draft PR #1**, all gates green |
| `arc/architecture` | 5c232df | **Stage 2 COMPLETE except C4 — C3 is now fully closed and independently verified.** C1, de-slop, C2, the cost-cap archive (R1), the Q7 cleanups, C3 built+verified (the turn-lifecycle state machine, fa437a1..77e6dd4, **plus its last item at 5c232df — passed=true on independent re-verification**), Q9 archival, C5 complete+verified. The 5c232df fix turned out to be a real, provable bug, not the hygiene nit its own prior description undersold it as (see journal: a straggler frame could land below the `interrupted` marker via the everyday Stop button, no exotic backend needed). `packages/core/src/session` isolated: 354/354 green, confirmed independently by two separate agents. C4 unbuilt, unblocked, parked on Fable/UX allocation |
| `arc/docs` | 14b55ac | **Stage 4 docs: the living doc set, drift repair, corpora retired (88 files, -30,736), VERIFIED.** Gates green (2928 tests, depcruise 418, docs-check 11). Both lenses ran clean/fixed; PR #3 body rewritten to match |
| `arc/handoff` | — | this arc folder (transport only, never merge) |
| tag `pre-reset` | 3536c28 | the pre-knife baseline |

`arc/wip-adapter-unify` deleted 2026-08-08 (local + `origin`) — confirmed by `merge-base --is-ancestor` fully contained in `arc/architecture` before deletion, per Q5's ruling anticipating exactly this as the closeout step. Nothing lost; every commit lives on in `arc/architecture`.

The 5 Stage-0 baseline commits that were on the old machine's local `main` (tip
a13e46d) are reachable in `arc/reset-knife`'s ancestry — recreate with
`git branch -f main a13e46d` if you want that local main back. Nothing exists only
on the old machine.

## Stage status (current as of 2026-08-08, the Stage 5 closeout)

- **Stage 0 (baseline)** — COMPLETE.
- **Stage 1 (the knife)** — COMPLETE. 12/12 verified rulings executed (R1 archived per Q1's
  ruling, R2 struck per Q2, R12f's Cost half kept per Q3 — the knife's question queue is fully
  closed), draft PR #1.
- **Stage 2 (architecture)** — COMPLETE except C4. C1, de-slop, C2 (all 3 parts, adapter
  unification gated and landed), C3 (session service extraction, including its turn-lifecycle
  state machine — see journal for the real bug its last item turned out to be), C5 (composition
  root + error honesty) are all DONE and independently verified. **C4 (console store rewrite) is
  the only item left, deliberately unstarted — it needs the maintainer's Fable/UX allocation, not
  sequence; C3 was its prerequisite and is done, so it is unblocked.**
- **Stage 3 (features)** — NOT STARTED except F6, which rode C2 and shipped. F1–F5, F7–F10
  untouched, same as Stage 2's UX allocation.
- **Stage 4 (docs)** — COMPLETE AND VERIFIED. Landed on `arc/docs`, both adversarial lenses ran
  and their one real finding (ADR 0015's rationale) is fixed. See branch table above.
- **Stage 5 (closeout)** — COMPLETE. See the "STAGE 5 CLOSEOUT" journal entry for the full
  morning-after report.

## Next action (in order)

1. ~~Gate the WIP adapter package~~ DONE 2026-08-07 (gated + landed, see journal).
2. ~~C2 part 2 completion~~ DONE 2026-08-07 (0c8c444 pushed — tree is in the unified
   state; old packages deleted; arc/architecture tip 0c8c444).
3. ~~Execute knife ruling R1~~ DONE 2026-08-07 (4848ff4..0be23fb pushed, ADR 0035,
   both verifiers addressed — see journal). Was: (as a
   workflow: executor + KEEP-seam and completeness verifiers): needs a SUPERSEDING ADR
   (0032 fan-out-bound + 0009 exactly-two-blocks are immutable) and a raw-SDK-option
   escape hatch for the live suites' maxBudgetUsd real-money guard. Full inventory in
   run/verification/R1.json. Do this BEFORE part 3 so part 3 adds no new
   maxBudgetUsd construction sites.
4. ~~C2 part 3~~ DONE 2026-08-07 (c5281b7 · 14044ce pushed, verifier passed — C2
   fully delivered; arc/architecture tip 14044ce). Follow-up queued for Stage 3: the
   desktop add-provider GUI flow lacks openai/openrouter rows (CLI/daemon complete).
5. ~~Q7 cleanups~~ DONE 2026-08-07 (a28bd30..658fbd8 pushed; arc/architecture tip
   658fbd8). Flakes root-caused (suite also ~20% faster), four orphans archived,
   verifier findings actioned. New question Q9 raised (health-profile.ts).
6. ~~C3 session-service extraction~~ DONE + VERIFIED 2026-08-07 (21bbc78 · f66d72b ·
   ca8fbdf · f648551). session-handlers.ts 1411 -> 122 lines; the non-founding-connection
   turn bug is fixed and was PROVEN real (all 3 regression tests fail at the pre-fix
   commit with exactly the predicted symptoms). See the journal for the one verification
   gap (G4 reattach / held-query-survives-interrupt lack independent confirmation).
7. ~~Q9 archival~~ DONE 2026-08-07 (d57d5c0).
8. **C5 — COMPLETE AND VERIFIED.** Both verifiers found real defects; all four blocking
   findings fixed and hand-verified with mutation probes. Plus the charter item the SCRIPT had
   dropped (a user-visible sample-data label on the usage surface, 7852763) — found by auditing
   the plan against the tree, not by any test.
8b. ~~C3's missing item — turn lifecycle~~ **BUILT, FIXED, AND NOW FULLY CLOSED (fa437a1 ·
   a1902f9 · 8b97c94 · 77e6dd4 · 5c232df).** One owned state machine replaces three hand-synced
   flags. Multiple verifier rounds returned passed=false across this charter, each finding
   something real: a NEW silent-failure mode the refactor itself introduced (the abandon-stop
   edge), and — in the final round — the two small leftover items (discarded `false` returns,
   `settle()` clearing `inert`) turned out to be a REAL, provable bug rather than the "latent,
   future-backend-only" hygiene nit this file previously described: a straggler frame could
   render below the `interrupted` marker via the everyday Stop button, proven with two working
   reproductions before any fix existed. Fixed at 5c232df, mutation-probed, and independently
   re-verified by a second adversarial agent (passed=true). See the journal for the full story
   and Q13's resolution.
9. **Stage 4 docs — LANDED on arc/docs (fa6a433 · a716bf4 · 9fb09db · 388272e · 14b55ac),
   VERIFIED, draft PR #3 body rewritten to match.** Resumed wf_1261f87e-ce1: the five writers
   replayed from cache, the closer found and reverted an uncommitted ROADMAP.md edit that had
   wrongly claimed two arc/architecture-only fixes (turn-lifecycle, sample-data label) as done
   here, and separately committed a pre-existing 942-line prose-tightening pass on
   ARCHITECTURE.md (388272e) after reading the whole diff. Both verifier lenses then ran for
   real: lens 1 (prose-vs-tree, 24 claims sampled) passed clean and independently confirmed the
   ROADMAP.md revert was correct; lens 2 (rationale survival) found one real gap — ADR 0015's
   two color exceptions (a third-party brand mark's own color, the chart series palette) were
   deleted with the ADR and left docs/UI.md's "no raw values" law contradicted by live code with
   no documented exception. Fixed by hand (14b55ac): both exceptions and their reasoning are now
   named directly in UI.md. Gate green after the fix (2928 tests, depcruise 418, docs-check 11).
   Pushed to origin/arc/docs. Left alone as genuinely optional (not a docs-check failure): lens 2
   also noted `docs/recipes/openai-bridge.md` isn't in AGENTS.md's nav table — it's reachable via
   README so nothing is broken, and the table's shape is "one row per domain authority," which a
   how-to recipe doesn't cleanly fit.
10. ~~Stage 5 closeout~~ **COMPLETE.** Every parked charter/feature has a numbered question; all
    branches pushed (`arc/wip-adapter-unify` deleted, fully merged); PR #2 and PR #3 bodies both
    current; the final morning report is the "STAGE 5 CLOSEOUT" entry at the end of the journal.

## The arc, right now

Nothing is queued. Stage 0/1 complete, Stage 2 complete except C4, Stage 4 complete and verified,
Stage 5 complete. C4 and Stage 3 wait on the maintainer's Fable/UX allocation — not sequence, not a
technical blocker. The next session starting fresh should read the journal's closeout entry first;
everything after this point in the file is prior-session detail, kept for the record.

## Standing operational facts (do not rediscover)

- **Run the test suite UNSANDBOXED.** The claude-sdk control probes spawn child
  processes and falsely time out in a sandboxed shell (5 fake failures).
- Gate command: `pnpm check && pnpm docs:check` (typecheck · lint · format · vitest ·
  depcruise, then the docs router check).
- ~~Known intermittent flakes~~ FIXED 2026-08-07 at the cause (Combobox focus, daemon
  watcher, AuthPanel replace-secret, Markdown fence). The suite should now be green
  every run — a failure is a real failure, not load. Treat any new intermittent as a
  bug to root-cause, not a known-flake to rerun.
- Commits: subject-only Conventional Commits, no body, no trailers, no internal
  codenames, stage files BY NAME, human-sized batches.
- **`git stash` is DENIED in this harness and the denial tells an agent to stop and wait
  for a human.** It wedged a C5 agent with finished work stranded in `stash@{0}` and a
  CLEAN working tree — so "no commits, nothing modified" is NOT proof an agent produced
  nothing. Check `git stash list` before concluding a dead agent did no work. Every
  workflow prompt should ban stash and say that a denied call means adapt, not halt.
- **Syntax-check a workflow script before launching** (`node --input-type=module --check`;
  the top-level `return` error is expected and fine) and write it as BINARY — a Python
  text-mode write converts LF to CRLF on Windows, and the launcher rejects the script for
  control characters.
- Never push `main`; never force-push anything on origin except the arc's own branches.
- **A Workflow's agents check out branches directly in the shared main working directory —
  there is no automatic isolation.** Launching a workflow (e.g. stage4-docs.js, which needs
  arc/docs checked out) while ALSO reading/editing a different branch's files in that same main
  tree is a real hazard, not a theoretical one: mid-run, a file that exists on arc/architecture
  briefly read back as "not found" because the workflow had switched HEAD to arc/docs underneath
  an unrelated `git status`/`Read` call. If you need to work a different branch while a workflow
  runs, use a separate `git worktree add <scratch> <branch>` and do that work there, or simply
  sequence the two rather than parallelizing them.
- **2026-08-08: a fresh `pnpm check` run threw 10 timeouts across 5 desktop-panel test files
  (ChatPanel.test.tsx x2, ShowcasePanel.test.tsx, +2 unrecorded) immediately after an 8-agent,
  1M-token workflow finished on the same machine.** Re-ran `pnpm test` alone seconds later with
  zero code changes in between: fully green, exact baseline (281/2928). This is the same family
  as Q10 — recorded there as a new data point, not treated as a regression (the only diff in the
  tree at the time was a markdown-only edit, which cannot affect JS/TS test timing).

## Model allocation (maintainer decision, 2026-08-07 afternoon)

The first Fable account's promo credit is EXHAUSTED (hit its monthly limit mid-part-3;
the maintainer re-logged into the second account). Decision: the session runs on
**Opus** for all remaining backend/mechanical work (Q7 cleanups, C3, C5, Stage 4
docs, closeout); the second account's remaining Fable credit is **reserved for the
UX stages** — Stage 3's mockup-driven features, C4's console rewrite, and the
mockup-conformance gates — per the plan's Fable-on-UX hard rule.

## Spend / cost discipline (READ THIS — the run died here)

The plan set a **$250 ceiling checked between stages, and it was never enforced**: no
spend meter was available in-session, and subagent token counts (~4.4M across ~45
agents) were tracked instead without being converted to dollars or acted on. The run
ended by hitting the account's individual spend limit mid-workflow, not by the planned
wind-down. On resume: set a hard token budget on every workflow (the budget mechanism
throws when exhausted), run fewer agents per phase, use cheaper tiers for mechanical
passes, and check actual account spend between stages.

## Workspace cleanup, 2026-08-08 (maintainer-directed)

- **The stray `.claude/worktrees/conversation-canvas` worktree is GONE — removed, not just
  flagged.** Before deleting, checked what it actually was: 431 commits (2026-07-01..07-11) of a
  console-redesign prototyping workbench, not nothing — but it is fully preserved on a local-only
  branch `backup/pre-squash` (tip 88b6a33), so nothing was lost. Deletion also had to close 4
  zombie Electron processes it had left running since earlier that day, loaded from its own stale
  binary via the exact module-resolution hijack this file already documented — that is what was
  locking `default_app.asar` and blocking the directory delete. Verified before killing them: all
  4 traced to that stray path specifically, none to the real `apps/desktop`.
- **`allowBuilds: electron: false` in pnpm-workspace.yaml stays `false`.** Maintainer left the
  call to the orchestrator. Decision: the file's own comment already documents the tradeoff
  deliberately (postinstall only fetches a prebuilt binary, not needed for typecheck/bundle); the
  repo is headed toward open-sourcing (see MEMORY's PHI-scrub note), so the tighter default that
  keeps a stranger's `pnpm install` from running Electron's postinstall unconditionally is the
  right posture. The documented one-time manual zip-extraction repair remains the path for
  interactive dev.

## Open questions: 3 parked (Q1–Q3 in questions.md) + every parked charter/feature
## Approximate cost so far: ~4.4M subagent tokens over ~6h wall-clock (pre-2026-08-08) + Stage 4
## re-verification (~1M tokens, 8 agents) on 2026-08-08

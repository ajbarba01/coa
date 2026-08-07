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
| `arc/architecture` | 1b70e47 | Stage 2 partial (C1, de-slop, C2 part 1, **+ the gated unified adapter package**), all gates green on the Windows machine |
| `arc/wip-adapter-unify` | 1b70e47 | **GATED 2026-08-07** (3 gate-fix commits) and fast-forwarded into arc/architecture — Q5 resolved, branch can be deleted at closeout |
| `arc/handoff` | — | this arc folder (transport only, never merge) |
| tag `pre-reset` | 3536c28 | the pre-knife baseline |

The 5 Stage-0 baseline commits that were on the old machine's local `main` (tip
a13e46d) are reachable in `arc/reset-knife`'s ancestry — recreate with
`git branch -f main a13e46d` if you want that local main back. Nothing exists only
on the old machine.

## Stage status

- **Stage 0 (baseline)** — COMPLETE. Found the pre-flight "green suite" was a no-op
  (`pnpm -r test` runs nothing); the real root suite had 27 pre-existing failures, all
  fixed. Also fixed a real workbench import cycle and lint/format debt.
- **Stage 1 (the knife)** — COMPLETE. 12/12 verified rulings executed, 19 commits,
  draft PR #1. R1 + R2 + the Cost floor half of R12f PARKED as contradicted (Q1–Q3).
- **Stage 2 (architecture)** — PARTIAL:
  - C1 tooling honesty — DONE (3 commits). Dependency rules actually fire now
    (source-resolved cross-package edges, node_modules matchable, apps/cli cruised)
    and a canary test makes silent inertness impossible. Ring rule extended to all of
    core. Two real CLI cycles fixed.
  - de-slop — DONE (4 commits). Codename sweep across 312 files; mockAuth→authStore
    and the mock/live boundary untangled; barrels narrowed (core 272→48 exports);
    knife leftovers archived/deleted.
  - C2 backend seam — part 1 DONE (2 commits: port shrink 14→6; core imports no
    adapter, capability ports injected from the CLI, new enforced cruiser rule).
    **Part 2 (adapter unification) killed by the spend limit — ungated work on
    `arc/wip-adapter-unify`. Part 3 (OpenAI + OpenRouter specs) never started.**
  - C3 (session service extraction), C4 (console store rewrite), C5 (composition
    root + error honesty) — PARKED, never started.
- **Stage 3 (features)** — NOT STARTED. F6 was riding C2 (so it is half-done via the
  WIP branch). F1–F5, F7–F10 untouched.
- **Stage 4 (docs)** — NOT STARTED, but fully prepped: both harvests are complete in
  `run/harvest/` (27 live ADR rationales distilled + ~40 tiered roadmap candidates +
  ~25 verified-SDK-behavior bullets), and the whole workflow is pre-written at
  `arc-handoff/workflow-scripts/stage4-docs.js` — launch it with
  `Workflow({scriptPath: '<that file>'})` after copying it somewhere writable.
- **Stage 5 (closeout)** — NOT STARTED.

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
6. Stage 4 docs (mandatory before any closeout) — absorbs the codename-consistency
   pass and the ADR-0032/D150/ROADMAP prose reconciliation R1 makes stale.
7. Stage 5 closeout: write questions for every parked charter/feature, push all
   branches, open draft PRs per workstream, final morning report in the journal.

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
- Never push `main`; never force-push anything on origin except the arc's own branches.

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

## Open questions: 3 parked (Q1–Q3 in questions.md) + every parked charter/feature
## Approximate cost so far: ~4.4M subagent tokens over ~6h wall-clock

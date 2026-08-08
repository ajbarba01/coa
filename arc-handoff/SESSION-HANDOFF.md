# Session handoff — resuming the arc in a fresh context

Written 2026-08-07 (evening) by the Windows resume session, for the session that
follows it. `run/state.md` is still the canonical "where the work stands" document —
this file carries what state.md cannot: how THIS run is being driven, and what has been
learned the hard way that is not visible in the tree.

## What you are

The orchestrator of a long-running, autonomous improvement arc on `coa`. You dispatch
workflows and subagents; you do not hold file-level work in your own context. Durable
state lives in files under `arc-handoff/run/`, not in conversation.

**Standing instruction from the maintainer:** run autonomously. Do NOT stop and hand
back after each completed unit. Only surface when genuinely blocked — an unsafe or
irreversible action needing authorization, missing access, or a decision only the
maintainer can make. Non-blocking questions go in `run/questions.md` and the run
continues. A question with a defensible default is not a block: pick the default, say
so in the journal, keep moving.

## Read these first, in order

1. `arc-handoff/run/state.md` — branches, tips, stage status, next actions
2. `arc-handoff/run/journal.md` — the append-only narrative; read the last three
   entries closely, they carry today's corrections
3. `arc-handoff/run/questions.md` — the queue and every ruling made so far
4. `arc-handoff/coa-arc-plan.md` — the master plan (stages, charters, gates)
5. `arc-handoff/architecture-audit.md` — the charter source for anything architectural

## Environment (this machine, not the plan's)

- **Windows.** `MACHINE-SETUP.md` is written for macOS/POSIX and is mostly moot here:
  Node 22.20 is already on PATH and matches `.nvmrc`, native modules build fine, no
  node-gyp venv needed.
- **Repo:** `C:\Users\Zander\Documents\Side Projects\coa`
- **Arc files:** a worktree of `arc/handoff` lives in the session scratchpad. Recreate
  with `git worktree add <scratch>/handoff-wt arc/handoff`. **Never merge that branch.**
- **Bypass permissions are ON.** The plan's allowlist tuning, the launch dry-run gate,
  and the "keep scratch inside the repo" workaround are all obsolete.
- **Ultracode is ON** and the `Workflow` tool is available. (An earlier session wrongly
  reported it missing — it had only searched *deferred* tools.)
- **Model: Opus.** The maintainer's ruling: all backend/mechanical work runs on Opus;
  the remaining Fable promo credit is RESERVED for the UX stages (Stage 3 features,
  C4's console rewrite, mockup-conformance gates), where the plan's Fable-on-UX rule
  actually binds. The first Fable account's credit is already exhausted.

## How the work is being driven (this pattern is working — keep it)

**Executor agent(s), then refute-framed verifier(s), in one workflow.** Verifiers are
told to REFUTE, to default `passed=false` when uncertain, to cite `file:line`, and are
given the executor's own claims as hypotheses to disprove.

**The verifier has found something real in every single charter so far.** Not once has
it come back clean-and-useless:
- R1: two surviving statements of an invariant the change had just falsified
- Q7: a product behaviour change shipped with ZERO test coverage (reverting it left the
  suite green), plus a second copy of a lookup table that had already diverged
- The flake work: an undisclosed side effect (~40 lines of leaked git stderr per run)

Budget for the verify phase. Treat `passed=false` as the system working.

**Also true: agents' self-reports are directionally honest but incomplete.** They
disclose deviations well; they under-report side effects and over-claim reach. Read the
deviations section of every report — that is where the real information is.

## Hard-won operational facts

- **Run the test suite UNSANDBOXED** (`dangerouslyDisableSandbox: true`). Sandboxed
  shells make ~5 claude-sdk control probes spawn-and-time-out falsely.
- **Gate:** `pnpm check && pnpm docs:check`.
- **The suite is green every run now.** Its historical load-flakes were root-caused on
  2026-08-07 (they were real: a 25-keystroke `user.type`, 23 tests sha256-ing all 859
  repo files, a focus assertion sampling before an rAF). A failing test is a REAL
  failure — never dismiss one as a known flake. The 11 skipped files are env-gated live
  smokes; the LongCat live smoke skips because that account's quota is exhausted.
- **Windows gotchas that have already bitten:** `.bin/` shims are extensionless POSIX
  scripts and cannot be spawned — spawn `process.execPath` against the package's real
  `.mjs` entry. Prettier line-length will fail a gate on a long comment you just wrote.
- **Do not run the full suite while the desktop app is running.** pnpm's deps-status
  auto-install fires, tries to relink `node_modules`, and hits EPERM on the in-use
  electron binary — leaving workspace junctions missing. Symptom: mass
  `Cannot find module '@coa/…'` / desktop collection errors that look like a code
  regression and are not. Diagnose with `ls apps/desktop/node_modules/@coa` against the
  `@coa/` dep count in `apps/desktop/package.json`. Repair the missing link surgically
  (`mklink /J <apps/desktop/node_modules/@coa/NAME> <packages/NAME>`) rather than
  running `pnpm install`, which will contend with the running app for the locked binary.
  This happened on 2026-08-07 and cost a gate cycle to diagnose.
- **If you create a scratch git worktree and junction `node_modules` into it, unlink
  every junction with `rmdir` BEFORE removing the worktree.** A recursive delete would
  otherwise follow the junction into the real `node_modules` and destroy it.
- **`git add` with a path that no longer exists rejects the WHOLE pathspec and stages
  nothing** — and if you have suppressed stderr, it does it silently. This produced a
  content-free commit earlier today. Stage by name, never `-A`, never suppress stderr
  on git commands.
- **Commits:** subject-only Conventional Commits, imperative, no body, no trailers, no
  codenames. Human-sized batches. Secret-shape grep the staged diff first.
- **Never push `main`.** Push arc branches freely.

## Bookkeeping cadence (do not skip — it is what makes this resumable)

After each landed charter: append to `run/journal.md` (what happened, verbatim gate
lines, what the verifier found, what you did about it), rewrite the affected part of
`run/state.md`, add/resolve entries in `run/questions.md`, tick `run/ledger.md` if a
knife ruling moved. Commit and push those to `arc/handoff` in the worktree. Record
mistakes and retractions there too — a wrong finding that gets quietly deleted is worse
than one that is visibly withdrawn.

## What is true about the tree right now

See `run/state.md` for tips. In short: Stage 0, Stage 1, C1, de-slop, and C2 (all three
parts) are DONE. The cost-cap deny path is ARCHIVED — spend is accounted, never capped,
the close gate is the only block, and **subagent fan-out is now unbounded** (that is a
roadmap item, and any doc claiming a cap bounds fan-out is stale). C3's session-layer
restructuring is BUILT and its verification is the immediate next thing to resolve.

## Immediate next actions

1. **Resolve C3 verification** (three lenses: invariants, bug-and-proof, hot-path
   drift). Action anything it finds, then journal it.
2. **Q9 archival** — park `packages/core/src/context/health-profile.ts` + its test into
   `archive/code-health/` per the `2afa808` convention. Ruled; just needs the tree free.
3. **C5** — the workflow is already written at
   `arc-handoff/workflow-scripts/c5-composition-and-honesty.js`. Launch it with
   `Workflow({scriptPath: ...})`. **Its phase 3 item 2 is the arc's only data-loss bug**
   (an agent scope move is delete-then-save; a failed save destroys the file in both
   scopes) — that one goes first and needs a test proving the file survives.
4. **Stage 4 docs** — the workflow at `arc-handoff/workflow-scripts/stage4-docs.js` was
   REVISED today; the original would have shipped a documented lie about the cost cap.
   Use the current version. It deletes the ADR corpus, so it must sweep `docs/adr`
   references out of code comments first or every one of those links 404s.
5. **Stage 5 closeout** — and note: **PR #2's body is materially stale.** It was created
   under the maintainer's identity at 14:37 today and still claims adapter unification
   is unlanded and the session/composition charters unstarted. Stage 5 owns PR bodies;
   rewrite it there. PR #1 (the knife) is fine.

## Still open for the maintainer (none blocking)

Everything from the knife's original queue is closed. Outstanding: nothing that stops
work. `run/questions.md` holds the full history including two rulings delegated to the
orchestrator and one finding (Q8) that was raised and then RETRACTED as a misread —
that retraction is deliberate and should stay visible.

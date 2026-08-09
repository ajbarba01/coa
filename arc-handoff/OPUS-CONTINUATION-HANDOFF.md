# Orchestrator continuation handoff — for an Opus session

Written 2026-08-08 (evening). The session that wrote this was itself running on Fable 5 — which
matters, because this arc's own standing rule is that Fable credit is reserved specifically for
UX-sensitive work (Stage 3's features, C4's console rewrite), not general backend/mechanical
orchestration. This session did a full round of that reserved-for-nothing-special work (Stage 4
verification, ledger reconciliation, a real bug fix in the turn-lifecycle machine, Stage 5
closeout) before that mismatch was caught. **This handoff exists so the arc's ongoing
backend/orchestrator stewardship moves to an Opus session from here on, and stops spending Fable
credit on work that doesn't need it.**

A parallel, separate handoff (`C4-STAGE3-HANDOFF.md`, same folder) exists for the one piece of
work that DOES belong on Fable — the console store rewrite (C4) and, time permitting, the Stage 3
features that follow it. **Do not duplicate that work from this session** — it's on its own branch
(`arc/c4-console`) and its own track. This handoff is for everything else.

## Restore context first

```
git -C "C:\Users\Zander\Documents\Side Projects\coa" fetch origin arc/handoff
git -C "C:\Users\Zander\Documents\Side Projects\coa" worktree add <your-scratchpad>\handoff-wt arc/handoff
```

Then read, in order:
1. `arc-handoff/run/state.md` — branches, tips, current stage status. As of this handoff:
   **Stage 0/1/2(except C4)/4/5 are all COMPLETE and independently verified. Stage 3 and C4 are
   the only remaining work, and they're on the parallel Fable track.** Read "The arc, right now"
   at the bottom of that file.
2. `arc-handoff/run/journal.md` — read the last ~150 lines (from "## The two lifecycle leftovers"
   through the "STAGE 5 CLOSEOUT" entry at the very end) for what actually happened this session,
   including a real bug that was found and fixed (a straggler frame could render below the
   `interrupted` marker via the everyday Stop button) and how it was verified.
3. `arc-handoff/run/questions.md` — the full queue and every ruling so far. **Q10, Q11, and Q14
   are open and are your most likely next actions** (see below).
4. `SESSION-HANDOFF.md` (same folder) — the longer-running operational memory: hard-won
   environment facts (Windows gotchas, the `git stash` denial, workflow/main-tree collision
   hazards, gate commands), most of which is still true and worth skimming once.

You do not need to re-read `coa-arc-plan.md` or `architecture-audit.md` in full unless you pick up
Q11 (which touches session composition) — `run/state.md` and this file are enough to orient.

## Current state, concretely

| Branch | Tip | State |
|---|---|---|
| `main` | `d97c118` | untouched |
| `arc/reset-knife` | `cc78b9f` | done, draft PR #1 |
| `arc/architecture` | `5c232df` | Stage 2 done except C4, draft PR #2 |
| `arc/docs` | `14b55ac` | Stage 4 done + verified, draft PR #3 |
| `arc/c4-console` | (just branched from `5c232df`, no commits yet) | **the parallel Fable track — don't touch** |
| `arc/handoff` | — | this transport branch |

All three real PRs (#1, #2, #3) are draft, current, and stacked. Verify none of this has drifted
before trusting it — the last session found the handoff docs accurate against the live repo every
time it checked, but check anyway; that habit is cheap and has caught real drift before.

## What to actually do

Three open, non-blocking questions are sized and ready to pick up as their own small charters,
in the order they're likely worth doing:

1. **Q10 — desktop/console-kit test suite reliability.** Two independent full-suite runs today
   each threw 37-50 failures concentrated in `apps/desktop/renderer`, `console-kit`, and
   `console-transcript` — up from a handful of isolated sightings earlier. Package-isolated reruns
   of unrelated work were 100% green both times, so this isn't code rot in those files, it's
   something about how the suite runs under load. Two candidate causes are recorded in
   `questions.md`'s Q10 escalation (file-handle exhaustion from many sequential vitest spawns;
   memory pressure from repeated large workflow runs) — worth ruling those out with something
   cheap (watch handle/memory counts across a few repeated runs) before assuming it's pure load
   and sizing a deterministic-waits pass across dozens of test files.
2. **Q11 — the daemon's root/home path seam is honored in one place, bypassed in ~6 others.**
   `startDaemon`/`session-deps.ts` thread a `root` override for the reconciler but not for
   `AgentRegistry`, `createConversationStore`, `buildClaudeLoginDriver`, `ModelCatalogStore`,
   `WebConfigStore`, or `AccountsRegistry` — all still resolve from the real `homedir()`/
   `process.cwd()`. Sharper: `packages/core/src/rpc/auth-handlers.ts` computes secret key-file
   paths from `homedir()` directly at 9 call sites, bypassing its own injected `AuthHandlerDeps`
   entirely — dormant today only because no test exercises an auth write under a test home, but a
   real bug the moment one does. Full file:line inventory is in `questions.md`'s Q11 entry. This
   is a small, mechanical, well-scoped charter: thread `root`/`home` through the remaining
   construction sites, make `auth-handlers.ts` honor its injected deps, add the isolation tests.
3. **Q14 — a closed session's leftover queued turn is invisible to the registry.**
   `LiveSession.close()`/`nextTurn()` (`live-session.ts:212-236`) never clears `#queue`, so a turn
   already queued when a session closes still gets dispatched afterward via a brand-new backend
   query the registry has no record of. Found as an explicitly-adjacent, not-blocking observation
   while verifying this session's bug fix — nothing has actually been observed to break because of
   it, only reasoned about. Cheap to fix (clear or explicitly drain `#queue` on close) if you want
   a small warm-up charter before Q10/Q11.

Any of these three follows the same executor-then-adversarial-verifier pattern that closed every
other charter in this arc — that pattern has found something real in every single charter it's
been applied to, including ones the executor was confident about. Don't skip the verify phase.

## Standing facts that still apply (condensed from `SESSION-HANDOFF.md` / `run/state.md`)

- **Gate:** `pnpm typecheck && pnpm lint && pnpm format --check && pnpm test && pnpm depcruise &&
  node scripts/docs-check.mjs`, bash sandbox disabled. A failing test is real — except the
  Q10-shaped desktop/console-kit noise under heavy load, which is a known, tracked pattern, not a
  new regression, as long as the package you actually touched is clean in isolation.
- **`git stash` is DENIED** and a denied call means adapt (copy files aside), not halt.
- **A `Workflow` call's agents check out branches in the shared main working directory with no
  isolation by default** — if you use the Workflow tool for one of these charters while also doing
  manual work in the main tree, either sequence the two or give the workflow/manual work separate
  worktrees. This bit a session earlier today.
- **Commit as you go**, subject-only Conventional Commits, no body/trailers, no project-internal
  codenames in the subject, staged by name. No employer references anywhere (personal project).
- **Never push `main`.** Arc branches push freely.
- If you finish all three, or run out of good next steps, the honest move is to write a fresh
  closeout note in `run/journal.md` and check on `arc/c4-console`'s progress rather than inventing
  new scope — this arc has a habit of staying honest about what's actually done versus parked, and
  that's worth preserving.

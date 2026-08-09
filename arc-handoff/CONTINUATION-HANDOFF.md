# Arc continuation handoff — one track, all Opus

Last rewritten 2026-08-08 (late evening). **This is the arc's single continuation handoff.** It
replaces the two-track split that existed earlier the same day (an Opus brief for backend work,
a separate Fable brief for C4 and the Stage 3 UX features) — that split is retired, and
`C4-STAGE3-HANDOFF.md` is deleted, its still-live content folded in below.

## What changed, and why there is only one track now

**The Fable credit is exhausted.** The arc's standing rule — Fable reserved for UX-sensitive work
(Stage 3's mockup-driven features, C4's console rewrite, the mockup-conformance gates), cheaper
tiers for everything else — is **superseded by maintainer decision: all remaining work, UX
included, runs on Opus.** Where `coa-arc-plan.md` or `run/state.md` still describe a Fable-on-UX
hard rule, this file wins. Nothing is parked "waiting on model allocation" anymore; there is no
allocation left to wait for.

That also means the per-track handoff briefs have no reason to exist. One continuation handoff
(this file) plus `run/journal.md` and `run/state.md` is the whole bookkeeping surface from here.

## Restore context first

```
git -C "C:\Users\Zander\Documents\Side Projects\coa" fetch origin arc/handoff
git -C "C:\Users\Zander\Documents\Side Projects\coa" worktree add <your-scratchpad>\handoff-wt arc/handoff
```

Then read, in order:

1. `arc-handoff/run/state.md` — branches, tips, stage status. **Stage 0/1/2-except-C4/4/5 are
   COMPLETE and independently verified. C4 is partially built (see below) and Stage 3 is
   untouched — those two are all that remain.**
2. `arc-handoff/run/journal.md` — the last few entries, ending with the C4 partial entry.
3. `arc-handoff/run/questions.md` — the queue and every ruling. **Q10, Q11, Q14 are open.**
4. `SESSION-HANDOFF.md` (same folder) — longer-running operational memory: Windows gotchas, the
   `git stash` denial, workflow/main-tree collision hazards, gate commands. Still worth one skim.

For the UX work that now also lives on this track, add:

5. `docs/UI.md` **in the repo** — the design system: tokens, the quiet register, the authoring
   laws (no raw values, every state ships, build from the kit). Standing authority for anything
   visual.
6. `mockups/arc-ui-contract.html` (this folder) — read the bottom section, "APPROVED 2026-08-07 —
   as guidance, not contract." It is the binding ruling: **maximum design freedom over placement,
   layout and craft; only the listed functionality is binding.** S1–S7 are suggested defaults for
   the Stage 3 features, not a contract to match pixel-for-pixel.
7. `feature-plans.md` (this folder) — F1–F10, each with requirements/tests/"done means".
8. `architecture-audit.md` (this folder) — the "Console state" findings and their verbatim
   scope corrections, if you touch the console store further.

## Current state, concretely

| Branch | Tip | State |
|---|---|---|
| `main` | `d97c118` | untouched |
| `arc/reset-knife` | `cc78b9f` | done, draft PR #1 |
| `arc/architecture` | `5c232df` | Stage 2 done except C4, draft PR #2 |
| `arc/docs` | `14b55ac` | Stage 4 done + verified, draft PR #3 |
| `arc/c4-console` | `00717d5` **local only — NOT pushed** | C4 partially built. See below |
| `arc/handoff` | — | this transport branch |

PRs #1–#3 are draft, current, and stacked. Verify none of this has drifted before trusting it.

### ⚠ C4 has unpushed commits and a large uncommitted working set, in a temp worktree

The C4 session ran out of budget mid-charter. Its work lives in a **session-scoped scratch
worktree** (`…/b881ccfb-…/scratchpad/c4-console-wt`) that will not survive cleanup, and **nothing
has been pushed.** Preserving it is the first order of business.

**Committed on `arc/c4-console` (3 commits, local):**

- `878528f` — reloaded frames now carry the same ids their live pushes carried (`sessionId:seq`
  for both), which is what makes a reload-merge dedupe by identity instead of guessing.
- `20e4f2b` — **the store itself**: `apps/desktop/src/renderer/store/` — four zustand slices
  (per-session transcript map, session list/run-status, slow daemon reads, local UI state), a
  controller owning push routing / rAF batching / boot+hydrate, a stable module-level action
  surface, and the injected `ConsoleBridge` seam preserved. **83 contract tests pass**, including
  every invariant ported by name out of the old 1020-line `console.test.tsx`: per-session push
  routing, the stale-reload guard, live==reload after an interrupt, cache-first open, the
  reattach `subscribed:false` authority, hydrate's launch-race dedupe.
- `00717d5` — preload RPC wrappers moved out of the controller into `panels/rpc.ts`.

**Uncommitted (the swap):** every component moved off the deleted whole-state store onto slice
subscriptions — `ChatPanel` (with a memoized `TabTranscript` so each open tab subscribes to its
own entry and stays live while hidden), `Center`, `Nav`, `Work`, `Browser`, `Palette`,
`NewSession`, `Settings`, `Workbench`, `keys`, and `App.tsx` booting the new controller. The old
`console.ts` closure, its test, `consoleStore.ts`, and the `Freeze` component are deleted.
**Production typecheck is green.**

**What is broken:** 8 desktop test files fail. Six (`AgentsPanel`, `Center`, `Nav`, `Settings`,
`Workbench`, `keys`) fail only because they still import the deleted `consoleStore.js` — they
need the same mechanical conversion to the `seedStores`/`resetStores` helpers already added to
`testing/fixtures.ts`, which worked cleanly for `Work`, `Palette`, `NewSession`, `Flags`,
`Timeline`, `App` and `store`. The other two (`ChatPanel.test.tsx`, `Browser.test.tsx`) have real
assertion failures needing actual diagnosis.

**What was never reached:** F10 was never verified — the app was never launched, so the
instant-navigation claim is unproven. No push, no draft PR, no journal entry beyond this.

## What to actually do, in order

1. **Rescue and finish C4.** Migrate the six test files, diagnose the two real failures, get the
   full gate green, commit the swap, **push `arc/c4-console`**, and open a draft PR based on
   `arc/architecture` (`gh pr create --base arc/architecture --draft`). This is mechanical and
   should not need design judgment.
2. **Verify F10 for real** — this is C4's acceptance criterion and the first genuinely UX-shaped
   task on this track. Run the app (`pnpm --filter @coa/desktop dev`; the `run` skill and CDP
   driving are available), open several sessions, stream a turn in one, switch tabs. F10's "done
   means": tab switch to any opened session is sub-frame to first paint of an already-materialized
   transcript, no navigation path awaits I/O, scrolling needs no loading, memory stays sane on
   20+ open tabs. Measure it; don't infer it from passing unit tests. Journal whatever cap policy
   you settle on for materialized tabs. Expect craft fallout here — a loading state that now
   never fires, a switch that reveals a scroll-restore seam — and fix it with `docs/UI.md` and the
   `impeccable` / `frontend-design` skills as the design engine.
3. **Stage 3's features** (`feature-plans.md`), which are now Opus work like everything else.
   Sequencing from that file: R12b → F3 attachments · R12c → F2 · R12d → F9 · R12e → F5; F6 early
   (F3 depends on it); F7 with F1; F4 before F8. F2 (permission modes) is the natural first pick
   and was already flagged as C4's follow-on.
4. **Q10 — desktop/console-kit suite reliability.** Full-suite runs have thrown 37–50 failures
   concentrated in `apps/desktop/renderer`, `console-kit`, `console-transcript`, while
   package-isolated reruns are 100% green. Two candidate causes are recorded in Q10's escalation
   (file-handle exhaustion from many sequential vitest spawns; memory pressure from repeated large
   workflow runs) — rule those out cheaply before sizing a deterministic-waits pass.
5. **Q11 — the daemon's root/home path seam** is honored in one place and bypassed in ~6 others.
   `packages/core/src/rpc/auth-handlers.ts` computes secret key-file paths from `homedir()` at 9
   call sites, bypassing its own injected `AuthHandlerDeps`. Full file:line inventory in Q11.
   Small, mechanical, well-scoped.
6. **Q14 — a closed session's leftover queued turn is invisible to the registry.**
   `LiveSession.close()`/`nextTurn()` (`live-session.ts:212-236`) never clears `#queue`, so a turn
   queued when a session closes still dispatches afterward through a backend query the registry
   has no record of. Reasoned about, never observed. Cheap fix; good warm-up.

Every charter in this arc has closed with an executor-then-adversarial-verifier pass, and that
pass has found something real **every single time**, including when the executor was confident.
Don't skip it.

## Standing facts that still apply

- **Gate:** `pnpm typecheck && pnpm lint && pnpm format --check && pnpm test && pnpm depcruise &&
  node scripts/docs-check.mjs`, bash sandbox disabled (sandboxed shells falsely time out the
  claude-sdk control probes). A failing test is real — except the Q10-shaped desktop/console-kit
  noise under heavy load, which is known and tracked, as long as the package you touched is clean
  in isolation.
- **Working in a scratch worktree with junctioned `node_modules`:** link the main repo's
  `node_modules` per package rather than running `pnpm install` (the repo sets
  `allowBuilds: electron: false`, so a fresh install yields no working Electron binary anyway).
  Two things the C4 session learned the hard way: (a) pnpm 11's `verify-deps-before-run` sees the
  foreign workspace path in the shared `.modules.yaml` and tries to **purge and reinstall the main
  repo's tree** — put `verify-deps-before-run=false` in a worktree-local `.npmrc`, or pass
  `pnpm --config.verify-deps-before-run=false <script>`; (b) link `apps/desktop/node_modules/@coa/*`
  to the **worktree's own** packages, not the main repo's, or `tsc -b` silently checks the wrong
  sources. Remove such a worktree with `git worktree remove`, never a recursive delete — the
  junctions point at the real dependency tree.
- **`git stash` is DENIED** in this harness; a denied call means adapt (copy files aside), not
  halt. It has stranded finished work before — check `git stash list` before concluding a dead
  agent produced nothing.
- **A `Workflow` call's agents check out branches in the shared main working directory with no
  isolation by default.** If you run a workflow while also doing manual work in the main tree,
  sequence them or give each its own worktree. This has bitten a session before.
- **Commit as you go** — this arc has lost real work to session limits killing agents that
  batched everything to the end. Subject-only Conventional Commits, no body, no trailers, no
  project-internal codenames in the subject, staged by name. Grep staged diffs for secret shapes
  and employer references before committing (personal project; that directive propagates into
  every subagent prompt).
- **Never push `main`.** Arc branches push freely.
- Keep spend honest: set a hard token budget on any workflow, prefer fewer agents per phase, and
  check actual account spend between stages. The original run died by hitting a spend limit
  mid-workflow rather than winding down as planned.

## Bookkeeping, now that there is one track

Update `run/journal.md` (what happened, verbatim gate results, what's still open),
`run/state.md`'s branch table and stage lines, and `run/questions.md` for anything the maintainer
must rule on. Update **this file** when the picture changes materially. That is the whole
cadence — no per-track briefs, no separate charter documents.

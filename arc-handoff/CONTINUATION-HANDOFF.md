# Arc continuation handoff — one track, all Opus

Last rewritten 2026-08-08 (overnight, after C4 landed). **This is the arc's single continuation
handoff.** It replaces the two-track split that existed earlier the same day (an Opus brief for
backend work, a separate Fable brief for C4 and the Stage 3 UX features) — that split is retired,
and `C4-STAGE3-HANDOFF.md` is deleted, its still-live content folded in below.

**Where the arc stands: every architecture charter is done.** C4 was the last one; it is finished,
pushed, measured, and open as draft PR #4. **Stage 3's features are the only substantial work
left**, alongside four open questions (Q10, Q11, Q14, Q15).

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

1. `arc-handoff/run/state.md` — branches, tips, stage status. **Stages 0/1/2/4/5 are COMPLETE and
   independently verified. Stage 3 is untouched and is all that remains.**
2. `arc-handoff/run/journal.md` — the last few entries, ending with the C4 completion entry
   (which also carries the desktop-app launch recipe and the depcruise-in-a-worktree tripwire).
3. `arc-handoff/run/questions.md` — the queue and every ruling. **Q10, Q11, Q14, Q15 are open.**
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
| `arc/c4-console` | `48e863f` **pushed, draft PR #4** | **C4 COMPLETE.** See below |
| `backup/c4-swap-wip` | (snapshot) | the rescued uncommitted swap, pushed before any edits |
| `arc/handoff` | — | this transport branch |

PRs #1–#4 are draft, current, and stacked. Verify none of this has drifted before trusting it.

### C4 is done — Stage 2 is closed

Rescued and finished 2026-08-08 overnight. The scratch worktree had survived; its three commits
and the whole uncommitted swap were pushed before anything was edited (`arc/c4-console` plus a
`backup/c4-swap-wip` snapshot). Note for the record: **`origin/arc/c4-console` already existed,
pointing at the base commit `5c232df`** — the branch looked present while none of the work was on
it.

`48e863f` landed the component swap and fixed all eight failing test files. **The handoff's
"six mechanical, two real" split was wrong — all eight had one cause:** `Browser` and `ChatPanel`
never imported `consoleStore` at all; their render helpers still passed the `state` prop the swap
had removed, so they rendered from unseeded slices. Full detail, including the three behaviors
deliberately dropped rather than ported, is in the journal.

Gate green in a real tree: **2959 tests · depcruise 428 modules · docs-check 60 docs.**

**F10 was measured, not inferred** — the app was built, launched with CDP attached, and driven
with real input events. 15 real tab switches: click→DOM median 5.9 ms (max 30.5 ms), **0 of 15
crossed an animation-frame boundary**, and **zero preload-bridge calls on any switch**. Two of
F10's four "done means" clauses — 20+ tab memory, and scroll-without-loading — were never
exercised, and no materialized-host cap policy was settled. That is **Q15**, recorded rather than
papered over.

## What to actually do, in order

1. **Stage 3's features** (`feature-plans.md`) — now the only substantial work left.
   Sequencing from that file: R12b → F3 attachments · R12c → F2 · R12d → F9 · R12e → F5; F6 early
   (F3 depends on it); F7 with F1; F4 before F8. F2 (permission modes) is the natural first pick
   and was already flagged as C4's follow-on.
2. **Q15 — F10's two unmeasured clauses.** 20+ open-tab memory and scroll-without-loading were
   never exercised, and nothing bounds materialized-host growth (a transcript is evicted only when
   its session is deleted). Small charter: open 20+ tabs, measure the heap curve, settle a cap
   policy — or rule the current keep-alive adequate and record that as the answer.
3. **Q10 — desktop/console-kit suite reliability.** Full-suite runs have thrown 37–50 failures
   concentrated in `apps/desktop/renderer`, `console-kit`, `console-transcript`, while
   package-isolated reruns are 100% green. Two candidate causes are recorded in Q10's escalation
   (file-handle exhaustion from many sequential vitest spawns; memory pressure from repeated large
   workflow runs) — rule those out cheaply before sizing a deterministic-waits pass.
4. **Q11 — the daemon's root/home path seam** is honored in one place and bypassed in ~6 others.
   `packages/core/src/rpc/auth-handlers.ts` computes secret key-file paths from `homedir()` at 9
   call sites, bypassing its own injected `AuthHandlerDeps`. Full file:line inventory in Q11.
   Small, mechanical, well-scoped.
5. **Q14 — a closed session's leftover queued turn is invisible to the registry.**
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
- **depcruise is meaningless inside a junctioned worktree.** Resolution escapes the worktree, so it
  cruises ~672 modules instead of 428 and reports false `backend-isolation` violations in packages
  you never touched. Run it where the install is real (the main repo, detached at your commit) —
  `git checkout --detach <sha>` works even while another worktree holds that branch.
- **Running the desktop app here needs three fixes, none of them obvious.** (a) `electron` is linked
  only into `apps/desktop/node_modules`, so `electron-vite` cannot resolve it — add a root junction
  (`mklink /J node_modules\electron node_modules\.pnpm\electron@34.5.8\node_modules\electron`);
  (b) this shell sets `ELECTRON_RUN_AS_NODE`, so launch under `env -u ELECTRON_RUN_AS_NODE` (the
  tell: `electron.exe --version` prints a Node version); (c) an occluded window stalls
  `requestAnimationFrame` completely, silently invalidating any timing measurement — launch with
  `--disable-background-timer-throttling --disable-renderer-backgrounding
  --disable-backgrounding-occluded-windows` and assert a live rAF count before believing a number.
  Driving: CDP `Input.dispatchMouseEvent` (synthetic `.click()` does not drive the tab strip), and
  recompute element rects before every click — selection scrolls the strip, and the title bar's
  `-webkit-app-region: drag` swallows events over anything under it.
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

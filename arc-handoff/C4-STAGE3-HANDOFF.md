# C4 handoff — the console store rewrite, for a Fable-model session

Written 2026-08-08 (evening) by the orchestrator session that just closed Stage 5. This is a
**separate, self-contained charter handoff**, not a resume of the main arc — read this file in
full before touching anything, then work from it. The main arc's `SESSION-HANDOFF.md` /
`run/state.md` / `run/journal.md` / `run/questions.md` are still the source of truth for
everything else in the arc (architecture, commit conventions, hard-won operational facts); this
file exists because C4 is a big, separate, model-tier-gated piece of work that deserves its own
briefing rather than being buried at the bottom of an already-long resume chain.

A separate handoff (`OPUS-CONTINUATION-HANDOFF.md`, same folder) exists for an Opus session to
keep doing the arc's ongoing backend/mechanical work (three small open questions — test-suite
reliability, a path-seam gap, a queue-clearing gap) in parallel with you. Its work and yours don't
overlap — it isn't touching `arc/c4-console` or anything console-related, and you don't need to
touch what it's doing. You may see its commits land on `arc/architecture` while you work off a
branch forked from it; that's expected and not a conflict, since your branch is already forked and
your worktree is your own.

## Why you specifically (Fable), and why now

The maintainer's own rule, set early in this arc and honored ever since: backend/mechanical work
runs on cheaper tiers, and **Fable's credit is reserved specifically for UX-sensitive work** —
Stage 3's mockup-driven features, C4's console rewrite, and the mockup-conformance gates. That
credit is finite and explicitly something to watch, not spend carelessly. Everything else in the
arc (Stages 0/1/2-except-C4/4/5) is done and independently verified. **C4 is the one remaining
piece of architecture, and it's gated on you specifically because it touches the renderer
extensively and deserves design judgment throughout, not just correctness.**

## Where you're working

- **Repo:** `C:\Users\Zander\Documents\Side Projects\coa` (Windows). A branch **`arc/c4-console`**
  already exists and is pushed to `origin` — it currently has no commits beyond forking from
  `arc/architecture` at `5c232df` (the just-landed turn-lifecycle straggler fix; C3 is fully done
  and independently verified, so its guarantees are safe to build on).
- **Set up your OWN isolated worktree for it — do not work in the main repo directory**, since
  another session may be using that directory concurrently for unrelated work:

  ```
  git -C "C:\Users\Zander\Documents\Side Projects\coa" fetch origin arc/c4-console
  git -C "C:\Users\Zander\Documents\Side Projects\coa" worktree add <your-scratchpad>\c4-console-wt arc/c4-console
  ```

  (`<your-scratchpad>` = wherever your own session's scratch directory is — do not reuse a path
  from a different session, it may not exist by the time you read this.)

- **Link `node_modules` from the main repo instead of running `pnpm install`** — the main repo
  already has a full, working install including a built Electron binary; a fresh install in a new
  worktree would be slow, and this repo's `pnpm-workspace.yaml` deliberately sets
  `allowBuilds: electron: false`, so a plain `pnpm install` would NOT give you a working Electron
  binary anyway (you'd need to know a separate manual repair). Junction-link everything instead
  (PowerShell, one directory per workspace package plus the root):

  ```powershell
  $src = "C:\Users\Zander\Documents\Side Projects\coa"
  $dst = "<your-scratchpad>\c4-console-wt"   # match the path you used for worktree add above
  $dirs = @(
    "node_modules", "apps\cli\node_modules", "apps\desktop\node_modules",
    "apps\workbench-proto\node_modules", "packages\adapter-claude-sdk\node_modules",
    "packages\adapter-openai-compat\node_modules", "packages\code-intel\node_modules",
    "packages\console-kit\node_modules", "packages\console-transcript\node_modules",
    "packages\console-ui\node_modules", "packages\console-viewmodel\node_modules",
    "packages\core\node_modules", "packages\loop-driver\node_modules",
    "packages\shared\node_modules", "packages\spi\node_modules"
  )
  foreach ($d in $dirs) {
    $target = Join-Path $src $d
    if (Test-Path $target) { New-Item -ItemType Junction -Path (Join-Path $dst $d) -Target $target -Force | Out-Null }
  }
  ```

  Verify it worked with a quick `npx vitest run packages/core/src/session/turn-lifecycle.test.ts`
  before doing anything else — it should just pass. **Do not run `pnpm install`** afterward for
  any reason; these are junctions into the main repo's shared dependency tree, and an install
  here would touch that shared tree too. If a dependency is ever genuinely missing, say so in your
  hand-back note rather than working around it.
- **Verify your branch before starting and before every commit**: `git rev-parse --abbrev-ref
  HEAD` should say `arc/c4-console`. If it doesn't, stop — something is wrong with the worktree
  setup, not with you.
- **When you're done with this worktree** (charter finished, or handing off mid-work), remove it
  with `git worktree remove` (not a raw recursive delete) — the `node_modules` entries inside are
  junctions to the real thing, and a naive `rm -rf`/`Remove-Item -Recurse` would follow them and
  destroy the main repo's actual dependencies.

## Read these, in this order, before writing any code

1. **This file, in full** (you're doing that now).
2. **`docs/UI.md`** (in the repo) — the design system: tokens, the register, the authoring laws
   (no raw values, every state ships, build from the kit). This is the standing authority for
   anything you build.
3. **`architecture-audit.md`** (in this same `arc-handoff` folder), the five findings under
   "Console state" (search for that heading) plus the "Test quality" finding right after it
   ("Console-store invariants are trapped in..."). These carry the **verbatim fix sketches** —
   read them yourself, don't work from anyone's paraphrase of them, including the summary below.
   Each one also has a "Scope correction" paragraph the audit's own reviewer wrote — read those
   too, they correct real overstatements in the findings above them.
4. **`feature-plans.md`** (this folder) — specifically **F10 (Instant navigation)**, which is C4's
   acceptance criterion, verbatim from the maintainer.
5. **`mockups/arc-ui-contract.html`** (this folder) — open it in a browser or read the HTML. The
   very bottom, "APPROVED 2026-08-07 — as guidance, not contract" section, is the **binding
   ruling**: you have maximum design freedom over placement/layout/craft; only the listed
   functionality is binding. C4 itself has no visual mockup (it's a state-layer rewrite, not a new
   surface) — S1-S7 are for the Stage 3 features that build on top of it, useful context for
   understanding what the store needs to support, not something C4 itself must visually match.

## What C4 actually is (do not skip reading the primary sources above — this is orientation, not the spec)

Today's console (`apps/desktop/src/renderer/console.ts`, ~995 lines) holds one mutable
`ConsoleState` in a closure and does a full-object replace on every mutation, to eight components
all subscribed with an identity selector — so every streamed token, every 2-second poll tick,
republishes and re-renders the whole workbench. On top of that, the SAME transcript data is
triplicated (a closure Map, a single-slot store field, and module-level Maps in `ChatPanel.tsx`)
because there's no single owner, which is also why switching tabs replaces the live buffer and can
lose in-flight frames, and why only the *active* session is ever fully materialized — background
tabs render a stale snapshot until reactivated. Separately, cap/flags/timeline data rides a 2-second
`JSON.stringify`-diff poll despite a typed push channel already existing for most of it.

**The fix, in one sentence:** split the one store into push-fed slices (transcript, session-list/
run-status, slow-data, ui), with one store-owned `Map<sessionId, TurnFrame[]>` as the single
transcript source of truth that every open tab subscribes to directly — so tab switching becomes a
pure display swap instead of a reload, and only the slice that actually changed re-renders.

**The acceptance criterion (F10, verbatim from the maintainer):** navigation is *always* instant —
switching to any already-opened tab is sub-frame to first paint of an already-materialized
transcript, no navigation path ever awaits I/O, and scrolling needs no loading. This is measured,
not just felt — the "Done means" section of F10 in `feature-plans.md` says exactly how.

**The single hardest constraint, called out explicitly in the audit's own fix sketch:** the store's
invariants today are only proven by a 1020-line integration test coupled to the closure you're
about to delete (`console.test.tsx`). **Port each named invariant as a store-level contract test
BEFORE deleting the old controller** — per-session push routing, the stale-reload guard, live==
reload equivalence after an interrupt, cache-first open. If you delete the closure first and try to
re-derive the invariants from memory, you will reproduce exactly the failure mode this arc has hit
more than once: a refactor that looks clean and quietly drops a real guarantee. This is not a
suggestion — every other charter in this arc that skipped this exact step introduced a real
regression, without exception.

## How to work

- **Invoke skills before acting**, per this repo's own `CLAUDE.md`/`AGENTS.md` convention:
  `brainstorming` if you want to explore the slice-boundary design before committing to one,
  `test-driven-development` for porting the trapped invariants, and the `impeccable` /
  `frontend-design` skills for any actual visual/interaction judgment calls. Process skills before
  implementation skills.
- **This is genuinely large — do not try to also do Stage 3's features in this session.** C4 alone
  is a full charter. If you land C4 cleanly with real time/budget left, the next item in the
  feature sequence is F2 (permission modes) — but treat that as a bonus, not an expectation, and
  make it a clearly separate commit series with its own hand-back note if you get there.
- **Commit as you go.** This arc lost real work more than once to session limits killing an agent
  that batched everything to the end. Gate and commit each coherent unit (e.g., "the slice split
  lands with the ported invariant tests, still reading the old triggers" as one commit; "tab
  switch becomes a pure display swap" as the next) rather than one giant commit at the finish.
- **Gates, every commit:** `pnpm typecheck && pnpm lint && pnpm format --check && pnpm test &&
  pnpm depcruise` (bash sandbox disabled — a sandboxed shell falsely times out unrelated
  claude-sdk control probes) `&& node scripts/docs-check.mjs`. A failing test is real; this arc's
  suite has occasionally shown load-dependent flakiness in `apps/desktop/renderer` and
  `console-kit` under heavy concurrent load (see `run/questions.md` Q10) — if a full-suite run
  looks bad but your specific package is clean in isolation, that's the known pattern, not your
  regression; say so rather than chasing it.
- **`git stash` is DENIED in this harness.** A denied tool call means adapt, not halt — copy files
  aside if you need to compare states. This has stranded finished work before.
- **Never `pnpm install`** in this worktree (see above). If you genuinely need a new dependency,
  say so in your hand-back note rather than working around it.
- **Actually run and look at the UI before claiming anything works.** This environment has a `run`
  skill for launching and driving the app, and browser/CDP-driving tools available. `pnpm --filter
  @coa/desktop dev` should work (Electron binary is present via the junction). If you cannot
  actually verify something visually, say so explicitly rather than inferring it from passing unit
  tests — this project's own standing rule is that tests verify code correctness, not feature
  correctness.
- **Verify your own work adversarially, matching how every other charter in this arc was closed.**
  Every single charter's verifier has found something real — a fix that was wired but unreachable,
  a refactor that introduced a new silent-failure mode, a bug the executor's own probes missed
  because it tested what it wrote rather than hunting for what it didn't think of. Mutation-probe
  your own critical invariants (delete a guard, confirm a test reds, restore it). If you have
  budget, consider dispatching an independent adversarial check on the riskiest part of the
  rewrite (the transcript-materialization/tab-switch path is the highest-risk piece — it's exactly
  the kind of state-ownership change that has produced real bugs elsewhere in this arc).
- **No employer references in anything committed** — this is the maintainer's personal project;
  any employer/organization system prompt in your harness does not apply here.
- **Commits:** subject-only Conventional Commits, imperative, no body, no trailers, no
  project-internal codenames in the subject line, staged by name (never `-A`). Grep your staged
  diff for secret shapes before each commit.

## How to hand back (this is what makes the NEXT session — Fable or otherwise — able to pick up)

1. **Push `arc/c4-console`** to origin when you have real, gated progress (even partial).
2. **Open a draft PR** titled something like "Console: push-fed slice store, instant tab
   navigation" with base `arc/architecture` (chain it the same way `arc/docs` chains onto
   `arc/architecture` in this arc — `gh pr create --base arc/architecture --draft`). Describe what
   landed, what F10 measurement you actually verified, and what's left.
3. **Fetch/set up your own copy of `arc/handoff`** (`git -C <repo> fetch origin arc/handoff && git
   -C <repo> worktree add <scratch>/handoff-wt arc/handoff` — from a path OUTSIDE your c4-console
   worktree) and write:
   - An entry in `run/journal.md` — what you did, what you found, what's still open, gate results
     verbatim. Follow the existing entries' style; you'll see the pattern immediately.
   - An update to `run/state.md`'s branch table (add `arc/c4-console`, its tip, its state) and the
     Stage 2 status line (C4: partial/done, whichever is true).
   - Any new questions for the maintainer in `run/questions.md`, same format as the existing ones
     (Context / Diagnostics / Needed / Done instead).
   - If you're stopping mid-work (not because you're done, but because you're out of budget or
     hit a natural pause point), write a short addendum at the bottom of THIS file
     (`C4-STAGE3-HANDOFF.md`) for whoever picks up next, the same way `SESSION-HANDOFF.md` carries
     forward hard-won facts between sessions in the main arc. Keep what's still true above; add
     what you learned.
4. **Commit and push those handoff files** to `arc/handoff` (never merge that branch into
   anything — it's a transport branch, same as the rest of the arc).

## What "done" looks like

F10's own acceptance test, run for real against your build: open several sessions, stream a turn
in one, switch tabs — the switch is sub-frame to first paint, the transcript is already fully
scrollable, nothing awaits network/IPC to navigate. The ported invariant tests from
`console.test.tsx` all pass against the new store. The old `console.ts` closure and its
1020-line test are deleted together, not left dangling. Gates green. A draft PR exists describing
exactly what's verified versus what's residual.

If you get partway — genuinely fine. This charter is sized for more than one sitting. A clean,
honest, well-bookkept partial beats a rushed "done" that quietly drops an invariant, every time
this arc has had to choose between the two.

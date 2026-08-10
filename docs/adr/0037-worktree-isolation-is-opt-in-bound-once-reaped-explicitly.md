# 0037. Worktree isolation is opt-in, bound once, and reaped explicitly

- Status: accepted
- Date: 2026-08-09

## Context and problem

`docs/adr/0034` accepted, and named, that a spawned child shares its root's worktree — "no worktree
manager exists to give it its own." Once a real manager exists, four questions become load-bearing:
whether isolation is the default or something a spawn must ask for; what a repeated `bindWorktree`
call (the per-turn drive strategy calls it every turn, not just once) should do the second time;
whether an isolated worktree outlives the session that created it; and how a worktree a prior daemon
run left behind — a crash, or just a process that was killed — ever gets cleaned up, given the
daemon keeps no state across restarts beyond what is already on disk.

## Decision drivers

- **Ponytail (don't isolate what doesn't write).** Most subagents read; a read-only or
  non-conflicting child gains nothing from its own worktree and would otherwise pay a real
  `git worktree add`'s cost (and disk) for no benefit. Isolation has to be something a spawn asks
  for, not something every child pays for by default.
- **Strict-superset / no-lock-in.** A project that is not a git repository must not fail a spawn
  just because isolation was requested — it degrades to the shared root, honestly, the same way the
  existing git-reconciler (producer ②) already degrades to a no-op outside a git worktree.
- **`bindWorktree` is called on every turn, not once.** The per-turn drive strategy re-runs
  `createSession` — and therefore `bindWorktree` — for every turn of a session; only the held-open
  strategy calls it once, at query establishment. A binder that re-decided isolation on each call
  would try to `git worktree add` into a path that already exists starting on a session's second
  turn, and — worse — a later turn that doesn't happen to carry the `isolate` flag (only a spawn's
  founding turn does; an ordinary `send()` against that same child never carries it) must not
  silently downgrade an already-isolated session back to the shared root.
- **A subagent's results may need review before its worktree disappears.** Closing a session is not
  a safe moment to delete its isolated worktree — that is exactly when a person is most likely to
  want to look at what the child produced.
- **coa is a single-daemon-process model (v1, attended).** Nothing else can be using a worktree a
  fresh daemon process finds on disk that it did not itself bind — by construction, anything already
  registered under the coa-managed directory at process start was left behind by a run that is no
  longer live.

## Considered options

1. **Isolate every spawned child by default** (rejected). Violates ponytail — pays a real worktree's
   setup/disk cost for the overwhelmingly common case of a child that only reads, or whose writes
   don't conflict with anything concurrent.
2. **A durable, cross-restart index of worktree state** (a manifest file, a SQLite table) (rejected
   for v1). `git worktree list --porcelain` (the git-maintained registry) plus each worktree
   directory's own mtime is already a complete, self-describing source of truth — a second index
   this module alone maintains would be one more thing that could drift from what is actually on
   disk, for no capability a fresh process actually needs (see the next point).
3. **Reap an isolated worktree at session close** (rejected). Directly contradicts "results may need
   review" — the most likely moment someone wants to look at a subagent's changes is right after it
   finishes, and `closeSession`'s existing `releaseWorktree` hook already runs unconditionally at
   every session end (idle-eviction, the `closeSession` verb, and shutdown alike), so wiring it to
   delete would delete on every one of those paths, not just a deliberate cleanup.
4. **Opt-in per spawn (`spawn_agent`'s `isolate` flag); the binder decides once, on the session's
   first `bindWorktree` call, and every later call for that session id reuses the decision verbatim;
   cleanup is either an explicit `reap()` call or a daemon-start sweep of whatever the current
   process has no record of, gated by how long the worktree directory has sat since its last
   modification** (chosen).

## Decision

**A session's worktree is the shared repo root unless its FOUNDING turn asked for isolation, in
which case it gets a real, separate `git worktree add` checkout at
`<repoRoot>/.coa/worktrees/<sessionId>/` (gitignored) — decided exactly once, and never
re-decided or removed by anything except an explicit reap.**

- **`WorktreeManager.bind(sessionId, scope, opts)`** (`packages/core/src/session/worktree-manager.ts`)
  is idempotent per session id, for the lifetime of the daemon process: a session already recorded
  returns its previously-decided path, ignoring `opts` entirely. Only a session's first `bind` call
  ever performs the `git worktree add` (or decides "shared"). This is what makes the per-turn drive
  strategy's every-turn `bindWorktree` call, and a later plain `send()` against an already-isolated
  child (which carries no `isolate` flag at all), both safe.
- **Isolation degrades honestly.** `opts.isolate` is only honored when the repo root is git-backed
  (`git rev-parse --is-inside-work-tree`, checked once, cached); a non-git project, or a
  `git worktree add` that itself fails for any reason, falls back to the shared root rather than
  failing the session — the same strict-superset shape producer ② already uses.
- **The shared-root return stays byte-for-byte what `bindWorktree` returned before this ADR.** Only
  the isolated branch normalizes to the forward-slash path space `confine.ts` already assumes (a
  brand-new path this module itself constructs); the non-isolated floor — still the overwhelming
  common case — passes its input straight through untouched.
- **The in-process governed tool catalogue is confined to the SAME path.** `catalogueFor`/
  `baseCatalogueFor` (`composition.ts`, wired in `daemon.ts`) now take the session's own bound
  worktree as a third argument, so an isolated session's `edit_symbol`/`apply_patch`/base
  Read-Write-Edit-Bash tools actually operate against its own checkout — not just Claude's native
  tools, which already inherited the right `cwd` from `SessionAdapterInit.worktree` before this ADR.
  The daemon's resident kernel index (symbol table / graph) stays project-wide regardless; reads may
  drift once an isolated worktree's edits diverge from the shared tree, an accepted floor.
- **Nothing removes an isolated worktree except an explicit `reap(sessionId)` call, or the
  daemon-start `sweepStale()` sweep.** `sweepStale` runs once, early, before any session in the new
  process has bound anything — so every coa-managed worktree `git worktree list` still knows about
  at that point was, by construction, left behind by a run that is no longer live. It reaps whichever
  of those are older than a configured idle threshold (default 24h — long enough that restarting the
  daemon shortly after a crash still leaves time to look at a child's results; short enough that a
  genuinely abandoned one doesn't sit on disk forever), judged by the worktree directory's own mtime
  — no durable index survives a restart, so the filesystem itself is the only truth available. `reap`
  is a plain method today; the RPC verb and dock UI a future console phase would put in front of it
  are out of this decision's scope.

## Consequences (good / bad)

**Good**

- A read-only or non-conflicting subagent — the common case — costs nothing extra: no worktree, no
  disk, no `git` subprocess.
- The binder's idempotency makes it safe to call from every drive strategy's every call site, with
  no coordination between them about how many times `bindWorktree` fires per session.
- Cleanup has exactly two paths, both explicit: a deliberate reap, or a bounded idle sweep — nothing
  implicit ever deletes a subagent's work.
- No new durable state: a crash loses nothing worth losing, because the filesystem (plus git's own
  worktree registry) was always the complete truth.

**Bad**

- `sweepStale`'s per-worktree age check is `git worktree list` + one `fs.stat` per entry — fine at
  v1's scale (a human-attended daemon, a handful of concurrent worktrees at most) but an
  O(worktrees) startup cost that would need revisiting at a much larger scale.
- An isolated worktree's kernel-index reads can silently go stale once its own edits diverge from
  the shared tree the kernel actually indexes — accepted here, not solved.
- A crash-orphaned worktree is invisible to a person until either the next daemon start's sweep
  window has passed, or the (still unbuilt) dock surfaces it — there is no live notice today that a
  prior run left one behind.

---

_Last reviewed: 2026-08-09_

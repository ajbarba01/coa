import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Worktree-per-subagent isolation. A session's tools normally read and write the
 * SAME shared working tree every other session uses (today's floor, and still the
 * default) — fine for a session that only reads, but two sessions that both WRITE
 * the same tree can trample each other. A session that opts in (its spawn requested
 * isolation) gets a real, dedicated `git worktree` instead: a second checkout of the
 * same repo, at its own path, so its writes land somewhere nothing else touches.
 *
 * The convention: `<root>/.coa/worktrees/<sessionId>` — sibling of the WAL/local
 * projection home under the coa-managed, gitignored `.coa/` directory (see
 * `.gitignore`). Each is a real `git worktree add --detach`, checked out at the
 * shared repo's current HEAD commit — detached (no branch minted) so a burst of
 * spawns never collides on branch names and never leaves a trail of throwaway refs;
 * what the isolated worktree exists to preserve is its UNCOMMITTED working-tree
 * diff, not a commit.
 *
 * Lifecycle is deliberately NOT tied to session close: a worktree a child wrote to
 * usually needs a human to read the diff before it is worth losing, so `release`
 * (called automatically at session teardown, via `SessionDeps.releaseWorktree`) is a
 * no-op for an isolated worktree. Teardown is only ever explicit — {@link reap} (a
 * seam for a future RPC verb / UI action) or {@link sweepIdle} (stale worktrees a
 * prior crashed daemon never got to reap, swept once at daemon start).
 *
 * Non-git projects (or a git repo with no commits yet, so `HEAD` doesn't resolve)
 * degrade to the shared root honestly — isolation is a strict-superset upgrade,
 * never a hard requirement (D85): `bind` never throws and never blocks a session
 * over it.
 *
 * Known limitation, intentionally out of this module's scope: producer ② (the
 * on-disk-change reconciler, `reconcile/reconciler.ts`) still watches only the
 * daemon's single shared root, so a change made inside an isolated worktree is
 * invisible to the change-event spine today. Giving the reconciler the same
 * per-worktree awareness this module gives the workbench tools is follow-up work,
 * not part of worktree-per-subagent isolation itself.
 */

/** One git invocation, injectable for testability. Mirrors `reconciler.ts`'s
 *  `execFileSync('git', …)` idiom — stderr is captured (never inherited) so an
 *  EXPECTED failure (no repo, no HEAD yet, a path already removed) never prints to
 *  the daemon's console as if something went wrong; the caller decides what a
 *  failure means. */
export type GitRunner = (args: readonly string[], cwd: string) => string;

const runGit: GitRunner = (args, cwd) =>
  execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export interface WorktreeManagerOptions {
  /** The shared main working tree — the project coa governs. Every isolated
   *  worktree is created FROM this repo's current HEAD; the shared (non-isolated)
   *  path IS this directory, unchanged from today's floor. */
  root: string;
  /** Injected `git` runner (tests only); defaults to a real child-process call. */
  git?: GitRunner;
}

/** What `bind` hands back: where this session's tools should read/write, and
 *  whether that is genuinely a dedicated worktree or the degraded shared floor. */
export interface BoundWorktree {
  path: string;
  isolated: boolean;
}

/** One isolated worktree this manager is currently tracking (this process's
 *  lifetime only — a restart starts empty, which is exactly what {@link
 *  WorktreeManager.sweepIdle} exists to reconcile against what's left on disk). */
export interface WorktreeRecord {
  sessionId: string;
  path: string;
  createdAt: number;
}

/** Directory name (repo-root-relative, POSIX-joined) for the coa-managed worktree
 *  home — sibling of `.coa/wal` and `.coa/local` (see `.gitignore`). */
const WORKTREES_DIR = ['.coa', 'worktrees'];

/** A session id must be a single safe path segment — defense in depth. Every real
 *  caller mints one via `ulid()` (composition.ts's default `newSessionId`), which is
 *  already this shape; this guard exists so a hostile or malformed id degrades to
 *  the shared root instead of ever reaching a shell-adjacent `git` argument or
 *  escaping `.coa/worktrees/` (`..`, a path separator, a leading dot). */
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

/** Forward-slash-normalize a path for prefix comparison only — never used for a
 *  path handed back to `fs`/`git` (those keep the OS's own separators). */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

export class WorktreeManager {
  readonly #root: string;
  readonly #git: GitRunner;
  readonly #bound = new Map<string, WorktreeRecord>();
  #isGit: boolean | undefined; // memoized on first real need — never probed for nothing

  constructor(options: WorktreeManagerOptions) {
    this.#root = options.root;
    this.#git = options.git ?? runGit;
  }

  /** Whether `root` is a usable git working tree (a repo AND `HEAD` resolves, so
   *  `git worktree add … HEAD` has something to check out). Probed once, lazily —
   *  most sessions never request isolation, and every probe is a spawned process. */
  isGitRepo(): boolean {
    if (this.#isGit === undefined) {
      try {
        this.#git(['rev-parse', '--verify', 'HEAD'], this.#root);
        this.#isGit = true;
      } catch {
        this.#isGit = false;
      }
    }
    return this.#isGit;
  }

  /**
   * Bind `sessionId`'s worktree. Idempotent — `bindWorktree` is called once per
   * TURN (the per-turn drive strategy re-binds every turn; held-open binds once per
   * query), not once per session, so a session already bound (isolated or not)
   * returns the SAME path rather than re-running `git worktree add` against a path
   * that already exists. `isolate` is the caller's request, not a guarantee: it is
   * silently downgraded to the shared root when `root` isn't a usable git repo, or
   * when the `git worktree add` itself fails for any reason (a stale on-disk
   * leftover a crashed daemon never reaped, a locked index, …) — isolation is an
   * upgrade a write-only child asks for, never something a spawn can be blocked on.
   */
  bind(sessionId: string, isolate: boolean): BoundWorktree {
    const existing = this.#bound.get(sessionId);
    if (existing !== undefined) return { path: existing.path, isolated: true };
    if (!isolate) return { path: this.#root, isolated: false };
    if (!SAFE_SESSION_ID.test(sessionId) || !this.isGitRepo()) {
      return { path: this.#root, isolated: false };
    }

    const path = this.#pathFor(sessionId);
    try {
      mkdirSync(join(this.#root, ...WORKTREES_DIR), { recursive: true });
      this.#git(['worktree', 'add', '--detach', path, 'HEAD'], this.#root);
    } catch {
      // Degrade, never fail the session over it (D85 / strict-superset).
      return { path: this.#root, isolated: false };
    }
    this.#bound.set(sessionId, { sessionId, path, createdAt: Date.now() });
    return { path, isolated: true };
  }

  /**
   * Explicit teardown of an isolated worktree — never called automatically (see
   * the module doc: a session's own close leaves its worktree alone). `git
   * worktree remove --force` discards the worktree's own working-tree changes
   * (nothing on the shared repo's history — no branch was ever minted, so there is
   * no commit this could lose); any leftover directory `remove` didn't clear
   * itself (an interrupted git, a file still open) is swept with a plain `rm -rf`
   * as a filesystem-level backstop. Returns `false` when `sessionId` names no
   * isolated worktree this manager is tracking (never isolated, or already reaped)
   * — a redundant reap is a harmless no-op, matching this codebase's other
   * idempotent teardown verbs.
   */
  reap(sessionId: string): boolean {
    const record = this.#bound.get(sessionId);
    if (record === undefined) return false;
    this.#removeWorktree(record.path);
    this.#bound.delete(sessionId);
    return true;
  }

  /**
   * The idle-cleanup sweep — call once, at daemon start. A crashed prior run
   * leaves both `git`'s own worktree registration AND the `.coa/worktrees/`
   * directory holding entries nothing will ever reap otherwise (this manager's
   * in-memory `#bound` map — the only other source of "what's still live" — is
   * necessarily empty on a fresh process, and every ordinary CLEAN shutdown
   * deliberately leaves its worktrees behind too — see the module doc — so
   * "found on disk, unbound" alone can't mean "stale").
   *
   * Adapted from Bruno's (github.com/usebruno/bruno, MIT) local-first
   * filesystem-as-database posture: rather than trusting one registry as the
   * source of truth for "what worktrees exist" (`git worktree list`, which can
   * itself go stale — an entry surviving in git's admin files after its directory
   * was deleted out from under it, or vice versa), the sweep reconciles TWO views —
   * git's own list and a plain directory listing of `.coa/worktrees/` — and
   * considers the union: an entry either side reports is treated as real, so a
   * mismatch between them (whichever direction) can never leave a leftover
   * neither view alone would have caught.
   *
   * What actually gets reaped is narrower than that union: an unbound worktree is
   * swept ONLY when `git status --porcelain` there is definitively CLEAN (byte-
   * identical to the HEAD it was checked out from — nothing was ever written into
   * it) — the "crashed before any real work happened" case this sweep exists for.
   * Anything dirty, or whose status can't even be read (a half-created worktree
   * with no working `.git` link — the OTHER crash shape), is left alone: a
   * worktree that might hold a result worth a human's look is never destroyed
   * automatically, only ever by the explicit {@link reap}.
   *
   * Never throws (no git, no worktrees directory, nothing to sweep, are all quiet
   * no-ops); returns every sessionId actually reaped, for a caller that wants to
   * log it.
   */
  sweepIdle(): string[] {
    if (!this.isGitRepo()) return [];
    const fromGit = this.#listGitWorktrees();
    const fromDisk = this.#listDiskWorktrees();
    const sessionIds = new Set<string>([...fromGit.keys(), ...fromDisk]);
    const reaped: string[] = [];
    for (const sessionId of sessionIds) {
      // A worktree this SAME process already bound (a sweep run after some binds,
      // e.g. from a test) is live, not stale — never reap our own.
      if (this.#bound.has(sessionId)) continue;
      const path = fromGit.get(sessionId) ?? this.#pathFor(sessionId);
      // Only a DEFINITIVELY clean worktree is safe to auto-reap — dirty (`true`)
      // or unreadable (`undefined`) both mean "might matter", so both are skipped.
      if (this.#statusDirty(path) !== false) continue;
      this.#removeWorktree(path);
      reaped.push(sessionId);
    }
    // Best-effort tidy of git's own admin files (`.git/worktrees/<name>`) for
    // whatever `#removeWorktree` couldn't cleanly remove above; never load-bearing
    // (every entry is already gone from `git worktree list` the moment this
    // method is called again), so a failure here is swallowed rather than surfaced.
    if (reaped.length > 0) {
      try {
        this.#git(['worktree', 'prune'], this.#root);
      } catch {
        // quiet — see above
      }
    }
    return reaped;
  }

  /** Every session this manager currently tracks as isolated — the data a future
   *  Worktree dock reads (which sessions have their own worktree, and where). */
  list(): WorktreeRecord[] {
    return [...this.#bound.values()];
  }

  /** Cheap dirty check for one isolated session's worktree (`git status
   *  --porcelain`, no content hashing) — `undefined` when `sessionId` names no
   *  isolated worktree, or the check itself failed (a directory removed out from
   *  under git). Never throws. */
  isDirty(sessionId: string): boolean | undefined {
    const record = this.#bound.get(sessionId);
    if (record === undefined) return undefined;
    return this.#statusDirty(record.path);
  }

  #pathFor(sessionId: string): string {
    return join(this.#root, ...WORKTREES_DIR, sessionId);
  }

  /** `git status --porcelain` at `path`: `true` dirty, `false` clean, `undefined`
   *  the check itself failed (path gone, no working `.git` link, …) — kept a
   *  three-way result rather than collapsing "unknown" into either boolean, since
   *  {@link sweepIdle} and {@link isDirty} treat "can't tell" differently from a
   *  definite answer (the former fail-safe-skips it; the latter reports it as-is). */
  #statusDirty(path: string): boolean | undefined {
    try {
      return this.#git(['status', '--porcelain'], path).trim().length > 0;
    } catch {
      return undefined;
    }
  }

  /** `git worktree remove --force`, then an unconditional `rm -rf` backstop — git
   *  refuses (or simply has nothing registered) for a path that is ALREADY gone
   *  from its admin files, which is exactly the state a directory-only leftover
   *  (see `sweepIdle`) is in; `rmSync`'s `force: true` makes the backstop a no-op
   *  when git already fully cleaned up, so running both unconditionally is safe. */
  #removeWorktree(path: string): void {
    try {
      this.#git(['worktree', 'remove', '--force', path], this.#root);
    } catch {
      // Fall through to the filesystem backstop below.
    }
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }

  /** `git worktree list --porcelain`, filtered to entries under this manager's
   *  `.coa/worktrees/` and keyed by sessionId (the leaf path segment). Entries git
   *  reports outside that directory (the main worktree itself, or one a person
   *  created by hand) are not this manager's concern and are left untouched. */
  #listGitWorktrees(): Map<string, string> {
    const found = new Map<string, string>();
    let output: string;
    try {
      output = this.#git(['worktree', 'list', '--porcelain'], this.#root);
    } catch {
      return found;
    }
    // Compare in forward-slash space regardless of platform: git's porcelain
    // output is not guaranteed to echo back the exact separator style `#pathFor`
    // built the path with (Windows git normalizes some of its own output).
    const managedPrefix = normalizeSlashes(join(this.#root, ...WORKTREES_DIR)) + '/';
    for (const line of output.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const rawPath = line.slice('worktree '.length).trim();
      const normalized = normalizeSlashes(rawPath);
      if (!normalized.startsWith(managedPrefix)) continue;
      const leaf = normalized.slice(managedPrefix.length);
      if (SAFE_SESSION_ID.test(leaf)) found.set(leaf, rawPath);
    }
    return found;
  }

  /** A plain directory listing of `.coa/worktrees/` — the disk-truth half of the
   *  {@link sweepIdle} reconciliation (see its doc for why two views). Absent
   *  directory ⇒ nothing on disk, a quiet empty result. */
  #listDiskWorktrees(): string[] {
    const dir = join(this.#root, ...WORKTREES_DIR);
    if (!existsSync(dir)) return [];
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SAFE_SESSION_ID.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}

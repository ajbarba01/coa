import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Worktree-per-session isolation (see docs/adr/0037). A session's worktree is, by
 * default, the shared repo root (today's floor, byte-identical). A spawned child
 * that asked for isolation (`spawn_agent`'s `isolate` flag) gets a REAL
 * `git worktree add` under a coa-managed directory instead — its own filesystem
 * copy, so its writes cannot collide with the parent's or a sibling's. Non-git
 * projects degrade to the shared root honestly (strict-superset: isolation is an
 * enhancement, never a requirement).
 *
 * Bruno's (https://github.com/usebruno/bruno) filesystem-as-database design informed
 * the shape of this module: treat the git worktree registration + the directory's own
 * mtime as the source of truth (never a durable index this process alone maintains),
 * so a fresh process can reconstruct "what's out there and how stale is it" from disk
 * and `git worktree list` alone — the same reasoning Bruno applies when a collection's
 * files change out from under it and the UI has to reconcile from scratch rather than
 * trust an in-memory cache. That is what makes {@link WorktreeManager.sweepStale} safe
 * to run on a fresh daemon boot with an empty in-memory registry.
 */

/** Where isolated worktrees live, relative to the repo root — gitignored (see `.gitignore`). */
export const DEFAULT_WORKTREES_DIR = '.coa/worktrees';

/**
 * How long an on-disk worktree this process never bound may sit before the startup
 * sweep reaps it. Long enough that restarting the daemon shortly after a crash still
 * lets a person open the console and look at a subagent's results before they vanish;
 * short enough that a genuinely abandoned run does not accumulate on disk forever.
 */
export const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A session's isolated worktree, as this process currently knows it. */
export interface WorktreeRecord {
  readonly sessionId: string;
  /** Absolute, forward-slash-normalized — the same path space `confine.ts` resolves in. */
  readonly path: string;
  readonly isolated: true;
  /** ISO 8601 — when this process created (or first observed) the worktree. */
  readonly createdAt: string;
}

/** A cheap, `git status --porcelain`-derived working-tree summary. */
export interface WorktreeStatus {
  readonly dirty: boolean;
  readonly filesChanged: number;
}

export interface WorktreeManagerOptions {
  /** The project root — passed straight through, UNCHANGED, as the shared-root
   *  floor's return value (byte-identical to the pre-isolation `bindWorktree`
   *  stub); only normalized internally where path math requires it (constructing
   *  or matching an isolated worktree's path). */
  repoRoot: string;
  /** Repo-relative; defaults to {@link DEFAULT_WORKTREES_DIR}. */
  worktreesDir?: string;
  /** See {@link DEFAULT_STALE_AFTER_MS}. */
  staleAfterMs?: number;
  /** Clock injection (tests only); defaults to `Date.now`. */
  now?: () => number;
  /** Surface a non-fatal problem (an isolated create/reap that failed); defaults to a
   *  no-op. Never called for the expected non-git-project floor — only for a real git
   *  repo where a git/fs operation nonetheless failed. */
  onWarn?: (message: string) => void;
}

/** What a `bind()` call resolves to, worked out from already-known facts — no I/O. */
export type BindAction =
  | { kind: 'reuse'; path: string }
  | { kind: 'shared'; path: string }
  | { kind: 'isolate'; path: string };

/**
 * The pure half of `bind()`: given what is already known (an existing record for this
 * session, whether isolation was requested, whether the repo is git-backed), decide
 * what this call should do. Never touches disk or spawns git — {@link WorktreeManager}
 * performs the `isolate` action's actual `git worktree add`.
 */
export function decideBind(params: {
  sessionId: string;
  /** Returned VERBATIM for a `shared` decision — never normalized, so the
   *  non-isolated floor stays byte-identical to the pre-isolation stub whatever
   *  slash convention the caller's `repoRoot` used. */
  repoRoot: string;
  worktreesDir: string;
  isolateRequested: boolean;
  isGitRepo: boolean;
  /** This session's already-bound path (this process only); present ⇒ every later
   *  call reuses it verbatim, regardless of `isolateRequested` — a per-turn drive
   *  strategy rebinds every turn, and only the founding turn carries the flag. */
  existingPath: string | undefined;
}): BindAction {
  if (params.existingPath !== undefined) return { kind: 'reuse', path: params.existingPath };
  if (!params.isolateRequested || !params.isGitRepo) {
    return { kind: 'shared', path: params.repoRoot };
  }
  // Only the ISOLATE branch needs POSIX-shaped path math (a brand-new path this
  // module itself constructs) — normalized here, not on the untouched `repoRoot`
  // the `shared` branch returns.
  const root = normalizeSlashes(params.repoRoot);
  return { kind: 'isolate', path: path.posix.join(root, params.worktreesDir, params.sessionId) };
}

/** Backslashes → forward slashes; confinement and every worktree path this module
 *  returns live in the same POSIX-shaped path space `confine.ts` already assumes. */
function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** `error.message`, or `String(error)` for a non-`Error` throw — never lets a raw
 *  thrown value reach an `onWarn` caller unformatted. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Run `git <args>` in `cwd`, discarding stdout; throws on a non-zero exit. */
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export class WorktreeManager {
  readonly #repoRoot: string;
  readonly #worktreesDir: string;
  readonly #staleAfterMs: number;
  readonly #now: () => number;
  readonly #onWarn: (message: string) => void;
  readonly #records = new Map<string, WorktreeRecord>();
  #isGitRepoCache: boolean | undefined;

  constructor(options: WorktreeManagerOptions) {
    this.#repoRoot = options.repoRoot;
    this.#worktreesDir = options.worktreesDir ?? DEFAULT_WORKTREES_DIR;
    this.#staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.#now = options.now ?? (() => Date.now());
    this.#onWarn = options.onWarn ?? (() => {});
  }

  /**
   * Bind (idempotently) the working directory `sessionId` should run against. A
   * session already bound in THIS process returns its previously-decided path,
   * ignoring `opts` — `bindWorktree` is called on every turn by the per-turn drive
   * strategy, so re-deciding each call would try to `git worktree add` into a path
   * that already exists on the session's second turn. `opts.isolate` requests a real,
   * separate git worktree; it is honored only against a git-backed `repoRoot` and
   * only degrades (never throws) when it is not, or when the underlying `git
   * worktree add` itself fails — a session's isolation request is an enhancement,
   * never a precondition for the session to start.
   */
  bind(sessionId: string, _scope: string, opts?: { isolate?: boolean }): string {
    const action = decideBind({
      sessionId,
      repoRoot: this.#repoRoot,
      worktreesDir: this.#worktreesDir,
      isolateRequested: opts?.isolate === true,
      isGitRepo: this.#isGitRepo(),
      existingPath: this.#records.get(sessionId)?.path,
    });
    if (action.kind !== 'isolate') return action.path;
    try {
      // `action.path`'s own parent — already the coa-managed directory, already
      // normalized by `decideBind` — rather than re-deriving it from `repoRoot`.
      mkdirSync(path.posix.dirname(action.path), { recursive: true });
      git(['worktree', 'add', '--detach', action.path, 'HEAD'], this.#repoRoot);
    } catch (error) {
      this.#onWarn(
        `worktree isolation failed for session ${sessionId}, falling back to the shared root: ${describeError(error)}`,
      );
      return this.#repoRoot;
    }
    this.#records.set(sessionId, {
      sessionId,
      path: action.path,
      isolated: true,
      createdAt: new Date(this.#now()).toISOString(),
    });
    return action.path;
  }

  /** This process's record for `sessionId`; `undefined` when it was never bound, was
   *  bound to the shared root, or has since been reaped. */
  get(sessionId: string): WorktreeRecord | undefined {
    return this.#records.get(sessionId);
  }

  /** Every isolated worktree this process currently knows about — the read side the
   *  Worktree dock's data (path, whether a session has its own worktree) reaches
   *  through; the dock itself is the next phase's job. */
  list(): WorktreeRecord[] {
    return [...this.#records.values()];
  }

  /** A cheap dirty/changed-file-count read for an isolated session's worktree — one
   *  `git status --porcelain` call, no diff computed. `undefined` for a session with
   *  no isolated worktree. */
  status(sessionId: string): WorktreeStatus | undefined {
    const record = this.#records.get(sessionId);
    if (record === undefined) return undefined;
    const output = git(['status', '--porcelain', '--untracked-files=all'], record.path);
    const lines = output.split('\n').filter((line) => line.length > 0);
    return { dirty: lines.length > 0, filesChanged: lines.length };
  }

  /**
   * The explicit reap action (docs' "results may need review before cleanup" —
   * nothing else ever removes an isolated worktree): `git worktree remove --force`,
   * falling back to `git worktree prune` + a plain directory removal if the
   * registered worktree's directory is already gone by hand. This is the callable
   * seam a future RPC verb (the Worktree dock's floor action) calls; no such verb
   * exists yet. `false` for a session with no isolated worktree to reap — the shared
   * root is never removable through this method.
   */
  reap(sessionId: string): boolean {
    const record = this.#records.get(sessionId);
    if (record === undefined) return false;
    this.#removeWorktree(record.path);
    this.#records.delete(sessionId);
    return true;
  }

  /**
   * Run once, early, at daemon composition (before any session binds): find every
   * git worktree already registered under the coa-managed directory that THIS fresh
   * process has no record of — by construction, everything a prior run (crashed, or
   * simply not cleanly shut down) left behind — and reap whichever are older than
   * `staleAfterMs`, judged by the worktree directory's own mtime (no durable index
   * survives a restart, so the filesystem is the only truth left; see the module
   * doc's Bruno note). Returns the reaped session ids. A no-op outside a git repo.
   */
  sweepStale(): string[] {
    if (!this.#isGitRepo()) return [];
    const reaped: string[] = [];
    for (const { sessionId, worktreePath } of this.#listCoaWorktrees()) {
      if (this.#records.has(sessionId)) continue;
      if (this.#ageOf(worktreePath) < this.#staleAfterMs) continue;
      this.#removeWorktree(worktreePath);
      reaped.push(sessionId);
    }
    return reaped;
  }

  #isGitRepo(): boolean {
    if (this.#isGitRepoCache === undefined) {
      try {
        const out = git(['rev-parse', '--is-inside-work-tree'], this.#repoRoot);
        this.#isGitRepoCache = out.trim() === 'true';
      } catch {
        this.#isGitRepoCache = false;
      }
    }
    return this.#isGitRepoCache;
  }

  /** Every currently-registered git worktree under this repo's coa-managed
   *  directory, however this process learned of it. */
  #listCoaWorktrees(): Array<{ sessionId: string; worktreePath: string }> {
    let output: string;
    try {
      output = git(['worktree', 'list', '--porcelain'], this.#repoRoot);
    } catch {
      return [];
    }
    const prefix = `${path.posix.join(normalizeSlashes(this.#repoRoot), this.#worktreesDir)}/`;
    const found: Array<{ sessionId: string; worktreePath: string }> = [];
    for (const line of output.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      const worktreePath = normalizeSlashes(line.slice('worktree '.length).trim());
      if (!worktreePath.startsWith(prefix)) continue;
      found.push({ sessionId: path.posix.basename(worktreePath), worktreePath });
    }
    return found;
  }

  /** How long ago the worktree directory was last modified, or `+Infinity`
   *  (immediately eligible) when it cannot be read — a dangling git-worktree
   *  registration with no directory left is exactly the kind of leftover this
   *  sweep exists to clear out. */
  #ageOf(worktreePath: string): number {
    try {
      return this.#now() - statSync(worktreePath).mtimeMs;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  /** Best-effort teardown: never throws, so a reap the caller already committed to
   *  (dropping the record right after) can't be left half-done by a git quirk. */
  #removeWorktree(worktreePath: string): void {
    try {
      git(['worktree', 'remove', '--force', worktreePath], this.#repoRoot);
      return;
    } catch (error) {
      this.#onWarn(
        `git worktree remove failed for ${worktreePath}, pruning instead: ${describeError(error)}`,
      );
    }
    try {
      git(['worktree', 'prune'], this.#repoRoot);
    } catch {
      // The registration may already be gone (or never existed) — the directory
      // removal below is what actually matters to the caller.
    }
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch {
      // Best-effort: nothing further this method can do about a path the OS won't
      // let go of (e.g. a held file handle); the record is dropped regardless.
    }
  }
}

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangeEventDraft } from '../event.js';
import { classifyObservation, type Observation, type PathState, type PreciseOp } from './dedup.js';

/**
 * Producer ② — the git-centric reconciler. Truth resolution is
 * git-centric: a scoped `git status` scopes dirty paths, content-hashing dedups,
 * and the causal-dedup decision turns each real transition into a change-event.
 * It is provenance-blind and **respects `.gitignore` by default** (engine
 * internals are excluded for free — the property that lets coa handle any project
 * type). Its crash recovery is WAL replay (the kernel seeds prior hashes) plus a
 * full disk rescan. The file-watcher trigger (`@parcel/watcher`) is a later wire;
 * the floor reconciles on demand.
 */
export interface ReconcilerDeps {
  worktree: string;
  root: string;
  emit: (draft: ChangeEventDraft) => void;
  /** Injectable scan, defaulting to the real `git status` scan (used by tests). */
  scan?: (root: string, worktree: string) => Observation[];
}

export class Reconciler {
  private readonly priorHash = new Map<string, string | null>();
  private readonly pendingPrecise = new Map<string, PreciseOp>();
  private readonly scan: (root: string, worktree: string) => Observation[];

  constructor(private readonly deps: ReconcilerDeps) {
    this.scan = deps.scan ?? scanWorktree;
    if (!deps.scan) this.seedTrackedBaseline();
  }

  /** Seed a path's last-known hash (crash recovery replays the WAL into here). */
  seedHash(path: string, hash: string | null): void {
    this.priorHash.set(path, hash);
  }

  /**
   * Establish the baseline hash of every already-tracked file, so the first real
   * change to a clean committed file is seen as a `modify`, not a `create`. In
   * production the WAL replay seeds these (and overrides via {@link seedHash});
   * standalone, this `git ls-files` pass is the equivalent disk baseline.
   */
  private seedTrackedBaseline(): void {
    // stderr is captured rather than inherited: failing here is an EXPECTED, handled
    // outcome on a non-git root (the caller degrades producer 2 to a no-op), so the
    // failure must not print to the daemon's console as if something went wrong.
    const listed = execFileSync('git', ['ls-files'], {
      cwd: this.deps.root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const path of listed.split('\n')) {
      if (path.length === 0 || this.priorHash.has(path)) continue;
      this.priorHash.set(path, hashFile(join(this.deps.root, path)));
    }
  }

  /** Register a recent precise event so its disk observation reconciles as a confirm. */
  expectPrecise(path: string, op: PreciseOp): void {
    this.pendingPrecise.set(path, op);
  }

  /** Scan the worktree and emit a change-event for every real, deduped transition. */
  reconcile(): void {
    for (const obs of this.scan(this.deps.root, this.deps.worktree)) {
      const precise = this.pendingPrecise.get(obs.path);
      const state: PathState = {
        priorHash: this.priorHash.has(obs.path) ? (this.priorHash.get(obs.path) ?? null) : null,
        ...(precise ? { pendingPrecise: precise } : {}),
      };
      const draft = classifyObservation(obs, state);
      if (!draft) continue;
      this.deps.emit(draft);
      this.priorHash.set(obs.path, obs.postHash);
      this.pendingPrecise.delete(obs.path);
    }
  }
}

/** The real scan: `git status --porcelain` (gitignore-respecting) + content hashing. */
export function scanWorktree(root: string, worktree: string): Observation[] {
  const output = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const observations: Observation[] = [];
  for (const line of output.split('\n')) {
    if (line.length < 4) continue;
    const path = pathOf(line);
    observations.push({ worktree, path, postHash: hashFile(join(root, path)) });
  }
  return observations;
}

/** sha256 of a file's bytes, or `null` if it does not exist (deleted). */
function hashFile(absolute: string): string | null {
  if (!existsSync(absolute)) return null;
  return createHash('sha256').update(readFileSync(absolute)).digest('hex');
}

/** Extract the path from a porcelain line, taking the post-rename target for renames. */
function pathOf(line: string): string {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return arrow >= 0 ? rest.slice(arrow + 4) : rest;
}

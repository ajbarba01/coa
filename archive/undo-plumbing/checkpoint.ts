// Archived from packages/core/src/checkpoint.ts — the pin/unpin/retention-floor members
// of `Timeline` and the pathspec-rewind helper. The `Checkpoint` pointer tuple and the
// `checkpoint`/`listTimeline` surface stayed live (the console Timeline panel reads them);
// `Checkpoint.pinned` — the flag only this code ever set — stayed as an always-false field.
import { execFileSync } from 'node:child_process';
import type { Checkpoint } from '../../packages/core/src/checkpoint.js';

/**
 * Checkpoint / rewind (D76/D97/D98) over the substrate that already exists (git +
 * the WAL) — no new primitive. A checkpoint is a **pointer tuple** pinning a WAL
 * retention floor; the timeline is a human-only control surface (the agent never
 * marks or prunes — D98). `pin` is the bookmark/anti-prune. Rewind re-materializes
 * the working tree from a git source ref and **never rewrites committed history**
 * (D97); projections always rebuild to follow.
 */
export class Timeline {
  private readonly checkpoints: Checkpoint[] = [];

  /** Human-only bookmark + anti-prune; only a pinned checkpoint holds the retention floor. */
  pin(id: string): void {
    this.setPinned(id, true);
  }

  unpin(id: string): void {
    this.setPinned(id, false);
  }

  /**
   * The compaction-safety floor (D94): the lowest WAL seq that must be retained —
   * the min of every live consumer cursor and every pinned checkpoint. `0` (retain
   * everything) when nothing constrains it.
   */
  retentionFloor(consumerCursors: number[]): number {
    const constraints = [
      ...consumerCursors,
      ...this.checkpoints.filter((c) => c.pinned).map((c) => c.seq),
    ];
    return constraints.length > 0 ? Math.min(...constraints) : 0;
  }

  private setPinned(id: string, pinned: boolean): void {
    const cp = this.checkpoints.find((c) => c.id === id);
    if (cp) cp.pinned = pinned;
  }
}

/** Re-materialize a git pathspec from a source ref. Working-tree only — never history. */
export function rewindPathspec(root: string, source: string, pathspecs: string[]): void {
  execFileSync('git', ['restore', '--source', source, '--', ...pathspecs], { cwd: root });
}

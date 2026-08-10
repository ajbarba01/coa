import { ulid } from 'ulid';
import type { WorktreeId } from '@coa/shared';

/**
 * The checkpoint timeline over the WAL: a checkpoint is a pointer tuple marking a
 * WAL position, recorded at prompt boundaries; the timeline is the ordered,
 * append-only list the console's Timeline panel renders.
 */
export interface Checkpoint {
  id: string;
  seq: number;
  ts: string;
  worktree: WorktreeId;
  /** A bookmark flag reserved for a future turn-level undo — nothing sets it today. */
  pinned: boolean;
}

export class Timeline {
  private readonly checkpoints: Checkpoint[] = [];

  /** Record a pointer tuple at the current WAL position (auto-fires at prompt boundaries). */
  checkpoint(seq: number, worktree: WorktreeId, ts: string = new Date().toISOString()): Checkpoint {
    const cp: Checkpoint = { id: ulid(), seq, ts, worktree, pinned: false };
    this.checkpoints.push(cp);
    return cp;
  }

  listTimeline(): Checkpoint[] {
    return this.checkpoints.map((c) => ({ ...c }));
  }
}

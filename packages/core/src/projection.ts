import Database from 'better-sqlite3';
import type { ChangeEvent } from '@coa/shared';

/**
 * The SQLite file-state projection — an **in-memory mirror** of the change-event
 * log. The log is the durable source of truth; the kernel rebuilds this mirror
 * by replaying the log on every start, so nothing here survives a restart (or
 * needs to).
 */
export interface FileState {
  postHash: string | null;
  seq: number;
  kind: string;
}

interface FileStateRow {
  post_hash: string | null;
  seq: number;
  kind: string;
}

export class ProjectionDb {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(':memory:');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS file_state (path TEXT PRIMARY KEY, post_hash TEXT, seq INTEGER, kind TEXT)',
    );
  }

  /** Project one change-event. File-change frames update the per-path state. */
  applyEvent(event: ChangeEvent): void {
    if (!('path' in event)) return;
    this.db
      .prepare(
        `INSERT INTO file_state (path, post_hash, seq, kind) VALUES (?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET post_hash = excluded.post_hash, seq = excluded.seq, kind = excluded.kind`,
      )
      .run(event.path, event.post_hash, event.seq, event.kind);
  }

  fileState(path: string): FileState | undefined {
    const row = this.db
      .prepare('SELECT post_hash, seq, kind FROM file_state WHERE path = ?')
      .get(path) as FileStateRow | undefined;
    if (!row) return undefined;
    return { postHash: row.post_hash, seq: row.seq, kind: row.kind };
  }

  close(): void {
    this.db.close();
  }
}

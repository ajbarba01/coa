import Database from 'better-sqlite3';
import type { ChangeEvent } from '@coa/shared';

/**
 * The SQLite projection store (D116). Treated as **reconstructible-not-durable**
 * (`synchronous=NORMAL`, SQLite's own WAL journal): the change-event log +
 * reconciler are the durable source, so a power-loss rollback of the projection
 * is harmless — a replay re-derives it. The projection carries its own
 * **projector-schema version** (distinct from the frame's); a version bump
 * **drops and replays from the WAL** rather than migrating in place.
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

  constructor(path: string, projectorVersion: number) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');

    const stored = this.storedVersion();
    if (stored !== projectorVersion) {
      this.db.exec('DROP TABLE IF EXISTS file_state');
      this.setVersion(projectorVersion);
    }
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

  /** Drop and replay the projection from a full event list (the rebuild rule). */
  rebuild(events: ChangeEvent[]): void {
    this.db.exec('DELETE FROM file_state');
    const replay = this.db.transaction((all: ChangeEvent[]) => {
      for (const event of all) this.applyEvent(event);
    });
    replay(events);
  }

  close(): void {
    this.db.close();
  }

  private storedVersion(): number | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'projector_version'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : undefined;
  }

  private setVersion(version: number): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('projector_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(String(version));
  }
}

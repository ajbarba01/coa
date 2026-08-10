import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type ChangeEvent } from '@coa/shared';
import { ProjectionDb } from './projection.js';

const fileEvent = (
  seq: number,
  kind: 'create' | 'modify' | 'delete',
  path: string,
  postHash: string | null,
): ChangeEvent => ({
  schema_version: SCHEMA_VERSION,
  seq,
  ts: 't',
  worktree: 'w',
  actor: 'reconciler',
  op_id: null,
  provenance: 'inferred',
  cause: null,
  kind,
  path,
  pre_hash: null,
  post_hash: postHash,
  generated: false,
});

describe('ProjectionDb', () => {
  it('projects file state from change-events', () => {
    const db = new ProjectionDb();
    db.applyEvent(fileEvent(0, 'create', 'a.ts', 'h1'));
    db.applyEvent(fileEvent(1, 'modify', 'a.ts', 'h2'));
    expect(db.fileState('a.ts')).toEqual({ postHash: 'h2', seq: 1, kind: 'modify' });
    db.close();
  });

  it('records a delete as a null-hash tombstone', () => {
    const db = new ProjectionDb();
    db.applyEvent(fileEvent(0, 'create', 'a.ts', 'h1'));
    db.applyEvent(fileEvent(1, 'delete', 'a.ts', null));
    expect(db.fileState('a.ts')).toEqual({ postHash: null, seq: 1, kind: 'delete' });
    db.close();
  });
});

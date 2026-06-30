import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-proj-'));
  dbPath = join(dir, 'proj.sqlite');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ProjectionDb', () => {
  it('projects file state from change-events', () => {
    const db = new ProjectionDb(dbPath, 1);
    db.applyEvent(fileEvent(0, 'create', 'a.ts', 'h1'));
    db.applyEvent(fileEvent(1, 'modify', 'a.ts', 'h2'));
    expect(db.fileState('a.ts')).toEqual({ postHash: 'h2', seq: 1, kind: 'modify' });
    db.close();
  });

  it('records a delete as a null-hash tombstone', () => {
    const db = new ProjectionDb(dbPath, 1);
    db.applyEvent(fileEvent(0, 'create', 'a.ts', 'h1'));
    db.applyEvent(fileEvent(1, 'delete', 'a.ts', null));
    expect(db.fileState('a.ts')).toEqual({ postHash: null, seq: 1, kind: 'delete' });
    db.close();
  });

  it('drops and rebuilds on a projector-version bump (no in-place migration)', () => {
    const v1 = new ProjectionDb(dbPath, 1);
    v1.applyEvent(fileEvent(0, 'create', 'a.ts', 'h1'));
    v1.close();

    const v2 = new ProjectionDb(dbPath, 2);
    expect(v2.fileState('a.ts')).toBeUndefined(); // dropped; the WAL replay re-derives it
    v2.close();
  });

  it('rebuilds the whole projection from a replayed event list', () => {
    const db = new ProjectionDb(dbPath, 1);
    db.applyEvent(fileEvent(0, 'create', 'stale.ts', 'h0'));
    db.rebuild([fileEvent(0, 'create', 'a.ts', 'h1'), fileEvent(1, 'create', 'b.ts', 'h2')]);
    expect(db.fileState('stale.ts')).toBeUndefined();
    expect(db.fileState('b.ts')?.postHash).toBe('h2');
    db.close();
  });
});

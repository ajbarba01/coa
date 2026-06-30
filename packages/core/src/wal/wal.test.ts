import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMA_VERSION, type ChangeEvent } from '@coa/shared';
import { Wal } from './wal.js';

const fileFrame = (seq: number, path: string): ChangeEvent => ({
  schema_version: SCHEMA_VERSION,
  seq,
  ts: '2026-06-29T00:00:00.000Z',
  worktree: 'w',
  actor: 'reconciler',
  op_id: null,
  provenance: 'inferred',
  cause: null,
  kind: 'modify',
  path,
  pre_hash: null,
  post_hash: 'h1',
  generated: false,
});

let dir: string;
let walPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coa-wal-'));
  walPath = join(dir, 'log.ndjson');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Wal', () => {
  it('appends and reads back frames in order', () => {
    const wal = new Wal(walPath);
    wal.append(fileFrame(0, 'a.ts'));
    wal.append(fileFrame(1, 'b.ts'));
    wal.sync();
    expect(wal.read().frames.map((f) => f.seq)).toEqual([0, 1]);
    wal.close();
  });

  it('survives a reopen — the log is the durable source of truth', () => {
    const first = new Wal(walPath);
    first.append(fileFrame(0, 'a.ts'));
    first.sync();
    first.close();

    const reopened = new Wal(walPath);
    expect(reopened.read().frames.map((f) => f.seq)).toEqual([0]);
    reopened.append(fileFrame(1, 'b.ts'));
    reopened.sync();
    expect(reopened.read().frames.map((f) => f.seq)).toEqual([0, 1]);
    reopened.close();
  });

  it('drops a torn trailing line written by a crashed predecessor', () => {
    const wal = new Wal(walPath);
    wal.append(fileFrame(0, 'a.ts'));
    wal.sync();
    appendFileSync(walPath, '{"schema_version":2,"seq":1,"kind":"mod'); // torn, no newline
    expect(wal.read().frames.map((f) => f.seq)).toEqual([0]);
    wal.close();
  });
});

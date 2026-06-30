import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type ChangeEvent } from '@coa/shared';
import { readFrames, serializeFrame } from './frame.js';

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
  pre_hash: 'h0',
  post_hash: 'h1',
  generated: false,
});

const log = (...frames: ChangeEvent[]): string =>
  frames.map((f) => serializeFrame(f) + '\n').join('');

describe('WAL frame reader', () => {
  it('round-trips appended frames in order', () => {
    const content = log(fileFrame(0, 'a.ts'), fileFrame(1, 'b.ts'), fileFrame(2, 'c.ts'));
    const result = readFrames(content);
    expect(result.quarantine).toBeUndefined();
    expect(result.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(result.frames.map((f) => (f.kind === 'modify' ? f.path : null))).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('discards a torn trailing line (a crash mid-append)', () => {
    const good = log(fileFrame(0, 'a.ts'), fileFrame(1, 'b.ts'));
    const torn = good + '{"schema_version":2,"seq":2,"kind":"modi'; // no newline -> partial
    const result = readFrames(torn);
    expect(result.frames.map((f) => f.seq)).toEqual([0, 1]);
  });

  it('tolerates an empty log', () => {
    expect(readFrames('').frames).toEqual([]);
  });

  it('refuses and quarantines a higher unknown schema_version (never a silent skip)', () => {
    const future = JSON.stringify({ ...fileFrame(2, 'c.ts'), schema_version: SCHEMA_VERSION + 1 });
    const content = log(fileFrame(0, 'a.ts'), fileFrame(1, 'b.ts')) + future + '\n';
    const result = readFrames(content);
    // Stops at the unreadable frame, surfacing the quarantine; earlier frames are still returned.
    expect(result.frames.map((f) => f.seq)).toEqual([0, 1]);
    expect(result.quarantine).toEqual({ line: 2, schemaVersion: SCHEMA_VERSION + 1 });
  });

  it('rejects a structurally invalid frame', () => {
    const content = log(fileFrame(0, 'a.ts')) + '{"schema_version":2,"seq":1,"kind":"nope"}\n';
    expect(() => readFrames(content)).toThrow();
  });
});

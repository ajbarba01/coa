import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, changeEventSchema } from './change-event.js';

const envelope = {
  schema_version: SCHEMA_VERSION,
  seq: 7,
  ts: '2026-06-29T00:00:00.000Z',
  worktree: 'wt-1',
  actor: 'session' as const,
  op_id: '01J000000000000000000000AB',
  provenance: 'declared' as const,
  cause: null,
};

describe('changeEventSchema — file kinds', () => {
  it('accepts a create with a null pre_hash', () => {
    const ev = {
      ...envelope,
      op_id: null,
      actor: 'reconciler' as const,
      provenance: 'inferred' as const,
      kind: 'create' as const,
      path: 'src/a.ts',
      pre_hash: null,
      post_hash: 'h1',
      generated: false,
    };
    expect(changeEventSchema.parse(ev)).toMatchObject({ kind: 'create', pre_hash: null });
  });

  it('rejects an unknown kind', () => {
    expect(
      changeEventSchema.safeParse({ ...envelope, kind: 'frobnicate', path: 'x' }).success,
    ).toBe(false);
  });

  it('rejects a stale schema_version', () => {
    const ev = {
      ...envelope,
      schema_version: 1,
      kind: 'modify' as const,
      path: 'x',
      pre_hash: 'a',
      post_hash: 'b',
      generated: false,
    };
    expect(changeEventSchema.safeParse(ev).success).toBe(false);
  });
});

describe('changeEventSchema — non-file kinds carry a non-null op_id and declared|gated provenance', () => {
  it('accepts an assert-edge frame', () => {
    const ev = {
      ...envelope,
      kind: 'assert-edge' as const,
      payload: { from: 'a', to: 'b', type: 'depends-on' as const },
    };
    expect(changeEventSchema.parse(ev)).toMatchObject({ kind: 'assert-edge' });
  });

  it('rejects an edge frame with a null op_id', () => {
    const ev = {
      ...envelope,
      op_id: null,
      kind: 'assert-edge' as const,
      payload: { from: 'a', to: 'b', type: 'depends-on' as const },
    };
    expect(changeEventSchema.safeParse(ev).success).toBe(false);
  });

  it('rejects an edge frame with inferred provenance', () => {
    const ev = {
      ...envelope,
      provenance: 'inferred' as const,
      kind: 'retract-edge' as const,
      payload: { from: 'a', to: 'b', type: 'imports' as const },
    };
    expect(changeEventSchema.safeParse(ev).success).toBe(false);
  });

  it('accepts a declare-symbols frame', () => {
    const ev = {
      ...envelope,
      kind: 'declare-symbols' as const,
      payload: { symbols: [{ name: 'foo', definedIn: 'src/a.ts' }], from: 'generator:zod' },
    };
    expect(changeEventSchema.parse(ev)).toMatchObject({ kind: 'declare-symbols' });
  });

  it('accepts a governance frame with a regenerate cause', () => {
    const ev = {
      ...envelope,
      kind: 'governance' as const,
      cause: { kind: 'regenerate' as const, sourceEventSeq: 3 },
      payload: { sub: 'decision' as const },
    };
    expect(changeEventSchema.parse(ev)).toMatchObject({ kind: 'governance' });
  });
});

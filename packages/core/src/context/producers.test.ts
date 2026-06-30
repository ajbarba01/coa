import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '@coa/shared';
import type { GenerationRelation, GenerationRunner, RegenOutput } from './ssot-constraint.js';
import { assembleProducers } from './producers.js';

const changeOf = (path: string): ChangeEvent =>
  ({
    seq: 1,
    ts: 't',
    worktree: 'main',
    actor: 'session',
    op_id: null,
    provenance: 'inferred',
    cause: null,
    kind: 'modify',
    path,
    pre_hash: 'a',
    post_hash: 'b',
    generated: false,
  }) as unknown as ChangeEvent;

const rel = (over: Partial<GenerationRelation> = {}): GenerationRelation => ({
  name: 'api-types',
  source: 'openapi.yaml',
  target: 'src/api.ts',
  lang: 'typescript',
  ...over,
});

const runner = (
  script: Record<string, { fresh: string | 'binary'; checkedIn: string }>,
): GenerationRunner => ({
  regenerate(relation): RegenOutput {
    const entry = script[relation.name];
    if (!entry) throw new Error(`no script for ${relation.name}`);
    return entry.fresh === 'binary' ? { kind: 'binary' } : { kind: 'text', bytes: entry.fresh };
  },
  readTarget(relation): string {
    return script[relation.name]?.checkedIn ?? '';
  },
});

describe('assembleProducers', () => {
  it('returns no producers for an empty registry (the D85 inert floor)', () => {
    expect(assembleProducers([], runner({}))).toEqual([]);
  });

  it('assembles the SSOT-constraint producer over the declared relations', () => {
    const producers = assembleProducers(
      [rel()],
      runner({ 'api-types': { fresh: 'a', checkedIn: 'a' } }),
    );
    expect(producers.map((p) => p.id)).toEqual(['ssot-constraint']);
  });

  it('the assembled producer fires a Type-1 on a drifted relation', () => {
    const producers = assembleProducers(
      [rel()],
      runner({ 'api-types': { fresh: 'a', checkedIn: 'b' } }),
    );
    const flags = producers[0]?.run({ kind: 'scope', scope: 'all' }) ?? [];
    expect(flags).toHaveLength(1);
    expect(flags[0]?.ruleId).toBe('generated-stale:api-types');
  });

  it('routes a relation L-GEN cannot verify to the origin-anchor producer', () => {
    const producers = assembleProducers(
      [rel()],
      runner({ 'api-types': { fresh: 'binary', checkedIn: 'x' } }),
    );
    expect(producers.map((p) => p.id)).toEqual(['ssot-constraint', 'origin-anchor']);
  });

  it('does not assemble an origin-anchor producer when every relation is verifiable', () => {
    const producers = assembleProducers(
      [rel()],
      runner({ 'api-types': { fresh: 'a', checkedIn: 'a' } }),
    );
    expect(producers.map((p) => p.id)).not.toContain('origin-anchor');
  });

  it('the origin-anchor producer notices a change to the unverifiable source', () => {
    const producers = assembleProducers(
      [rel()],
      runner({ 'api-types': { fresh: 'binary', checkedIn: 'x' } }),
    );
    const anchor = producers.find((p) => p.id === 'origin-anchor');
    const flags = anchor?.run({ kind: 'change', event: changeOf('openapi.yaml') }) ?? [];
    expect(flags[0]?.ruleId).toBe('origin-anchor:api-types');
    expect(flags[0]?.type).toBe(2);
  });
});

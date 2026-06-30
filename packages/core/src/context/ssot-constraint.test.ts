import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '@coa/shared';
import { validateProducer } from '../flags/producer.js';
import {
  createSsotConstraintProducer,
  type GenerationRelation,
  type GenerationRunner,
  type RegenOutput,
} from './ssot-constraint.js';

const rel = (over: Partial<GenerationRelation> = {}): GenerationRelation => ({
  name: 'api-types',
  source: 'openapi.yaml',
  target: 'src/api.ts',
  lang: 'typescript',
  ...over,
});

/** A fake generator runner driven by a per-relation script: fresh output(s) + the checked-in copy. */
function runner(
  script: Record<string, { fresh: string | string[] | 'binary'; checkedIn: string }>,
): GenerationRunner {
  const calls: Record<string, number> = {};
  return {
    regenerate(relation): RegenOutput {
      const entry = script[relation.name];
      if (!entry) throw new Error(`no script for ${relation.name}`);
      if (entry.fresh === 'binary') return { kind: 'binary' };
      if (Array.isArray(entry.fresh)) {
        const i = calls[relation.name] ?? 0;
        calls[relation.name] = i + 1;
        return { kind: 'text', bytes: entry.fresh[Math.min(i, entry.fresh.length - 1)] ?? '' };
      }
      return { kind: 'text', bytes: entry.fresh };
    },
    readTarget(relation): string {
      const entry = script[relation.name];
      if (!entry) throw new Error(`no script for ${relation.name}`);
      return entry.checkedIn;
    },
  };
}

const sweep = { kind: 'scope', scope: 'all' } as const;

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

describe('createSsotConstraintProducer — the L-GEN SSOT-as-constraint producer', () => {
  it('passes when the checked-in target matches fresh output (zero flags)', () => {
    const { producer } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'export type A = 1;', checkedIn: 'export type A = 1;' } }),
    );
    expect(producer.run(sweep)).toEqual([]);
  });

  it('flags a stale target when fresh output differs from the checked-in copy', () => {
    const { producer } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'export type A = 2;', checkedIn: 'export type A = 1;' } }),
    );
    const flags = producer.run(sweep);
    expect(flags).toHaveLength(1);
    const flag = flags[0];
    expect(flag?.ruleId).toBe('generated-stale:api-types');
    expect(flag?.location).toBe('src/api.ts');
    expect(flag?.type).toBe(1);
    expect(flag?.severity).toBe('high');
    expect(flag?.fix).toEqual({
      target: 'src/api.ts',
      diff: { form: 'whole-file', body: 'export type A = 2;' },
    });
  });

  it('ignores formatting-only differences via G0 canonicalization', () => {
    const { producer } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'const x = a + b;', checkedIn: 'const x=a+b;' } }),
    );
    expect(producer.run(sweep)).toEqual([]);
  });

  it('refuses to ship a Type-1 for a non-reproducible relation (the GEN-8 self-test)', () => {
    const { producer, degraded } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: ['gen-1', 'gen-2'], checkedIn: 'gen-1' } }),
    );
    expect(degraded).toEqual([{ name: 'api-types', reason: 'non-reproducible' }]);
    expect(producer.run(sweep)).toEqual([]);
  });

  it('degrades a binary/non-canonicalizable relation to a notice, never a Type-1', () => {
    const { producer, degraded } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'binary', checkedIn: 'whatever' } }),
    );
    expect(degraded).toEqual([{ name: 'api-types', reason: 'non-canonicalizable' }]);
    expect(producer.run(sweep)).toEqual([]);
  });

  it('checks only the relation whose source or target changed on a change event', () => {
    const a = rel({ name: 'a', source: 'a.yaml', target: 'a.ts' });
    const b = rel({ name: 'b', source: 'b.yaml', target: 'b.ts' });
    const { producer } = createSsotConstraintProducer(
      [a, b],
      runner({
        a: { fresh: 'export type A = 2;', checkedIn: 'export type A = 1;' },
        b: { fresh: 'export type B = 2;', checkedIn: 'export type B = 1;' },
      }),
    );
    const flags = producer.run({ kind: 'change', event: changeOf('a.yaml') });
    expect(flags.map((f) => f.ruleId)).toEqual(['generated-stale:a']);
  });

  it('passes the CF-6 registration gate (a self-contained golden pair)', () => {
    const { producer } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'export type A = 1;', checkedIn: 'export type A = 1;' } }),
    );
    expect(validateProducer(producer)).toEqual({ ok: true });
  });

  it('regenerates the fresh output as a whole-file patch for the auto-patch path', () => {
    const { producer } = createSsotConstraintProducer(
      [rel()],
      runner({ 'api-types': { fresh: 'export type A = 2;', checkedIn: 'export type A = 1;' } }),
    );
    const flag = producer.run(sweep)[0];
    expect(flag).toBeDefined();
    if (!flag) return;
    expect(producer.fix?.(flag)).toEqual({
      target: 'src/api.ts',
      diff: { form: 'whole-file', body: 'export type A = 2;' },
    });
  });
});

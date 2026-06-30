import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '@coa/shared';
import { validateProducer } from '../flags/producer.js';
import type { GenerationRelation } from './ssot-constraint.js';
import { createOriginAnchorProducer, type UnverifiableRelation } from './origin-anchor.js';

const rel = (over: Partial<GenerationRelation> = {}): GenerationRelation => ({
  name: 'diagram',
  source: 'model.ts',
  target: 'docs/diagram.png',
  lang: 'plain',
  ...over,
});

const unverifiable = (over: Partial<UnverifiableRelation> = {}): UnverifiableRelation => ({
  relation: rel(),
  reason: 'non-canonicalizable',
  ...over,
});

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

describe('createOriginAnchorProducer', () => {
  it('emits a never-blocking Type-2 notice when an unverifiable target’s source changes', () => {
    const producer = createOriginAnchorProducer([unverifiable()]);
    const flags = producer.run({ kind: 'change', event: changeOf('model.ts') });

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      ruleId: 'origin-anchor:diagram',
      location: 'docs/diagram.png',
      type: 2,
      severity: 'low',
      confidence: 'low',
    });
    expect(flags[0]?.fix).toBeUndefined();
  });

  it('also fires when the unverifiable target itself changes', () => {
    const producer = createOriginAnchorProducer([unverifiable()]);
    expect(producer.run({ kind: 'change', event: changeOf('docs/diagram.png') })).toHaveLength(1);
  });

  it('stays silent on a change unrelated to any anchored relation', () => {
    const producer = createOriginAnchorProducer([unverifiable()]);
    expect(producer.run({ kind: 'change', event: changeOf('unrelated.ts') })).toEqual([]);
  });

  it('records the reason coa cannot canonicalize the artifact in the message', () => {
    const producer = createOriginAnchorProducer([unverifiable({ reason: 'non-reproducible' })]);
    const flags = producer.run({ kind: 'change', event: changeOf('model.ts') });
    expect(flags[0]?.message).toContain('non-reproducible');
    expect(flags[0]?.message).toContain('docs/diagram.png');
  });

  it('raises a standing notice per anchored relation on a scope sweep', () => {
    const producer = createOriginAnchorProducer([
      unverifiable(),
      unverifiable({ relation: rel({ name: 'other', source: 'x.ts', target: 'y.bin' }) }),
    ]);
    expect(producer.run({ kind: 'scope', scope: 'all' })).toHaveLength(2);
  });

  it('is a mechanical, model-free producer that passes the CF-6 registration gate', () => {
    const producer = createOriginAnchorProducer([unverifiable()]);
    expect(producer.kind).toBe('deterministic');
    expect(validateProducer(producer)).toEqual({ ok: true });
  });
});

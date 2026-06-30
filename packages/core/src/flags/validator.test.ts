import { describe, expect, it } from 'vitest';
import type { ContextSlice, FlagRecord } from '@coa/shared';
import { contextKeyOf, groupSelection } from './validator.js';
import { FlagPipeline } from './pipeline.js';
import type { Producer } from './producer.js';

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'staleness/doc',
    location: 'guide.md:10',
    severity: 'med',
    message: 'doc may be stale',
    fingerprint: 'fp-1',
    type: 2,
    confidence: 'low',
    concernKey: 'guideStale',
    ...over,
  };
}

function slice(path: string): ContextSlice {
  return { ref: { path }, bytes: '...', truncatedTo: 100 };
}

describe('groupSelection (CF-5 auto-group by shared context)', () => {
  it('batches flags whose envelopes overlap into one group', () => {
    const a = flag({ fingerprint: 'a' });
    const b = flag({ fingerprint: 'b' });
    const groups = groupSelection([a, b], () => slice('guide.md'));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.flags).toHaveLength(2);
  });

  it('does not lump flags that need different slices (correctness over token-saving)', () => {
    const a = flag({ fingerprint: 'a' });
    const b = flag({ fingerprint: 'b' });
    const groups = groupSelection([a, b], (f) =>
      slice(f.fingerprint === 'a' ? 'one.md' : 'two.md'),
    );
    expect(groups).toHaveLength(2);
  });

  it('keys a path+symbol envelope distinctly from the bare path', () => {
    expect(
      contextKeyOf({ ref: { path: 'x.ts', symbol: 'f' }, bytes: '', truncatedTo: 0 }),
    ).not.toBe(contextKeyOf({ ref: { path: 'x.ts' }, bytes: '', truncatedTo: 0 }));
  });
});

function producer(over: Partial<Producer> = {}): Producer {
  return {
    id: 'staleness/doc',
    kind: 'judgment',
    activation: 'idle',
    run: (input) => (input.kind === 'scope' && input.scope === 'BAD' ? [flag()] : []),
    envelope: () => slice('guide.md'),
    golden: { good: { kind: 'scope', scope: 'ok' }, bad: { kind: 'scope', scope: 'BAD' } },
    ...over,
  };
}

describe('FlagPipeline.runValidator (CF-5)', () => {
  it('resolves a refuted flag and keeps a confirmed one', async () => {
    const pipe = new FlagPipeline();
    pipe.registerProducer(producer());
    pipe.ingest(flag({ fingerprint: 'a', concernKey: 'k-a' }));
    pipe.ingest(flag({ fingerprint: 'b', concernKey: 'k-b' }));

    await pipe.runValidator(
      [
        flag({ fingerprint: 'a', concernKey: 'k-a' }),
        flag({ fingerprint: 'b', concernKey: 'k-b' }),
      ],
      async (group) =>
        group.flags.map((f) => ({
          fingerprint: f.fingerprint,
          verdict: f.fingerprint === 'a' ? ('refuted' as const) : ('confirmed' as const),
          confidence: 'high' as const,
          reason: 'judged',
        })),
    );

    const open = pipe.flagsForUser().collapsed.map((c) => c.concernKey);
    expect(open).toContain('k-b');
    expect(open).not.toContain('k-a');
  });

  it('never judges a Type-1 flag (the validator targets Type-2 only)', async () => {
    const pipe = new FlagPipeline();
    pipe.registerProducer(producer());
    const judged: string[] = [];
    await pipe.runValidator([flag({ fingerprint: 'a', type: 1 })], async (group) => {
      for (const f of group.flags) judged.push(f.fingerprint);
      return [];
    });
    expect(judged).toEqual([]);
  });
});

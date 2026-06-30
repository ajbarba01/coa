import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { FlagPipeline } from './pipeline.js';
import type { Producer } from './producer.js';

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'demo/rule',
    location: 'charge.ts:42',
    severity: 'med',
    message: 'something',
    fingerprint: 'fp-1',
    type: 2,
    confidence: 'low',
    concernKey: 'chargeTs42',
    ...over,
  };
}

function validProducer(): Producer {
  return {
    id: 'demo/no-todo',
    kind: 'deterministic',
    activation: 'on-change',
    run: (input) => (input.kind === 'scope' && input.scope === 'BAD' ? [flag({ type: 1 })] : []),
    golden: { good: { kind: 'scope', scope: 'ok' }, bad: { kind: 'scope', scope: 'BAD' } },
  };
}

describe('FlagPipeline registration (CF-6)', () => {
  it('admits a producer that passes its golden gate', () => {
    const pipe = new FlagPipeline();
    expect(() => pipe.registerProducer(validProducer())).not.toThrow();
  });

  it('quarantines (throws on) a producer that fails its golden gate', () => {
    const pipe = new FlagPipeline();
    const blind = { ...validProducer(), run: () => [] };
    expect(() => pipe.registerProducer(blind)).toThrow();
  });
});

describe('FlagPipeline ingest + flagsForUser (CF-1)', () => {
  it('expands crit/high and collapses-but-counts med/low', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ fingerprint: 'a', severity: 'high', concernKey: 'k1' }));
    pipe.ingest(flag({ fingerprint: 'b', severity: 'low', concernKey: 'k2' }));

    const view = pipe.flagsForUser();
    expect(view.expanded.map((f) => f.concernKey)).toEqual(['k1']);
    expect(view.collapsed).toEqual([{ concernKey: 'k2', count: 1, severity: 'low' }]);
  });

  it('is idempotent on fingerprint — a re-ingest replaces, never duplicates', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ fingerprint: 'a', severity: 'high', message: 'first' }));
    pipe.ingest(flag({ fingerprint: 'a', severity: 'high', message: 'second' }));

    const view = pipe.flagsForUser();
    expect(view.expanded).toHaveLength(1);
    expect(view.expanded[0].message).toBe('second');
  });

  it('collapses two producers on one concernKey into a single feed item (CF-7)', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ fingerprint: 'a', ruleId: 'tsc/2304', severity: 'high', concernKey: 'k' }));
    pipe.ingest(
      flag({ fingerprint: 'b', ruleId: 'grounding/x', severity: 'high', concernKey: 'k' }),
    );

    const view = pipe.flagsForUser();
    expect(view.expanded).toHaveLength(1);
    // corroboration by a second producer lifts a high concern to crit
    expect(view.expanded[0].severity).toBe('crit');
    expect(view.expanded[0].ruleId).toEqual(['grounding/x', 'tsc/2304']);
  });
});

describe('FlagPipeline flagsForAgent (CF-1 gated injection)', () => {
  it('injects only high-confidence crit/high, grouped by concernKey', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ fingerprint: 'a', type: 1, severity: 'high', concernKey: 'inject' }));
    pipe.ingest(
      flag({
        fingerprint: 'b',
        type: 2,
        confidence: 'low',
        severity: 'high',
        concernKey: 'withheld',
      }),
    );

    const bundle = pipe.flagsForAgent();
    expect(bundle.groups.map((g) => g.concernKey)).toEqual(['inject']);
  });

  it('withholds med/low from the agent budget but carries them on a count line', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag({ fingerprint: 'a', type: 1, severity: 'high', concernKey: 'inject' }));
    pipe.ingest(flag({ fingerprint: 'b', severity: 'med', concernKey: 'm1' }));
    pipe.ingest(flag({ fingerprint: 'c', severity: 'low', concernKey: 'm2' }));

    const bundle = pipe.flagsForAgent();
    expect(bundle.groups).toHaveLength(1);
    expect(bundle.countLine).toMatch(/2/);
  });
});

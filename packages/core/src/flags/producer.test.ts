import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { type Producer, type ProducerInput, validateProducer } from './producer.js';

/** A flag the demo producer emits when it "catches" something. */
function caught(location: string): FlagRecord {
  return {
    ruleId: 'demo/no-todo',
    location,
    severity: 'low',
    message: 'TODO left in source',
    fingerprint: `todo-${location}`,
    type: 1,
    confidence: 'high',
    concernKey: 'todoLeftInSource',
  };
}

/** A producer that flags any input whose `scope` contains the literal "BAD". */
function demoProducer(over: Partial<Producer> = {}): Producer {
  return {
    id: 'demo/no-todo',
    kind: 'deterministic',
    activation: 'on-change',
    run: (input: ProducerInput): FlagRecord[] =>
      input.kind === 'scope' && input.scope.includes('BAD') ? [caught(input.scope)] : [],
    golden: {
      good: { kind: 'scope', scope: 'clean.ts' },
      bad: { kind: 'scope', scope: 'BAD.ts' },
    },
    ...over,
  };
}

describe('validateProducer (CF-6 registration gate)', () => {
  it('admits a producer that passes the good case and catches the bad case', () => {
    expect(validateProducer(demoProducer())).toEqual({ ok: true });
  });

  it('rejects a producer that fails to catch its bad case', () => {
    const blind = demoProducer({ run: () => [] });
    const result = validateProducer(blind);
    expect(result.ok).toBe(false);
  });

  it('rejects a producer that false-positives on its good case', () => {
    const noisy = demoProducer({ run: () => [caught('anything')] });
    const result = validateProducer(noisy);
    expect(result.ok).toBe(false);
  });

  it('rejects a producer that fires on every member of the calibration corpus', () => {
    const corpus: ProducerInput[] = [
      { kind: 'scope', scope: 'a.ts' },
      { kind: 'scope', scope: 'b.ts' },
    ];
    const firesOnAll = demoProducer({
      run: (input) => [caught((input as { scope: string }).scope)],
    });
    const result = validateProducer(firesOnAll, corpus);
    expect(result.ok).toBe(false);
  });
});

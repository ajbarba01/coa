import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { mergeConcern } from './dedup.js';

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'demo/rule',
    location: 'charge.ts:42',
    severity: 'med',
    message: 'something',
    fingerprint: 'fp-1',
    type: 2,
    confidence: 'low',
    concernKey: 'chargeTs42MissingSymbol',
    ...over,
  };
}

describe('mergeConcern (CF-7)', () => {
  it('carries all contributing ruleIds onto one record', () => {
    const merged = mergeConcern([
      flag({ ruleId: 'tsc/2304', fingerprint: 'a' }),
      flag({ ruleId: 'grounding/missing-symbol', fingerprint: 'b' }),
    ]);
    expect(merged.ruleId).toEqual(['grounding/missing-symbol', 'tsc/2304']);
  });

  it('tiers at the highest contributing severity', () => {
    const merged = mergeConcern([
      flag({ severity: 'med', fingerprint: 'a' }),
      flag({ severity: 'high', fingerprint: 'b' }),
    ]);
    expect(merged.severity).toBe('high');
  });

  it('tiers at the highest contributing confidence', () => {
    const merged = mergeConcern([
      flag({ confidence: 'low', fingerprint: 'a' }),
      flag({ confidence: 'high', fingerprint: 'b' }),
    ]);
    expect(merged.confidence).toBe('high');
  });

  it('is gate-eligible (Type-1) if any contributing producer is deterministic', () => {
    const merged = mergeConcern([
      flag({ type: 2, fingerprint: 'a' }),
      flag({ type: 1, fingerprint: 'b' }),
    ]);
    expect(merged.type).toBe(1);
  });

  it('prefers a deterministic auto-patch from a Type-1 contributor', () => {
    const patch = { target: 'charge.ts', diff: { form: 'whole-file' as const, body: 'x' } };
    const merged = mergeConcern([
      flag({ type: 2, fingerprint: 'a' }),
      flag({ type: 1, fingerprint: 'b', fix: patch }),
    ]);
    expect(merged.fix).toEqual(patch);
  });

  it('a single flag round-trips to a single ruleId (no spurious array)', () => {
    const merged = mergeConcern([flag({ ruleId: 'tsc/2304' })]);
    expect(merged.ruleId).toBe('tsc/2304');
  });

  it('flattens already-merged ruleId arrays and de-duplicates', () => {
    const merged = mergeConcern([
      flag({ ruleId: ['tsc/2304', 'eslint/x'], fingerprint: 'a' }),
      flag({ ruleId: 'tsc/2304', fingerprint: 'b' }),
    ]);
    expect(merged.ruleId).toEqual(['eslint/x', 'tsc/2304']);
  });
});

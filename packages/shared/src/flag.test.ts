import { describe, expect, it } from 'vitest';
import { flagRecordSchema } from './flag.js';

const base = {
  ruleId: 'no-explicit-any',
  location: 'src/a.ts:42',
  severity: 'high' as const,
  message: 'unexpected any',
  fingerprint: 'fp-1',
  type: 1 as const,
  confidence: 'high' as const,
  concernKey: 'src/a.ts:42|missing-type',
};

describe('flagRecordSchema', () => {
  it('accepts a single ruleId and an array of ruleIds (CF-7 merge)', () => {
    expect(flagRecordSchema.parse(base).ruleId).toBe('no-explicit-any');
    expect(flagRecordSchema.parse({ ...base, ruleId: ['tsc', 'grounding'] }).ruleId).toEqual([
      'tsc',
      'grounding',
    ]);
  });

  it('round-trips a record carrying a deterministic fix patch', () => {
    const withFix = {
      ...base,
      fix: { target: 'src/a.ts', diff: { form: 'whole-file' as const, body: 'fixed' } },
    };
    expect(flagRecordSchema.parse(withFix)).toEqual(withFix);
  });

  it('rejects a type outside {1,2} and a non-enum severity', () => {
    expect(flagRecordSchema.safeParse({ ...base, type: 3 }).success).toBe(false);
    expect(flagRecordSchema.safeParse({ ...base, severity: 'blocker' }).success).toBe(false);
  });
});

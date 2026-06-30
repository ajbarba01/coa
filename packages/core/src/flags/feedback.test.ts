import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { resolutionFor } from './feedback.js';
import { FlagPipeline } from './pipeline.js';

function flag(over: Partial<FlagRecord> = {}): FlagRecord {
  return {
    ruleId: 'grounding/x',
    location: 'charge.ts:42',
    severity: 'high',
    message: 'did you mean chargeCard?',
    fingerprint: 'fp-1',
    type: 1,
    confidence: 'high',
    concernKey: 'chargeTs42',
    ...over,
  };
}

describe('resolutionFor (D131 typed-reason → effect)', () => {
  it('treats a wrong-guess as a false positive (resolve)', () => {
    expect(resolutionFor('wrong-guess')).toBe('resolve');
  });

  it('suppresses an intentional/aspirational/policy dismissal (baseline)', () => {
    expect(resolutionFor('intentional-historical-reference')).toBe('baseline');
    expect(resolutionFor('doc-is-aspirational')).toBe('baseline');
    expect(resolutionFor('wont-fix-by-policy')).toBe('baseline');
  });

  it('keeps a rule-too-blunt flag but seeds a proposal (record-only)', () => {
    expect(resolutionFor('rule-too-blunt')).toBe('record');
  });
});

describe('FlagPipeline.submitFeedback (D131)', () => {
  it('records the typed reason for later constraint proposals', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    pipe.submitFeedback(flag(), 'rule-too-blunt');
    expect(pipe.feedback()).toEqual([{ fingerprint: 'fp-1', reason: 'rule-too-blunt' }]);
  });

  it('a wrong-guess resolves the flag so it no longer blocks', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    expect(pipe.gate().allow).toBe(false);
    pipe.submitFeedback(flag(), 'wrong-guess');
    expect(pipe.gate()).toEqual({ allow: true });
  });

  it('a won’t-fix dismissal baselines the flag (unblocks, stays visible)', () => {
    const pipe = new FlagPipeline();
    pipe.ingest(flag());
    pipe.submitFeedback(flag(), 'wont-fix-by-policy');
    expect(pipe.gate()).toEqual({ allow: true });
    expect(pipe.flagsForUser().expanded).toHaveLength(1);
  });
});

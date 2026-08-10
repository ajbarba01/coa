import { describe, expect, it } from 'vitest';
import type { MetricId, MetricSample } from '@coa/shared';
import { composeProfile } from './health-profile.js';

const sample = (
  metric: MetricId,
  value: number,
  over: Partial<MetricSample> = {},
): MetricSample => ({
  metric,
  granularity: 'file',
  target: 'src/x.ts',
  value,
  sizeLoc: 100,
  basis: 'graph',
  confidence: 'high',
  walPosition: 1,
  ...over,
});

/** A breach predicate for tests: any non-zero value is "bad". */
const nonZeroIsWorst = (s: MetricSample): boolean => s.value > 0;

describe('composeProfile — the HLT-2 non-compensatory composition', () => {
  it('lists each independently-breaching metric in worst (no weighted sum)', () => {
    const profile = composeProfile(
      'src/x.ts',
      'file',
      [sample('cycle', 1), sample('churn', 0)],
      nonZeroIsWorst,
    );
    expect(profile.worst).toEqual(['cycle']);
    expect(profile.samples).toHaveLength(2);
  });

  it('surfaces a lone hotspot among otherwise-clean signals (no average can hide it)', () => {
    const profile = composeProfile(
      'src/x.ts',
      'file',
      [sample('churn', 0), sample('cycle', 0), sample('hotspot', 1)],
      nonZeroIsWorst,
    );
    expect(profile.worst).toEqual(['hotspot']);
  });

  it('never lists size-loc in worst (it is the confound control, not a health signal)', () => {
    const profile = composeProfile('src/x.ts', 'file', [sample('size-loc', 9999)], nonZeroIsWorst);
    expect(profile.worst).toEqual([]);
  });

  it('never lists the hint-only metrics (instability / lcom4) in worst', () => {
    const profile = composeProfile(
      'pay',
      'scope',
      [
        sample('instability', 1, { granularity: 'scope' }),
        sample('lcom4', 1, { granularity: 'scope' }),
      ],
      nonZeroIsWorst,
    );
    expect(profile.worst).toEqual([]);
  });

  it('keeps the full sample vector and carries no rolled-up score', () => {
    const samples = [sample('cycle', 1), sample('churn', 3)];
    const profile = composeProfile('src/x.ts', 'file', samples, nonZeroIsWorst);
    expect(profile.samples).toEqual(samples);
    expect(profile).not.toHaveProperty('score');
  });

  it('dedupes a metric that breaches across several samples', () => {
    const profile = composeProfile(
      'src/x.ts',
      'file',
      [sample('cycle', 1, { target: 'a' }), sample('cycle', 1, { target: 'b' })],
      nonZeroIsWorst,
    );
    expect(profile.worst).toEqual(['cycle']);
  });
});

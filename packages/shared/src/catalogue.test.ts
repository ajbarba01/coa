import { describe, expect, it } from 'vitest';
import { capabilityProfileSchema } from './capability.js';
import { canonicalizationProfileSchema, tierSchema } from './code-lens.js';
import { neutralConfigSchema } from './config.js';
import { healthProfileSchema, metricSampleSchema } from './metric.js';

/** Smoke coverage for the remaining shared records that have no dedicated test file. */
describe('shared type-catalogue smoke', () => {
  it('tierSchema accepts only 0|1|2', () => {
    expect(tierSchema.parse(2)).toBe(2);
    expect(tierSchema.safeParse(3).success).toBe(false);
  });

  it('canonicalizationProfileSchema accepts ignore regions as number pairs', () => {
    expect(
      canonicalizationProfileSchema.parse({ lang: 'ts', ignoreRegions: [[0, 10]] }).ignoreRegions,
    ).toEqual([[0, 10]]);
  });

  it('metricSampleSchema requires sizeLoc alongside the value (the size confound control)', () => {
    const ok = {
      metric: 'cognitive-complexity' as const,
      granularity: 'symbol' as const,
      target: 'sym:beginWork',
      value: 71,
      sizeLoc: 4800,
      basis: 'ast' as const,
      confidence: 'high' as const,
      walPosition: 100,
    };
    expect(metricSampleSchema.parse(ok)).toEqual(ok);
    const { sizeLoc: _omit, ...withoutSize } = ok;
    expect(metricSampleSchema.safeParse(withoutSize).success).toBe(false);
  });

  it('healthProfileSchema is a non-compensatory vector (samples + worst)', () => {
    const profile = {
      target: 'payments',
      granularity: 'scope' as const,
      samples: [],
      worst: ['cycle' as const],
    };
    expect(healthProfileSchema.parse(profile).worst).toEqual(['cycle']);
  });

  it('capabilityProfileSchema carries ports + degradation', () => {
    const profile = {
      ports: { lsp: { present: false, nullFallback: 'tree-sitter floor' } },
      spiVersion: '0.1.0',
      degradation: { lsp: 'exact refs unavailable; degraded to tree-sitter' },
    };
    expect(capabilityProfileSchema.parse(profile).ports['lsp']?.present).toBe(false);
  });

  it('neutralConfigSchema keeps the pinned slot set', () => {
    const cfg = {
      prefixHead: [],
      systemReminders: [],
      onDemandPullable: [],
      scopePushed: [],
      toolIntents: { allow: ['Read'], deny: [] },
    };
    expect(neutralConfigSchema.parse(cfg)).toMatchObject({ onDemandPullable: [] });
  });
});

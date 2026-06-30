import { describe, expect, it } from 'vitest';
import type { FlagRecord } from '@coa/shared';
import { assignConfidence, assignSeverity } from './severity.js';

/** A minimal Type-2 flag with a producer-biased default. */
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

describe('assignConfidence (CF-2)', () => {
  it('Type-1 is always high-confidence even if the producer stamped low', () => {
    expect(assignConfidence(flag({ type: 1, confidence: 'low' }), {})).toBe('high');
  });

  it('a bare Type-2 lexical near-miss is low-confidence', () => {
    expect(assignConfidence(flag({ type: 2, confidence: 'low' }), {})).toBe('low');
  });

  it('Type-2 with deterministic evidence (rename-provenance) is high-confidence', () => {
    expect(assignConfidence(flag({ type: 2 }), { evidenceDeterminism: true })).toBe('high');
  });

  it('Type-2 corroborated by a second producer is high-confidence', () => {
    expect(assignConfidence(flag({ type: 2 }), { corroboration: 2 })).toBe('high');
  });
});

describe('assignSeverity (CF-2 + D134)', () => {
  it('a producer cannot self-stamp crit without cross-producer corroboration', () => {
    expect(assignSeverity(flag({ severity: 'crit' }), { corroboration: 1 })).not.toBe('crit');
  });

  it('crit is reachable when a high flag is corroborated by a second producer', () => {
    expect(assignSeverity(flag({ severity: 'high' }), { corroboration: 2 })).toBe('crit');
  });

  it('a structural-shake (signature/export change) outranks a body-only edit', () => {
    const bodyOnly = assignSeverity(flag({ severity: 'med' }), { structuralShake: false });
    const shake = assignSeverity(flag({ severity: 'med' }), { structuralShake: true });
    expect(rank(shake)).toBeGreaterThan(rank(bodyOnly));
  });

  it('D134 ratio: a large change relative to node size bumps severity', () => {
    const small = assignSeverity(flag({ severity: 'med' }), { linesChanged: 1, nodeSize: 100 });
    const big = assignSeverity(flag({ severity: 'med' }), { linesChanged: 80, nodeSize: 100 });
    expect(rank(big)).toBeGreaterThan(rank(small));
  });

  it('measured low precision damps severity', () => {
    const base = assignSeverity(flag({ severity: 'high' }), {});
    const damped = assignSeverity(flag({ severity: 'high' }), { measuredPrecision: 0.1 });
    expect(rank(damped)).toBeLessThan(rank(base));
  });

  it('an out-of-scope flag is damped', () => {
    const base = assignSeverity(flag({ severity: 'high' }), {});
    const damped = assignSeverity(flag({ severity: 'high' }), { inScope: false });
    expect(rank(damped)).toBeLessThan(rank(base));
  });
});

const ORDER = ['low', 'med', 'high', 'crit'] as const;
function rank(s: string): number {
  return ORDER.indexOf(s as (typeof ORDER)[number]);
}

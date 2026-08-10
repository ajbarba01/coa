// Archived from packages/core/src/context/health.test.ts
import { describe, expect, it } from 'vitest';
import { health, type HealthSource, type HealthThresholds } from './health.js';

function source(over: Partial<HealthSource> = {}): HealthSource {
  return {
    cycles: () => [],
    coupling: (node) => ({ node, fanOut: 0, fanIn: 0, cbo: 0, outgoing: [], incoming: [] }),
    temporal: (node) => ({ node, churn: 0, hotspot: 0, changeCoupling: [] }),
    sizeLoc: () => 0,
    walPosition: () => 7,
    ...over,
  };
}

const thresholds: HealthThresholds = { churn: 10, hotspot: 10, fanIn: 12, fanOut: 12, cbo: 16 };

const valueOf = (
  profile: { samples: { metric: string; value: number }[] },
  metric: string,
): number | undefined => profile.samples.find((s) => s.metric === metric)?.value;

describe('health — the L-HLT floor producer', () => {
  it('reports churn and hotspot for a file from the WAL temporal view', () => {
    const profile = health(
      'src/x.ts',
      'file',
      source({
        temporal: (node) => ({ node, churn: 5, hotspot: 5, changeCoupling: [] }),
        sizeLoc: () => 200,
      }),
      thresholds,
    );
    expect(valueOf(profile, 'churn')).toBe(5);
    expect(valueOf(profile, 'hotspot')).toBe(5);
    const churn = profile.samples.find((s) => s.metric === 'churn');
    expect(churn?.basis).toBe('wal');
    expect(profile.samples.find((s) => s.metric === 'hotspot')?.basis).toBe('graph+wal');
  });

  it('always reports size-loc as a control alongside, never in worst', () => {
    const profile = health('src/x.ts', 'file', source({ sizeLoc: () => 200 }), thresholds);
    expect(valueOf(profile, 'size-loc')).toBe(200);
    expect(profile.worst).not.toContain('size-loc');
  });

  it('flags a file whose churn breaches the threshold', () => {
    const profile = health(
      'src/x.ts',
      'file',
      source({ temporal: (node) => ({ node, churn: 20, hotspot: 20, changeCoupling: [] }) }),
      thresholds,
    );
    expect(profile.worst).toContain('churn');
  });

  it('flags a symbol in a dependency cycle (threshold-free structural)', () => {
    const profile = health(
      'a',
      'symbol',
      source({ cycles: () => [{ id: 'a|b', members: ['a', 'b'], backEdges: [] }] }),
      thresholds,
    );
    expect(valueOf(profile, 'cycle')).toBe(2);
    expect(profile.worst).toContain('cycle');
  });

  it('does not flag a symbol that is in no cycle', () => {
    const profile = health(
      'a',
      'symbol',
      source({ cycles: () => [{ id: 'b|c', members: ['b', 'c'], backEdges: [] }] }),
      thresholds,
    );
    expect(valueOf(profile, 'cycle')).toBe(0);
    expect(profile.worst).not.toContain('cycle');
  });

  it('reports fan-in and fan-out for a symbol from coupling', () => {
    const profile = health(
      'a',
      'symbol',
      source({
        coupling: (node) => ({ node, fanOut: 4, fanIn: 3, cbo: 6, outgoing: [], incoming: [] }),
      }),
      thresholds,
    );
    expect(valueOf(profile, 'fan-in')).toBe(3);
    expect(valueOf(profile, 'fan-out')).toBe(4);
  });

  it('stamps the wal freshness position on every sample', () => {
    const profile = health('src/x.ts', 'file', source({ walPosition: () => 42 }), thresholds);
    expect(profile.samples.length).toBeGreaterThan(0);
    expect(profile.samples.every((s) => s.walPosition === 42)).toBe(true);
  });

  it('applies conservative default thresholds when none are supplied', () => {
    const profile = health(
      'src/x.ts',
      'file',
      source({ temporal: (node) => ({ node, churn: 1000, hotspot: 1000, changeCoupling: [] }) }),
    );
    expect(profile.worst).toContain('churn');
  });
});

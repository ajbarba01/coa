import { describe, expect, it } from 'vitest';
import type { ModelDescriptor, ModelEntry } from '@coa/shared';
import { effectiveModels } from './effective-models.js';

const entry = (id: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({ id, origin: 'default', ...extra });

describe('effectiveModels', () => {
  it('hidden entries are dropped; order follows the user list', () => {
    const out = effectiveModels('claude', [entry('a'), entry('b', { hidden: true }), entry('c')], []);
    expect(out.map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('an empty list assembles to an empty list (picker falls back to backend default)', () => {
    expect(effectiveModels('claude', [], [{ id: 'live-1' }])).toEqual([]);
  });

  it('live fetch enriches by id but never defines membership', () => {
    const live: ModelDescriptor[] = [
      { id: 'claude-x', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
      { id: 'not-in-list' },
    ];
    const out = effectiveModels('claude', [entry('claude-x')], live);
    expect(out).toEqual([
      { id: 'claude-x', provider: 'claude', supportsEffort: true, supportedEffortLevels: ['low', 'high'] },
    ]);
  });

  it('falls back to catalog caps when the live fetch lacks the id', () => {
    const out = effectiveModels('claude', [entry('claude-opus-4-8')], []);
    expect(out[0]?.supportsEffort).toBe(true);
    expect(out[0]?.displayName).toBe('opus 4.8');
  });

  it('an unknown hand-typed id degrades to a bare runnable descriptor (never-cage)', () => {
    expect(effectiveModels('claude', [entry('mystery', { origin: 'custom' })], [])).toEqual([
      { id: 'mystery', provider: 'claude' },
    ]);
  });

  it('the user label overrides every tier as displayName', () => {
    const live: ModelDescriptor[] = [{ id: 'claude-x', displayName: 'from live' }];
    const out = effectiveModels('claude', [entry('claude-x', { label: 'mine' })], live);
    expect(out[0]?.displayName).toBe('mine');
  });

  it('reasoning overrides replace the base caps per the mapping table', () => {
    const live: ModelDescriptor[] = [
      { id: 'x', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAdaptiveThinking: true },
    ];
    const cases: [ModelEntry['reasoning'], Partial<ModelDescriptor>][] = [
      [{ kind: 'none' }, {}],
      [{ kind: 'effort', max: 'high' }, { supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] }],
      [{ kind: 'thinking' }, { supportsThinking: true }],
      [{ kind: 'budget', tokens: 8000 }, { supportsAdaptiveThinking: true }],
    ];
    for (const [reasoning, caps] of cases) {
      const out = effectiveModels('claude', [entry('x', { reasoning })], live);
      expect(out[0]).toEqual({ id: 'x', provider: 'claude', ...caps });
    }
  });
});

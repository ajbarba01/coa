import type { ClaudeReasoning } from '@coa/shared';
import { describe, expect, it } from 'vitest';
import { reasoningToOptions } from './reasoning.js';

describe('reasoningToOptions — coa ClaudeReasoning → SDK thinking/effort (1:1)', () => {
  it('maps off to disabled thinking (no effort)', () => {
    expect(reasoningToOptions({ mode: 'off' })).toEqual({ thinking: { type: 'disabled' } });
  });

  it('maps an effort level to adaptive thinking + that effort', () => {
    const cases: ClaudeReasoning[] = [
      { mode: 'effort', effort: 'low' },
      { mode: 'effort', effort: 'high' },
      { mode: 'effort', effort: 'xhigh' },
      { mode: 'effort', effort: 'max' },
    ];
    for (const r of cases) {
      expect(reasoningToOptions(r)).toEqual({
        thinking: { type: 'adaptive' },
        effort: (r as { effort: string }).effort,
      });
    }
  });

  it('maps a budget to enabled thinking with the fixed token budget', () => {
    expect(reasoningToOptions({ mode: 'budget', budgetTokens: 8000 })).toEqual({
      thinking: { type: 'enabled', budgetTokens: 8000 },
    });
  });
});

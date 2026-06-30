import { describe, expect, it } from 'vitest';
import type { SymbolRecord } from '@coa/shared';
import { FuzzyIndex } from './fuzzy-index.js';

const sym = (name: string): SymbolRecord => ({ name, definedIn: `${name}.ts:1:1` });

describe('FuzzyIndex', () => {
  const index = new FuzzyIndex();
  index.build([sym('chargeCard'), sym('capturePayment'), sym('refundOrder')]);

  it('ranks the nearest name first on a near-miss', () => {
    const candidates = index.match('chargeCrd');
    expect(candidates[0]?.symbol.name).toBe('chargeCard');
    expect(candidates[0]?.confidence).toBeGreaterThan(0.5);
    expect(candidates[0]?.confidence).toBeLessThanOrEqual(1);
    expect(candidates[0]?.why).toContain('edit distance');
  });

  it('caps the number of candidates returned', () => {
    expect(index.match('x', 2).length).toBeLessThanOrEqual(2);
  });

  it('returns nothing for a name nowhere near the index', () => {
    expect(index.match('zzzzzzzzzzzzzz')).toEqual([]);
  });
});

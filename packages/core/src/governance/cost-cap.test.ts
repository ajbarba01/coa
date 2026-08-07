import { describe, expect, it } from 'vitest';
import { CostCap } from './cost-cap.js';

describe('CostCap (the spend counter, a pass-through)', () => {
  it('imposes no ceiling — spend never trips a cap', () => {
    const cap = new CostCap();
    cap.charge('s1', 5);
    cap.charge('s1', 100);
    expect(cap.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('reads the same unbounded state for every session', () => {
    const cap = new CostCap();
    cap.charge('s1', 4);
    cap.charge('s2', 3);
    expect(cap.capState('s1')).toEqual({ remaining: null, capHit: false });
    expect(cap.capState('s2')).toEqual({ remaining: null, capHit: false });
  });

  it('capState is non-mutating — repeated reads never charge', () => {
    const cap = new CostCap();
    cap.capState();
    cap.capState();
    expect(cap.capState()).toEqual({ remaining: null, capHit: false });
  });
});

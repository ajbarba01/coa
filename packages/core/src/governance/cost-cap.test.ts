import { describe, expect, it } from 'vitest';
import { CostCap } from './cost-cap.js';

describe('CostCap (the cost-cap seam, default pass-through)', () => {
  it('imposes no ceiling under the subscription model (the v1 default)', () => {
    const cap = new CostCap();
    cap.charge('s1', 5);
    cap.charge('s1', 100);
    expect(cap.capState()).toEqual({ remaining: null, capHit: false });
  });

  it('meters against a configured API-route ceiling', () => {
    const cap = new CostCap({ ceilingUsd: 10 });
    cap.charge('s1', 4);
    expect(cap.capState()).toEqual({ remaining: 6, capHit: false });
  });

  it('hits the cap (fail-expensive) once the ceiling is reached', () => {
    const cap = new CostCap({ ceilingUsd: 10 });
    cap.charge('s1', 10);
    expect(cap.capState()).toEqual({ remaining: 0, capHit: true });
  });

  it('is daemon-global — one session’s spend reduces every session’s remaining', () => {
    const cap = new CostCap({ ceilingUsd: 10 });
    cap.charge('s1', 4);
    cap.charge('s2', 3);
    expect(cap.capState('s1').remaining).toBe(3);
    expect(cap.capState('s2').remaining).toBe(3);
  });

  it('capState is non-mutating — repeated reads never double-charge', () => {
    const cap = new CostCap({ ceilingUsd: 10 });
    cap.charge('s1', 4);
    cap.capState();
    cap.capState();
    expect(cap.capState().remaining).toBe(6);
  });
});

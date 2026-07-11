import { describe, expect, it } from 'vitest';
import { resolveCollapse } from './resolve-collapse.js';

const SPEC = { min: 200, max: 340, collapseBelow: 112, reopenAt: 132 };

describe('resolveCollapse', () => {
  it('collapses below the threshold', () => {
    expect(resolveCollapse(100, SPEC, true)).toEqual({ open: false, width: null });
  });

  it('holds closed inside the hysteresis band (no flapping)', () => {
    expect(resolveCollapse(120, SPEC, false)).toEqual({ open: false, width: null });
  });

  it('reopens at the reopen threshold with a clamped width', () => {
    expect(resolveCollapse(150, SPEC, false)).toEqual({ open: true, width: 200 });
    expect(resolveCollapse(400, SPEC, false)).toEqual({ open: true, width: 340 });
  });

  it('while open, tracks the clamped width and ignores the band', () => {
    expect(resolveCollapse(120, SPEC, true)).toEqual({ open: true, width: null });
    expect(resolveCollapse(250, SPEC, true)).toEqual({ open: true, width: 250 });
  });
});

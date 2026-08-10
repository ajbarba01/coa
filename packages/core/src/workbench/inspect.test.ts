import { describe, expect, it } from 'vitest';
import type { FeedView } from '@coa/shared';
import type { CapState } from '../governance/cost-cap.js';
import { contextStatus, getSpec, runChecks, type InspectDeps } from './inspect.js';

const feed: FeedView = { expanded: [], collapsed: [] };
const cap: CapState = { remaining: null, capHit: false };

const deps = (over: Partial<InspectDeps> = {}): InspectDeps => ({
  runChecks: () => feed,
  capState: () => cap,
  ...over,
});

describe('runChecks', () => {
  it('returns the on-demand flag feed for the scope', () => {
    const out = runChecks({ scope: 'src' }, deps());
    expect(out.result).toEqual(feed);
  });
});

describe('contextStatus', () => {
  it('returns the cap state and a null context package at the floor', () => {
    const out = contextStatus(deps());
    expect(out.result).toEqual({ cap, context: null });
  });
});

describe('getSpec', () => {
  it('returns a null governing spec at the floor (no spec store yet)', () => {
    const out = getSpec({ ref: 'src/u.ts#userName' }, deps());
    expect(out.result).toEqual({ ref: 'src/u.ts#userName', spec: null });
  });
});

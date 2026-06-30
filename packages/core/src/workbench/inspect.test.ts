import { describe, expect, it } from 'vitest';
import type { FeedView } from '@coa/shared';
import type { CapState } from '../governance/cost-cap.js';
import type { DecisionEntry } from '../governance/governance-log.js';
import {
  contextStatus,
  getDecision,
  getSpec,
  runChecks,
  why,
  type InspectDeps,
} from './inspect.js';

const feed: FeedView = { expanded: [], collapsed: [] };
const cap: CapState = { remaining: null, capHit: false };
const decision: DecisionEntry = {
  id: 4,
  target: 'src/u.ts#userName',
  entry: 'renamed for clarity',
};

const deps = (over: Partial<InspectDeps> = {}): InspectDeps => ({
  runChecks: () => feed,
  capState: () => cap,
  decisionsByTarget: (target) => (target === decision.target ? [decision] : []),
  readDecision: (id) => (id === 4 ? decision : undefined),
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

describe('why', () => {
  it('returns the decision-log rationale for a target', () => {
    const out = why({ target: 'src/u.ts#userName' }, deps());
    expect(out.result).toEqual({ target: 'src/u.ts#userName', decisions: [decision] });
  });
});

describe('getDecision', () => {
  it('returns a numbered decision-log entry', () => {
    const out = getDecision({ id: 4 }, deps());
    expect(out.result).toEqual({ found: true, decision });
  });

  it('returns not-found for an unknown id', () => {
    const out = getDecision({ id: 99 }, deps());
    expect(out.result).toEqual({ found: false });
  });
});

describe('getSpec', () => {
  it('returns a null governing spec at the floor (no spec store yet)', () => {
    const out = getSpec({ ref: 'src/u.ts#userName' }, deps());
    expect(out.result).toEqual({ ref: 'src/u.ts#userName', spec: null });
  });
});

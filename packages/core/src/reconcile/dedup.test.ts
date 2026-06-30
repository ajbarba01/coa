import { describe, expect, it } from 'vitest';
import { classifyObservation, type Observation, type PathState } from './dedup.js';

const obs = (over: Partial<Observation> = {}): Observation => ({
  worktree: 'w',
  path: 'a.ts',
  postHash: 'h1',
  ...over,
});

describe('classifyObservation (causal dedup, D120)', () => {
  it('emits an inferred create for a newly observed file', () => {
    const draft = classifyObservation(obs({ postHash: 'h1' }), { priorHash: null });
    expect(draft?.kind).toBe('create');
    expect(draft?.provenance).toBe('inferred');
    expect(draft?.actor).toBe('reconciler');
    expect(draft?.op_id).toBeNull();
    if (draft?.kind === 'create') {
      expect(draft.pre_hash).toBeNull();
      expect(draft.post_hash).toBe('h1');
    }
  });

  it('emits an inferred modify when content changed', () => {
    const draft = classifyObservation(obs({ postHash: 'h2' }), { priorHash: 'h1' });
    expect(draft?.kind).toBe('modify');
    if (draft?.kind === 'modify') {
      expect(draft.pre_hash).toBe('h1');
      expect(draft.post_hash).toBe('h2');
    }
  });

  it('emits a delete when the file vanished', () => {
    const draft = classifyObservation(obs({ postHash: null }), { priorHash: 'h1' });
    expect(draft?.kind).toBe('delete');
    if (draft?.kind === 'delete') expect(draft.post_hash).toBeNull();
  });

  it('drops a no-op observation (content-hash dedup)', () => {
    expect(classifyObservation(obs({ postHash: 'h1' }), { priorHash: 'h1' })).toBeNull();
    expect(classifyObservation(obs({ postHash: null }), { priorHash: null })).toBeNull();
  });

  it('emits a confirm (not a duplicate) when a precise event already covered the change', () => {
    const state: PathState = {
      priorHash: 'h1',
      pendingPrecise: { opId: 'op-9', preHash: 'h1', postHash: 'h2', provenance: 'declared' },
    };
    const draft = classifyObservation(obs({ postHash: 'h2' }), state);
    expect(draft?.kind).toBe('confirm');
    expect(draft?.op_id).toBe('op-9');
    expect(draft?.provenance).toBe('declared');
  });
});

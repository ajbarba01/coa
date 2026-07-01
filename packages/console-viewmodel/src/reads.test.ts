import { describe, expect, it } from 'vitest';
import { CheckpointSchema, FeedViewSchema, TimelineSchema } from './reads.js';

describe('console read schemas', () => {
  it('accepts a well-formed feed view', () => {
    const feed = { expanded: [], collapsed: [{ concernKey: 'k', count: 3, severity: 'med' }] };
    expect(FeedViewSchema.parse(feed)).toEqual(feed);
  });

  it('accepts a checkpoint list and strips unknown fields', () => {
    const cp = { id: 'c1', seq: 12, ts: '2026-07-01T00:00:00Z', worktree: 'wt', pinned: false };
    expect(TimelineSchema.parse([cp])).toEqual([cp]);
    expect(CheckpointSchema.parse({ ...cp, extra: 1 })).toEqual(cp);
  });
});

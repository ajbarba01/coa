import { describe, expect, it } from 'vitest';
import { Timeline } from './checkpoint.js';

describe('Timeline', () => {
  it('records checkpoints as pointer tuples', () => {
    const timeline = new Timeline();
    const a = timeline.checkpoint(3, 'main');
    const b = timeline.checkpoint(7, 'main');
    expect(timeline.listTimeline().map((c) => c.seq)).toEqual([3, 7]);
    expect(a.id).not.toBe(b.id);
    expect(a.pinned).toBe(false);
  });
});

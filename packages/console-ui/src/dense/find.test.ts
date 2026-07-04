import { describe, expect, it } from 'vitest';
import { findMatches } from './find.js';

describe('findMatches', () => {
  it('matches frames by case-insensitive text', () => {
    const frames = [
      { id: 'a', role: 'agent', kind: 'text', text: 'Hello World' },
      { id: 'b', role: 'agent', kind: 'text', text: 'nothing here' },
      { id: 'c', role: 'you', kind: 'text', text: 'say hello again' },
    ] as const;
    expect(findMatches(frames as never, 'hello').map((m) => m.frameId)).toEqual(['a', 'c']);
    expect(findMatches(frames as never, '')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { findTermMatches } from './find.js';

describe('findTermMatches', () => {
  const frames = [
    { id: 'a', role: 'agent', kind: 'text', text: 'Hello World, hello again' },
    { id: 'b', role: 'agent', kind: 'text', text: 'nothing here' },
    { id: 'c', role: 'you', kind: 'text', text: 'say hello' },
  ] as const;

  it('counts every occurrence, not just rows (case-insensitive)', () => {
    const matches = findTermMatches(frames as never, 'hello');
    expect(matches.map((m) => [m.frameId, m.occurrence])).toEqual([
      ['a', 0],
      ['a', 1],
      ['c', 0],
    ]);
  });

  it('empty and whitespace queries match nothing', () => {
    expect(findTermMatches(frames as never, '')).toEqual([]);
    expect(findTermMatches(frames as never, '   ')).toEqual([]);
  });

  it('carries the frame index for row navigation', () => {
    const matches = findTermMatches(frames as never, 'hello');
    expect(matches.map((m) => m.index)).toEqual([0, 0, 2]);
  });
});

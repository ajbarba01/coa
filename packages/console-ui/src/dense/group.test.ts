import { describe, expect, it } from 'vitest';
import { groupByUserTurn } from './group.js';
import type { TranscriptFrame } from './Transcript.js';

const f = (id: string, role: 'you' | 'agent', text: string): TranscriptFrame => ({ id, role, kind: 'text', text });

describe('groupByUserTurn', () => {
  it('starts a new group at each user turn and holds the following frames', () => {
    const g = groupByUserTurn([f('1', 'you', 'a'), f('2', 'agent', 'b'), f('3', 'agent', 'c'), f('4', 'you', 'd')]);
    expect(g.counts).toEqual([2, 0]);
    expect(g.headers.map((h) => h?.id)).toEqual(['1', '4']);
    expect(g.items.map((i) => i.id)).toEqual(['2', '3']);
  });
  it('puts pre-first-user frames in a leading headerless group', () => {
    const g = groupByUserTurn([f('1', 'agent', 'sys'), f('2', 'you', 'hi')]);
    expect(g.counts).toEqual([1, 0]);
    expect(g.headers[0]).toBeUndefined();
    expect(g.headers[1]?.id).toBe('2');
  });
});

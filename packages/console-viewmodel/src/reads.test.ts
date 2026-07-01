import { describe, expect, it } from 'vitest';
import {
  CheckpointSchema,
  FeedViewSchema,
  TimelineSchema,
  TurnFrameSchema,
  TurnStreamSchema,
} from './reads.js';

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

describe('turn frame schema', () => {
  it('accepts each governed frame kind', () => {
    const frames = [
      { id: '1', role: 'you', kind: 'text', text: 'go' },
      { id: '2', role: 'agent', kind: 'tool-use', tool: 'read_file', input: '{}' },
      { id: '3', role: 'agent', kind: 'tool-result', tool: 'read_file', output: 'ok', ok: true },
      { id: '4', kind: 'approval', requestId: 'r1', tool: 'write_file', summary: 's' },
      { id: '5', kind: 'deny', denyKind: 'cost-cap', reason: 'cap' },
    ];
    expect(TurnStreamSchema.parse(frames)).toHaveLength(5);
  });

  it('rejects an unknown frame kind', () => {
    expect(() => TurnFrameSchema.parse({ id: 'x', kind: 'nope' })).toThrow();
  });

  it('carries optional subagent depth', () => {
    const f = TurnFrameSchema.parse({
      id: '6',
      role: 'subagent',
      kind: 'text',
      text: 'r',
      depth: 1,
    });
    expect(f).toMatchObject({ depth: 1 });
  });
});

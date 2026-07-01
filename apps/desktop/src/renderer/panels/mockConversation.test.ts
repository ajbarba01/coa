import { describe, expect, it } from 'vitest';
import { TurnStreamSchema } from '@coa/console-viewmodel';
import { MOCK_TURNS } from './mockConversation.js';

describe('MOCK_TURNS', () => {
  it('conforms to the turn-stream edge schema', () => {
    expect(() => TurnStreamSchema.parse(MOCK_TURNS)).not.toThrow();
  });

  it('exercises the states the transcript must render', () => {
    const kinds = new Set(MOCK_TURNS.map((f) => f.kind));
    for (const k of ['text', 'tool-use', 'tool-result', 'approval', 'deny'])
      expect(kinds.has(k)).toBe(true);
    expect(MOCK_TURNS.some((f) => 'depth' in f && f.depth)).toBe(true); // a nested subagent
  });
});

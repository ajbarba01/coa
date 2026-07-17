import { describe, expect, it } from 'vitest';
import { nearBottom, previousPromptIndex } from './scrollState.js';
import type { TranscriptFrame } from './Transcript.js';

describe('nearBottom', () => {
  it('is true within the threshold and false beyond it', () => {
    expect(nearBottom(880, 100, 1000, 100)).toBe(true); // 20px from bottom
    expect(nearBottom(700, 100, 1000, 100)).toBe(false); // 200px from bottom
  });
});

describe('previousPromptIndex', () => {
  const f = (id: string, role: 'you' | 'agent'): TranscriptFrame => ({
    id,
    role,
    kind: 'text',
    text: id,
  });
  const frames = [f('u1', 'you'), f('a1', 'agent'), f('u2', 'you'), f('a2', 'agent')];
  it('finds the nearest user prompt above the cursor', () => {
    expect(previousPromptIndex(frames, 3)).toBe(2);
    expect(previousPromptIndex(frames, 2)).toBe(0);
    expect(previousPromptIndex(frames, 0)).toBeUndefined();
  });
});

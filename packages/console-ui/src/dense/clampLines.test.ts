import { describe, expect, it } from 'vitest';
import { clampLines } from './clampLines.js';

describe('clampLines', () => {
  it('returns the text untouched when within the limit', () => {
    expect(clampLines('a\nb\nc', 5)).toEqual({
      shown: 'a\nb\nc',
      truncated: false,
      hiddenCount: 0,
    });
    expect(clampLines('a\nb\nc', 3)).toEqual({
      shown: 'a\nb\nc',
      truncated: false,
      hiddenCount: 0,
    });
  });

  it('clamps to the first N lines when over the limit (byte-faithful shown)', () => {
    expect(clampLines('a\nb\nc\nd', 2)).toEqual({ shown: 'a\nb', truncated: true, hiddenCount: 2 });
  });

  it('clamps to the last N lines with fromEnd', () => {
    expect(clampLines('a\nb\nc\nd', 2, { fromEnd: true })).toEqual({
      shown: 'c\nd',
      truncated: true,
      hiddenCount: 2,
    });
  });

  it('preserves whitespace lines verbatim', () => {
    expect(clampLines('  x\n\ty\nz', 2).shown).toBe('  x\n\ty');
  });
});

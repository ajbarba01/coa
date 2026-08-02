import { describe, expect, it } from 'vitest';
import { estimateTokens, formatTokens } from './tokenEstimate.js';

describe('estimateTokens', () => {
  it('estimates ~4 chars per token, rounding up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('scales to larger text', () => {
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
    expect(estimateTokens('x'.repeat(4001))).toBe(1001);
  });
});

describe('formatTokens', () => {
  it('prints small counts verbatim', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(820)).toBe('820');
    expect(formatTokens(999)).toBe('999');
  });

  it('prints thousands with one decimal and a k suffix', () => {
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1200)).toBe('1.2k');
    expect(formatTokens(15300)).toBe('15.3k');
  });
});

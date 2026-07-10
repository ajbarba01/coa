import { describe, expect, it } from 'vitest';
import { defaultReveal } from './reveal.js';

describe('defaultReveal', () => {
  it('ships the maintainer-approved feel', () => {
    expect(defaultReveal.text.variant).toBe('blurIn');
    expect(defaultReveal.caret).toBe(false);
    expect(defaultReveal.reasoning.mode).toBe('shimmer');
    expect(defaultReveal.block.variant).toBe('blurRise');
    expect(defaultReveal.block.durationMs).toBe(500);
  });

  it('every duration is a positive number', () => {
    expect(defaultReveal.text.durationMs).toBeGreaterThan(0);
    expect(defaultReveal.reasoning.collapseDurationMs).toBeGreaterThan(0);
    expect(defaultReveal.block.staggerCap).toBeGreaterThanOrEqual(1);
  });
});

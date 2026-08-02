import { describe, expect, it } from 'vitest';
import { defaultReveal } from './reveal.js';

describe('defaultReveal', () => {
  it('ships the design reference feel: a crisp fade + rise, no block stagger', () => {
    expect(defaultReveal.text.variant).toBe('blurIn');
    expect(defaultReveal.caret).toBe(false);
    expect(defaultReveal.reasoning.mode).toBe('auto-expand');
    expect(defaultReveal.block.variant).toBe('fadeRise');
    expect(defaultReveal.block.durationMs).toBe(180);
    expect(defaultReveal.block.staggerMs).toBe(0);
  });

  it('every duration is a positive number', () => {
    expect(defaultReveal.text.durationMs).toBeGreaterThan(0);
    expect(defaultReveal.reasoning.collapseDurationMs).toBeGreaterThan(0);
    expect(defaultReveal.block.durationMs).toBeGreaterThan(0);
  });
});

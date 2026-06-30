import { describe, expect, it } from 'vitest';
import { selfModGuard } from './selfmod.js';

describe('selfModGuard (D138 — the self-mod guard half; eval mechanism is M9)', () => {
  it('allows a promotion that passed eval and is not a sole blocker', () => {
    expect(selfModGuard({ rule: 'r', becomesSoleBlocker: false }, { passed: true })).toBe('allow');
  });

  it('requires a pinned spine when the promotion would become the sole blocker', () => {
    expect(selfModGuard({ rule: 'r', becomesSoleBlocker: true }, { passed: true })).toBe(
      'needsPinnedSpine',
    );
  });

  it('requires a pinned spine when the golden-corpus eval did not pass', () => {
    expect(selfModGuard({ rule: 'r', becomesSoleBlocker: false }, { passed: false })).toBe(
      'needsPinnedSpine',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { describeLoopFailure, isTransientNetworkError } from './loop-failure.js';

describe('isTransientNetworkError', () => {
  it('flags the undici "fetch failed" TypeError', () => {
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(true);
  });

  it('flags an error whose cause carries a transient socket code', () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(isTransientNetworkError(new TypeError('fetch failed', { cause }))).toBe(true);
  });

  it('flags a top-level error with a transient code and no telling message', () => {
    expect(isTransientNetworkError(Object.assign(new Error('boom'), { code: 'ETIMEDOUT' }))).toBe(true);
  });

  it('does not flag an ordinary application error', () => {
    expect(isTransientNetworkError(new Error('validation exploded'))).toBe(false);
  });

  it('does not flag a non-Error value', () => {
    expect(isTransientNetworkError('nope')).toBe(false);
  });
});

describe('describeLoopFailure', () => {
  it('rewrites a transient network failure into an actionable, retry-framed message', () => {
    const msg = describeLoopFailure(new TypeError('fetch failed'));
    expect(msg).toMatch(/transient/i);
    expect(msg).toMatch(/send it again|retry/i);
    // The raw signal is preserved so the cause is still legible.
    expect(msg).toContain('fetch failed');
  });

  it('passes a non-network error message through unchanged', () => {
    expect(describeLoopFailure(new Error('validation exploded'))).toBe('validation exploded');
  });

  it('falls back to a generic message for a non-Error throw', () => {
    expect(describeLoopFailure({ weird: true })).toBe('session failed');
  });
});

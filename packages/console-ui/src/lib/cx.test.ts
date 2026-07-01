import { describe, expect, it } from 'vitest';
import { cx, focusRing } from './cx.js';

describe('cx', () => {
  it('joins truthy parts and drops falsy ones', () => {
    expect(cx('a', false, undefined, 'b', null, '')).toBe('a b');
  });
  it('focusRing targets a real outline with the focus-ring token', () => {
    expect(focusRing).toContain('focus-visible:outline');
    expect(focusRing).toContain('outline-focus');
  });
});

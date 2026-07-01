import { describe, expect, it } from 'vitest';
import { toCapViewModel } from './cap.js';

describe('toCapViewModel', () => {
  it('renders the subscription model (unbounded) as neutral', () => {
    const vm = toCapViewModel({ remaining: null, capHit: false });
    expect(vm).toEqual({ headline: 'No ceiling', sub: 'subscription', tone: 'neutral' });
  });

  it('formats a remaining dollar amount', () => {
    const vm = toCapViewModel({ remaining: 2.5, capHit: false });
    expect(vm.headline).toBe('$2.50 left');
    expect(vm.tone).toBe('neutral');
  });

  it('marks a hit cap danger', () => {
    const vm = toCapViewModel({ remaining: 0, capHit: true });
    expect(vm.tone).toBe('danger');
    expect(vm.headline).toBe('Cap reached');
  });

  it('rejects a malformed payload', () => {
    expect(() => toCapViewModel({ remaining: 'lots' })).toThrow();
  });
});

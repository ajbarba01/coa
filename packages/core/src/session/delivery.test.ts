import { describe, expect, it } from 'vitest';
import { DeliveryQueue } from './delivery.js';

describe('DeliveryQueue', () => {
  it('drains in FIFO order and empties itself', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'user', text: 'steer one' });
    q.push({ origin: 'system', text: 'notice one' });
    q.push({ origin: 'user', text: 'steer two' });
    expect(q.size()).toBe(3);
    expect(q.drain()).toEqual([
      { origin: 'user', text: 'steer one' },
      { origin: 'system', text: 'notice one' },
      { origin: 'user', text: 'steer two' },
    ]);
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it('delivers each entry exactly once across two drains', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'system', text: 'first' });
    expect(q.drain()).toEqual([{ origin: 'system', text: 'first' }]);
    q.push({ origin: 'user', text: 'second' });
    expect(q.drain()).toEqual([{ origin: 'user', text: 'second' }]);
  });

  it('drops pushes once sealed and drains empty', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'user', text: 'before' });
    q.seal();
    q.push({ origin: 'system', text: 'after' });
    expect(q.isSealed()).toBe(true);
    expect(q.drain()).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { IdleScheduler } from './idle.js';

describe('IdleScheduler', () => {
  it('runs due jobs highest-priority first', () => {
    const scheduler = new IdleScheduler();
    const order: string[] = [];
    scheduler.scheduleIdle(() => order.push('low'), { priority: 1, preemptible: true });
    scheduler.scheduleIdle(() => order.push('high'), { priority: 10, preemptible: true });
    scheduler.flush();
    expect(order).toEqual(['high', 'low']);
  });

  it('does not run a cancelled job', () => {
    const scheduler = new IdleScheduler();
    let ran = false;
    const handle = scheduler.scheduleIdle(() => (ran = true), { priority: 5, preemptible: false });
    handle.cancel();
    scheduler.flush();
    expect(ran).toBe(false);
  });

  it('drains each job once per flush', () => {
    const scheduler = new IdleScheduler();
    let count = 0;
    scheduler.scheduleIdle(() => count++, { priority: 1, preemptible: true });
    scheduler.flush();
    scheduler.flush();
    expect(count).toBe(1);
  });
});

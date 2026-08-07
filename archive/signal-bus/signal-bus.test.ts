// Archived from packages/core/src/signal-bus.test.ts
import { describe, expect, it } from 'vitest';
import { SignalBus } from './signal-bus.js';

describe('SignalBus', () => {
  it('records and queries signals', () => {
    const bus = new SignalBus();
    bus.record({
      name: 'coa.change',
      ts: '2026-06-29T00:00:00Z',
      attributes: { 'coa.kind': 'modify' },
    });
    bus.record({ name: 'coa.checkpoint', ts: '2026-06-29T00:00:01Z', attributes: {} });
    expect(bus.query().map((s) => s.name)).toEqual(['coa.change', 'coa.checkpoint']);
  });

  it('filters by signal name', () => {
    const bus = new SignalBus();
    bus.record({ name: 'coa.change', ts: 't1', attributes: { 'coa.kind': 'create' } });
    bus.record({ name: 'coa.change', ts: 't2', attributes: { 'coa.kind': 'delete' } });
    bus.record({ name: 'coa.checkpoint', ts: 't3', attributes: {} });
    expect(bus.query((s) => s.name === 'coa.change')).toHaveLength(2);
  });

  it('bounds retention to a stated window (drops the oldest)', () => {
    const bus = new SignalBus(2);
    bus.record({ name: 'a', ts: 't1', attributes: {} });
    bus.record({ name: 'b', ts: 't2', attributes: {} });
    bus.record({ name: 'c', ts: 't3', attributes: {} });
    expect(bus.query().map((s) => s.name)).toEqual(['b', 'c']);
  });
});

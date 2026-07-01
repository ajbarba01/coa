import { describe, expect, it } from 'vitest';
import { createPanelRegistry, type PanelDefinition } from './registry.js';

function fakePanel(id: string): PanelDefinition<number, { n: number }> {
  return {
    id,
    displayName: id.toUpperCase(),
    render: () => null,
    selectVm: (s) => s.n,
  };
}

describe('createPanelRegistry', () => {
  it('registers and resolves a panel by id', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    expect(reg.has('cost')).toBe(true);
    expect(reg.resolve('cost')?.displayName).toBe('COST');
  });

  it('returns undefined / false for unknown ids', () => {
    const reg = createPanelRegistry();
    expect(reg.resolve('nope')).toBeUndefined();
    expect(reg.has('nope')).toBe(false);
  });

  it('throws on duplicate registration', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    expect(() => reg.register(fakePanel('cost'))).toThrow(/already registered/i);
  });

  it('exposes a pure selectVm that maps daemon state to a view-model', () => {
    const reg = createPanelRegistry();
    reg.register(fakePanel('cost'));
    const def = reg.resolve('cost');
    expect(def?.selectVm({ n: 42 })).toBe(42);
  });
});

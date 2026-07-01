import { describe, expect, it } from 'vitest';
import { parseDescriptor } from './migrate.js';
import { LAYOUT_VERSION, type LayoutDescriptor } from './schema.js';
import { createPanelRegistry, type PanelDefinition } from '../panel/registry.js';

function reg(...ids: string[]) {
  const r = createPanelRegistry();
  for (const id of ids) {
    const def: PanelDefinition = {
      id,
      displayName: id,
      render: () => null,
      selectVm: () => undefined,
    };
    r.register(def);
  }
  return r;
}

const fallback: LayoutDescriptor = {
  version: LAYOUT_VERSION,
  root: { type: 'leaf', panelId: 'nav' },
};

describe('parseDescriptor', () => {
  it('returns a valid descriptor unchanged when all panels are known', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'resizable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    expect(parseDescriptor(d, reg('nav', 'chat'), fallback)).toEqual(d);
  });

  it('drops a leaf whose panelId is unknown and keeps the rest', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'resizable',
        children: [
          { type: 'leaf', panelId: 'nav' },
          { type: 'leaf', panelId: 'ghost' },
          { type: 'leaf', panelId: 'chat' },
        ],
      },
    };
    const out = parseDescriptor(d, reg('nav', 'chat'), fallback);
    expect(out.root).toEqual({
      type: 'split',
      direction: 'row',
      adjustability: 'resizable',
      children: [
        { type: 'leaf', panelId: 'nav' },
        { type: 'leaf', panelId: 'chat' },
      ],
    });
  });

  it('collapses a split down to its single surviving child', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: {
        type: 'split',
        direction: 'row',
        adjustability: 'static',
        children: [
          { type: 'leaf', panelId: 'chat' },
          { type: 'leaf', panelId: 'ghost' },
        ],
      },
    };
    const out = parseDescriptor(d, reg('chat'), fallback);
    expect(out.root).toEqual({ type: 'leaf', panelId: 'chat' });
  });

  it('falls back when every panel is unknown', () => {
    const d: LayoutDescriptor = {
      version: LAYOUT_VERSION,
      root: { type: 'leaf', panelId: 'ghost' },
    };
    expect(parseDescriptor(d, reg('nav'), fallback)).toBe(fallback);
  });

  it('falls back (never throws) on structurally invalid input', () => {
    expect(parseDescriptor({ garbage: true }, reg('nav'), fallback)).toBe(fallback);
    expect(parseDescriptor(null, reg('nav'), fallback)).toBe(fallback);
    expect(parseDescriptor('nope', reg('nav'), fallback)).toBe(fallback);
  });
});

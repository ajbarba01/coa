import { describe, expect, it } from 'vitest';
import {
  LAYOUT_EPOCH,
  ROUTABLE_IDS,
  getMainPanelId,
  makeDescriptor,
  setMainPanelId,
} from './routing.js';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

describe('routing', () => {
  it('builds the inspector tree with the given main panel', () => {
    const d = makeDescriptor('cost');
    expect(d.root).toMatchObject({ type: 'split', direction: 'row', adjustability: 'static' });
    const leaves = JSON.stringify(d);
    expect(leaves).toContain('"panelId":"nav"');
    expect(leaves).toContain('"panelId":"cost"');
    expect(leaves).toContain('"panelId":"conversation"');
    // account + agent config are nav-routed main surfaces now, not dock panes
    expect(leaves).not.toContain('"panelId":"account"');
    expect(leaves).not.toContain('"panelId":"agent"');
    // the nav is a fixed-width region, not a proportional one
    expect(leaves).toContain('"fixedPx":56');
    expect(leaves).not.toContain('"panelId":"nav","size"');
  });

  it('swaps only the routable main leaf, preserving other panels and sizes', () => {
    const d = makeDescriptor('cost');
    const swapped = setMainPanelId(d, 'flags');
    const s = JSON.stringify(swapped);
    expect(s).toContain('"panelId":"flags"');
    expect(s).not.toContain('"panelId":"cost"');
    expect(s).toContain('"panelId":"conversation"');
    expect(s).toContain('"panelId":"nav"');
  });

  it('leaves the descriptor unchanged when no routable leaf is present', () => {
    const d = makeDescriptor('cost');
    const noRoutable = { version: d.version, root: { type: 'leaf', panelId: 'nav' } as const };
    expect(setMainPanelId(noRoutable, 'flags')).toEqual(noRoutable);
  });

  it('reads back the routable main leaf so the nav can sync to a restored layout', () => {
    expect(getMainPanelId(makeDescriptor('flags'))).toBe('flags');
    expect(getMainPanelId(makeDescriptor('timeline'))).toBe('timeline');
  });

  it('falls back to the default main panel when no routable leaf is present', () => {
    const noRoutable = { version: 1, root: { type: 'leaf', panelId: 'nav' } as const };
    expect(getMainPanelId(noRoutable)).toBe(DEFAULT_MAIN_PANEL_ID);
  });

  it('declares the routable set and a bumped layout epoch', () => {
    expect(ROUTABLE_IDS.has('cost')).toBe(true);
    expect(ROUTABLE_IDS.has('agents')).toBe(true);
    expect(ROUTABLE_IDS.has('account')).toBe(true);
    expect(ROUTABLE_IDS.has('nav')).toBe(false);
    expect(LAYOUT_EPOCH).toBe(8);
  });
});

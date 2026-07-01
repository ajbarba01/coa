import { LAYOUT_VERSION, type LayoutDescriptor, type Region } from '@coa/console-layout';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

/** Panels that occupy the nav-driven main region (never the rail or dock). Grows
 *  as surfaces land: cost (now) · flags · timeline (P2) · settings (P3) · the
 *  component showcase (a dev-facing kit reference). */
export const ROUTABLE_IDS: ReadonlySet<string> = new Set([
  'cost',
  'flags',
  'timeline',
  'settings',
  'showcase',
]);

/** Bump when the default arrangement changes so a persisted older layout is
 *  ignored (a stale layout.json has no matching epoch → the new default is used). */
export const LAYOUT_EPOCH = 4;

/**
 * Inspector-first (spec §21.1): a thin static nav rail beside the workbench body;
 * the single draggable boundary is main↔dock; the right dock stacks chat + agent
 * (account joins it later). `nav`'s small fractional size gives the narrow rail
 * width under the StaticEngine's flex-ratio model.
 */
export function makeDescriptor(mainPanelId: string): LayoutDescriptor {
  return {
    version: LAYOUT_VERSION,
    root: {
      type: 'split',
      direction: 'row',
      adjustability: 'static',
      children: [
        { type: 'leaf', panelId: 'nav', fixedPx: 48 },
        {
          type: 'split',
          direction: 'row',
          adjustability: 'resizable',
          children: [
            { type: 'leaf', panelId: mainPanelId, size: 72 },
            {
              type: 'split',
              direction: 'column',
              adjustability: 'static',
              children: [
                // Chat is the always-present companion, so it dominates the dock;
                // the agent summary and account context are compact below it. Min
                // heights keep each pane usable when the dock is short (spec §22.3).
                { type: 'leaf', panelId: 'conversation', size: 3, minPx: 160 },
                { type: 'leaf', panelId: 'agent', size: 1, minPx: 88 },
                { type: 'leaf', panelId: 'account', size: 1, minPx: 64 },
              ],
            },
          ],
        },
      ],
    },
  };
}

/** Read back which panel currently fills the routable main region, so the nav
 *  selection can sync to a restored layout instead of the hard default. Returns
 *  DEFAULT_MAIN_PANEL_ID if the descriptor holds no routable leaf. */
export function getMainPanelId(descriptor: LayoutDescriptor): string {
  function recur(region: Region): string | undefined {
    if (region.type === 'leaf') {
      return ROUTABLE_IDS.has(region.panelId) ? region.panelId : undefined;
    }
    for (const child of region.children) {
      const found = recur(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return recur(descriptor.root) ?? DEFAULT_MAIN_PANEL_ID;
}

/** Replace the single routable leaf's panelId (the main region), preserving every
 *  other panel and all sizes. Robust to tree shape: it targets whichever leaf holds
 *  a routable id, so a future rearrangement still works. Returns the input unchanged
 *  if no routable leaf exists. */
export function setMainPanelId(
  descriptor: LayoutDescriptor,
  mainPanelId: string,
): LayoutDescriptor {
  function recur(region: Region): Region {
    if (region.type === 'leaf') {
      return ROUTABLE_IDS.has(region.panelId) ? { ...region, panelId: mainPanelId } : region;
    }
    return { ...region, children: region.children.map(recur) };
  }
  return { ...descriptor, root: recur(descriptor.root) };
}

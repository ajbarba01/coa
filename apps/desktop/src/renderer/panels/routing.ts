import { LAYOUT_VERSION, type LayoutDescriptor, type Region } from '@coa/console-layout';

/** Panels that occupy the nav-driven main region (never the rail or dock). Grows
 *  as surfaces land: cost (now) · flags · timeline (P2) · settings (P3). */
export const ROUTABLE_IDS: ReadonlySet<string> = new Set(['cost', 'flags', 'timeline', 'settings']);

/** Bump when the default arrangement changes so a persisted older layout is
 *  ignored (a 4a layout.json has no matching epoch → the new default is used). */
export const LAYOUT_EPOCH = 2;

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
        { type: 'leaf', panelId: 'nav', size: 0.06 },
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
                { type: 'leaf', panelId: 'conversation' },
                { type: 'leaf', panelId: 'agent' },
                { type: 'leaf', panelId: 'account' },
              ],
            },
          ],
        },
      ],
    },
  };
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

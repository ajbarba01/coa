import {
  createPanelRegistry,
  LAYOUT_VERSION,
  type LayoutDescriptor,
  type PanelRegistry,
} from '@coa/console-layout';
import { costPanel } from './CostPanel.js';
import { navPanel } from './NavPanel.js';
import { makePlaceholderPanel } from './PlaceholderPanel.js';

/** The 4a surfaces: the activity-bar rail, a conversation placeholder, and the
 *  one live surface (cost). Later plans register the remaining surfaces here. */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(
    makePlaceholderPanel(
      'conversation',
      'Conversation',
      'The live conversation stream arrives with a later build.',
    ),
  );
  registry.register(costPanel);
  return registry;
}

/**
 * Direction B (spec §21): a static outer split places the narrow nav rail beside
 * the workbench body; the single draggable boundary is conversation <-> cost.
 * The dashboard rail grows into a column-static split of multiple cards in a
 * later plan; for the skeleton the right pane is the cost surface.
 *
 * `nav`'s small fractional size gives the narrow activity-bar width under the
 * StaticEngine's flex-ratio model (body always has flex-grow 1); a fixed-pixel
 * rail width is a later engine refinement.
 */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = {
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
          { type: 'leaf', panelId: 'conversation', size: 70 },
          { type: 'leaf', panelId: 'cost', size: 30 },
        ],
      },
    ],
  },
};

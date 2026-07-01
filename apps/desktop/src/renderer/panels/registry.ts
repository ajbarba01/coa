import {
  type LayoutDescriptor,
  type PanelRegistry,
  createPanelRegistry,
} from '@coa/console-layout';
import { costPanel } from './CostPanel.js';
import { navPanel } from './NavPanel.js';
import { makePlaceholderPanel } from './PlaceholderPanel.js';
import { makeDescriptor } from './routing.js';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

/** The 4b surfaces registered so far: the nav rail, the live Cost surface, and the
 *  right-dock placeholders (chat + agent). Flags/Timeline/Account/Settings register
 *  here as they land. */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(costPanel);
  registry.register(
    makePlaceholderPanel(
      'conversation',
      'Chat',
      'The live conversation stream arrives with a later build.',
    ),
  );
  registry.register(
    makePlaceholderPanel('agent', 'Agent', 'Agent configuration arrives with a later build.'),
  );
  return registry;
}

/** The inspector-first default: nav rail · Cost in the main region · chat+agent dock. */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = makeDescriptor(DEFAULT_MAIN_PANEL_ID);

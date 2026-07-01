import {
  type LayoutDescriptor,
  type PanelRegistry,
  createPanelRegistry,
} from '@coa/console-layout';
import { accountPanel } from './AccountPanel.js';
import { chatPanel } from './ChatPanel.js';
import { costPanel } from './CostPanel.js';
import { flagsPanel } from './FlagsPanel.js';
import { navPanel } from './NavPanel.js';
import { makePlaceholderPanel } from './PlaceholderPanel.js';
import { settingsPanel } from './SettingsPanel.js';
import { timelinePanel } from './TimelinePanel.js';
import { makeDescriptor } from './routing.js';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

/** The 4b surfaces registered so far: the nav rail, the live Cost surface, and the
 *  right-dock placeholders (chat + agent). Flags/Timeline/Account/Settings register
 *  here as they land. */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(costPanel);
  registry.register(flagsPanel);
  registry.register(timelinePanel);
  registry.register(settingsPanel);
  registry.register(accountPanel);
  registry.register(chatPanel);
  registry.register(
    makePlaceholderPanel('agent', 'Agent', 'Agent configuration arrives with a later build.'),
  );
  return registry;
}

/** The inspector-first default: nav rail · Cost in the main region · chat+agent dock. */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = makeDescriptor(DEFAULT_MAIN_PANEL_ID);

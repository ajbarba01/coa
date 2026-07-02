import {
  type LayoutDescriptor,
  type PanelRegistry,
  createPanelRegistry,
} from '@coa/console-layout';
import { accountPanel } from './AccountPanel.js';
import { agentsPanel } from './AgentsPanel.js';
import { chatPanel } from './ChatPanel.js';
import { costPanel } from './CostPanel.js';
import { flagsPanel } from './FlagsPanel.js';
import { navPanel } from './NavPanel.js';
import { settingsPanel } from './SettingsPanel.js';
import { showcasePanel } from './ShowcasePanel.js';
import { timelinePanel } from './TimelinePanel.js';
import { makeDescriptor } from './routing.js';
import { DEFAULT_MAIN_PANEL_ID } from './state.js';

/** The registered surfaces: the nav rail, the nav-driven main windows
 *  (cost/flags/timeline/agents/settings), and the right dock (chat + account). */
export function buildPanelRegistry(): PanelRegistry {
  const registry = createPanelRegistry();
  registry.register(navPanel);
  registry.register(costPanel);
  registry.register(flagsPanel);
  registry.register(timelinePanel);
  registry.register(settingsPanel);
  registry.register(showcasePanel);
  registry.register(accountPanel);
  registry.register(chatPanel);
  registry.register(agentsPanel);
  return registry;
}

/** The inspector-first default: nav rail · Cost in the main region · chat+agent dock. */
export const DEFAULT_DESCRIPTOR: LayoutDescriptor = makeDescriptor(DEFAULT_MAIN_PANEL_ID);

import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const agentRailIntent: ComponentIntent = assertIntent({
  name: 'AgentRail',
  family: 'Layout',
  intent: 'The chat pane’s agent drawer: a slim chip rail that expands to names on hover.',
  useWhen: [
    'Choosing which agent to talk to from the chat pane, with pinned agents kept in reach.',
  ],
  dontUseWhen: [
    'Navigating app sections — use NavList (the nav rail).',
    'Managing/editing agents — that is the Agents surface; the rail only selects and cross-links to it.',
  ],
  anatomy:
    'A fixed 40px chip column (pinned first, active marked in the agent’s own color) plus a name drawer that slides out from behind the column on hover/focus — name rows with pin stars and a per-agent context menu (New session / Pin / Configure); the drawer is clipped and absolutely positioned so the icons never move and the content beside it never reflows.',
  variantsStates: [
    'collapsed',
    'expanded',
    'item rest/hover/active/focus',
    'pinned',
    'context menu open',
  ],
  accessibility:
    'A labelled group; every chip carries the agent name as its accessible name; the drawer expands instantly on hover and on keyboard focus and is aria-hidden while collapsed; ArrowUp/Down rove within the focused layer, Escape collapses; the active item sets aria-current; pin state is aria-pressed.',
  related: ['AgentChip', 'NavList', 'SwitcherMenu', 'Menu'],
});

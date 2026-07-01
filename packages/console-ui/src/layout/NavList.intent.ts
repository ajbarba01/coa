import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const navListIntent: ComponentIntent = assertIntent({
  name: 'NavList',
  family: 'Layout',
  intent: 'A vertical list of navigable sections with one active.',
  useWhen: ['Switching between primary sections in a rail (chat, decisions, timeline).'],
  dontUseWhen: ['Choosing a form value — use Radio/Select.'],
  anatomy: 'A vertical tablist of icon+label tabs.',
  variantsStates: ['item rest', 'hover', 'active', 'focus'],
  accessibility:
    'role=tablist/tab with aria-selected and vertical orientation; visible focus ring.',
  related: ['Pane', 'Menu'],
});

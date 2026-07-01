import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const tooltipIntent: ComponentIntent = assertIntent({
  name: 'Tooltip',
  family: 'Overlays',
  intent: 'A brief hint revealed on hover or focus.',
  useWhen: ['Labelling an icon-only control or clarifying a term.'],
  dontUseWhen: [
    'The content is interactive — use Popover.',
    'It is essential info — put it in the UI, not a hover.',
  ],
  anatomy: 'A provider, a trigger, and a small floating label.',
  variantsStates: ['hidden', 'visible'],
  accessibility: 'role=tooltip, shows on focus as well as hover; provider controls delay.',
  related: ['Popover'],
});

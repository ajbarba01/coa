import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const popoverIntent: ComponentIntent = assertIntent({
  name: 'Popover',
  family: 'Overlays',
  intent: 'Non-modal floating content anchored to a trigger.',
  useWhen: ['Showing supplemental detail or a small control cluster on demand.'],
  dontUseWhen: [
    'The interaction is modal/blocking — use Dialog.',
    'A one-line hint suffices — use Tooltip.',
  ],
  anatomy: 'A trigger and a portalled, anchored content panel.',
  variantsStates: ['closed', 'open'],
  accessibility: 'Radix popover: focus management, Escape/outside-click dismiss.',
  related: ['Tooltip', 'Dialog', 'Menu'],
});

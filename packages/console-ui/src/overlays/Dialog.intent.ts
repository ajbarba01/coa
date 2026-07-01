import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const dialogIntent: ComponentIntent = assertIntent({
  name: 'Dialog',
  family: 'Overlays',
  intent: 'A focused modal for a confirmation or a small focused task.',
  useWhen: ['Confirming a consequential action (rewind) or a short focused edit.'],
  dontUseWhen: [
    'A large side surface fits better — use Sheet.',
    'A hint suffices — use Tooltip/Popover.',
  ],
  anatomy: 'A trigger, an overlay, and a titled content box with optional footer actions.',
  variantsStates: ['closed', 'open'],
  accessibility: 'Radix dialog: focus trap, Escape closes, labelled by its title; overlay scrim.',
  related: ['Sheet', 'Popover'],
});

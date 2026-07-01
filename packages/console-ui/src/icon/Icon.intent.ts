import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const iconIntent: ComponentIntent = assertIntent({
  name: 'Icon',
  family: 'Foundations',
  intent: 'Renders a single Lucide glyph at a consistent stroke and grid size.',
  useWhen: ['A glyph reinforces a label, status, or action.'],
  dontUseWhen: [
    'A glyph would stand alone as the only meaning — pair it with text.',
    'You need an emoji — emoji are banned.',
  ],
  anatomy: 'A Lucide icon component sized to the icon grid.',
  variantsStates: ['decorative (aria-hidden)', 'labelled (role=img)'],
  accessibility:
    'Decorative by default (aria-hidden, not focusable); pass label to announce it as an image.',
  related: ['IconButton', 'Badge'],
});

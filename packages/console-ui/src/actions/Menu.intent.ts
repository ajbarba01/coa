import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const menuIntent: ComponentIntent = assertIntent({
  name: 'Menu',
  family: 'Actions',
  intent: 'A dropdown of secondary actions behind a trigger.',
  useWhen: ['Overflow or contextual actions that do not warrant always-visible buttons.'],
  dontUseWhen: [
    'Selecting a value from options — use Select.',
    'A single primary action — use Button.',
  ],
  anatomy: 'A trigger and a portalled list of items with optional icons.',
  variantsStates: ['closed', 'open', 'item hover/highlight', 'item disabled'],
  accessibility:
    'Radix menu semantics: roving focus, Escape closes, arrow keys navigate, type-ahead.',
  related: ['Button', 'IconButton', 'Select'],
});

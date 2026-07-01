import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const iconButtonIntent: ComponentIntent = assertIntent({
  name: 'IconButton',
  family: 'Actions',
  intent: 'An icon-only button for dense toolbars where a text label would not fit.',
  useWhen: ['A recognizable action fits a compact toolbar (rewind, copy, expand).'],
  dontUseWhen: ['The action is primary or ambiguous — use a labelled Button.'],
  anatomy: 'A square button wrapping one Icon; label is the accessible name.',
  variantsStates: [
    'primary',
    'secondary',
    'tertiary',
    'danger',
    'sizes sm/md',
    'hover',
    'focus',
    'loading',
    'disabled',
  ],
  accessibility:
    'label is required and becomes aria-label; native button keyboard model; visible focus ring.',
  related: ['Button', 'Menu'],
});

import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const buttonGroupIntent: ComponentIntent = assertIntent({
  name: 'ButtonGroup',
  family: 'Actions',
  intent: 'Groups related buttons as one labelled cluster.',
  useWhen: ['Two or more actions belong together (confirm/cancel, segmented choices).'],
  dontUseWhen: ['The buttons are unrelated — lay them out separately.'],
  anatomy: 'A role=group wrapper around Button/IconButton children.',
  variantsStates: ['rest'],
  accessibility: 'role=group with an aria-label naming the cluster.',
  related: ['Button', 'Toolbar'],
});

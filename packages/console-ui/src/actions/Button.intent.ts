import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const buttonIntent: ComponentIntent = assertIntent({
  name: 'Button',
  family: 'Actions',
  intent: 'Triggers an action the user commits to.',
  useWhen: [
    'Submitting, confirming, running, or cancelling an action.',
    'A view has one primary action (use variant=primary once).',
  ],
  dontUseWhen: [
    'Navigating to another location — use Link.',
    'Toggling a boolean — use Switch or Checkbox.',
    'The trigger is icon-only in a dense toolbar — use IconButton.',
  ],
  anatomy: 'Optional leading Icon, label, optional trailing Icon; one border-box control.',
  variantsStates: [
    'primary',
    'secondary',
    'tertiary',
    'danger',
    'sizes sm/md',
    'rest',
    'hover',
    'active',
    'focus',
    'loading',
    'disabled',
  ],
  accessibility:
    'Native <button> (Enter/Space activate); loading sets aria-busy and disables; visible focus ring; asChild preserves the child role.',
  related: ['IconButton', 'ButtonGroup', 'Link'],
});

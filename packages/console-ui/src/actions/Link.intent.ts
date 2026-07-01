import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const linkIntent: ComponentIntent = assertIntent({
  name: 'Link',
  family: 'Actions',
  intent: 'Navigates to another location or resource.',
  useWhen: ['Moving to a route, doc, or external resource.'],
  dontUseWhen: ['Committing an action — use Button.'],
  anatomy: 'A styled anchor, optionally external.',
  variantsStates: ['default', 'muted', 'hover', 'focus', 'external'],
  accessibility: 'Native anchor; external links get rel=noopener noreferrer; visible focus ring.',
  related: ['Button'],
});

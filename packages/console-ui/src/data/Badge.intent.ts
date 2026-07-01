import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const badgeIntent: ComponentIntent = assertIntent({
  name: 'Badge',
  family: 'Data-display',
  intent: 'A small toned label for a status, count, or category.',
  useWhen: ['Tagging severity, plan, or a small count next to a heading.'],
  dontUseWhen: ['It is an interactive filter — use a Button/Toggle.'],
  anatomy: 'A rounded pill with a tone and short text.',
  variantsStates: ['neutral', 'info', 'success', 'warning', 'danger'],
  accessibility: 'Tone is conveyed by text, not color alone; data-tone for styling.',
  related: ['Stat', 'Icon'],
});

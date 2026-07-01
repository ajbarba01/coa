import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const statIntent: ComponentIntent = assertIntent({
  name: 'Stat',
  family: 'Data-display',
  intent: 'A single labelled metric with an optional sub-line.',
  useWhen: ['Surfacing a headline number (cost, turns) in the dashboard rail.'],
  dontUseWhen: ['Several related fields — use KeyValue.'],
  anatomy: 'An eyebrow label, a large tabular value, an optional sub-line.',
  variantsStates: ['default', 'info', 'success', 'warning', 'danger'],
  accessibility: 'Value is labelled by its eyebrow id; numbers use tabular figures.',
  related: ['KeyValue', 'Badge'],
});

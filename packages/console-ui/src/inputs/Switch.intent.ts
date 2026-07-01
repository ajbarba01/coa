import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const switchIntent: ComponentIntent = assertIntent({
  name: 'Switch',
  family: 'Inputs',
  intent: 'Toggles a setting that takes effect immediately.',
  useWhen: ['An immediate on/off preference (reduce motion, compact density).'],
  dontUseWhen: [
    'The value is only applied on submit — use Checkbox.',
    'Choosing among options — use Radio.',
  ],
  anatomy: 'A Radix switch track and thumb with a clickable label.',
  variantsStates: ['off', 'on', 'focus', 'disabled'],
  accessibility: 'role=switch, Space toggles, label associated by id; visible focus ring.',
  related: ['Checkbox'],
});

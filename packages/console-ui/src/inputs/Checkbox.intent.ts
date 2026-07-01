import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const checkboxIntent: ComponentIntent = assertIntent({
  name: 'Checkbox',
  family: 'Inputs',
  intent: 'Toggles a single independent boolean.',
  useWhen: ['One on/off option that stands alone (enable verbose logging).'],
  dontUseWhen: [
    'Choosing one of several — use Radio.',
    'An immediate-effect setting toggle reads better as a Switch.',
  ],
  anatomy: 'A Radix checkbox box with a check indicator and a clickable label.',
  variantsStates: ['unchecked', 'checked', 'focus', 'disabled'],
  accessibility: 'role=checkbox, Space toggles, label associated by id; visible focus ring.',
  related: ['Switch', 'Radio'],
});

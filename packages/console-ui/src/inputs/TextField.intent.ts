import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const textFieldIntent: ComponentIntent = assertIntent({
  name: 'TextField',
  family: 'Inputs',
  intent: 'A single-line text input with label, description, and error states.',
  useWhen: ['Collecting a short free-text value (a name, a path, a query).'],
  dontUseWhen: [
    'Choosing from a fixed set — use Select.',
    'Toggling a boolean — use Checkbox/Switch.',
    'Multi-line text — use a textarea variant (not in this kit yet).',
  ],
  anatomy: 'A Field wrapping a native <input type=text>.',
  variantsStates: ['rest', 'hover', 'focus', 'disabled', 'error/invalid'],
  accessibility:
    'Labelled input; error sets aria-invalid + role=alert message; visible focus ring.',
  related: ['Field', 'Select', 'Combobox'],
});

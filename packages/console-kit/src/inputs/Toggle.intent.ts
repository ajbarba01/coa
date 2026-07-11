import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toggleIntent: ComponentIntent = assertIntent({
  name: 'Toggle',
  family: 'Inputs',
  intent:
    'The boxy two-state switch: neutral fill when on — accent blue stays reserved for running.',
  useWhen: ['Settings rows and inline controls flipping one boolean (reduce motion, autosave).'],
  dontUseWhen: ['A momentary action — Button.', 'More than two choices — Select or StepSlider.'],
  anatomy:
    'Base UI Switch rendered as a real button (honest disabled + focus semantics) with a slip-move thumb.',
  variantsStates: [
    'off',
    'on (neutral s6 fill)',
    'disabled off/on (inert, dimmed, no hover)',
    'focus-visible (global interior ring)',
  ],
  accessibility:
    'Native switch role via Base UI; space/enter toggle; disabled uses the real attribute.',
  related: ['Select', 'StepSlider', 'Button'],
});

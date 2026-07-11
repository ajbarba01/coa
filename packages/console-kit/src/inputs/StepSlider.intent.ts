import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const stepSliderIntent: ComponentIntent = assertIntent({
  name: 'StepSlider',
  family: 'Inputs',
  intent:
    'A discrete slider over a small ordered set of named levels, with a boxy thumb and per-stop ticks.',
  useWhen: ['Choosing one of a few ordered named levels (reasoning effort, density).'],
  dontUseWhen: [
    'Two states — Toggle.',
    'Unordered choices — Select.',
    'Continuous numeric ranges — this is stops-only by design.',
  ],
  anatomy:
    'Base UI Slider (value = stop index) inside the kit rail: 4px-inset track, filled indicator, one tick per stop, 7×13 boxy thumb.',
  variantsStates: [
    'per-stop positions',
    'drag/click (Base UI pointer mechanics)',
    'keyboard arrows/Home/End (native range input)',
    'focus-visible (global interior ring)',
  ],
  accessibility:
    'A native range input carries the slider semantics; aria-valuetext speaks the stop name, not the index.',
  related: ['Toggle', 'Select'],
});

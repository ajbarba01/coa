import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const radioIntent: ComponentIntent = assertIntent({
  name: 'Radio',
  family: 'Inputs',
  intent: 'Chooses exactly one option from a small, visible set.',
  useWhen: ['2–5 mutually exclusive options that benefit from being all visible.'],
  dontUseWhen: ['Many options — use Select.', 'Independent booleans — use Checkbox.'],
  anatomy: 'A labelled radiogroup of labelled radio items.',
  variantsStates: ['unselected', 'selected', 'focus', 'item disabled'],
  accessibility:
    'role=radiogroup with roving focus; arrow keys move selection; group labelled by id.',
  related: ['Select', 'Checkbox'],
});

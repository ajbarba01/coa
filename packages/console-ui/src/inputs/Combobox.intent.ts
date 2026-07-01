import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const comboboxIntent: ComponentIntent = assertIntent({
  name: 'Combobox',
  family: 'Inputs',
  intent: 'Chooses one value from a long list by typing to filter.',
  useWhen: ['Selecting from many options where filtering by text helps (a symbol, an account).'],
  dontUseWhen: [
    'The list is short — use Select or Radio.',
    'Free-text with no fixed set — use TextField.',
  ],
  anatomy: 'A text input (role=combobox) over a filtered listbox of options.',
  variantsStates: ['collapsed', 'expanded', 'filtered', 'option hover/selected'],
  accessibility:
    'Input is role=combobox with aria-expanded/aria-controls/aria-autocomplete; options are role=option in a role=listbox.',
  related: ['Select', 'TextField'],
});

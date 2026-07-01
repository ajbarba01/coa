import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const selectIntent: ComponentIntent = assertIntent({
  name: 'Select',
  family: 'Inputs',
  intent: 'Chooses one value from a fixed list via a dropdown.',
  useWhen: ['A single choice from a known, closed set that is too long for Radio.'],
  dontUseWhen: [
    'The set is short and worth showing at once — use Radio.',
    'The user should be able to filter/type — use Combobox.',
  ],
  anatomy: 'A labelled trigger showing the current value and a portalled option list.',
  variantsStates: ['closed', 'open', 'highlighted item', 'selected item', 'disabled'],
  accessibility:
    'Radix select: trigger is role=combobox labelled by id, listbox with role=option, full keyboard + type-ahead.',
  related: ['Combobox', 'Radio', 'Menu'],
});

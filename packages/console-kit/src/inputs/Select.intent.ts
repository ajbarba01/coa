import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const selectIntent: ComponentIntent = assertIntent({
  name: 'Select',
  family: 'Inputs',
  intent:
    'Pick one value from a flat list: a quiet mono chip that grows a positioned option popup.',
  useWhen: ['Settings rows and toolbars choosing one of a few named values (theme, density).'],
  dontUseWhen: [
    'Rich option rows with glyphs or descriptions — PopoverCard + MenuItem.',
    'Two states — Toggle.',
    'Free text — a text input.',
  ],
  anatomy:
    'Controlled Base UI Select (Root/Trigger/Value/Portal/Positioner/Popup/Item); the popup wears menuSurface below the trigger; the selected item carries the `current` marker.',
  variantsStates: [
    'closed',
    'open (trigger border steps up)',
    'item hover/highlighted',
    'item selected (tint + current)',
    'focus-visible (global interior ring)',
  ],
  accessibility:
    'Base UI combobox/listbox semantics with typeahead and keyboard selection; Escape runs through the kit dismiss-layer stack; selection mirrored by aria-selected.',
  related: ['PopoverCard', 'MenuItem', 'Toggle'],
});

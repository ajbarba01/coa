import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const comboboxIntent: ComponentIntent = assertIntent({
  name: 'Combobox',
  family: 'Inputs',
  intent:
    'Pick one value from a set too long to scan: a trigger chip that grows a searchable, filter-as-you-type option popup.',
  useWhen: [
    'A set too long to scan at a glance, where the value is one choice (a model picker across every provider).',
  ],
  dontUseWhen: [
    'Fewer than about seven fixed options — Select.',
    'The choice is set membership, not one value — the resolved-set row.',
    'Two states — Toggle.',
  ],
  anatomy:
    'A trigger button (role="combobox") wearing either the Select chip skin (bordered, the default) or the composer shelf\'s borderless chip, growing a PopoverCard whose popup holds a filter input and a role="listbox" of role="option" rows; a group header (CapsLabel\'s caps style — size, tracking, colour — without its uppercase transform, since a group can be a deliberately-cased literal) renders where an option\'s group differs from its neighbour; the selected row carries the s4 tint and the trailing mono `Current` marker; an unmatched query renders "No match" instead of an empty list; an optional footer sits beneath the listbox on its own hairline, carrying a second axis of the same choice; an optional rail of glyph scopes runs down the left edge on the recessed step, spanning filter, list and footer on a flush (unpadded) surface and widening the popup, with the list held at a fixed height so changing scope cannot resize the card — the rail REPORTS the scope clicked and never filters, since what a scope means is the caller\'s knowledge.',
  variantsStates: [
    'closed',
    'open (trigger border steps up, filter input focused)',
    'filtered (options narrow as you type)',
    'no-match ("No match")',
    'option hover/cursor',
    'option selected (tint + Current)',
    'active (trigger and option rows press with the kit scale tick)',
    'disabled (no hover, no press)',
    'focus-visible (global interior ring on the trigger; the filter input opts out — its own border step-up is the cue)',
    'bordered trigger (default) · chip trigger (dense control rows)',
    'with footer (second axis on its own hairline) · without (no region, no hairline)',
    'with rail (wider popup, scopes down the left edge, the active one tinted, fixed-height list) · without (narrow popup, list sized to its rows)',
    'with a leading glyph on the trigger (the selection’s own mark) · text only',
    'popup anchored to the trigger’s start edge (default) or its end edge (a trigger in a right-packed row, whose start edge moves as its label changes width)',
  ],
  accessibility:
    'Trigger carries role="combobox", aria-expanded and aria-haspopup="listbox"; ArrowUp/ArrowDown move a cursor over the filtered rows, Enter selects it; Escape runs through the kit dismiss-layer stack via PopoverCard; the popup opens onto the filter input by name (initialFocus) rather than onto whatever is first tabbable; the rail is a labelled role="group" of aria-pressed buttons, each named by its scope since the rail is glyphs only, each carrying the kit tooltip (never a native title, which the OS draws outside the page in its own skin), and it swallows mousedown so the filter input keeps the caret; the trigger takes the same kit tooltip through its own spec.',
  related: ['Select', 'PopoverCard', 'MenuItem'],
});

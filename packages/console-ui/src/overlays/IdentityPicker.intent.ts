import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const identityPickerIntent: ComponentIntent = assertIntent({
  name: 'IdentityPicker',
  family: 'Overlays',
  intent: "Edits an agent's icon and color from the curated vocabulary, previewing live.",
  useWhen: ["Changing an agent's visual identity in the agent editor's identity header."],
  dontUseWhen: [
    'Displaying identity — use AgentChip.',
    'Choosing a form value from options — use Select/Radio.',
  ],
  anatomy:
    'The lg AgentChip as the popover trigger; inside, a labelled 16-glyph icon grid and an 8-swatch color row.',
  variantsStates: ['closed', 'open', 'swatch/glyph rest/hover/pressed/selected', 'disabled'],
  accessibility:
    'Trigger names the agent + action; glyphs and swatches are aria-pressed toggle buttons named by icon/color; Radix popover handles dismissal and focus.',
  related: ['AgentChip', 'Popover', 'InlineEdit'],
});

import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const copyButtonIntent: ComponentIntent = assertIntent({
  name: 'CopyButton',
  family: 'Actions',
  intent:
    'A one-click control that copies a string to the clipboard with brief confirmation feedback.',
  useWhen: ['Offering copy on a code block, id, diff, or any short text payload.'],
  dontUseWhen: [
    'Copying requires formatting/serialization first — do that upstream and pass the final string.',
  ],
  anatomy:
    'An IconButton showing a copy glyph that swaps to a check for ~1.2s after a successful copy.',
  variantsStates: ['idle', 'copied'],
  accessibility: 'Native button; its accessible name announces Copy → Copied on success.',
  related: ['Code', 'IconButton'],
});

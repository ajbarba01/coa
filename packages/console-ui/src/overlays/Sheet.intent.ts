import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const sheetIntent: ComponentIntent = assertIntent({
  name: 'Sheet',
  family: 'Overlays',
  intent: 'A side drawer for a larger secondary surface.',
  useWhen: ['Settings, detail inspectors, or side forms that need room.'],
  dontUseWhen: ['A small confirmation — use Dialog.'],
  anatomy: 'A trigger and a side-anchored titled dialog with a scrim.',
  variantsStates: ['left', 'right', 'closed', 'open'],
  accessibility: 'Built on Radix dialog: focus trap, Escape closes, labelled by title.',
  related: ['Dialog', 'Pane'],
});

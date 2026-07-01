import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const spinnerIntent: ComponentIntent = assertIntent({
  name: 'Spinner',
  family: 'Feedback',
  intent: 'An indeterminate busy indicator for a single module.',
  useWhen: ['A short (~1–2s) wait with unknown duration on one control/module.'],
  dontUseWhen: [
    'A structured pane is loading — use Skeleton.',
    'Completion is measurable — use Progress.',
  ],
  anatomy: 'A rotating loader glyph in a live status.',
  variantsStates: ['spinning'],
  accessibility: 'role=status, aria-live=polite, labelled; honors reduced motion.',
  related: ['Progress', 'Skeleton'],
});

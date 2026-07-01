import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const skeletonIntent: ComponentIntent = assertIntent({
  name: 'Skeleton',
  family: 'Feedback',
  intent: 'A placeholder block for structured content that is loading.',
  useWhen: ['A pane with known shape (timeline, ledger) is loading 2–10s.'],
  dontUseWhen: ['A single control is busy — use Spinner.'],
  anatomy: 'A pulsing rounded block sized to the incoming content.',
  variantsStates: ['pulsing'],
  accessibility: 'aria-hidden (decorative); honors reduced motion.',
  related: ['Spinner', 'EmptyState'],
});

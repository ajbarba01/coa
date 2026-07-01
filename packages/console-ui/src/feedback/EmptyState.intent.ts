import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const emptyStateIntent: ComponentIntent = assertIntent({
  name: 'EmptyState',
  family: 'Feedback',
  intent: 'Explains why a region is empty and what to do next.',
  useWhen: ['A list/table/pane has no content yet — designed before the happy path.'],
  dontUseWhen: ['It is loading — use Skeleton.', 'It is an error — use Banner/InlineMessage.'],
  anatomy: 'An icon, a title, a description, and an optional action.',
  variantsStates: ['with action', 'without action'],
  accessibility: 'Icon is decorative; meaning is in the text.',
  related: ['Skeleton', 'Banner'],
});

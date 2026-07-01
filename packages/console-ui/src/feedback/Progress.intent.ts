import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const progressIntent: ComponentIntent = assertIntent({
  name: 'Progress',
  family: 'Feedback',
  intent: 'A determinate bar for a measurable long operation.',
  useWhen: ['An operation over ~10s with known completion (>10s triage step).'],
  dontUseWhen: [
    'Duration is unknown — use Spinner.',
    'A structured region is loading — use Skeleton.',
  ],
  anatomy: 'A track with a filled bar sized to the value.',
  variantsStates: ['0–100%'],
  accessibility: 'role=progressbar with aria-valuenow/min/max and a label.',
  related: ['Spinner', 'Skeleton'],
});

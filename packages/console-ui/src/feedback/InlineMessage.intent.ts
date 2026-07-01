import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const inlineMessageIntent: ComponentIntent = assertIntent({
  name: 'InlineMessage',
  family: 'Feedback',
  intent: 'A compact toned message shown inline with content.',
  useWhen: ['A short status next to a control or row (unsaved, syncing).'],
  dontUseWhen: [
    'A region-level condition — use Banner.',
    'A validation error on a field — use the Field error.',
  ],
  anatomy: 'A tone icon and short text.',
  variantsStates: ['info', 'success', 'warning', 'danger'],
  accessibility: 'Danger uses role=alert; tone carried by icon, not color alone.',
  related: ['Banner', 'Toast'],
});

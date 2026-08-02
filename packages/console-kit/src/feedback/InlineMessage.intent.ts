import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const inlineMessageIntent: ComponentIntent = assertIntent({
  name: 'InlineMessage',
  family: 'Feedback',
  intent: 'State about the thing beside it, said once and in place.',
  useWhen: [
    'A field, panel, or row needs to report its own state (saved, unsaved, failed to load).',
  ],
  dontUseWhen: [
    'The state belongs to the whole surface — dock a notice instead.',
    'The message is transient and must be noticed after focus has moved — that is a Toast.',
    'The state is one word with no detail — that is a StatusDot plus its label.',
  ],
  anatomy: 'A decorative tone mark and the message, on one inline baseline.',
  variantsStates: ['info (muted ground)', 'success (ok)', 'warning (warn)', 'danger (crit)'],
  accessibility:
    'The mark is aria-hidden; the message is the accessible content, so nothing announces twice.',
  related: ['Toast', 'StatusDot'],
});

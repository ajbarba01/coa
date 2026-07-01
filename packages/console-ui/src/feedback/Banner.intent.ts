import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const bannerIntent: ComponentIntent = assertIntent({
  name: 'Banner',
  family: 'Feedback',
  intent: 'Shows a persistent, in-flow status message tied to a region or view.',
  useWhen: [
    'A condition persists and the operator needs to keep seeing it (degraded mode, stale data).',
  ],
  dontUseWhen: [
    'The message is transient — use Toast.',
    'It is a validation error on a control — use the Field error.',
    'It is a system deny — use DenyNotice.',
  ],
  anatomy: 'Tone icon, title, optional body, optional dismiss.',
  variantsStates: ['info', 'success', 'warning', 'danger', 'dismissible'],
  accessibility:
    'role=status (danger uses role=alert); dismiss has an accessible label; never color alone (tone icon).',
  related: ['Toast', 'InlineMessage', 'DenyNotice'],
});

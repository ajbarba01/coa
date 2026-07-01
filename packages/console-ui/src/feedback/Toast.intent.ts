import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toastIntent: ComponentIntent = assertIntent({
  name: 'Toast',
  family: 'Feedback',
  intent: 'A transient confirmation that auto-dismisses.',
  useWhen: ['Confirming a completed local action (saved, copied).'],
  dontUseWhen: ['The condition persists — use Banner.', 'It is a system deny — use DenyNotice.'],
  anatomy: 'A provider + viewport hosting toast roots with title, body, and close.',
  variantsStates: ['info', 'success', 'warning', 'danger', 'open/closed'],
  accessibility: 'Radix toast live region; close has an accessible label.',
  related: ['Banner', 'InlineMessage'],
});

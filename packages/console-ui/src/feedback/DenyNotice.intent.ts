import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const denyNoticeIntent: ComponentIntent = assertIntent({
  name: 'DenyNotice',
  family: 'Feedback',
  intent: 'Surfaces a denial the daemon already issued — the close-gate or the cost-cap.',
  useWhen: ['Rendering a deny returned by the single deny channel (the only two real blocks).'],
  dontUseWhen: [
    'You are tempted to block or gate an action in the UI — the console never denies; only the daemon does.',
    'The message is a non-blocking warning — use Banner.',
  ],
  anatomy: 'Deny-kind eyebrow, the verbatim reason, optional next-step detail.',
  variantsStates: ['close-gate', 'cost-cap'],
  accessibility: 'role=alert; the kind is named in text, not color alone.',
  related: ['Banner', 'InlineMessage'],
});

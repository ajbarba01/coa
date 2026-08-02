import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toastIntent: ComponentIntent = assertIntent({
  name: 'Toast',
  family: 'Feedback',
  intent: 'A transient result the user must notice after their attention has moved on.',
  useWhen: [
    'An action the user started elsewhere failed or finished, and its own surface is no longer in view.',
  ],
  dontUseWhen: [
    'The state belongs beside a field or row — that is an InlineMessage.',
    'The message must be acted on before continuing — that is a modal.',
    'The state persists until something changes it — dock a notice instead.',
  ],
  anatomy: 'A bottom-right card: title, optional detail, and a labelled dismiss control.',
  variantsStates: [
    'info (ground rim)',
    'success (ok rim)',
    'warning (warn rim)',
    'danger (crit rim)',
    'closed (renders nothing)',
  ],
  accessibility:
    'role=status with aria-live=polite, so it is announced without taking focus; the whole card dismisses on click and the close control carries its own name.',
  related: ['InlineMessage'],
});

import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const modalShellIntent: ComponentIntent = assertIntent({
  name: 'ModalShell',
  family: 'Overlays',
  intent:
    'The modal ground: scrim + heavy-shadow centered card for the few moments that block the workbench.',
  useWhen: [
    'A blocking surface — settings, the shortcuts reference, a confirmation that must resolve before work continues.',
  ],
  dontUseWhen: [
    'Anchored options or controls — PopoverCard.',
    'Anything a quiet inline notice can say — modals are the loudest ground and must stay rare.',
  ],
  anatomy:
    'Controlled Base UI Dialog: scrim backdrop at the modal-backdrop z, a pointer-transparent centering popup, and the animated card inside it sized by the caller.',
  variantsStates: [
    'closed (renders nothing)',
    'open (focus trapped, scroll locked, mount rise)',
    'reduced-motion (instant)',
  ],
  accessibility:
    'Base UI focus trap + labelled dialog role; scrim press dismisses; Escape runs through the kit dismiss-layer stack.',
  related: ['PopoverCard', 'useDismissLayer', 'ShortcutsOverlay'],
});

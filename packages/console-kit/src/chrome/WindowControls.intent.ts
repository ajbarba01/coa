import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const windowControlsIntent: ComponentIntent = assertIntent({
  name: 'WindowControls',
  family: 'Chrome',
  intent:
    'The hidden-frame window’s min/max/close cluster, drawn in the DOM so it scales with the app zoom.',
  useWhen: [
    'The rightmost visible title-bar segment of a frameless window (and full-window gates that keep the chrome).',
  ],
  dontUseWhen: [
    'macOS — native traffic lights own the frame there; render nothing.',
    'Anywhere that is not window chrome — these verbs act on the OS window, not the app.',
  ],
  anatomy:
    'Three self-stretching w-10 buttons ─ · ▢/❐ · ✕ in a no-drag flex row; the middle glyph tracks the real maximized state.',
  variantsStates: [
    'default (ink s8)',
    'hover (min/max: s3 ground + s10 ink)',
    'close hover (crit ground + s12 ink — the one red hover in the chrome)',
    'restore (maximized ⇒ ❐ glyph + aria-label "restore")',
  ],
  accessibility:
    'Each button carries its verb as aria-label; the maximize label flips to "restore" with the state.',
  related: ['Button'],
});

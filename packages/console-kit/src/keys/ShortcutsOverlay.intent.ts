import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const shortcutsOverlayIntent: ComponentIntent = assertIntent({
  name: 'ShortcutsOverlay',
  family: 'Overlays',
  intent:
    'The shortcuts surface: the keybind registry rendered as a grouped, searchable modal card — and, when the caller passes an `editing` seam, the place binds are rebound.',
  useWhen: [
    'The app-wide shortcut summon (ctrl+/) — pass the same registry table that drives dispatch.',
    'Rebinding: pass `editing`. Reference and editor are ONE surface, so a bind is never discoverable in one place and changeable in another.',
  ],
  dontUseWhen: [
    'Naming one shortcut inline — Kbd.',
    'Owning the key vocabulary or the conflict policy — those come in through `editing`; this card renders and captures, it does not decide.',
  ],
  anatomy:
    'A height-capped ModalShell card: caps header with reset-all + a ghost close, an autofocused filter field, then the scrolling rows — one group header per bind group, and per row: label, a scope tag where the bind only answers somewhere ("in chat"), and the CHORD FIELD: the Kbd chips (or "unbound") inside a bordered control you click into to record a new chord, plus a reset for a customised bind. The chord is the control — there is no separate record button — and while recording it holds the chord heard and a line stating what Enter will do (including whose bind it would take).',
  variantsStates: [
    'open',
    'closed (unmounted by the caller)',
    'read-only (no `editing`)',
    'row recording',
    'row recording · conflict',
    'row unbound',
  ],
  accessibility:
    'Labelled dialog via ModalShell; the registry prop guarantees no bind exists without appearing here. Capture swallows every key while it runs (Escape cancels the recording rather than closing the card) so a chord under test can never also fire the command it names.',
  related: ['Kbd', 'ModalShell'],
});

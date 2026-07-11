import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const shortcutsOverlayIntent: ComponentIntent = assertIntent({
  name: 'ShortcutsOverlay',
  family: 'Overlays',
  intent: 'The quick shortcuts reference: the keybind registry rendered as a grouped modal card.',
  useWhen: [
    'The app-wide shortcut summon (ctrl+/) — pass the same registry table that drives dispatch.',
  ],
  dontUseWhen: [
    'Editing binds — that is a settings section, not this read-only card.',
    'Naming one shortcut inline — Kbd.',
  ],
  anatomy:
    'A ModalShell card: caps header with a ghost close, one CapsLabel-style group header per bind group, label + Kbd chips per row.',
  variantsStates: ['open', 'closed (unmounted by the caller)'],
  accessibility:
    'Labelled dialog via ModalShell; the registry prop guarantees no bind exists without appearing here.',
  related: ['Kbd', 'ModalShell'],
});

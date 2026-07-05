import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const paneOverlayIntent: ComponentIntent = assertIntent({
  name: 'PaneOverlay',
  family: 'Layout',
  intent: 'A modal-like overlay confined to its own pane, never the whole window.',
  useWhen: [
    'Expanding a truncated in-pane detail (e.g. a full tool diff/output) over just the chat pane.',
  ],
  dontUseWhen: [
    'A window-level modal is wanted — use Dialog.',
    'A transient message is enough — use Toast.',
  ],
  anatomy:
    'A provider wrapping a relative pane container; an absolute-inset overlay layer with a pane-confined scrim and a scrollable titled panel (close button); an open/close API exposed via usePaneOverlay.',
  variantsStates: ['closed', 'open'],
  accessibility:
    'role=dialog with an aria-label; Escape and backdrop/close-button dismiss; the panel is a focusable, scrollable region.',
  related: ['Dialog', 'Sheet', 'Toast'],
});

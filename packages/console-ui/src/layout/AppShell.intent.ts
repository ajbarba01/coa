import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const appShellIntent: ComponentIntent = assertIntent({
  name: 'AppShell',
  family: 'Layout',
  intent:
    'The window chrome: a custom title bar above a content slot the layout engine mounts into.',
  useWhen: ['Framing the desktop console — the one top-level shell around the panel layout.'],
  dontUseWhen: [
    'Arranging content regions — that is the layout descriptor and engine, not the shell.',
  ],
  anatomy:
    'A draggable custom title bar (platform-inset wordmark, workspace label, account context, persistent raw affordance) above a single content slot.',
  variantsStates: [
    'darwin (traffic-light inset)',
    'win32 (window-controls inset)',
    'with-account',
    'without-account',
  ],
  accessibility:
    'The title bar is a labelled banner; the raw control is a real focusable button; the content slot is the main region.',
  related: ['Pane', 'Toolbar', 'NavList'],
});

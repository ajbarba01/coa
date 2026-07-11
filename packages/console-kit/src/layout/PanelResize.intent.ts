import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const panelResizeIntent: ComponentIntent = assertIntent({
  name: 'PanelResize',
  family: 'Layout',
  intent:
    'A zero-width column seam: a 7px grab strip straddling a panel border, resizing it by drag.',
  useWhen: [
    'A resizable side panel (nav, work column) needs a draggable, double-click-resettable border.',
  ],
  dontUseWhen: [
    'The panel has a fixed width — no seam needed.',
    'Collapse/reopen hysteresis math is wanted ready-made — combine with resolveCollapse in onDrag.',
  ],
  anatomy:
    'A zero-width flex-none wrapper holding an absolutely-positioned 7px separator strip with a slip hairline.',
  variantsStates: ['idle (transparent, hover brightens)', 'active/dragging (bg-s7 hairline)'],
  accessibility:
    'role="separator" aria-orientation="vertical" aria-label="resize panel"; pointer-driven, no keyboard resize.',
  related: ['resolveCollapse'],
});

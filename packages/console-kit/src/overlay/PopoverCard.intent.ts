import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const popoverCardIntent: ComponentIntent = assertIntent({
  name: 'PopoverCard',
  family: 'Overlays',
  intent:
    'A trigger-anchored floating card on Base UI mechanics, wearing the shared menu-surface skin.',
  useWhen: [
    'A chip or button that grows a card of options or controls (composer chips, attach menu).',
    'Any anchored popup that must escape clipping containers and reposition on scroll.',
  ],
  dontUseWhen: [
    'Picking one value from a flat list — Select.',
    'A blocking decision or form — the modal ground.',
    'Hover-only detail — a tooltip, not a popover.',
  ],
  anatomy:
    'Controlled Base UI Popover (Root/Trigger/Portal/Positioner/Popup); the caller supplies the trigger element; the popup wears menuSurface at the dropdown z, or menuSurfaceFlush when flush drops the surface\'s own vertical padding so an edge-to-edge child reaches its rounded ends. An optional tooltip spec stacks Tooltip.Trigger onto the same element for hover/focus detail.',
  variantsStates: [
    'closed',
    'open (positioned side/align, mount rise)',
    'flush (no surface padding, for edge-to-edge children) · padded (default)',
    'reduced-motion (instant)',
  ],
  accessibility:
    'Base UI wires trigger aria + focus; outside-press is Base UI; Escape runs through the kit dismiss-layer stack so app-mode ordering holds. initialFocus names the element the popup opens onto, for a popup whose real entry point is not its first tabbable child.',
  related: ['MenuCard', 'MenuItem', 'useDismissLayer'],
});

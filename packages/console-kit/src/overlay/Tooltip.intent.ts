import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const tooltipIntent: ComponentIntent = assertIntent({
  name: 'Tooltip',
  family: 'Overlays',
  intent:
    'Hover/focus detail for icon-only controls — a quiet floating label, with the keybind when one exists.',
  useWhen: [
    'An icon-only button whose meaning is not instantly readable (foot buttons, strip glyphs, chevrons).',
    'A control that has a registry keybind worth surfacing at point-of-use.',
  ],
  dontUseWhen: [
    'The control already shows its full text — a tooltip restating a label is noise.',
    'Content the user must interact with or that must persist — PopoverCard.',
    'Disabled-state explanations on elements that swallow pointer events — inline text instead.',
  ],
  anatomy:
    'Base UI Tooltip (Root/Trigger/Portal/Positioner/Popup) under one app-level TooltipProvider (600ms delay, 400ms warm window); the popup wears the floating-surface skin (s3 + s5 hairline + shadow) at the tooltip z; keybinds render as Kbd chips.',
  variantsStates: [
    'hidden',
    'open (after delay, or instantly inside the warm window)',
    'open-from-focus (keyboard focus, no delay path)',
    'with-keybind (label + kbd chips)',
    'reduced-motion (instant)',
  ],
  accessibility:
    'Base UI wires the trigger aria and opens on keyboard focus; NOT a dismiss layer — Escape falls through to real layers; triggers keep their own aria-label as the accessible name.',
  related: ['PopoverCard', 'Kbd'],
});

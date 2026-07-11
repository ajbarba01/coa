import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const useDismissLayerIntent: ComponentIntent = assertIntent({
  name: 'useDismissLayer',
  family: 'Overlays',
  intent:
    'The one Escape stack: every dismissible surface registers while open; Escape closes only the topmost.',
  useWhen: [
    'A modal, dropdown, or app mode (e.g. search) needs to close on Escape.',
    'Several dismissible surfaces can be open at once and must pop in reverse open order.',
  ],
  dontUseWhen: [
    'A bespoke keydown listener for Escape.',
    'A Base UI popup — it owns its own open/close and Escape handling.',
  ],
  anatomy: 'A module-level stack of {id, close}; one shared window keydown listener closes only the top entry.',
  variantsStates: ['active (registered while true)', 'inactive (not registered)'],
  accessibility: 'Escape is the standard dismiss key; only the topmost layer ever intercepts it.',
  related: ['useClickAway'],
});

export const useClickAwayIntent: ComponentIntent = assertIntent({
  name: 'useClickAway',
  family: 'Overlays',
  intent:
    'Dismiss on outside pointerdown for bespoke menus; accepts several refs so a portaled card counts as inside.',
  useWhen: [
    'A bespoke non-Base-UI overlay (e.g. the Nav HUD picker) needs outside-click dismissal.',
    'The overlay is portaled and its trigger and portaled content must both count as "inside".',
  ],
  dontUseWhen: [
    'Base UI-backed popups — they own their own outside-press dismissal.',
    'No ref is ever mounted — there is nothing to be "outside" of.',
  ],
  anatomy: 'A document pointerdown listener that checks the pointer target against one or more ref-bound elements.',
  variantsStates: ['mounted (ref bound, listens)', 'unmounted (ref null, ignored)'],
  accessibility: 'Pointer-only dismissal; pairs with useDismissLayer for keyboard (Escape) dismissal.',
  related: ['useDismissLayer'],
});

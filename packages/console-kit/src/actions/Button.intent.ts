import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const buttonIntent: ComponentIntent = assertIntent({
  name: 'Button',
  family: 'Actions',
  intent:
    'The six-variant action vocabulary — primary/quiet/outline/block/ghost/text pick the weight, icon swaps text padding for square icon geometry.',
  useWhen: [
    'Any clickable control that commits an action: submit, confirm, deny, run, start, or trigger a menu.',
    'primary for the one accent action per view · quiet for the workhorse confirm · outline for secondary/deny · block for raised square utilities · ghost for chrome-adjacent icons · text for ink-only toolbar controls.',
  ],
  dontUseWhen: [
    'The control navigates to another location rather than committing an action.',
    'The control needs a loading state — this vocabulary has none; callers disable instead.',
  ],
  anatomy:
    'A native <button> whose face (color/border/hover/press) and geometry (text padding or icon square) are selected per variant; disabled swaps to the off face with no hover, no press, no pointer.',
  variantsStates: [
    'primary',
    'quiet',
    'outline',
    'block',
    'ghost',
    'text',
    'default · hover · focus-visible (global interior ring) · active (scale press) · disabled (no hover, no pointer)',
  ],
  accessibility:
    'Native <button> semantics (Enter/Space activate); type defaults to button; icon-only callers must pass aria-label; loading is not applicable in this vocabulary — callers disable instead.',
  related: ['StatusDot'],
});

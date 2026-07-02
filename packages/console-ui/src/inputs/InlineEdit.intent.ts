import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const inlineEditIntent: ComponentIntent = assertIntent({
  name: 'InlineEdit',
  family: 'Inputs',
  intent: 'Click-to-edit text for renaming a thing where it is displayed (title pattern).',
  useWhen: [
    'Renaming an entity in place — the agent name in the identity header, a session title.',
  ],
  dontUseWhen: [
    'Collecting a value in a form — use TextField.',
    'The text is not editable — render it plainly.',
  ],
  anatomy:
    'A display button (value + hover pencil) that swaps to an input on click; identical type styling in both modes so nothing shifts.',
  variantsStates: ['display rest/hover/active/focus', 'editing', 'disabled'],
  accessibility:
    'Display button is named "Rename {label}: {value}"; the editor input carries the label; Enter commits, Escape cancels, blur commits; empty/unchanged drafts revert without firing.',
  related: ['TextField', 'IdentityPicker'],
});

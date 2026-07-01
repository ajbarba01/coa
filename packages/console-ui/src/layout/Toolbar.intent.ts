import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const toolbarIntent: ComponentIntent = assertIntent({
  name: 'Toolbar',
  family: 'Layout',
  intent: 'Groups a row of actions over a content region.',
  useWhen: ['A pane needs a cluster of buttons/toggles acting on its content.'],
  dontUseWhen: ['The actions are page-level — use the shell chrome.'],
  anatomy: 'A Radix toolbar row of buttons/controls.',
  variantsStates: ['rest'],
  accessibility: 'role=toolbar with an aria-label; roving focus across controls.',
  related: ['ButtonGroup', 'IconButton'],
});

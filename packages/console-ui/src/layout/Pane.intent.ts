import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const paneIntent: ComponentIntent = assertIntent({
  name: 'Pane',
  family: 'Layout',
  intent: 'A titled, bordered content region with an optional scrolling body.',
  useWhen: ['Framing a surface (cost rail, decision log) as a distinct region.'],
  dontUseWhen: ['Content needs no frame — compose plainly to reduce chrome.'],
  anatomy: 'Optional header (title + actions) and a body that can scroll.',
  variantsStates: ['untitled', 'titled', 'scroll'],
  accessibility: 'section labelled by its heading id when titled.',
  related: ['Toolbar', 'Divider'],
});

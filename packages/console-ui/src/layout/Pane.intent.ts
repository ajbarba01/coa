import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const paneIntent: ComponentIntent = assertIntent({
  name: 'Pane',
  family: 'Layout',
  intent: 'A titled, bordered content region with an optional scrolling body.',
  useWhen: ['Framing a surface (cost rail, decision log) as a distinct region.'],
  dontUseWhen: ['Content needs no frame — compose plainly to reduce chrome.'],
  anatomy:
    'Optional header (title text or an interactive titleSlot, plus actions) and a body that can scroll or sit flush to the edges.',
  variantsStates: ['untitled', 'titled', 'titleSlot', 'scroll', 'flush'],
  accessibility:
    'section labelled by its heading id when titled; with a titleSlot the title string becomes the region aria-label.',
  related: ['Toolbar', 'Divider'],
});

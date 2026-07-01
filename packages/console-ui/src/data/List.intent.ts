import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const listIntent: ComponentIntent = assertIntent({
  name: 'List',
  family: 'Data-display',
  intent: 'Renders a simple sequence of items with a custom item renderer.',
  useWhen: ['A flat sequence (flags, files) without columnar structure.'],
  dontUseWhen: ['Records with multiple aligned fields — use Table.'],
  anatomy: 'A semantic list of rendered items.',
  variantsStates: ['rest'],
  accessibility: 'role=list/listitem; optional aria-label.',
  related: ['Table', 'KeyValue'],
});

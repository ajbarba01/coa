import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const tableIntent: ComponentIntent = assertIntent({
  name: 'Table',
  family: 'Data-display',
  intent: 'Presents rows of records with aligned columns, empty state first.',
  useWhen: ['Showing the ledger, decisions, or timeline as scannable rows.'],
  dontUseWhen: ['Two fields of one record — use KeyValue.', 'A simple sequence — use List.'],
  anatomy: 'A caption, column headers, and rows with per-column render + alignment; an empty slot.',
  variantsStates: ['populated', 'empty'],
  accessibility: 'Semantic table with scoped column headers and an sr-only caption.',
  related: ['List', 'KeyValue'],
});

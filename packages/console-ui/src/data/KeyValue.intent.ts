import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const keyValueIntent: ComponentIntent = assertIntent({
  name: 'KeyValue',
  family: 'Data-display',
  intent: 'Shows term/value pairs for a single record.',
  useWhen: ['Displaying metadata of one thing (model, turns, mode).'],
  dontUseWhen: ['Many records — use Table.'],
  anatomy: 'A description list of term/description pairs on a two-column grid.',
  variantsStates: ['rest'],
  accessibility: 'Semantic dl/dt/dd.',
  related: ['Table', 'Stat'],
});

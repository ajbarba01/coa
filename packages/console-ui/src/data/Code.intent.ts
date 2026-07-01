import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const codeIntent: ComponentIntent = assertIntent({
  name: 'Code',
  family: 'Data-display',
  intent: 'Renders code or identifiers verbatim in monospace.',
  useWhen: ['Showing a symbol, path, command, or byte-faithful block.'],
  dontUseWhen: ['Prose — use normal text.'],
  anatomy: 'Inline <code> or a whitespace-preserving <pre> block.',
  variantsStates: ['inline', 'block'],
  accessibility: 'Preserves bytes exactly; no truncation or normalization.',
  related: ['KeyValue'],
});

import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const dividerIntent: ComponentIntent = assertIntent({
  name: 'Divider',
  family: 'Layout',
  intent: 'Separates content with the lightest visible rule.',
  useWhen: ['Whitespace and grouping are not enough to separate two regions.'],
  dontUseWhen: ['Space or a tint already reads as separated — prefer removing the border.'],
  anatomy: 'A one-pixel hairline, horizontal or vertical.',
  variantsStates: ['horizontal', 'vertical'],
  accessibility: 'role=separator with aria-orientation.',
  related: ['Toolbar', 'Pane'],
});

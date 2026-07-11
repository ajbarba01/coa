import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const kbdIntent: ComponentIntent = assertIntent({
  name: 'Kbd',
  family: 'Foundations',
  intent: 'The kbd chip — one look for every shortcut the UI names.',
  useWhen: [
    'Rendering a key or chord anywhere: the shortcuts overlay, settings rows, inline hints.',
  ],
  dontUseWhen: [
    'Describing an action without its key — plain text.',
    'A clickable control — Button; Kbd is inert.',
  ],
  anatomy: 'One <kbd>: caps-scale mono text on an s3 chip with an s4 hairline.',
  variantsStates: ['default'],
  accessibility: 'Semantic <kbd> element; reads as the key name.',
  related: ['ShortcutsOverlay', 'CapsLabel'],
});

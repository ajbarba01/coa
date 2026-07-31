import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const iconIntent: ComponentIntent = assertIntent({
  name: 'Icon',
  family: 'Data',
  intent: 'A drawn glyph at the house convention — the picture half of an affordance.',
  useWhen: [
    'A glyph IS the control — an icon-only affordance with no adjacent text to name it (close, settings, copy, attach).',
    'The same action recurs across surfaces and a glyph makes it findable faster than reading.',
  ],
  dontUseWhen: [
    'The glyph sits BESIDE a text label. The label already names the thing, so the mark is ornament and stays a mono character in the type stream (UI.md, label-adjacency law).',
    'Indicating state — that is StatusDot; a glyph is an action or an object, never status.',
    'Naming a third party — that is BrandMark, which carries their color; Icon is always currentColor.',
    'Mirroring an OS vocabulary — WindowControls keeps its ─ ▢ ✕ characters so the chrome matches the platform.',
    'Decorating a surface. A glyph with no action behind it is noise in the quiet register.',
  ],
  anatomy:
    'A Lucide svg at --icon-sm (default) or --icon-md, stroke 2, round caps/joins, inheriting currentColor from its parent.',
  variantsStates: [
    'sm (house default) · md (a glyph carrying a row alone)',
    'decorative (default — aria-hidden, for a glyph beside a text label)',
    'labelled (role=img + aria-label, for an icon-ONLY control)',
    'States belong to the parent control: an Icon has no hover/press/disabled of its own, so it cannot drift from the affordance it sits in.',
  ],
  accessibility:
    'Decorative by default (aria-hidden, focusable=false) so an icon beside a label is not announced twice; pass `label` ONLY when the icon is a control\'s sole content, which makes it role="img" with that accessible name.',
  related: ['StatusDot', 'BrandMark', 'Button'],
});

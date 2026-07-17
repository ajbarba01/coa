import { assertIntent, type ComponentIntent } from '../lib/intent.js';

export const brandMarkIntent: ComponentIntent = assertIntent({
  name: 'BrandMark',
  family: 'Brand',
  intent: "A third party's own mark in its own color — identity you read without thinking.",
  useWhen: [
    'Naming an external provider (agent backend, tool service) on a credentials or usage surface.',
    'A row whose subject IS the third party, where the logo is the fastest identifier.',
  ],
  dontUseWhen: [
    'Indicating state — that is StatusDot; a mark is identity, never status.',
    'Decorating coa surfaces that are not about a third party (the sand register owns those).',
  ],
  anatomy:
    'One 24×24 svg path filled with the brand hex, or — when no official mark ships — a rounded monogram tile grounded in that hex.',
  variantsStates: [
    'path (bundled official mark)',
    'monogram (no mark bundled — the extensibility floor)',
    'muted (a benched provider: desaturated + dimmed, never recolored)',
  ],
  accessibility:
    'role="img" with the provider name as aria-label, so the identity survives with images or color off.',
  related: ['StatusDot', 'Meter'],
});

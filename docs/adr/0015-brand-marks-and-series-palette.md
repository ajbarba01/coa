# 0015. Third-party brand marks, and a series palette for charts

- Status: accepted
- Date: 2026-07-13
- Extends the indicator law of [0014](0014-workbench-design-system.md) (which stands unchanged everywhere else)

## Context and problem

The auth and usage surfaces render **other people's products** — Claude, DeepSeek, Tavily, Firecrawl — and
they render **charts** of per-model spend. Both needs collide with 0014's indicator law, which reserves
colour for state ("accent hues never decorate inactive chrome") and gives the console a status vocabulary of
exactly four hues: blue = running, amber = needs-you, red = critical, green = done.

Two questions fell out of that collision, and guessing at either would have quietly corrupted the register:

1. **May a provider's logo wear its own brand colour on an inactive row?** Under a literal reading of the
   indicator law, no — and the surface then asks the operator to identify eight providers from monochrome
   glyphs on a surface whose whole job is "which of my credentials is this".
2. **What colour is a chart series?** The status four are the only saturated hues we have, and painting a
   model's spend segment amber would make it indistinguishable from a warning.

## Decision

- **A third party's mark wears its own colour, on every row, active or not** (`BrandMark`). On a credentials
  surface the logo IS the identity: it is the fastest, least ambiguous way to say *whose* key this is, and
  making the operator decode a monochrome glyph would cost more than the register gains. The mark is the one
  sanctioned exception to "colour is earned"; it is **identity, never state**. State next to it stays a dot.
  - A benched provider's mark is **desaturated and dimmed, never recoloured** — we mute an identity, we do
    not restate it in our own palette.
  - The hex lives on a **descriptor** (`BrandMarkSpec`), not in a component: it is external data, not a
    token, and it must never become one. Providers we ship no official mark for degrade to a **monogram
    tile**, which is what keeps "a new provider is a registry row and no new UI" true.
- **Charts get their own `series` palette** (`--color-series-1..3`), part of the theme, disjoint from the
  status set: violet `#9070dd` · teal `#2aa294` · gold `#b8842e`. Series colour carries **identity** (which
  model), assigned in fixed order and never cycled or reassigned by rank, so a filter that drops a model
  never repaints the survivors. A series must never be readable as "warning" — which is exactly why it may
  not draw from the status four.
  - The set was **validated, not eyeballed**: OKLCH lightness band, chroma floor, colourblind separation
    (worst adjacent ΔE 40.5), and ≥3:1 contrast against the s1 ground. A theme that changes these
    re-validates them **as a set**.
  - Identity is never colour-alone: every chart carries a legend, and the hover card names each model.

## Consequences

- The console spends colour on inactive chrome in exactly one place, deliberately, with a stated reason — an
  ADR'd deviation rather than a slow erosion of the quiet register.
- Adding a provider stays a registry row: mark, or monogram, and no component knows any provider's name.
- The `series` tokens are now part of what "a theme is a scale swap at full quality" (0014) means: a new
  theme owes a validated series set, not a partial recolour.

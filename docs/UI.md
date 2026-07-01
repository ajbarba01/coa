# UI — Control & Inspection Intent

> **Status: M10 design system specified.** coa's only GUI is the **M10 Console**. The concrete design system —
> principles, the three-tier token system, component families, layout architecture, and visual direction — is
> specified in
> [superpowers/specs/2026-06-30-console-frontend-foundation-design.md](superpowers/specs/2026-06-30-console-frontend-foundation-design.md).
> That spec is the authority for the GUI's look and structure; this doc keeps only the standing invariants that
> bind the build regardless of implementation detail.
>
> Authority for the product behavior behind the GUI is [design/handoff/SPEC.md](design/handoff/SPEC.md) (M10 +
> the M8 JSON-RPC surface). UI engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and
> [CODE_STYLE.md](CODE_STYLE.md).

---

## Standing UI principles (summary — see the spec above for the full design system)

- **Control through the catalogue.** Every interactive action the GUI offers is an M8 JSON-RPC verb; a write that
  mutates project state lands as a change-event through the kernel (P7 mutation chokepoint). The GUI never edits
  state out of band, and never reaches into M1–M9 internals directly.
- **`coa raw` is sacred.** The console always offers the unfiltered loop (D85 strict-superset); the GUI must
  never hide that escape.
- **Catalogue-only, byte-faithful.** The GUI is a second _client_ of the M8 catalogue, not a second source of
  truth; the artifacts it renders (graph, diffs, ledger) are byte-stable and diffable — the GUI presents them, it
  does not recompute or re-interpret them.
- **Component kit with declared intent.** The standardized component families live in
  [`packages/console-ui`](../packages/console-ui) (design tokens + components over Radix primitives, styled from the
  tokens). Every component ships a typed `intent` declaration (Intent / Use-it-when / Don't-use-it-when / Anatomy /
  Variants & States / Accessibility / Related); presence and completeness are enforced, and all intents compile into
  the generated [`COMPONENTS.md`](../packages/console-ui/COMPONENTS.md) catalogue — the one doc to consult when
  choosing a component. The SC-1 single deny channel is surfaced by the `DenyNotice` member, which only renders a
  daemon-issued block (close-gate / cost-cap) and never invents one.
- **Accessibility floor.** Semantic structure, sufficient contrast, visible focus, full keyboard navigation —
  non-negotiable, re-verified per surface.
- **Honest surfacing (CF-1).** The user sees **everything** via progressive disclosure (crit/high expanded;
  med/low collapsed-but-counted, never hidden). The GUI mirrors that contract.

---

## Authoring rules (framework-first — read before writing any console UI)

The M10 foundation exists so surfaces **reuse one system** instead of each reinventing it. These rules are
binding; full detail + exact token values live in the design spec
([§6 tokens](superpowers/specs/2026-06-30-console-frontend-foundation-design.md),
[§7 component families](superpowers/specs/2026-06-30-console-frontend-foundation-design.md),
[§23 as-built conventions](superpowers/specs/2026-06-30-console-frontend-foundation-design.md)) and
`console-ui/src/theme.css` / `tokens/semantic.ts`; per-component usage intent is in
[`COMPONENTS.md`](../packages/console-ui/COMPONENTS.md).

- **Build from the kit, never hand-roll.** Every control, surface, and piece of feedback is a
  `@coa/console-ui` component — pick one via `COMPONENTS.md`. If nothing fits, add a member **to the kit**
  with its lint-enforced intent block; do not inline a bespoke component inside a panel. A panel is kit
  composition + a pure `selectVm`, with no styling of its own.
- **No raw values.** No literal hex/px/rem/duration/radius in a component. Text →
  `text-{eyebrow…metric}` (never `text-[Npx]`); control height → `h-control-{sm,md}` /
  `h-control-indicator`; color/space/radius/z → the semantic tokens (`bg-surface`, `text-fg`,
  `rounded-control`, the named z bands). The one sanctioned raw px is a value that must match a
  main-process pixel (the title bar) — and it says so in a comment.
- **Sizing is density-driven.** Extend the `--fs-*` / `--control-h-*` tokens to add a size; never
  hardcode, or the density toggle silently skips your component. The 8pt grid assumes a 16px root — don't
  shrink it to "make things dense."
- **Feedback contract.** Every clickable ships its own **hover** *and* its own **press** (`active:` — plus
  `data-[state=open]:` on overlay triggers so the close-click responds), and shows **no hover when
  disabled**. Motion: transitions for interruptible state, keyframes only for mount/unmount; honor
  reduced-motion.
- **Two Electron/Chromium gotchas.** Don't set the standard `scrollbar-width`/`scrollbar-color` (it
  disables all `::-webkit-scrollbar` styling); keep the title-bar height in px lockstep with
  `TITLE_BAR_HEIGHT`.
- **Check the Components tab** — a live, states-first catalogue of every primitive — before wiring a
  component into a surface.

---

_Last reviewed: 2026-07-01_

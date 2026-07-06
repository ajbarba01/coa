# UI — Control & Inspection Intent

> **Status: M10 design system built.** coa's only GUI is the **M10 Console**. This doc is the standing authority
> for the GUI's principles and authoring rules; the design system's *structure* — a three-tier token system
> (`palette.ts` raw values → `semantic.ts` the only tier components consume → per-theme/density CSS), component
> families catalogued by intent, a panel/descriptor/engine layout split, and the locked warm-dark "forge" visual
> direction — is summarized here. **Exact token values and component definitions live in code**:
> [`packages/console-ui`](../packages/console-ui) (`src/theme.css`, `src/tokens/`, the generated
> [`COMPONENTS.md`](../packages/console-ui/COMPONENTS.md)). The durable *why* — the governance rationale behind
> the token tiers, the intent-block contract, the layout engine seam, and the virtualization reversal — is
> [ADR-0007](adr/0007-console-design-system.md).
>
> Authority for the product behavior behind the GUI is [design/handoff/SPEC.md](design/handoff/SPEC.md) (M10 +
> the M8 JSON-RPC surface). UI engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and
> [CODE_STYLE.md](CODE_STYLE.md).

---

## Standing UI principles

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
binding. Token *tiers* are named and defined in `console-ui/src/theme.css` / `tokens/semantic.ts` (tier 1
`palette.ts` raw values, tier 2 `semantic.ts` the only tier components consume); component *families* (Actions,
Feedback, Dense/Viz, …) and per-component usage intent are catalogued in
[`COMPONENTS.md`](../packages/console-ui/COMPONENTS.md), generated from each component's lint-enforced intent
declaration so the catalogue can't drift from the code. The rationale for this shape is
[ADR-0007](adr/0007-console-design-system.md).

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
- **Virtualization is not the default for a chat transcript.** The 2026-07-04 chat rebuild reversed the two
  prior chat specs (both pinned `react-virtuoso`): `Transcript` now renders every frame to the DOM (no
  windowing), because full-transcript text selection and in-page Ctrl-F both require every row present.
  `content-visibility: auto` on each row keeps off-screen rows out of layout/paint without unmounting them, and
  native scroll drives stick-to-bottom. Reach for virtualization only when a stream's unbounded length actually
  costs more than the selection/find loss — it is no longer the assumed default for this surface.

---

_Last reviewed: 2026-07-06_

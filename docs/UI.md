# UI — Control & Inspection Intent

> **Status: workbench design system adopted.** coa's only GUI is the **M10 Console**. This doc is the standing
> authority for the GUI's principles, design laws, and authoring rules. The direction is the
> **conversation-first workbench** on the **sand-dark quiet register** — adopted at
> [ADR-0014](adr/0014-workbench-design-system.md), superseding the forge/brass direction (whose governance
> machinery — intent blocks, token tiers, the no-windowing reversal — still binds via
> [ADR-0007](adr/0007-console-design-system.md)). **Exact token values live in code**:
> [`packages/console-kit`](../packages/console-kit) (`tokens.css`: the s1–s12 scale, Slipstream durations,
> status colors) during migration; the motion-true reference implementation is
> [`apps/workbench-proto`](../apps/workbench-proto). The legacy kit
> ([`packages/console-ui`](../packages/console-ui)) and its `COMPONENTS.md` remain authoritative for surfaces
> not yet migrated; the rebuild sequence is ROADMAP-owned.
>
> Authority for the product behavior behind the GUI is [design/handoff/SPEC.md](design/handoff/SPEC.md) (M10 +
> the M8 JSON-RPC surface). UI engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and
> [CODE_STYLE.md](CODE_STYLE.md).

---

## Standing UI principles

- **Control through the catalogue.** Every interactive action the GUI offers is an M8 JSON-RPC verb; a write that
  mutates project state lands as a change-event through the kernel (P7 mutation chokepoint). The GUI never edits
  state out of band, and never reaches into M1–M9 internals directly.
- **`coa raw` is sacred, not advertised.** The console always offers the unfiltered loop (D85 strict-superset) —
  from the command palette, with a visible indicator only while it is ON. Reachability is the guarantee;
  chrome is not.
- **Catalogue-only, byte-faithful.** The GUI is a second _client_ of the M8 catalogue, not a second source of
  truth; the artifacts it renders (graph, diffs, ledger) are byte-stable and diffable — the GUI presents them, it
  does not recompute or re-interpret them.
- **The only "no" is the daemon's.** SC-1's two blocks (close-gate, cost-cap) arrive through the single deny
  channel and are *rendered*, never invented, by the UI (the `DenyNotice` contract).
- **Accessibility floor.** Semantic structure, sufficient contrast, visible focus, full keyboard navigation —
  non-negotiable, re-verified per surface.
- **Honest surfacing (CF-1).** The user sees **everything** via progressive disclosure (crit/high expanded;
  med/low collapsed-but-counted, never hidden). The GUI mirrors that contract.

---

## Design laws (the register — every surface, every component)

- **Quiet register.** Nothing shouts; if it doesn't need instant attention it isn't instantly apparent.
  Conversation owns the darkest ground (s1); chrome sits on s2. Attention is earned by frequency or
  criticality — never by ideology, never persistently.
- **Indicator law.** State is a **dot** (blue running · amber needs-you · red critical · green done · ground
  idle); magnitude is a **count** (zero renders nothing); text is for names; detail is proximity
  (hover/focus). Accent hues never decorate inactive chrome.
- **Elevation grounds.** In-flow surfaces s2/s4 with no shadow · floating surfaces s3/s5 + shadow · modals
  s2/s5 + heavy shadow + scrim. **Hairlines:** s3 internal · s4 structural · s5 floating edges.
- **Slipstream motion.** swift 80 / base 140 / move 200 / enter 180 ms, expo-out, ≤ 12 px travel, never
  bouncy. Transitions for interruptible state; keyframes only for mount/unmount, with fill-mode `backwards`
  (a filled end-state transform turns the element into a containing block and breaks `position: fixed`
  descendants). Reduced-motion collapses everything to instant.
- **Focus.** Keyboard focus is a 2 px s8 ring drawn **inside** the element (`outline-offset: -2px`) so it
  never collides with neighbors or clips in scroll containers; pointer focus shows nothing
  (`:focus-visible`). Inputs opt out — their container's border step-up is the cue.
- **Dismissal.** One Escape **layer stack** (topmost closes first); menus dismiss on outside *pointerdown*;
  modal scrims guard `target === currentTarget`; a portaled menu counts as inside its trigger. Menus that
  escape a clipping container do so via a portal + fixed position, and close on any scroll/resize.
- **Selection marker.** A selected option row is an s4 tint + a trailing mono `current` — one vocabulary in
  every menu, picker, and select.
- **Keybinds are a registry.** One table drives both the dispatch and the shortcuts UI (settings section +
  the quick overlay), so a bind cannot exist without being discoverable. Shortcuts render as kbd chips.
- **Chrome geometry.** The title bar is app surface, segmented per column; sidebar borders run title-bar →
  floor and beat other hairlines; side panels drag-resize between constraints (the right one drag-collapses
  with hysteresis and resurrects in-gesture); the base scale is 1.2 (Electron `setZoomFactor` — pointer→layout
  math divides by it). Scrollbars are boxy, constant-width, palette-stepped — a deliberate, flagged exception
  to "never restyle scrollbars", justified by category convention (VS Code) and constancy.
- **Banners' function, not banners.** Predictive notices (drift, cold cache) surface as one quiet line in
  indicator-law form — dot + name + inline action — docked to the surface they concern; they never take the
  frame and never persist past relevance.

---

## Authoring rules (framework-first — read before writing any console UI)

- **Design through Impeccable.** Any agent designing, critiquing, or polishing console UI invokes the
  **impeccable** design skill (product register — design serves the product) as its design engine before
  pixels. Its general rules (contrast verification, state completeness, dropdown-clipping, the absolute bans)
  apply here; where it and this doc disagree, **this doc and ADR-0014 win** — deviations are flagged
  decisions, not oversights (e.g. our constant-width scrollbars deliberately override its
  no-custom-scrollbars ban on VS Code-precedent grounds).
- **Build from the kit, never hand-roll.** Every control, surface, and piece of feedback is a kit component;
  if nothing fits, add a member **to the kit** with its lint-enforced intent block (Intent / Use-it-when /
  Don't-use-it-when / Anatomy / Variants & States / Accessibility / Related); do not inline a bespoke
  component inside a panel. A panel is kit composition + a pure `selectVm`, with no styling of its own.
- **No raw values.** No literal hex/px/rem/duration/radius in a component — color/space/radius/duration/z
  come from the tokens. The one sanctioned raw px is a value that must match a main-process pixel (the title
  bar) — and it says so in a comment.
- **Every state ships.** default · hover · focus-visible · active · disabled · loading · empty · error —
  "unpolished" almost always means "an unhandled state". Every clickable has its own hover *and* press, and
  shows no hover when disabled. This is the graduation checklist for moving a prototype specimen into the kit.
- **A theme is a scale swap at full quality.** New themes (light, the re-tailored brass identity) replace the
  whole s-scale + status set to the same bar as sand-dark — never a partial recolor. Density and motion are
  token axes, not per-component decisions.
- **Semantic z-index scale.** dropdown → sticky → modal-backdrop → modal → toast → tooltip, as named tokens —
  never arbitrary values.
- **Two Electron/Chromium gotchas.** Don't set the standard `scrollbar-width`/`scrollbar-color` in the
  Chromium path (it disables all `::-webkit-scrollbar` styling; the Firefox-only fallback is scoped with
  `@supports not selector(::-webkit-scrollbar)`); keep the title-bar height in px lockstep with
  `TITLE_BAR_HEIGHT`.
- **Virtualization is not the default for a chat transcript.** `Transcript` renders every frame to the DOM
  (no windowing) because full-transcript selection and in-page Ctrl-F require every row present;
  `content-visibility: auto` keeps off-screen rows cheap. Reach for virtualization only when unbounded length
  actually costs more than the selection/find loss.
- **The showcase is the living spec.** Every primitive and every state renders in the showcase surface;
  critique and harden there before a component graduates into the kit.

---

_Last reviewed: 2026-07-10_

# UI — Control & Inspection Intent

> **Status: workbench design system adopted.** coa's only GUI is the **M10 Console**. This doc is the standing
> authority for the GUI's principles, design laws, and authoring rules. The direction is the
> **conversation-first workbench** on the **sand-dark quiet register** — adopted at
> [ADR-0014](adr/0014-workbench-design-system.md), superseding the forge/brass direction (whose governance
> machinery — intent blocks, token tiers, the no-windowing reversal — still binds via
> [ADR-0007](adr/0007-console-design-system.md)). **Exact token values live in code**:
> [`packages/console-kit`](../packages/console-kit) (`tokens.css` + `themes/sand-dark.css`: the s1–s12 scale,
> Slipstream durations, status/agent/focus colors) — the console's ONE token substrate, with no second theme
> to lose a collision to ([ADR-0025](adr/0025-retire-the-legacy-console-kit.md)). The living reference
> implementation is the console's own
> [showcase surface](../apps/desktop/src/renderer/panels/ShowcasePanel.tsx), a specimen per registered kit
> member enforced by test. The conversation renderer lives in
> [`packages/console-transcript`](../packages/console-transcript), a composite built on the kit rather than a
> kit member.
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
  s2/s5 + heavy shadow + scrim. **Hairlines:** s3 internal · s4 structural · s5 floating edges. The in-flow
  step is a **panel** (header / body / optional footer, `r3`, never a shadow and never nested) — the agent
  editor's sections are its first consumers. A panel is not a card: it does not float, does not sit in a
  uniform tile grid, and a selected row's own tint inside it is a tint, not a second surface.
- **Slipstream motion.** swift 80 / base 140 / move 200 / enter 180 ms, expo-out, ≤ 12 px travel, never
  bouncy. Transitions for interruptible state; keyframes only for mount/unmount, with fill-mode `backwards`
  (a filled end-state transform turns the element into a containing block and breaks `position: fixed`
  descendants). Reduced-motion collapses everything to instant.
- **Focus.** Keyboard focus is a 2 px s8 ring drawn **inside** the element (`outline-offset: -2px`) so it
  never collides with neighbors or clips in scroll containers; pointer focus shows nothing
  (`:focus-visible`). Inputs opt out — their container's border step-up is the cue.
- **Dismissal.** One Escape **layer stack** — the kit's single Escape authority (topmost closes first; a
  Base UI popup's own Escape close is swallowed so the stack issues it); menus dismiss on outside
  *pointerdown*; modal scrims guard the backdrop; a portaled menu counts as inside its trigger. Menus that
  escape a clipping container do so via a portal, and reposition to follow their trigger on scroll/resize.
- **Two glyph vocabularies, one test.** A **typed** mono character (`▣ ⇪ ⌕ ⇄`) rides `--text-icon`, a
  font-size; a **drawn** lucide mark (the kit's `Icon`) rides `--icon-sm`/`--icon-md`, a box. The label
  decides which: **a glyph beside a text label is typed; a glyph that _is_ the control is drawn.** A named
  row, menu item, or title-bar button already says what it does, so its mark is ornament and belongs in the
  type stream. An icon-only control carries the whole meaning alone, so it earns a drawn mark and a real
  accessible name — which is why `Icon` is decorative by default and its `label` is for sole-content use
  only. Pure ornament inside a field (the search `⌕`) is typed; **status is neither vocabulary, it is a
  dot.** One carve-out: `WindowControls` keeps its `─ ▢/❐ ✕` characters, because that chrome exists to
  mirror the platform's own window vocabulary and a lucide mark would read as foreign there.

- **Capitalization is a function of element kind.** Not one case everywhere — the element decides, and then
  it holds without exception. **A command or action is Title Case** (`Remove Profile`, `Check for Updates`);
  articles and prepositions inside it stay lowercase. **A label that names a thing or reports a state is
  sentence case** (`Agent backend`, `No flags`, `Signed in`). **Prose is sentence case and takes a terminal
  period**; a label never does. Everything starts with a capital letter. Measured against ~233 000 words of
  shipped interface copy (VS Code, Spotify, Notion, Slack, GitHub Desktop, Docker Desktop): commands run 100 %
  capital-first and 66 % Title Case, state labels 33 % Title, prose 96 % capital-first with 96 % terminal
  periods. The **quiet register is visual, not typographic** — loudness is earned through ground, hue and
  motion, and lowercasing a button never bought any of it. **An accessible name matches its visible label
  verbatim**; with no visible label it takes the case of what it is — a menu-item-shaped command Title Case
  (`Remove Provider`), a descriptive phrase for an icon-only control sentence case (`Stop the running turn`),
  a field or state sentence case (`Reduce motion`). **Keycap hints stay lowercase** (`esc`, `ctrl+`, `⌥⏎`):
  they name a physical key, not a word. Derivation and the full trait set live in
  `.claude/skills/writing-in-voice`.
- **Copy states, it does not sell.** One fact per string, said once, at the moment it is load-bearing. Name
  the object and its state rather than the reader (second person is ~5 % of shipped copy — reserve it for the
  user's own property or choice). **No em dashes**: they are absent from the reference corpus, at 0.00 per
  1000 words; a qualifier takes parentheses or a second sentence. Labels run 1–5 words, prose 5–24. Write
  copy through the **writing-in-voice** skill, whose profile is derived from that corpus and is coa's source
  of truth for wording.
- **Selection marker.** A selected option row is an s4 tint + a trailing mono `Current` — one vocabulary in
  every menu, picker, and select.
- **Keybinds are a registry.** One table drives both the dispatch and the shortcuts UI (settings section +
  the quick overlay), so a bind cannot exist without being discoverable. Shortcuts render as kbd chips.
- **Chrome geometry.** The title bar is app surface, segmented per column; sidebar borders run title-bar →
  floor and beat other hairlines; side panels drag-resize between constraints (the right one drag-collapses
  with hysteresis and resurrects in-gesture); the base scale is 1.2 (Electron `setZoomFactor` — pointer→layout
  math divides by it). Scrollbars are boxy, constant-width, palette-stepped — a deliberate, flagged exception
  to "never restyle scrollbars", justified by category convention (VS Code) and constancy.
- **Banners' function, not banners.** Predictive notices (drift, cold cache) surface as one quiet line in
  indicator-law form — dot + name + inline action — **merged into the composer's own rect** above the
  approval gate, the same construction the gate itself uses; they never take the frame and never persist
  past relevance. Severity stays the dot (amber needs-you for drift, ground idle for cache); the warn tint
  says only that attention is due. **The session state owns the shell's edge** — a notice tints it only
  while nothing is running and no gate waits, and never starts the status shimmer. **Flagged deviation:** a
  notice shows one clause of cause permanently, against "detail is proximity, never permanent prose". A
  warning that carries an action must say what happened, or it asks for a decision the reader cannot make;
  the copy law's "at the moment it is load-bearing" wins, and the full paragraph stays on hover/focus.

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
- **Semantic z-index scale.** sticky → modal-backdrop → modal → dropdown → toast → tooltip, as named tokens —
  never arbitrary values. Dropdown ranks above modal deliberately: a select portaled from inside a dialog
  must paint over it.
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

_Last reviewed: 2026-08-01_

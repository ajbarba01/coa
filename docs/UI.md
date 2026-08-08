# UI — Control & Inspection Intent

> Authority for the console's **principles, design laws, and authoring rules**. coa's only GUI is the desktop
> console. The direction is the **conversation-first workbench** on the **sand-dark quiet register**, and it
> replaced an earlier warm-dark "forge" identity — the visual language changed, but the governance machinery
> that identity introduced (per-component intent blocks, tiered tokens, no windowing in the transcript) still
> binds and is restated below.
>
> **Exact token values live in code**, in [`packages/console-kit`](../packages/console-kit): the spacing and
> surface scales, the motion durations, and the status, agent, and focus colors. The kit is the console's **one**
> token substrate — an earlier parallel kit was retired precisely so no surface can lose a collision to a second
> theme. The living reference implementation is the console's own showcase surface, which renders a specimen per
> registered kit member and is enforced by test. The conversation renderer lives in
> [`packages/console-transcript`](../packages/console-transcript): a composite built on the kit, not a kit
> member.
>
> What the console _is_ and how it talks to the daemon lives in [ARCHITECTURE.md](ARCHITECTURE.md). UI
> engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and [CODE_STYLE.md](CODE_STYLE.md).

---

## Standing UI principles

- **Control through the catalogue.** Every interactive action the GUI offers is a daemon JSON-RPC verb, and a
  write that mutates project state lands as a change event through the kernel. The GUI never edits state out of
  band and never reaches into daemon internals directly.
- **Raw mode is sacred, not advertised.** The console can always show the unfiltered loop — reachable from the
  command palette, with a visible indicator only while it is on. Reachability is the guarantee; chrome is not.
  This is the whole reason the governed view is trustworthy: it is a strict superset of the raw one, and the
  reader can check.
- **Catalogue-only, byte-faithful.** The GUI is a second _client_ of the daemon's verb catalogue, not a second
  source of truth. The artifacts it renders (graph, diffs, ledger) are byte-stable and diffable — it presents
  them, it does not recompute or re-interpret them.
- **The only "no" is the daemon's.** The system has exactly one deliberate block — the close gate that refuses
  "done" while an unresolved blocking flag stands — and it arrives through the single deny channel. Spend is
  accounted, never capped. The UI _renders_ a denial; it never invents one.
- **Accessibility floor.** Semantic structure, sufficient contrast, visible focus, full keyboard navigation —
  non-negotiable, re-verified per surface.
- **Honest surfacing.** The user sees **everything**, via progressive disclosure: the critical and high expanded,
  the medium and low collapsed but counted, never hidden. The GUI mirrors that contract rather than editorializing
  it.

---

## Design laws (the register — every surface, every component)

- **Quiet register.** Nothing shouts; if it doesn't need instant attention it isn't instantly apparent.
  Conversation owns the darkest ground; chrome sits one step up. Attention is earned by frequency or
  criticality — never by ideology, never persistently.
- **Indicator law.** State is a **dot** (blue running · amber needs-you · red critical · green done · ground
  idle); magnitude is a **count** (zero renders nothing); text is for names; detail is proximity (hover or
  focus). Accent hues never decorate inactive chrome.
- **Elevation grounds.** In-flow surfaces sit low with no shadow · floating surfaces one step up with a shadow ·
  modals higher still, with a heavy shadow and a scrim. Hairlines step with them: internal, structural, floating
  edge. The in-flow step is a **panel** (header / body / optional footer, never a shadow and never nested) — the
  agent editor's sections are its first consumers. A panel is not a card: it does not float, it does not sit in a
  uniform tile grid, and a selected row's own tint inside it is a tint, not a second surface.
- **Slipstream motion.** Four durations — swift, base, move, enter — expo-out, no more than about 12 px of
  travel, never bouncy. Transitions for interruptible state; keyframes only for mount and unmount, with fill mode
  `backwards` (a filled end-state transform turns the element into a containing block and breaks `position:
  fixed` descendants). Reduced motion collapses everything to instant.
- **Focus.** Keyboard focus is a 2 px ring drawn **inside** the element (`outline-offset: -2px`) so it never
  collides with neighbors or clips inside a scroll container; pointer focus shows nothing (`:focus-visible`).
  Inputs opt out — their container's border step-up is the cue.
- **Dismissal.** One Escape **layer stack** is the kit's single Escape authority: the topmost layer closes first,
  and a popup library's own Escape handling is swallowed so the stack issues it. Menus dismiss on outside
  _pointerdown_; modal scrims guard the backdrop; a portaled menu counts as inside its trigger. A menu that
  escapes a clipping container does so via a portal, and repositions to follow its trigger on scroll and resize.
- **Two glyph vocabularies, one test.** A **typed** mono character (`▣ ⇪ ⌕ ⇄`) rides the text-icon size; a
  **drawn** icon rides an icon box. The label decides which: **a glyph beside a text label is typed; a glyph that
  _is_ the control is drawn.** A named row, menu item, or title-bar button already says what it does, so its mark
  is ornament and belongs in the type stream. An icon-only control carries the whole meaning alone, so it earns a
  drawn mark and a real accessible name — which is why the kit's `Icon` is decorative by default and its label is
  for sole-content use only. Pure ornament inside a field (the search `⌕`) is typed; **status is neither
  vocabulary, it is a dot.** One carve-out: the window controls keep their `─ ▢/❐ ✕` characters, because that
  chrome exists to mirror the platform's own window vocabulary and a drawn icon would read as foreign there.
- **Capitalization is a function of element kind.** Not one case everywhere — the element decides, and then it
  holds without exception. **A command or action is Title Case** (`Remove Profile`, `Check for Updates`); articles
  and prepositions inside it stay lowercase. **A label that names a thing or reports a state is sentence case**
  (`Agent backend`, `No flags`, `Signed in`). **Prose is sentence case and takes a terminal period**; a label
  never does. Everything starts with a capital letter. Measured against roughly 233 000 words of shipped
  interface copy (VS Code, Spotify, Notion, Slack, GitHub Desktop, Docker Desktop): commands run 100 %
  capital-first and 66 % Title Case, state labels 33 % Title, prose 96 % capital-first with 96 % terminal
  periods. The **quiet register is visual, not typographic** — loudness is earned through ground, hue, and
  motion, and lowercasing a button never bought any of it. **An accessible name matches its visible label
  verbatim**; with no visible label it takes the case of what it is — a menu-item-shaped command Title Case
  (`Remove Provider`), a descriptive phrase for an icon-only control sentence case (`Stop the running turn`), a
  field or state sentence case (`Reduce motion`). **Keycap hints stay lowercase** (`esc`, `ctrl+`, `⌥⏎`): they
  name a physical key, not a word.
- **Copy states, it does not sell.** One fact per string, said once, at the moment it is load-bearing. Name the
  object and its state rather than the reader (second person is about 5 % of shipped copy — reserve it for the
  user's own property or choice). **No em dashes**: they are absent from the reference corpus, at 0.00 per 1000
  words; a qualifier takes parentheses or a second sentence. Labels run 1–5 words, prose 5–24. Write copy through
  the **writing-in-voice** skill, whose profile is derived from that corpus and is the source of truth for
  wording.
- **Selection marker.** A selected option row is a tint plus a trailing mono `Current` — one vocabulary in every
  menu, picker, and select.
- **Keybinds are a registry.** One table drives both the dispatch and the shortcuts UI (the settings section and
  the quick overlay), so a bind cannot exist without being discoverable. Shortcuts render as kbd chips.
- **Chrome geometry.** The title bar is app surface, segmented per column; sidebar borders run title bar to floor
  and beat other hairlines; side panels drag-resize between constraints, and the right one drag-collapses with
  hysteresis and resurrects in-gesture. The app runs at a base zoom above 1, so any pointer-to-layout math
  divides by it. Scrollbars are boxy, constant-width, and palette-stepped — a deliberate, flagged exception to
  "never restyle scrollbars", justified by category convention and by constancy.
- **Banners' function, not banners.** Predictive notices (drift, cold cache) surface as one quiet line in
  indicator-law form — dot, name, inline action — **merged into the composer's own rect** above the approval
  gate, the same construction the gate itself uses. They never take the frame and never persist past relevance.
  Severity stays the dot (amber needs-you for drift, ground idle for cache); the warn tint says only that
  attention is due. **The session state owns the shell's edge** — a notice tints it only while nothing is running
  and no gate waits, and never starts the status shimmer. **Flagged deviation:** a notice shows one clause of
  cause permanently, against "detail is proximity, never permanent prose". A warning that carries an action must
  say what happened, or it asks for a decision the reader cannot make; the copy law's "at the moment it is
  load-bearing" wins, and the full paragraph stays on hover or focus.

---

## Authoring rules (read before writing any console UI)

- **Design through Impeccable.** Any agent designing, critiquing, or polishing console UI invokes the
  **impeccable** design skill (product register — design serves the product) as its design engine before pixels.
  Its general rules (contrast verification, state completeness, dropdown clipping, the absolute bans) apply here;
  where it and this doc disagree, **this doc wins** — our deviations are flagged decisions, not oversights (the
  constant-width scrollbars above deliberately override its no-custom-scrollbars ban).
- **Build from the kit, never hand-roll.** Every control, surface, and piece of feedback is a kit component. If
  nothing fits, add a member **to the kit** with its lint-enforced intent block (Intent / Use-it-when /
  Don't-use-it-when / Anatomy / Variants & States / Accessibility / Related); do not inline a bespoke component
  inside a panel. A panel is kit composition plus a pure selector, with no styling of its own.
- **No raw values.** No literal hex, px, rem, duration, radius, or z-index in a component — every one comes from
  a token. Three sanctioned exceptions exist, each flagged in a comment where it lives, and the set is closed —
  a new one is a design decision, not a shortcut: a main-process pixel match (the title bar height); a
  third-party brand mark (`packages/console-kit/src/brand/BrandMark.tsx`) wearing its own color because on a
  credentials surface the logo _is_ the identity, and identity is never state — the hex lives on a descriptor,
  never a token, dimmed rather than recolored when a provider is benched; and the chart series palette
  (`packages/console-kit/src/themes/sand-dark.css`), a validated three-color set (lightness band, chroma floor,
  colorblind separation, contrast) kept deliberately disjoint from the four status hues so a spend segment can
  never read as a warning.
- **Every state ships.** default · hover · focus-visible · active · disabled · loading · empty · error.
  "Unpolished" almost always means "an unhandled state". Every clickable has its own hover _and_ press, and shows
  no hover when disabled. This is the graduation checklist for moving a prototype specimen into the kit.
- **A theme is a scale swap at full quality.** A new theme replaces the whole surface scale and status set to the
  same bar as sand-dark — never a partial recolor. Density and motion are token axes, not per-component
  decisions.
- **Semantic z-index scale.** sticky → modal backdrop → modal → dropdown → toast → tooltip, as named tokens,
  never arbitrary values. Dropdown ranks above modal deliberately: a select portaled from inside a dialog must
  paint over it.
- **Two Chromium gotchas.** Don't set the standard `scrollbar-width` / `scrollbar-color` in the Chromium path —
  it disables all `::-webkit-scrollbar` styling, so the standards-track fallback is scoped behind an `@supports
  not selector(::-webkit-scrollbar)`. And keep the title bar's CSS height in lockstep with the constant the main
  process uses.
- **The transcript is not virtualized.** Every frame stays in the DOM, because full-transcript selection and
  in-page find both require every row present; rows are memoized so a streamed frame re-renders only the one it
  appended. Paint containment (`content-visibility`) is deliberately _not_ used — it clips a row's children to
  the row box and cuts off the tool card's intentional bleed. Reach for virtualization only when unbounded length
  actually costs more than losing selection and find.
- **The showcase is the living spec.** Every primitive and every state renders in the showcase surface; critique
  and harden there before a component graduates into the kit.

---

_Last reviewed: 2026-08-08_

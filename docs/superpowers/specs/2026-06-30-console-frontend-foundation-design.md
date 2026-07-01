# Spec: Console frontend foundation — design system, app shell & layout architecture

_Status: draft for maintainer review · Authored: 2026-06-30 · Owner module: M10 Console (`apps/desktop`, new)_
_Process: brainstorming COMPLETE + design APPROVED (interactive session, research-grounded, visual direction locked
in the companion). This is a **design-only foundation pass** — no console feature code is built here. Next gate:
writing-plans → TDD._

## 1. Problem

M10 (the Console) is the last module and, as the maintainer put it, "basically an entire other system." Before any
console surface is built we need the **frontend foundation**: a cohesive design-token system, a standardized
component library with declared usage intent, the professional craft standards that lift it from "a set of
components" to an elegant app, the responsive/motion behavior, the native cross-platform feel, and the app-shell +
layout architecture that lets surfaces be created and rearranged cheaply. [UI.md](../../UI.md) deliberately deferred
all of this ("the rendering layer, styling/token system, whether a component kit is warranted, theming, layout" —
"decided at M10"). This spec makes those decisions, grounded in research rather than guessed, so we don't pay for a
UI refactor later.

**This is a foundation, not a feature build.** It defines the system every future surface is built from. The
surfaces themselves (chat, agent config, graph, etc.) are their own later specs; several depend on M8 backend seams
that do not exist yet (§12).

## 2. Goal / non-goals

**Goal.** A basic-but-complete, professionally-grounded frontend foundation for the M10 desktop console: principles
→ tokens → component families → motion/responsive → native/parity → app-shell → layout architecture → surface IA →
locked visual direction. Complete enough that the first surfaces drop onto it without rework; basic enough that we
ship v1.

**Maintainer's eight goals (the brief), made enforceable as principles P1–P12 (§5):** cohesion via tokens; modular
component families; per-component usage intent; researched professional craft; motion-as-feedback + dynamic UI;
never-weird responsiveness; native (not web-in-a-frame) feel; cross-platform parity (macOS + Windows); avoid
AI-slop; **plus** dense/complex content (prompts, transcripts, graphs) as a first-class problem, and composable
engine-agnostic panels ("easily rearranged, like VS Code").

**Non-goals (explicitly out of this pass):**
- **No surface feature builds.** No chat, agent-config, graph, timeline, ledger *feature* code. This pass builds the
  system and (per §12) a mock-fed shell that proves it.
- **No new M8 verbs / backend seams.** M10 talks only to M8's catalogue (SPEC §M10). Where a surface needs a verb
  that does not exist, that verb is its own later spec, not invented here.
- **No docking engine.** The layout abstraction ships with a static engine; full drag-to-dock (dockview) is a
  deferred, drop-in upgrade (§11).
- **No light-theme fine-tuning yet.** Both themes are architected from day one; dark is tuned first, light's exact
  values are a build-time tuning task (§6.3).

## 3. Invariants preserved (Constitution / SPEC §B / UI.md)

- **SC-1 — help, never cage.** The console adds **no block**. The only two blocks stay M3's Type-1 close-gate and
  M7's cost-cap, surfaced through M9's single deny channel. A dedicated `DenyNotice` component family member (§7)
  encodes this so the UI cannot drift into caging. ✔
- **Strict-superset / `coa raw` sacred (D85).** The unfiltered loop is always reachable (a persistent `raw` affordance
  in the title bar). ✔
- **M10 is a leaf; talks only to M8 (SPEC §M10).** Every interactive action is an existing/future M8 verb; every
  write funnels through the daemon → `M1.emit`. The GUI computes nothing authoritative and reaches into no other
  module. ✔
- **Byte-faithful renders (D128).** Diffs/prompts/metrics render exactly as the bytes — no silent
  truncation/normalization/recompute. Verbatim copy is sourced from canonical bytes, not DOM selection (§6.4 note,
  §11.4). ✔
- **Determinism-first (P1).** The console is a pure client; no model call on any path it owns. ✔
- **No-lock-in.** The layout descriptor is a neutral, coa-owned schema (not a library's), mirroring the "M9 is the
  one backend seam" philosophy applied to layout (§11). ✔
- **Typed boundaries (Zod at the edges).** IPC payloads and the persisted layout descriptor are validated with Zod;
  M0 owns shared schemas. ✔
- **Pure-core / testable seams.** The daemon-result→props view-model is a pure package, unit-tested without launching
  Electron (§10.3). ✔
- **Renderer-isolation (D128).** The Electron renderer is sandboxed and context-isolated; privileged work happens on
  the trusted main side (§10). ✔
- **Push posture (Ruling-12 RESHAPE).** The console pulls and pushes freely in service of what the user is actively
  viewing; the only restraint is unsolicited ambient *alerting* (silent, opt-in, cap-hit + high-severity). The
  always-on push-dashboard stays deferred. ✔

## 4. Stack decision

**Electron + React (D114), desktop-only, renderer-isolated (D128).** On top of that:

- **Design tokens as CSS custom properties**, three-tier (primitive → semantic → component), themeable at runtime.
- **Tailwind CSS configured *from* the tokens** — Tailwind's theme reads `var(--…)`; utilities are an internal
  implementation detail of components, never sprayed across surfaces. Tailwind does not define the scales; the tokens
  do.
- **Custom, in-repo component library** (not a copy-pasted kit) — we own look, families, intents, native feel,
  anti-slop.
- **Radix UI headless primitives** underneath for accessible behavior (focus, keyboard, ARIA, dismissal) — compose
  the a11y floor, don't hand-roll it.
- **Build:** `electron-vite` (renderer/preload/main) + `electron-builder` (packaging/signing/auto-update). Native
  addons live in **main only**, rebuilt for Electron's ABI (renderer loads none).
- **Icons:** Lucide (single consistent stroke, tree-shaken, one wrapped `<Icon>`). Emoji are banned from UI strings.
- **Key libraries (grounded, §20):** `react-virtuoso` (virtualized transcript/long-docs), React Flow + Dagre (graph,
  semantic zoom; Sigma.js documented fallback >~5k nodes), `react-resizable-panels` (MVP resizable regions),
  **dockview** (deferred docking upgrade target), Zod (edge validation).

## 5. Design principles (P1–P12)

Binding philosophy; every later choice traces to one.

```text
P1  Cohesion via constraint     No raw values. Every color/space/radius/duration/size is a token reference.
P2  Component families          Related components share structure/sizing/state so they compose as an intentional set.
P3  Declared intent             Every component + token records when-to-use / when-not — the connective tissue.
P4  Researched craft            Elevating details (grids, scales, contrast, motion) are grounded, not improvised.
P5  Motion is feedback          Every action has an immediate visible consequence; motion communicates, never decorates.
P6  Never-weird responsive      Holds together at any window size AND any panel arrangement; fluid, rule-governed.
P7  Native, not web-in-a-frame  Desktop conventions, density, chrome, typography — not a website in Electron.
P8  Cross-platform parity       macOS + Windows feel like one app; per-OS differences are deliberate + documented.
P9  No AI-slop                  Actively avoid templated tells (gradient surfaces, glassmorphism, emoji-icons, etc.).
P10 Honest disclosure           Deep internals surfaced via progressive disclosure (never a walled-off debug mode);
                                coa raw always reachable; one developer-detail density toggle.
P11 Dense content is first-class Long-form prompts, transcripts, and graph viz are the hard problems the system is
                                designed around, each on a researched professional footing — not styled afterthoughts.
P12 Composable engine-agnostic   Surfaces are layout-agnostic panel modules in a registry; arrangement is a
    panels                       serializable descriptor consumed by a swappable engine; adjustability is a per-region
                                 dial (static/resizable/dockable); static loses zero functionality.
```

## 5.1 Professional composition principles (the composition-craft tier)

_The P4/P11 craft tier — how a designer **composes**, not which values to use; this is the layer that makes a
layout read as designed rather than assembled. Research-grounded (Müller-Brockmann *Grid Systems*, Refactoring UI,
NN/g Gestalt, Tufte data-ink, Butterick, Rams, Linear). Binds every surface layout._

```text
1  Pane-scoped 12-column grid   Compose dense views on a 12-col grid INSIDE content panes (8+4 stream+detail,
                                4+4+4 metric cards, 3+9 nav+form); gutters on the 8pt system. Panes themselves are
                                sized by function/resize, not a window-wide 12-track. (The key desktop adaptation.)
2  Baseline / vertical rhythm   Snap type + spacing to one shared baseline (8pt, 4pt for line-height) so density
                                reads ordered, not ragged.
3  Three levels, one primary    Exactly three hierarchy levels per view + one primary action; combine hierarchy
                                levers (size OR weight OR color), stack all three only on the single focal element.
4  Hierarchy by de-emphasis     Make secondary/tertiary content quieter rather than the primary louder.
5  Proximity over borders       Group by whitespace first; lightest separator that works — space → tint → divider
                                → border → box ("when in doubt, remove the border"). Watch false-floor containers.
6  Few edges; optical alignment Hold rows to a few hard edges; nudge glyphs + equalize icon visual weight by eye
                                (overshoot, play-triangle) — optical correction is part of "done."
7  Asymmetric balance; space    Default weight-balanced asymmetry (wide pane + narrow rail); micro-whitespace tight,
                                macro-whitespace generous — the key calm-and-dense lever.
8  Hue-shifted secondary text   De-emphasized text steps toward the warm bg in HUE, never flat grey — and never
                                below WCAG AA 4.5:1 (ties de-emphasis to the a11y floor).
9  60-30-10; brass ~10%         Neutral warm-dark dominates; brass stays ~10%, reserved for the primary action and
                                the cost-cap / close-gate signals (coa's only two hard blocks).
10 Maximize data-ink           Erase gridlines, redundant borders, zebra+box double-cues, chartjunk; show the data,
                                not the chrome. Small multiples (mini-sparkline rows) for comparison. (Tufte.)
11 Systematize                 One card / table / row / action-placement pattern, reused across every pane.
12 States-first = done         Design empty / loading / error / overflow with real content BEFORE the happy path —
                                for an audit tool these states are the credibility.
13 Restraint — boldness once    One bold move per screen; remove one "accessory" from every finished view.
14 Meaning-bearing structure    Numbering / eyebrows / dividers only where a real sequence or group exists —
                                "structure should be felt, not seen"; no decorative rules.
15 Signature                   Disciplined forge + brass + calm-density IS the signature (no extra coined motif);
                                execution quality is the differentiator.
16 Everything is a budget       Contrast, color, motion default LOW; spend deliberately on what the operator must
                                not miss.
```

**Explicit density value:** coa targets **dev-tool density** — dense, matched to a professional developer audience.
A stated design value, not a default to be "corrected" toward airy consumer spacing.

## 6. Design tokens

### 6.1 Three-tier architecture
- **Tier 1 — primitives** (raw values, never used directly in components): OKLCH palette ramps, raw spacing steps,
  raw radii.
- **Tier 2 — semantic/alias** (intent-named, the *only* tier components consume): `--color-bg-base`,
  `--color-fg-muted`, `--space-inset-md`, `--radius-control`, …
- **Tier 3 — component tokens** (scoped, sparing): `--button-padding-x`, …

Implemented as CSS custom properties on `:root`, with `[data-theme]` (light/dark) and `[data-density]`
(comfortable/compact) overrides. Tailwind's theme maps to these vars. The token map is unit-testable (assert every
semantic token resolves).

### 6.2 Concrete scales (grounded — see §20)

```text
Spacing (hybrid 4pt-base / 8pt-rhythm; "1 unit" = 8px; 2–4px for dense tables/toolbars)
  0 · 1px · 2 · 4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64   (rem, base 0.25rem)

Type (base 13px — VS Code/Figma native density; Major-Third 1.25 headings)
  sizes  11 · 12 · 13(body) · 14 · 16 · 20 · 24        code 12 · 13
  line-h 1.25 headings · 1.5 UI · 1.55 code · 1.35 dense
  weight 400 · 500(default emphasis) · 600(headings/active)   700 is too heavy at 13px
  track  -0.01em headings ≥20px · 0.04em all-caps micro-labels · 0 body (never letter-space body)

Radius (tight/native)  3 · 4(control default) · 6(surface) · 8(overlay) · full(pill)
Z-index (named bands, gaps of 100)  base 0 · raised 10 · sticky 100 · dropdown 200 · overlay 300 ·
                                    modal 400 · popover 500 · toast 600 · tooltip 700 (tooltip outranks modal)
Elevation  light: 2-layer subtle shadows (xs/sm/md/lg).  dark: elevation = lighter surface + faint edge, not shadow.
Motion durations  instant 70 · fast 120 · normal 180(default) · slow 260 · slower 400 (ms); scales with travel
Motion easing (Carbon "productive")  standard cubic-bezier(.2,0,.38,.9) · entrance (0,0,.38,.9) · exit (.2,0,1,.9)
                                     springs ONLY for interruptible/gesture motion (panel resize)
Opacity  disabled .5 · muted .7 · scrim .5 · hover-overlay .06
Border   1px default · 2px emphasis/focus
Focus    real `outline` + 2px width + 2px offset (survives Windows High-Contrast; box-shadow does not);
         honor OS accent on macOS; :focus-visible only

Fonts
  --font-ui:   -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Menlo, Consolas, monospace
               (bundle JetBrains Mono as the deterministic fallback for verbatim surfaces)
```

### 6.3 Color system
- **Primitives authored in OKLCH** (perceptually-uniform ramps; a neutral ramp + brass accent + status hues, each
  50–950).
- **Semantic roles follow Radix's 12-step model** (app-bg → subtle-bg → element / hover / active → border / hover →
  solid-accent / hover → low-contrast text → high-contrast text). Adopt Radix's pre-tuned dark + light scales as the
  starting point; layer coa-specific **syntax** and **diff** tints on top.
- **Dark mode is a deliberate palette, not an inversion.** Elevation is expressed by *lighter surfaces*, shadow only
  crisps the edge.
- **Semantic role token set:** bg (base/subtle/surface/raised/overlay + element/hover/active) · fg
  (default/muted/subtle/on-accent) · border (subtle/default/strong) · accent (solid/solid-hover/text/bg) · status
  (success/warning/danger/info, each tint/solid/text) · focus-ring · selection · syntax-* · diff-add/del.

### 6.4 Contrast
**WCAG 2.2 AA is the hard gate; APCA is the design lens.** Targets: body/code text ≥ 4.5:1 (APCA aim Lc 75–90);
secondary ≥ 4.5:1 (or 3:1 if ≥18.66px bold); large headings ≥ 3:1; borders/icons/controls ≥ 3:1 (SC 1.4.11); focus
≥ 3:1 + ≥ 2px (SC 2.4.13). **AA (4.5:1) not AAA** for body — AAA glares at 13px on dark.

### 6.5 Theming & density
Ship **light + dark from day one** (Radix provides both scales; both needed for true parity); **dark tuned first**,
light's exact values a build-time tuning task. The P10 **density toggle** is a `[data-density]` variant that remaps
spacing/type-step tokens — it does not fork components. 13px is the native-dense default; comfortable = 14px.

## 7. Component families + intent contract

Taxonomy (Polaris/Carbon/Primer/Spectrum-shaped, fitted to an audit console):

```text
Foundations   tokens · icon set (Lucide) · motion — one owner, everything derives from it
Actions       Button (primary/secondary/tertiary/danger) · ButtonGroup · Link · Menu (Radix) · IconButton
Inputs        TextField · Select · Combobox · Checkbox · Radio · Switch · Form/Field  (Radix under the hood)
Layout        AppShell (title bar+rail+panes) · Pane · Sidebar/NavList · Divider · Toolbar · ResizableSplitter
Data-display  Table/DataTable (ledger/decisions/timeline) · List · KeyValue · Code/Mono · Badge/Tag · Stat
Feedback      Banner(persistent) · Toast(transient) · InlineMessage · Progress/Spinner · Skeleton · EmptyState ·
              DenyNotice  ← coa-specific: the SC-1 single-deny-channel surface (close-gate / cost-cap)
Overlays      Dialog/Modal · Popover · Tooltip · Sheet/Drawer  (Radix Dialog/Popover/Tooltip)
Dense/Viz     Longform/PromptView · Transcript · DiffView · Graph (React Flow) · Timeline  (the P11 family)
```

**Intent contract (P3):** every component ships a **lint-enforced doc block** — `Intent` (one sentence) ·
`Use it when` / `Don't use it when` (the governance lever) · `Anatomy` · `Variants & States` (incl. required
rest/hover/active/focus/loading/disabled/error/success) · `Accessibility` (keyboard model, focus, labeling) ·
`Related` (which family to reach for instead). A component cannot merge without it.

## 8. Motion, feedback & responsive

- **Register:** Carbon "productive" — fast, restrained, no bouncy overshoot (which reads as slop in a governance
  tool). Durations/easings per §6.2.
- **Feedback contract (P5):** every interactive element expresses rest/hover/active/focus/loading/disabled/
  error/success (a lint-able test matrix). Press fires on `pointerdown`, not click, so feedback precedes the handler.
- **Correctness rule:** **optimistic UI only for purely-local actions.** Anything the daemon can *deny* (deny
  channel, cost-cap) shows explicit pending+confirm — never "allowed-then-yanked" (SC-1).
- **Loading triage:** <1s none/optimistic · ~1s inline spinner · 2–10s skeleton for regions · >10s determinate
  progress. Skeletons for structured panes (timeline/ledger/decisions), spinners for single modules.
- **Reduced-motion:** "reduce ≠ none" — swap transforms for opacity/color, never delete meaningful feedback; honor
  the OS query **and** an in-app toggle feeding one `motion-enabled` switch.
- **Responsive (P6): container-query-first.** Each pane is its own `container-type: inline-size` context; in-pane
  components adapt to the pane's actual width, not the window's — the mechanism that keeps the UI legible at any
  splitter position. Media queries only for the window shell. Fluid type/space via `clamp()` (Utopia-generated,
  frozen as tokens, in `rem`). Intrinsic grids (`auto-fit`/`minmax`) for tile collections. Min-content floors so
  content never crushes.
- **Property allowlist:** animate `transform` + `opacity` only; animating `width/height/top/left` is a bug.

## 9. Native feel & cross-platform parity

- **Native counters (P7):** `cursor: default` (pointer only for real external links) · `user-select: none` on chrome
  (selection re-enabled in log/ledger/code content) · system fonts · real OS menu bar + accelerators · ⌘, →
  Preferences (macOS) · show window on `ready-to-show` + persist geometry · no bounce-scroll on panes.
- **Parity (P8):** identical IA / component behavior / tokens; **per-platform chrome only**. **Custom title bar**
  (confirmed): macOS `titleBarStyle: 'hidden'` with native traffic lights + `trafficLightPosition` and a ~78–80px
  left safe-area inset; Windows `titleBarOverlay { color, symbolColor, height }` with a right inset from
  `env(titlebar-area-*)`; `-webkit-app-region: drag` on the bar, `no-drag` on controls. A `platform:'darwin'|'win32'`
  flag is injected main→renderer so layout applies insets without touching `process`.
- **Density:** 13–14px body; multi-pane by default (an audit console — density is a feature).

## 10. App-shell architecture

### 10.1 Secure Electron baseline (D128 renderer-isolation)
`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, a preload bridge, and a
restrictive CSP with **`connect-src 'none'`** (local-first; all data flows through IPC — also an anti-exfil control).
`@electron/fuses` off unused features at package time; `electronegativity` in CI.

### 10.2 Three-layer seam
```text
1. Transport (MAIN)     JSON-RPC pipe client → daemon (M8). Lives only in main. Holds the connection.
2. Bridge   (PRELOAD)   one contextBridge method per IPC channel (coa.getCap(), coa.subscribeTurns(cb), …);
                        Zod-validated both directions; NO raw ipcRenderer exposed.
3. View-model (RENDERER, pure)  daemon JSON-RPC result → render props. No Electron/window import.
                        Lives in a standalone pure package (packages/…) → unit-tested in Vitest, no Electron launch;
                        a dependency-cruiser rule forbids it importing Electron.
```

### 10.3 Daemon process model (confirmed)
Opening the desktop app **connects to a running daemon over the pipe, and auto-spawns `coa serve` if none is
running** — the peer-client model (same as the CLI, SPEC §M10). Native addons (`better-sqlite3`) stay entirely out
of Electron; the daemon outlives the GUI.

### 10.4 Build
`electron-vite` (main/preload/renderer, correct native externals, HMR) + `electron-builder` (signing/auto-update).
Native modules rebuilt for Electron's ABI, **main-process only**. Electron version + native-module versions pinned
together; rebuilt on upgrade in CI.

## 11. Layout abstraction (P12)

Prior art (VS Code `SerializableGrid`, dockview `{grid,panels}`+components map, FlexLayout model+factory,
golden-layout) validates the separation: **panel content (id → registry) · arrangement (serializable descriptor) ·
engine**. Making adjustability itself swappable is the extension coa adds. **Four day-one seams; nothing else
docking-related:**

### 11.1 Panel registry
```text
PanelDefinition<VM> = { id; displayName; render: Component<{vm; host: PanelHostApi}>;
                        selectVm: (daemonState) => VM;  // pure, unit-testable
                        defaultConstraints? }
PanelRegistry = { register(def); resolve(id); has(id) }
```
Panels are pure view modules; they never import the engine or the descriptor. `PanelHostApi` (title, visibility
events, requestFocus) is a strict **subset of dockview's panel api** so today's panels work under dockview tomorrow.

### 11.2 Layout descriptor (neutral, versioned, Zod-validated)
A tree of regions; each leaf carries a `panelId` + geometry + a per-region
`adjustability: 'static'|'resizable'|'dockable'` dial. Shaped deliberately close to dockview's `{grid,panels}` so a
future adapter is a tree-walk. `version` + a migration ladder; **validate-or-fall-back-to-default; always drop an
unknown `panelId` rather than throw** (persisted layout = untrusted input — a real dockview corruption class).
Persisted **per-workspace by the daemon/main** (single source of truth), `react-resizable-panels` used in *controlled*
mode.

### 11.3 Engine port
```text
LayoutEngine  = { id; supports: Set<Adjustability>;
                  mount({descriptor, registry, onChange}) => LayoutHandle }
LayoutHandle  = { serialize(); applyDescriptor(d); focusPanel(id); dispose() }
```
The engine is the *only* place that knows whether arrangement is mutable. This is the one seam painful to retrofit, so
it exists day one even behind a single engine.

### 11.4 MVP engine + upgrade (confirmed)
**MVP = a hand-rolled `StaticEngine`** (CSS grid/flex fixed regions) **+ `react-resizable-panels`** for the resizable
region(s) (the chat pane). No docking dependency shipped. **Upgrade target = `DockviewEngine`** (implement the port
against dockview, register the same registry as its components map). Panels + descriptors unchanged. Per-region dial
MVP value = all `static` except chat (`resizable`).

### 11.5 Accessibility
`react-resizable-panels` gives WAI-ARIA window-splitter compliance for free in MVP (role=separator, arrow-key resize,
value attrs); label splitters via `aria-labelledby` to the pane heading. Static regions correctly have no splitter.
The dockview upgrade turns on its AccessibilityModule (LiveRegion + keyboard docking). `focusPanel` ships in the
handle from day one.

### 11.6 Plan-3 concretization (locked)

The layout core ships as a standalone package **`@coa/console-layout`** (`packages/console-layout`). It renders React
so it is not "pure," but it is **Electron-free and jsdom-unit-testable**, mirroring the console-viewmodel/console-ui
split (a `console-layout-no-electron-core` dependency-cruiser rule enforces it). It stays **generic over the panel
view-model**: it imports `react` + `react-resizable-panels` + `zod` only — never `console-ui`, `console-viewmodel`, or
`core`. Concrete panels (which import the UI kit + view-model selectors) are the shell's job, not the core's.

- **Descriptor schema home = console-local, not M0.** The versioned `LayoutDescriptor` Zod schema and its migration
  ladder / drop-unknown-panelId logic live in `console-layout`. The descriptor is a console-only concept (panelIds,
  geometry, adjustability); the daemon persists it **opaquely** and the console **validates-on-read** at its edge. This
  keeps M0 pure to its cross-module wire-type charter while honoring "validate the persisted layout with Zod."
- **Region model.** A descriptor is `{ version, root }` where `Region = Leaf | Split`; the `adjustability` dial lives on
  the **split** region (the node that owns the boundary between its children), mapping 1:1 onto a
  react-resizable-panels group. `StaticEngine.supports = {static, resizable}`; a `dockable` region **degrades to
  resizable** (never loses functionality).
- **Engine port is imperative** — `mount({container, …}) => LayoutHandle` (the engine owns its React root), matching
  dockview's imperative api + `dispose()`, so it is a true swappable seam rather than a React component.
- **Plan-3 scope = the four seams + StaticEngine + tests**, including the serialize/parse/migrate machinery (the
  validation half of persistence). **Deferred to the shell plan:** concrete panels, the daemon persistence verb +
  per-workspace storage + IPC wiring, and the `apps/desktop` consumption (vite alias / tsconfig reference /
  `globals.css` `@source`). **Deferred to its own spec:** `DockviewEngine`.

## 12. Surface inventory & information architecture

**Three zones (D128)** + surrounding own-UI-parts, mapped to backend readiness:

```text
Zone / surface            what                                          backend status
Conversation pane (CHAT-*) chat you drive the agent in                   raw-tokens FLOOR now; structured stream
                                                                          needs unbuilt seams (turn producer, R-7
                                                                          store, CON-PUSH, `coa run`)
Dashboard rail   (CON-*)   urgency-ordered cost/cap · flags(CF-1) ·       BUILDABLE NOW (capState, flagsForUser)
                           constraints · status
Approval surface (CHAT-3)  event-driven permission/approval cards         needs unbuilt seams (approval Push,
                                                                          respondApproval)
Decision log               why / getDecision                             BUILDABLE NOW
Timeline / checkpoints     listTimeline (+ rewind)                       mostly now (read exists; rewind verb TBD)
Account selector           auth verbs                                    BUILDABLE NOW
coa raw · Settings         transparency view · theme/density/motion       BUILDABLE NOW (pure client)
Agent config / creation    Roles + Pieces                                needs unbuilt verbs (listRoles/writeRole…)
Compiled-prompt view       byte-faithful long-form (P11)                 needs an M8 read over M5 compiled output
Graph / scope viz (VIZ-*)  React Flow                                    needs unbuilt graph read verbs
Model-usage / cost detail  ledger                                        partly (cap now; ledger-entries verb TBD)
```

**Shell:** custom title bar · slim left nav rail · account/session context · global command surface · persistent
`raw` escape · settings.

**Build posture (confirmed): mock-first full shell.** Build every panel — including chat/approvals/agent-config/graph
— with not-yet-wired ones rendering realistic mock data, so the whole product is navigable immediately and the design
system is validated against every surface type. Each panel swaps mock→real M8 verb (a one-line data-source change,
via the registry + view-model seam) as its backend lands. This is the D85 degrade-to-floor console: the buildable-now
set is genuinely runnable; the rest is honest mock until its seam exists.

## 13. Visual direction (locked)

**Identity: warm-dark "forge / ledger"** — a dim workshop at night, cream worklight on paper, brass spent only on
identity + live/active/governance moments. (Grounded in coa's subject: a tool that watches work being forged and
keeps an honest ledger of it — chosen over the generic "cream-bg + terracotta" and "near-black + acid accent"
defaults, and deliberately off Claude's signature orange.)

```text
Dark theme (tuned first)
  bg-base #14100d · subtle #1b1511 · surface #221a15 · raised #2c211b · border #3a2c24 · hair #2e231d
  fg-default #ece0d0 · fg-muted #a89180 · fg-faint #6e5d50
  accent (brass) #c39a3e            ← identity + live/active/governance emphasis ONLY
  status (independent of accent): danger #c0432f · warning #cf9a4e · success #7c9a6b
```

**Shell = direction B** (conversation-centric three-zone): custom title bar → slim icon nav rail → dominant
conversation pane → right urgency-ordered dashboard rail. ASCII skeleton:

```text
┌─ traffic lights ── co·a  myproject ───────────────── ● Pro·acct-1 ─ raw ┐
│ nav  │  conversation · turn 12 · ●running          │ Cost               │
│ rail │  you  ▁▁                                     │  $2.14 / $5.00 ▔▔  │
│ ◧    │  agent ▁▁▁▁▁▁                                │────────────────────│
│ ◧    │   └ subagent·review  ▁▁▁                     │ Flags        [3]   │
│ ◧    │  agent ▁▁▁▁                                  │ ‖crit ▁▁  ‖ ▁      │
│      │  ┌ Message the agent… ─────────────────────┐ │────────────────────│
│  ⚙   │  └──────────────────────────────────────────┘│ Status ●running    │
└──────┴──────────────────────────────────────────────┴────────────────────┘
```

Wireframes (shell A/B, warm re-skin, accent + brass exploration, compiled-prompt dense surface) were explored
interactively in the visual companion; the mockup HTML lives in `.superpowers/brainstorm/` (gitignored scratch, not
committed). The decisions above are the durable record.

## 14. Anti-slop charter (P9)

No gradient surfaces · no glassmorphism / decorative blur · **one restrained accent** (brass), neutrals carry the UI ·
tinted (not pure-grey) neutrals; secondary text moves toward the bg hue · overhead-light shadows, never the framework
default · one consistent radius scale · **Lucide icons, never emoji** (banned in labels/statuses/empty states) ·
left-aligned density, not centered heroes · **design empty/loading/error states first**. Encoded in tokens + lint so
neither human nor AI-assisted contributions regress.

## 15. Accessibility floor (re-verified per surface)

Semantic structure · sufficient contrast (§6.4) · **visible focus** (real `outline`, survives Windows High-Contrast) ·
**full keyboard navigation** (Radix behavior + WAI-ARIA splitter for panes) · reduced-motion honored (§8) · redundant
encoding (never color alone — pair with icon/shape/label), including colorblind-safe viz palettes (**Okabe-Ito**
categorical + **Viridis** sequential, enforced in shared chart/legend components).

## 16. Build sequencing & the no-refactor guarantee

The foundation seams (tokens, component families, app-shell, the four layout seams, the view-model package) are built
first and are all unit-testable without Electron. Surfaces then attach: buildable-now surfaces wire to real M8 verbs;
chat/approval/agent-config/graph render mock data until their M8 seams (their own later specs) land, then swap
mock→verb via the registry — **no shell or panel refactor**. The docking engine is a later drop-in against the
existing port. This is the no-refactor guarantee that justified doing the foundation first.

## 17. Testability

- **View-model package** — pure daemon-result→props mapping, unit-tested with fixture JSON-RPC payloads.
- **Layout core** — registry, descriptor Zod parse/migrate/drop-unknown, `StaticEngine` — unit-tested, no Electron.
- **Token map** — assert every semantic token resolves in both themes/densities.
- **IPC bridge** — Zod schemas tested both directions.
- **Component intent blocks** — lint-enforced presence.
- Full-app smoke (Playwright-for-Electron) is off the unit path, added later.

## 18. Open decisions / deferred

- **Docking engine (dockview)** — deferred; port + neutral descriptor make it a drop-in.
- **Light-theme exact values** — architected now, tuned at build.
- **CHAT-\* / approval / agent-config / graph / compiled-prompt / ledger surfaces** — designed here at the IA/mock
  level; each real build is its own spec gated on its M8 seam.
- **Bundled display typeface** — system-font-only for body/UI (native); at most one distinctive face for the wordmark
  only, decided at build.
- **Sigma.js graph fallback** — only if real graphs exceed ~5k visible nodes.

## 19. Same-commit doc obligations

When implementation begins: **scaffolding `apps/desktop` updates [REPO_LAYOUT.md](../../REPO_LAYOUT.md) in the same
commit**; the pure view-model + layout packages update the logical→physical map + the dependency-cruiser ruleset in
the same commit; and **[UI.md](../../UI.md)'s placeholder is replaced by the real design-system doc** (this spec's
durable content) when the first console code lands.

## 20. Grounding / references

Design systems: Radix Colors (12-step, OKLCH, dark scales) · Tailwind v4 (OKLCH, spacing/type/radius/shadow) · IBM
Carbon (2x-grid/spacing, motion productive/expressive) · Material 3 (elevation, motion tokens) · GitHub Primer
(z-index bands, ActionList composition) · Adobe Spectrum (adaptive dark, token taxonomy) · Atlassian (elevation,
foundations→components→patterns) · Shopify Polaris (families + intent). Platform: Apple HIG · Microsoft Fluent 2 ·
Electron security checklist / context-isolation / custom-title-bar / native-modules. Craft: Refactoring UI ·
Butterick's Practical Typography · Linear redesign writeups · Emil Kowalski (motion). A11y/contrast: WCAG 2.2
(1.4.11 / 2.4.13) · APCA · WAI-ARIA Window Splitter. Dense/viz: react-virtuoso · React Flow / Dagre / Sigma.js ·
Okabe-Ito · Viridis · ColorBrewer · Carbon Data-Viz. Layout: VS Code `SerializableGrid` · dockview · FlexLayout ·
golden-layout · react-resizable-panels. (Full URLs captured in the four research briefs produced during
brainstorming.)

---

_Last reviewed: 2026-07-01_

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
  validation half of persistence). **Deferred to the shell plan:** concrete panels, layout persistence +
  per-workspace storage + IPC wiring (resolved in §21 as Electron-**main** file storage, not a daemon verb), and the
  `apps/desktop` consumption (vite alias / tsconfig reference / `globals.css` `@source`). **Deferred to its own
  spec:** `DockviewEngine`.

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

## 21. Plan 4 — the mock-first shell: decomposition & locked build decisions

The §12 "mock-first full shell" is built as **three sub-plans, each shipping working, testable software** (the
repo's bite-sized-plan + developer-sized-commit norm). Every decision below is locked; each sub-plan draws from this
section rather than re-deciding.

**Decomposition.**

- **4a — the walking skeleton.** The AppShell chrome + `StaticEngine` mounted in `apps/desktop` + a `PanelRegistry`
  + the **cost/cap** surface live end-to-end, proving every seam of the composition (chrome → mount → registry →
  panel → shared-registry IPC bridge → pure view-model → main-process persistence). All other content regions are
  placeholders. Nothing here is refactored when 4b/4c land.
- **4b — the remaining buildable-now surfaces.** Flags (CF-1 `flagsForUser`), decision log (`why`/`getDecision`),
  timeline (`listTimeline`), account selector (the auth verbs), `coa raw` + Settings (pure client). Each surface =
  a `console-viewmodel` `selectVm` + a bridge-registry entry + a `console-ui` panel. All verbs already exist and are
  bound in the daemon console-handler map.
- **4c — the design-now MOCK surfaces.** Structured chat stream, approval cards, agent-config, compiled-prompt view,
  graph/scope viz — realistic mock rendered through the same registry + selector seam, each swapping mock→verb via
  the registry with **no shell or panel refactor** as its M8 seam (its own later spec) lands (§16).

**Locked cross-cutting decisions.**

- **Layout persistence = Electron-main file, no daemon verb.** The **main** process reads/writes a per-workspace
  `layout.json`; preload exposes `getLayout()` / `saveLayout(descriptor)`; the renderer validates on read via
  `parseDescriptor(raw, registry, DEFAULT_DESCRIPTOR)` (never throws → default on any corruption) and persists on
  `onChange`. This honors §11.2/§11.6 ("persisted per-workspace by the daemon/**main**… the daemon persists it
  opaquely") and the §2 non-goal of **no new M8 verbs**; the descriptor is console-local and non-authoritative, so
  main-side storage does not breach "M10 computes nothing authoritative." The daemon-verb alternative is rejected
  for v1.
- **IPC bridge = named methods over a shared Zod method registry.** One named `contextBridge` method per verb
  (`coa.capState()`, …) — enumerable and matching §10.2's one-method-per-channel posture — backed by a single
  registry mapping each verb → `{ params, result }` Zod schemas that **both** main-side validation and the renderer
  view-model consume (reusing the `console-viewmodel` edge schemas). Adding a verb = one registry entry + a thin
  passthrough; schemas cannot drift across transport/preload/view-model.
- **Live-data seam = a small `console-layout` extension.** Because the imperative engine owns its **own** React root
  (§11.3/§11.6), React context cannot reach panels — live daemon data must flow through the handle. The engine store
  gains a `daemonState` slot and `LayoutHandle` gains **`setDaemonState(state)`**; `PanelBody` reads it live so a
  panel's pure `selectVm` re-runs on each update, while descriptor/drag state stays in its separate slot (a resize is
  not clobbered by a data tick). Established in 4a because every surface needs it — deferring it would force a 4b
  refactor, breaking the §16 no-refactor guarantee.

**AppShell composition (the §7 Layout family member deferred from Plan 2).**

- **Fixed chrome = the custom title bar only** — window controls / platform-flag insets (§9), the wordmark, the
  account/session context, and the persistent **`raw`** affordance (D85). This is the OS window-frame region and is
  genuinely not rearrangeable. AppShell = the title bar + a content slot into which the app mounts the engine.
- **The nav rail is a layout region in the descriptor, not fixed chrome** — a `nav` panel, VS Code activity-bar
  style (VS Code itself makes the activity bar movable/hideable). Keeping it inside the composable seam means a later
  reposition/hide is a **descriptor change, not a shell refactor**. The serializable descriptor therefore arranges
  the whole workbench body (nav + conversation + dashboard rail); only the title bar sits outside it.
- **Nav-rail routing semantics are deferred.** Direction B is conversation-centric, so until 4b/4c there is only one
  section's worth of content; 4a renders the nav rail as real, accessible chrome (Lucide icon buttons with full
  rest/hover/active/focus states, one active, settings gear pinned bottom) but section **switching** is a stub. The
  routing model (secondary-area swap vs. full-surface takeover) is pinned once more than one surface exists.

**Default direction-B descriptor (MVP — §11.4 "all static except chat").**

```text
root = split(row, static)[
  leaf(nav)  @ fixed-narrow,                       // the activity-bar-style rail (no drag handle in MVP)
  split(row, resizable)[                           // the one draggable boundary: conversation <-> rail
    leaf(conversation) @ 70,
    split(column, static)[ leaf(cost), …rail leaves ] @ 30
  ]
]
```

4a registers **three** panels — `nav`, `conversation` (a placeholder surface), and `cost` (live) — which also
exercises a real nested static+resizable tree in the skeleton. A reusable `PlaceholderPanel` covers the not-yet-built
surfaces for 4b/4c.

**Panels live in `apps/desktop`** (§11.6 "concrete panels are the shell's job") — `apps/desktop/src/renderer/panels/`,
each = a `console-viewmodel` `selectVm` + a `console-ui` `render`, jsdom-tested in-app. No new package.

**States-first is demonstrated in 4a, not deferred (§5.1 #12).** The cost panel ships real **loading** (skeleton),
**error** (inline message), and **empty / "no ceiling"** states before its happy path — for an audit tool these
states are the credibility, and 4a sets the pattern 4b/4c copy.

### 21.1 Plan 4b concretization (locked)

Plan 4b builds the remaining buildable-now surfaces and, in doing so, pins the nav-rail **routing model** §21
deferred ("once more than one surface exists").

**Arrangement = inspector-first (a refinement of direction B's arrangement, not its identity).** The **nav rail
drives the main region** — it swaps which surface panel fills the dominant center — while a **persistent right dock**
holds chat (mock) + agent (mock) + the **live account/session selector**. The single resizable boundary is
main↔dock; the nav rail stays a thin static region. Chat stays *prominent* (always visible) but is no longer
*dominant-center*; the forge/brass visual identity (§13) is unchanged, and the layout stays fully descriptor-driven
so any surface can be re-homed later (the §13 ASCII shows the earlier chat-center arrangement — 4b refines it). This
was the maintainer's call: an audit tool's main job is *inspecting* surfaces, so the big area is the audit windows
and chat is the always-present companion you drive from.

**Mechanism = one state object down, actions up.** The renderer maintains a single **`ConsoleState = { data, ui,
actions }`** pushed through the existing `setDaemonState` seam (generalizing 4a's `DaemonState`): `data` = the polled
daemon reads (`cap`/`flags`/`timeline`) + `accounts` (fetched on demand); `ui` = `activeMainPanelId` + `settings`;
`actions` = app-owned callbacks (`setRoute`/`switchAccount`/`setSettings`/`refresh`). Each surface is a **real
`PanelDefinition`** whose pure `selectVm` picks only what it needs; interactive panels reach back across the engine's
own React root by pulling a callback out of the pushed state (unidirectional: state down, actions up). **Nav routing**
= `setRoute` sets `activeMainPanelId`; the app swaps the main leaf's `panelId` (preserving sizes via `serialize`) and
persists — so every surface stays an independent, reorganizable panel rather than a sub-view of a monolith.

**Surfaces live in 4b:** Cost (re-homed from 4a's right pane into a nav-driven window; renders `capState` honestly —
subscription/no-ceiling · "$X under cap" · cap-reached), **Flags** (`flagsForUser` → `FeedView`, states-first),
**Timeline** (`listTimeline` → checkpoints, read-only; the rewind verb is still TBD), **Account selector** (the auth
verbs, in the right dock, interactive), **Settings** (§21.2). The **`raw`** affordance stays present and focusable
(the 4a title-bar button) opening an honest placeholder — its real content is the *unfiltered loop*, which needs
`coa run` + the turn store, so the real raw view lands in 4c on that same seam.

**No persistent cost chip.** The M7 cap is **daemon-wide**, but v1 is subscription-locked so `capState.remaining` is
usually `null` (no dollar figure to show); per-account cost is the *ledger*, a separate surface whose verb is still
TBD. And a cap-hit is one of the two hard blocks, so it **self-announces via the SC-1 DenyNotice** when the live deny
channel lands (4c) — no always-on chip is needed. The always-visible *context* is the account/session in the right
dock.

**Deferred out of 4b (with reasons):** Decisions (the read verbs are `getDecision(id)` / `why(target)` only — there
is **no list-all-decisions verb**, so a chronological log isn't buildable; the targeted "why" explain-power waits
with it) · agent-config (4c) · the ledger / model-usage detail (verb TBD) · a session-status chip (no session-state
verb) · the SC-1 DenyNotice **banner** on cap-hit (wires with the live deny channel in 4c). Build order = three
parts: (1) the inspector-first reshape (`ConsoleState` + nav routing + right-dock/nav-driven descriptor + re-home
Cost), (2) the read surfaces (Flags + Timeline), (3) the interactive surfaces (Account selector + Settings).

### 21.2 Console settings (locked)

Settings is a **dedicated, extensible `ConsoleSettings`** object (a Zod schema with defaults + a merge-on-read, so
future toggles just add a field), persisted by the **main** process in a `settings.json` via new `getSettings` /
`saveSettings` registry methods — the same mechanism as `layout.json` (all console-local state on the trusted main
side, no daemon verb). The first three fields are **theme · density · motion**, applied by setting
`data-theme` / `data-density` on the document root plus a `motion-enabled` flag; loaded on boot, applied instantly on
change, persisted async.

### 21.3 Plan 4c concretization (locked)

Plan 4c builds the **design-now MOCK surfaces** (§12): the structured chat stream, inline approval cards,
`coa raw`, agent config, the compiled-prompt view, and the graph/scope viz. Each fronts an **unbuilt M8
seam**, so each renders realistic mock through the same registry + selector seam and swaps mock→verb via the
registry with **no shell or panel refactor** when its seam (its own later spec) lands (§16). Visual direction
is unchanged (§13); the inspector-first arrangement of §21.1 is preserved, not re-opened.

**Decomposition = three sub-plans, each shipping working, testable software** (mirroring 4b's plan-per-slice /
commit-per-Part norm). The whole decomposition + per-surface mock shape is pinned here; the detailed TDD plans
are authored one at a time (4c-1 first), each drawing from this section.

| Sub-plan | Surfaces | New `console-ui` component | Fronts (unbuilt seam) |
| --- | --- | --- | --- |
| **4c-1 — conversation seam** | structured chat stream · inline approval cards · `coa raw` mode | **Transcript** (P11 Dense/Viz) | turn producer · R-7 store · CON-PUSH · approval Push / `respondApproval` · `coa run` |
| **4c-2 — agent config** | Roles + Pieces config | — (existing Inputs + `Sheet`) | `listRoles` / `getRole` / `writeRole` |
| **4c-3 — the P11 dense/viz pair** | compiled-prompt view · graph / scope viz | **Longform/PromptView** (react-virtuoso) · **Graph** (React Flow + Dagre) | an M8 read over M5 compiled output · graph read verbs |

**Surface placement (faithful to §21.1).**

- **Chat + approvals + raw** re-home the right-dock `conversation` slot. **Approval cards are a turn-frame
  kind rendered inline** where the agent pauses for permission (matching how tool-approvals actually flow),
  sharing the Transcript data model. **`coa raw` is the existing title-bar affordance made live as a mode
  toggle** — it flips the same conversation panel between governed and verbatim frames (D85: the same loop,
  unfiltered — one stream, no overlay, no second view). Wired as a `ui.rawMode` flag + a `toggleRaw` action
  the title bar's `onRaw` invokes; the chat panel's pure `selectVm` reads it.
- **Agent config** re-homes the dock `agent` slot as a compact **active-role summary** (role · scope) with a
  *Configure* affordance that opens the full Roles + Pieces mock form in a **`Sheet`** (the kit's side-drawer
  for "forms that need room"). This keeps §21.1's dock composition (chat + agent + account) and adds no nav
  routing.
- **Compiled-prompt** and **graph** are **routable main windows** — new nav sections (`prompt`, `graph`)
  added to `ROUTABLE_IDS`, filling the dominant center like Cost/Flags/Timeline (the "big area = the audit
  windows" model of §21.1). Nav rail after 4c: Cost · Flags · Timeline · Prompt · Graph, Settings gear pinned
  bottom.

**New Dense/Viz components (the deferred §7 P11 family — built real, mock-fed).** Building the real components
now (not lighter placeholders) is what honors the §16 no-refactor guarantee and actually validates the design
system against every surface type — the thesis of §12's mock-first posture. Each ships its colocated
lint-enforced intent block (§7), a registry entry, a regenerated `COMPONENTS.md` (diff-checked), and
states-first jsdom tests.

- **Transcript** — a virtualized (react-virtuoso) turn stream: role-tagged frames (you / agent / nested
  subagent), content blocks (text / tool-use / tool-result), a live/running affordance, and pluggable frame
  kinds so the **approval card**, the **DenyNotice**, and the **verbatim (raw)** rendering are frame variants,
  not separate widgets. Tool payloads render byte-faithful (D128).
- **Longform/PromptView** — byte-faithful long-form (react-virtuoso) for the compiled prompt: verbatim
  rendering with section anchors, no truncation/normalization, verbatim copy sourced from the canonical bytes,
  not the DOM (D128, §11.4).
- **Graph** — React Flow + Dagre auto-layout with semantic zoom, an **Okabe-Ito** categorical node palette and
  redundant (non-color) encoding (§15), keyboard-navigable, degrading to a non-graph fallback list for a11y.
  Sigma.js remains the documented >~5k-node fallback (§4/§18), not built here.

New renderer-only dependencies: `react-virtuoso`, `reactflow` (+ `dagre`). Native-addon-free, so they live in
the renderer with no main-process rebuild (§10.4). REPO_LAYOUT + the dependency-cruiser ruleset get the
same-commit note where each lands (§19).

**Mock shapes mirror their future verb, in `console-viewmodel` (pure, renderer-safe).** Each surface's mock is
typed by a Zod edge schema in the view-model package (never `@coa/core`), shaped like the verb that will
replace it so the swap is a one-line data-source change: a **turn frame** (role · kind
text|tool-use|tool-result|approval|deny|raw · byte-faithful payload · subagent nesting · running/settled),
an **approval request** (requestId · tool · args preview · diff stat · risk), an **agent role** (name · scope
· pieces), a **compiled prompt** (verbatim bytes + section offsets), and a **scope graph** (nodes + edges).
Fixture mock data lives in the shell, not the schema.

**Mechanism (extends §21.1's `ConsoleState`, no new seam).** `data` gains the mock reads
(`turns`/`agent`/`compiledPrompt`/`graph`, each a `Remote<T>`); `ui` gains `rawMode`; `actions` gains
`toggleRaw` (and the inert mock approval/config callbacks). Every surface stays a real `PanelDefinition` with
a pure `selectVm`; data flows down and actions up through the existing `setDaemonState` push (§21/§21.1). No
`console-layout` change is required.

**SC-1 — help, never cage (the load-bearing invariant here).** The approval card's Approve/Deny are **inert
mock actions** — they only resolve the mock card locally; the card **surfaces** an approval the daemon would
issue and **never originates a block** (the UI cannot deny). The two real blocks stay M3's close-gate and M7's
cost-cap through M9's single deny channel, rendered by the `DenyNotice` frame kind. 4c renders a **mock**
DenyNotice frame states-first (to design and validate the surface), but the **live deny channel wiring stays
deferred** — it needs the R-12 push bridge; the console still denies nothing on its own.

**Deferred out of 4c (with reasons).** Live turn / approval / deny **push** (needs the R-12 WAL→Push bridge) ·
`coa run` and every real verb behind the five mocks (their own later specs) · the **live** SC-1 deny-channel
wiring (rides R-12) · the **DiffView** and **Timeline** Dense/Viz members (§7) — not required by any 4c surface
· dockview docking (§18). After 4c the mock-first shell is complete; remaining M10 work is swapping each
mock→verb as its M8 seam lands.

## 22. Shell chrome & layout responsiveness (post-4c-1 compliance pass)

Once the shell rendered end-to-end, an audit against the design principles (§5 P1–P12, §5.1 #1–#16) surfaced
gaps between the built shell and the locked intent — the principles bind every surface, so these are corrected
rather than deferred. This section pins the corrections; the visual direction (§13) and inspector-first
arrangement (§21.1) are unchanged.

### 22.1 Separation model — floating panes (chosen over hairline dividers)

The workbench body is a **recessed canvas** (`bg-base`); each region (nav, the main surface, and every dock
pane) is a **surface card with a gutter between**, sized on the 8pt system. **Space is the primary separator**
(§5.1 #5 space→tint→divider→border→box; #7 macro-whitespace generous; #10 maximize data-ink) — this replaces
the built shell's edge-to-edge stacked bordered boxes (double borders / false-floors / zero macro-whitespace,
which read as "cramped"). Borders drop to the lightest weight that still reads; a pane is a single card, not a
box-inside-a-box. The alternative (flush panes + 1px hairline dividers, denser "IDE") was mocked and rejected
for v1.

### 22.2 Seamless title bar; no native menu (P7 native, P8 parity, P9 anti-slop)

The custom title bar (§9) becomes the **only** window chrome. On Windows the frame is removed and the OS window
controls are **overlaid into our bar** (`titleBarStyle: 'hidden'` + `titleBarOverlay { color, symbolColor,
height }`), matching the already-wired `env(titlebar-area-*)` right inset in `AppShell`; macOS keeps
`titleBarStyle: 'hidden'` + traffic lights. The **native application menu is removed**
(`Menu.setApplicationMenu(null)`) — a File/Edit/View bar is not part of this product's surface. The title bar is
a **flat surface** (no gradient, per §14), `-webkit-app-region: drag` with `no-drag` controls, and chrome uses
`cursor: default` (§9). This closes the gap where the built window showed the native frame **and** the native
menu **and** our bar stacked.

### 22.3 Fixed-width nav + honored resize constraints (P6 never-weird responsive)

The built nav rail is sized by a **flex ratio**, so it scaled with window width (non-standard — an activity bar
is fixed). Corrections:

- **The nav is a fixed-px region.** The layout descriptor gains a **fixed-size leaf** concept (a leaf whose
  size is pixels, not a proportional weight); the `StaticEngine` renders it `flex: 0 0 <px>` so it never grows
  or shrinks with the window. Only the main↔dock boundary stays proportional/resizable.
- **Min sizes are honored, not a flat 5%.** Each region carries a **min size** (the `PanelDefinition`
  `defaultConstraints` seam, §11.1, wired through the descriptor into the engine); the resizable split enforces
  per-pane pixel minimums so a pane stops before its content crushes (§5.1 min-content floors), and the
  `BrowserWindow` gets a sensible `minWidth`/`minHeight`. Container-query-first adaptation (§8) keeps in-pane
  content legible at any splitter position.
- **The resize handle reads as draggable** — a visible grip that turns **brass on hover** (P5 motion-as-feedback;
  the built handle had no affordance).

### 22.4 Themed scrollbars & cohesion (P1 cohesion via tokens)

Native OS scrollbars are replaced by **themed thin scrollbars** (transparent track, `border`-toned thumb → `fg`
on hover), applied globally from the token set so every scroll surface (transcript, long panes) is cohesive.
This is a token-driven global rule, not a per-component style.

### 22.5 Implementation surface

The corrections span: **`console-layout`** (the descriptor schema gains fixed-size + min-size on regions; the
`StaticEngine` renders fixed-px leaves and enforces min sizes — the tested pure core, the meatiest change),
**`console-ui`** (`Pane` border/gutter treatment for the floating model; the `AppShell` flat title bar; a
scrollbar utility), **`apps/desktop`** (`main` — `titleBarOverlay` + `Menu.setApplicationMenu(null)` +
`minWidth`/`minHeight`; the default descriptor — fixed nav width + dock/main min sizes; `globals.css` — the
recessed-canvas background + global scrollbar rule). Same-commit doc obligations (§19) apply where a package
surface changes.

---

_Last reviewed: 2026-07-01_

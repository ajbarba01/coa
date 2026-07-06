# 0007. Console design system

- Status: accepted
- Date: 2026-07-06

## Context and problem

M10 (the Electron inspector) needed a design system before it needed screens: a shared vocabulary of tokens and
components so `apps/desktop` and any future console surface draw from one source instead of each screen
inventing its own colors, spacing, and control shapes. The system also had to answer a governance-specific
question no generic component library owns: the console is a **second client** to a daemon that already governs
the loop (M3's close-gate, M7's cost-cap, `coa raw`'s byte-faithfulness) — so the design system's job is to
render those decisions faithfully, never to grow a second copy of them at the UI layer. Two more problems
surfaced only once the first chat surface shipped and was used for real: a windowed transcript could not support
full-conversation text selection or in-page find, and a generic single component was being asked to both warn
softly and hard-deny, which is exactly the ambiguity SC-1 exists to prevent.

## Decision drivers

- **SC-1 — help, never cage, applies at the GUI too.** The only two real blocks in the whole system are M3's
  close-gate and M7's cost-cap, both issued through M9's single deny channel. A UI component that can render an
  unsolicited "no" (rather than only display one the daemon already decided) reopens a blocking surface the
  constitution says must not exist outside those two paths.
- **The GUI is a client, not a second source of truth.** `coa raw` (D85's strict-superset guarantee, surfaced) has
  to render byte-faithfully; a design system that reshapes or summarizes what the daemon sent would make the raw
  view a second, divergent account of the session instead of a catalogue of the same one.
- **Full-transcript selection and find are table stakes for a chat surface**, and both are fundamentally
  incompatible with row windowing — a windowed list only ever has the visible rows in the DOM, so `Ctrl+F` and
  "select all, copy" both silently stop at the viewport boundary.
- **Consistency has to be enforced, not remembered.** A hand-maintained style guide drifts the moment a second
  contributor (human or agent) adds a component; the contract needs to be machine-checkable so drift fails a
  lint/build rather than a design review months later.
- **Swappable arrangement without touching panels.** The layout had to separate "what panels exist and what they
  render" from "how they're currently arranged on screen," so a future docking engine (or a saved/restored
  window arrangement) is a new engine behind one port, not a rewrite of every panel.

## Considered options

1. **Ad hoc styling per screen, tuned in `apps/desktop` directly.** Rejected: the fastest path to divergence —
   nothing stops two screens from picking different grays for the same semantic surface, and nothing catches it.
2. **A component library with prose usage docs maintained by hand (a `CONTRIBUTING.md`-style guide).** Rejected:
   prose guidance is real but unenforced; nothing fails a build when a new component ships without an entry, and
   nothing catches a stale entry once the component's behavior moves on.
3. **A three-tier token system + a lint-enforced, typed intent contract per component, with the catalogue
   generated from the contract rather than written separately** (chosen). Tokens separate raw values from the
   names components consume from the few extension points components still need directly, so a re-theme is a
   tier-1/tier-2 edit, never a hunt through component code. The intent contract makes "when to use this instead
   of that" a required, typed field (`assertIntent` throws on any blank field) rather optional prose, and the
   generated `COMPONENTS.md` can never drift from the code because it *is* the code, compiled.
4. **Keep the windowed transcript (`react-virtuoso`) and treat text-selection/find as a follow-up polish task.**
   Rejected post-use: the 2026-07-04 chat-professionalization pass found the scroll lag, the broken jump-to-latest,
   the sticky-header visual push, *and* the broken text selection all traced to the same foundation
   (`GroupedVirtuoso`) — patching each symptom individually would have left the root cause in place. Full-history
   selection and in-page find are not degradable features; a windowed DOM cannot provide either no matter how the
   symptoms are patched.
5. **Render every transcript frame, unwindowed, relying on `content-visibility` for off-screen performance**
   (chosen for the transcript). Every frame is in the DOM as an ordinary node, so native selection and native
   `Ctrl+F` work across the whole conversation for free; `content-visibility: auto` (plus a tuned
   `contain-intrinsic-size`) keeps the browser from paying layout/paint cost for rows currently off-screen,
   without unmounting them and losing selection state.
6. **One generic "message" component covering both soft warnings and hard denials.** Rejected: collapsing the two
   into one component erases the distinction SC-1 depends on — a user cannot tell "the daemon is warning you"
   from "the daemon just blocked you" if both render through the same, freely-instantiable component. A
   dedicated `DenyNotice`, constructed only from a daemon-issued deny frame, keeps that distinction structural
   rather than a matter of remembering to pick the right props.

## Decision

### Three-tier token system
Tier 1 (`packages/console-ui/src/tokens/palette.ts`) is raw values only — named hues and steps
(`brown0`…`brown3`, `cream`, `brass`, `danger`/`warning`/`success`, and their light-theme companions) — never
consumed by a component directly. Tier 2 (`semantic.ts`) is the only tier components consume: CSS custom
properties named by role (`--color-bg-base`, `--color-fg-muted`, `--color-accent`, `--color-border`, …) that map
onto tier-1 values per `Theme` (`dark`/`light`) and `Density` (`comfortable`/`compact`). `resolveTokens`/
`tokensToCss` (`tokens.ts`) compile a theme+density pair into the CSS actually applied. A tier-3 layer of
component-consumed extensions (documented inline in `palette.ts` as "component-consumed extensions") exists for
values that need a component-specific name (e.g. per-agent identity colors) without polluting the general
semantic set. Re-theming or introducing a new density is a tier-1/tier-2 edit; no component file changes.

### The typed intent-block contract, lint-enforced, compiled into `COMPONENTS.md`
Every exported component in `packages/console-ui` carries a co-located `<Name>.intent.ts` declaring a
`ComponentIntent`: `family`, one-sentence `intent`, `useWhen`/`dontUseWhen` (the governance lever — where a
reviewer or an agent is steered *away* from a component, not just toward one), `anatomy`, `variantsStates`
(including the states the feedback contract requires: rest/hover/active/focus/disabled/loading as applicable),
`accessibility`, and `related`. `assertIntent` (`packages/console-ui/src/lib/intent.ts`) throws if any string
field is blank or any list field is empty — the contract is enforced at declaration time, not by convention.
`COMPONENTS.md` is generated from these declarations ("Generated from each component's intent declaration. Do not
edit by hand.") grouped by family (Actions, Feedback, Dense/Viz, …), so the catalogue can never say something the
code doesn't also assert.

### Layout architecture: panel registry + versioned descriptor + an imperative engine port
`packages/console-layout` separates three concerns that a monolithic layout component would otherwise fuse.
A `PanelRegistry` (`panel/registry.ts`) holds `PanelDefinition`s — an id, a pure `selectVm(daemonState)` selector,
and a render component — and never imports the engine or the descriptor, so a panel written today runs unchanged
under a future docking engine. A console-local, versioned `LayoutDescriptor` (`descriptor/schema.ts`,
`LAYOUT_VERSION`) is the serializable arrangement — a tree of `LeafRegion`/`SplitRegion` nodes with a per-region
`Adjustability` dial (`static`/`resizable`/`dockable`) — parsed with `parseDescriptor`
(`descriptor/migrate.ts`), which runs any pending version migrations, drops leaves whose `panelId` is no longer
registered, prunes emptied splits, and **falls back to a supplied default rather than ever throwing** on
malformed or stale persisted state. The `LayoutEngine` port (`engine/port.ts`) is the one seam that knows whether
the current arrangement is mutable; `StaticEngine` is the shipped implementation (`react-resizable-panels`,
degrading `dockable` to `resizable`), and swapping it for a docking engine later touches this one seam, not the
panels or the descriptor shape.

### Visual direction locked: warm-dark "forge," brass accent
The shipped visual direction is a warm-dark neutral ramp (the "forge" palette: near-black browns rising through
raised-surface steps to a cream foreground) with a single brass accent color carrying interactive/selected
emphasis, plus semantic danger/warning/success/info hues. This is a *locked* decision, not a placeholder — the
token tiers exist so retuning within this direction (spacing, an individual step's contrast) is cheap, but the
direction itself (which hue family, which single accent) is the considered choice this ADR records, not an
implementation detail left open per screen.

### The virtualization reversal
The two chat specs that preceded 2026-07-04 (2026-06-30's console-frontend foundation and 2026-07-02's chat
interface overhaul) both specified `react-virtuoso` (`GroupedVirtuoso` with `followOutput`) for the transcript.
Built and used, that foundation traced several distinct symptoms — scroll lag, a broken jump-to-latest, a sticky
header's visual push, and, decisively, **broken text selection** — to the same root cause: a windowed list only
ever holds the visible rows in the DOM. Full-transcript text selection and in-page `Ctrl+F` both require every
row to be present; no amount of windowing-parameter tuning satisfies either. The 2026-07-04 chat-professionalization
pass reversed course: `Transcript` (`packages/console-ui/src/dense/Transcript.tsx`) now renders **every** frame
to the DOM as an ordinary node, with `content-visibility: auto` (plus a tuned `contain-intrinsic-size`) keeping
off-screen rows out of layout/paint without unmounting them, and native browser scroll (not a hand-rolled
scroll-lerp) driving stick-to-bottom. `react-virtuoso` is no longer a dependency of `packages/console-ui`
(verified below). **Virtualization is no longer the default for this surface** — a future surface with a
genuinely unbounded, selection-uninteresting row count (e.g. a raw event log) could still choose it, but the
chat transcript's defaults are now unwindowed-by-design, not a temporary state pending re-optimization.

### The single `DenyNotice` channel
`DenyNotice` (`packages/console-ui/src/feedback/DenyNotice.tsx`) is the **only** component that renders a block,
and its own intent contract states the constraint directly: it exists to surface "a denial the daemon already
issued — the close-gate or the cost-cap," and its `dontUseWhen` names the failure mode by name — "You are
tempted to block or gate an action in the UI — the console never denies; only the daemon does." A non-blocking
warning uses `Banner` instead, whose own intent contract points back the other way ("It is a system deny — use
DenyNotice"). This is SC-1 made structural at the component boundary: there is exactly one component capable of
rendering a deny, it is driven only by a `DenyKind` (`close-gate`/`cost-cap`) the daemon already decided, and no
other component in the kit is positioned as an alternative path to the same visual weight.

### `coa raw` is sacred
The GUI's raw mode is a byte-faithful catalogue view of the daemon's own frames, not a second rendering pipeline
with its own opinions — the console is a *client* to the daemon's account of the session, and D85's
strict-superset guarantee (coa with a feature off is never worse than the raw loop, and `coa raw` always shows
the unfiltered loop) holds at the GUI exactly as it holds at the CLI. Every kit member that renders daemon output
(`Transcript`'s `raw` row kind included) treats the daemon's frame as authoritative content, not as something to
reinterpret before display.

### Verification against the current code
```
$ rg -n "content-visibility|virtuoso" packages/console-ui/src | head
packages/console-ui/src/dense/Transcript.tsx:702: /** Memoized so a streamed frame re-renders only the appended row, and `content-visibility`
packages/console-ui/src/dense/Transcript.tsx:764: * selection and Ctrl-F work across the full transcript; `content-visibility: auto` on
packages/console-ui/src/dense/Transcript.intent.ts:15: '... with content-visibility keeping off-screen rows out of layout/paint; native scroll ...'
```
No `virtuoso` match in `packages/console-ui/src` at all — the reversal is complete in source, not partial.
```
$ rg -n "virtuoso" packages/console-ui/package.json
(no matches)
```
`react-virtuoso` is confirmed removed from `console-ui`'s dependencies.
```
$ rg -n "DenyNotice" packages/console-ui/src | head
packages/console-ui/src/registry.ts: import { denyNoticeIntent } from './feedback/DenyNotice.intent.js';
packages/console-ui/src/feedback/DenyNotice.tsx: export interface DenyNoticeProps { ... } export function DenyNotice(...)
packages/console-ui/src/feedback/Banner.intent.ts: dontUseWhen: [..., 'It is a system deny — use DenyNotice.']
packages/console-ui/src/dense/Transcript.tsx: <DenyNotice kind={frame.denyKind} reason={frame.reason} />
```
`DenyNotice` is a single, real component (not a placeholder), consumed by `Transcript` for the `deny` frame kind,
and cross-referenced by `Banner`'s own `dontUseWhen` — the single-deny-channel constraint is enforced by both
components' intent declarations, not by convention alone.
```
$ ls packages/console-ui/COMPONENTS.md packages/console-ui/src/tokens
packages/console-ui/COMPONENTS.md
packages/console-ui/src/tokens: palette.ts  semantic.ts  tokens.test.ts  tokens.ts
```
Both the generated catalogue and the token tier files exist and are current.

## Consequences (good / bad)

**Good**

- The token system makes re-theming and density changes a two-file edit (`palette.ts`/`semantic.ts`); no
  component needs to change to support a new theme or a tighter density, because components only ever consume
  tier-2 names.
- The intent contract cannot silently drift: `assertIntent` throws at declaration time on any missing field, and
  `COMPONENTS.md` is generated from the same declarations it documents, so the catalogue and the code cannot
  diverge the way a hand-written guide would.
- The layout's panel/descriptor/engine split means a future docking engine, or a saved-and-restored window
  arrangement, is a new `LayoutEngine` implementation and a version bump with a migration — not a rewrite of
  every panel or a breaking change for persisted layouts (`parseDescriptor` degrades stale/malformed state to a
  fallback rather than throwing).
- The virtualization reversal fixed a whole cluster of previously-separate-looking bugs (scroll lag,
  jump-to-latest, sticky push, broken selection) at their shared root, and the resulting design — full DOM +
  `content-visibility` — is simpler to reason about than the windowed-list-plus-workarounds it replaced.
- SC-1 holds at the GUI the same way it holds at the daemon: exactly one component can render a block, and it is
  only ever constructed from a daemon-issued deny frame — there is no code path by which the console itself
  originates a denial.

**Bad**

- Rendering every transcript frame to the DOM trades a real (if `content-visibility`-mitigated) cost for
  unbounded conversation length; a session long enough to strain this has not yet been characterized, and no
  ceiling or archival strategy exists yet if one is found.
- The intent contract enforces *presence*, not *correctness* — `assertIntent` catches a blank `dontUseWhen`, not
  a wrong or stale one; keeping the prose honest as components evolve is still a review judgment, same as any
  hand-written guide, just harder to skip declaring.
- `StaticEngine`'s `dockable` → `resizable` degrade means the shipped console does not yet have real docking
  (drag-to-rearrange, floating panels); the port is designed for that future engine, but it isn't built.
- The warm-dark "forge" direction is locked for the shipped console; a user-facing theme switch beyond
  dark/light density variants (a genuinely different visual direction) would be a new decision, not a token
  retune within this one.

---

_Last reviewed: 2026-07-06_

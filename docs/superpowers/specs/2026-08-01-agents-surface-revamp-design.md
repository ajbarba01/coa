# Agents surface revamp — design

**Date:** 2026-08-01
**Status:** approved in brainstorming, not yet planned
**Scope:** the console's agents surface, the composer's predictive notices, and the model picker
**Supersedes:** the layout decisions in `2026-07-31-console-orphan-homes-design.md` for the agent
editor only. That spec's membership vocabulary (`SetRow`, `SetBox`, the four memberships), its
provenance rules, and its two load-bearing rules (an exclusion stays visible in the agent's own
list; the add overlay is sticky) all still bind and are unchanged here.

---

## Why

Maintainer review of the shipped surface raised five notes. Two of them turned out to have
mechanical causes rather than taste causes, and finding those reframed the rest.

**`text-heading` resolves only in the retired kit.** `InlineEditName` styles both its display face
and its edit face with `text-heading`. The current ramp in `packages/console-kit/src/tokens.css` is
`body / sec / code / meta / caps / icon` and has no such step; `--text-heading` (16px) is declared
only by `packages/console-ui/src/theme.css`, the retired kit, which `globals.css` still imports. So
the display face reached across into the old kit's ramp for its size, while the edit face could not
override `TEXT_INPUT_CLASS`'s `font-mono text-code` at all and rendered mono at 11.5px. The reported
"rename mode changes height and font and font size" is that — a cross-kit type leak plus an
un-overridable skin, not a stale component.

**The editor has two measures.** `AgentEditor` wraps its header and divider in `max-w-160` (640px)
and everything below in `max-w-md` (448px), inside a pane that can be 1200px. The rule introducing
the content is wider than the content it introduces.

The remaining note — "most of the surface doesn't feel like it fits the kit" — was diagnosed
during brainstorming as **absence of containment**. The agent editor is the only console surface
whose content sits directly on the raw canvas, held together by `gap-3` alone. The composer is one
rect with hairline-divided sections; usage uses bordered tiles; auth uses rows on grounds. That
contrast is what reads as foreign, and it is also why the surface cannot fill width gracefully:
there is no object to lay out, only a stack of text.

---

## 1. The agent editor becomes panels

### The panel

A **panel** is the console's sanctioned in-flow elevation, which this surface currently does not
use: **s2 ground, s4 hairline, `r3` radius, no shadow** (`docs/UI.md`, elevation grounds). It is
explicitly **not a card** — no float, no drop shadow, no uniform tile grid, no nesting. `SetRow`'s
existing s3 on an included row stays a *selection tint inside a ground*, not a second surface.

Anatomy, in order: a **header** (the section label, and a count on the trailing edge) sitting on
its own hairline · a **body** · an optional **footer** on a hairline carrying the `AddPicker`
trigger.

Today's `SectionHeader` becomes that panel header. Its existing contract is preserved: the count
takes a node so a compound count can wear the same header, and omitting it entirely stays the way
to suppress a count that would mislead (Reach's permissive floor).

### The grid

The identity header spans the full content width above the grid, so there is **one measure and one
rule**. Below it:

| Column | Width | Contents |
| --- | --- | --- |
| Left rail | `264px` | Runs on · Reach |
| Main | `minmax(0, 1fr)` | Roles · Context |

Reading order is runtime, then composition: *this agent runs on Sonnet and reaches these six tools,
and here is what composes that.* The two read-mostly panels sit nearest the list you switch agents
in.

**Gutter rhythm is load-bearing.** The column gutter is `22px`; the gap between vertically stacked
panels is `14px`. They must stay visibly different. An even value everywhere collapses the grid
into one undifferentiated mesh and re-creates the "everything is floating" problem the panels exist
to solve.

### Width goes to content with quantity

The row list inside the Roles and Context panels is
`repeat(auto-fit, minmax(272px, 1fr))`. On a wide pane a nine-package project reads as three
columns rather than nine stranded lines; it collapses to one column with no breakpoint.

**Accepted cost:** at two or three columns, each row's provenance meta (`Default`, `Researcher`)
pins to its own column's trailing edge rather than to one clean right rail. This was reviewed and
accepted.

### Narrow

Below `AGENTS_NARROW_PX` the grid collapses to a single column and the panels stack in reading
order: **Runs on · Roles · Context · Reach**. Reach moves last, where it reads as the summary of
what precedes it. The drill-down behaviour itself is unchanged.

### Other vocabulary corrections in the editor

- The `AddPicker` trigger stops being a bare text button (it currently reads as a link) and takes
  the composer's chip vocabulary: `border-s5`, `bg-s4`, `r2`, with the kit's press idiom.
- Reach's tool pills move from the local `Pill` to the well treatment: `bg-s1`, `border-s5` — a
  darker well inside the s2 panel, which is the correct direction of contrast.
- The trailing "takes effect on the next message" paragraph moves inside the Reach panel, which is
  the thing it is about.

### On "dynamic repositioning"

Containment is the fix. Today, toggling a role adds or removes Context rows and shoves every
following section down the page, because nothing is bounded. A panel absorbs its own growth and its
neighbours hold still.

**Explicitly out of scope:** a `layout` animation on the row grid. A row changing column can travel
well past the Slipstream ≤12px ceiling, and the motion law reserves keyframes for mount/unmount.
Rows keep the existing `slip-enter`; panel height changes are not animated.

---

## 2. The filter moves onto what it filters

Out of the title-bar strip, and onto the list.

- **Wide:** a slot at the head of the agent list column, full column width, above the groups,
  separated from the list by its own hairline.
- **Narrow, list showing:** centered at the top of the pane, capped at `320px` so it does not
  stretch into a banner.
- **Drill-down:** no filter. There is no list to filter.

`+ New Agent` stays at the top right of the title-bar strip and **stays mounted in the drill-down**,
where it currently unmounts. It acts on the surface, not on the list.

`ctrl+f` keeps working: the `filterFocus` nonce on `useAgentsUi` is unchanged, and the focusing
effect moves to wherever the input now lives. The guard test that enumerates the `COMMANDS` registry
stays as-is.

---

## 3. One model picker, everywhere

A new app-level **`ModelPicker`** in `apps/desktop/src/renderer/panels/`, wrapping the kit's
`Combobox`. App-level rather than kit-level follows the existing precedent of `fields.tsx`,
`resolvedSet.tsx` and `RowMenu.tsx`: it composes kit members and carries app knowledge (harness
grouping, provider marks) that the kit does not own.

It owns: harness grouping and ordering, the provider/harness mark per option, the filter field, and
the reasoning-effort control.

**One component; the reasoning axis is placed by variant, because the two surfaces have very
different room.** The control vocabulary stays single — only its density adapts, which is what the
responsive rule already asks for. The variant decides both the trigger's skin and where reasoning
renders:

| Variant | Trigger | Trigger label | Reasoning |
| --- | --- | --- | --- |
| `chip` (composer) | the shelf's chip skin | `Sonnet 4.6 · think` | in the popover footer |
| `bordered` (agent editor) | the kit's bordered chip | `Sonnet 4.6` | inline, beneath the trigger |

The composer's shelf is a cramped row that cannot carry a slider, so its effort control lives in
the footer and its trigger label carries the current stop. The Runs on panel has the space, so the
ladder stays on the surface where its position against its own scale is readable at a glance; the
trigger there names only the model, because the ladder beneath it already reports the effort and
saying it twice would be noise.

The `chip` variant requires a `footer?: React.ReactNode` slot on `ComboboxProps`, since the popover
belongs to the kit.

Consequences:

- The composer's `ModelChip` — currently an unfiltered `MenuItem` list — is replaced. It gains
  filtering and harness grouping, and keeps its existing slider footer.
- `RunsOnField` keeps its `StepSlider` and its three end-caption row, but stops hand-rolling them:
  both move inside `ModelPicker`, so the two surfaces cannot drift apart.
- An empty `effortOptions` (a model with no reasoning surface, or a still-loading list) renders no
  reasoning control in either variant, and the `chip` trigger falls back to the model name alone.

The harness mark stays **outside** the trigger on both surfaces, as it is today. The harness is
derived, never chosen, so it must not look pickable.

---

## 4. The notices merge into the composer

Same construction as the approval gate: a section inside the composer's own rect, above the field,
under the top radius — not a pill floating above the composer.

- **Ground:** warn tint on the notice section itself. Drift `warn/7`; cache `warn/4`, quieter
  because it is passive.
- **Severity stays the dot,** per the indicator law: amber `needs-you` for drift, ground `idle` for
  cache. The tint says "attention"; the dot says how much.
- **The session state owns the shell border, not the notice.** The composer's edge already encodes
  running (`border-run` plus the run-blue comets) and needs-you (`border-warn` plus amber comets),
  and a notice must not overwrite either or start a shimmer of its own — a passive cache notice
  animating the composer's outline would be a straight indicator-law violation. So the shell picks
  up a static `border-warn/55` from a notice **only when the composer is otherwise idle**: no turn
  in flight and no approval docked. Whenever a real session state is present it wins outright, and
  the notice is carried by its own tinted section alone.
- **Order:** notices rank **above** the approval gate — a standing fact about the prompt outranks
  one request inside it, and the gate keeps its adjacency to the field it blocks. Among notices,
  the actionable one leads: **drift, then cache**. (This inverts today's ordering in
  `computeChatBanners`.)

### Actions

Unchanged in logic, because `computeChatBanners` already computes the split correctly:

- **Cache** is passive: **Dismiss** only. There is nothing to recompile — a cold cache from an idle
  session cannot be undone.
- **Drift** is actionable: **Recompile** and **Dismiss**. Prompts are stored per session, so
  dismissing genuinely means "keep this session's prompt as it is".

**The one behavioural addition: the cache notice becomes dismissable.** It is not today. Dismissal
must be keyed so the derived notice does not re-raise on the next render — mirroring the existing
`dismissedDriftKey`, add a `dismissedCacheKey` computed over the reasons set plus the pinned
model/provider.

### How much reason shows

**One clause, permanently visible, truncating with ellipsis. The full explanation stays on hover
and keyboard focus.**

This is a deliberate, flagged deviation. The indicator law says *detail is proximity, never
permanent prose*; the copy law says *one fact per string, at the moment it is load-bearing* — and a
warning is that moment. Today's `NoticeLine` obeys the first and hides the whole reason behind a
tooltip, which asks the reader to press **Recompile** without telling them what drifted. The
resolution: a clause naming the state is a **name**, not prose. The three-sentence paragraph stays
where the law wants it, behind proximity.

Implementation: add `summary: string` to the `Banner` shape in `console-viewmodel` and populate it
in `banners.ts` — derived from the existing `reasons` array for cache, a constant for drift. `reason`
keeps its current full text and continues to feed the `Tooltip`.

---

## 5. Rename and pin

### The name

Delete the `text-heading` usage. The display face and the edit face share **one metric**:
`--text-body`, weight 600, one line-height, one padding, one border box. The display face wears a
transparent border and no ground; clicking swaps the border to s5 and the ground to s1, focus
stepping the border to s7. **Nothing moves.**

The edit field must not inherit `TEXT_INPUT_CLASS`'s `font-mono text-code`. Appending a class will
not reliably win on font-family, so `TextInput` gains an optional prop that **replaces**
`TEXT_INPUT_CLASS` rather than appending to it. All existing callers are unaffected.

`InlineEditName`'s commit/cancel contract is unchanged, including the `settledRef` guard that
allows exactly one exit per edit session.

### The pin

The `Pinned` `Pill` is deleted. The pin becomes an `aria-pressed` icon toggle in the header action
cluster beside `⋯`: filled mark and s11 ink when pinned, outline mark and s7 when not, with the
accessible name `Pin agent` / `Unpin agent` matching the visible tooltip.

This satisfies "the indicator should also be the button" without breaking the indicator law: a
**control** may render when it is off; an **indicator** may not. `Pin` / `Unpin` stays in the row
menu as the discoverable path.

The scope `Pill` (`Project` / `Personal`) is unchanged.

---

## Invariants this must not break

- **The three defects the redesign exists to kill.** An exclusion must still look different from
  something never wanted; provenance must stay visible; the registry must not crowd the agent's own
  composition.
- **An exclusion stays visible in the agent's own list.** It is a decision about this agent, not a
  fact about the registry.
- **The add overlay stays sticky.** Toggling does not close it.
- **Panels are not cards.** No shadow, no float, no uniform tile grid, no nesting.
- **No raw values.** Colour, space, radius, duration and z come from tokens.
- **Every applicable state ships**, with the `slip slip-press` press idiom.
- **Copy laws hold:** commands Title Case, labels and state names sentence case, prose sentence case
  with a terminal period, keycaps lowercase, no em dashes.

## Out of scope

- MCP grants reaching an adapter. `createRegistryAssemblePieces` still drops `mcpServers`; the reach
  band still renders tools only. That is backend work for its own change.
- Layout animation on the row grid (see §1).
- Any change to `@coa/console-ui`. The transcript and some chat pieces still import it; it cannot be
  deleted yet and is not touched here.
- The `Combobox`'s existing keyboard and dismissal behaviour, beyond adding the `footer` slot.

## Verification

- `npx vitest run` over `apps/desktop` and `packages/console-kit` (`pnpm --filter … test` is a
  silent no-op in this repo).
- Both typecheck targets.
- Known baseline failures that are not this work: ~10 tests in `packages/adapter-deepseek` and
  `packages/adapter-longcat`; `pnpm docs:check` failing on a gitignored root `TEMP.md`; 8
  pre-existing `eslint` errors across 7 files.
- **Nothing in the preceding arc has ever been seen running.** The highest-risk unseen areas remain
  `AddPicker`'s popover placement inside a scrolling pane, and the narrow drill-down. The panel grid
  and the merged notices join that list. A maintainer pass against the running app is required
  before this is called done.

---

_Decided through the brainstorming visual companion, 2026-08-01. Mockups persist under
`.superpowers/brainstorm/`._

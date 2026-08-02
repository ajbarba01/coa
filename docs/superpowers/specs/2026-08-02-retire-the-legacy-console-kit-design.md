# Retiring the legacy console kit

Design for closing the console rebuild's last structural debt: `@coa/console-ui` stops existing, and
the retired forge palette goes with it. Sequenced inside W4, after the orphan-homes work.

## Why this exists

W4's drive-the-app pass found the component showcase rendering on a brown ground under a doubled title
bar. The cause was the surface still being wrapped in the legacy `Pane`; fixing that exposed the larger
fact behind it.

Two token systems are live at once and share no variable names. The kit defines `--color-s1…s12` in
`sand-dark.css`. The legacy kit defines `--color-bg-surface`, `--color-fg-default` and the rest,
injected **at runtime** by `tokensToCss` and resolved through a literal hex table — the retired warm-dark
"forge" palette. A legacy component asking for `bg-raised` never consults the sand scale, so no theme
control can reach it and the app's pinned sand theme cannot override it.

The palette is therefore effectively hardcoded. It is kept alive on purpose, because chat still renders
from the legacy kit, but it will keep leaking brown into any surface that touches a legacy component.
This design ends that by deleting the package rather than by re-tokening it again.

## What is actually there

Reachability was computed from the app's real imports rather than assumed.

| | Files | LOC |
| --- | --- | --- |
| Unreachable — nothing renders it | 39 | 2,428 |
| Live — needs a home | 33 | 4,366 |

Over half the package is already dead: the whole `actions/`, `inputs/` and `overlays/` families and most
of `data/` and `layout/`, all superseded by the kit.

Of what remains live, most **already looks correct**. W2 re-tokened the transcript family onto the sand
scale *in place*, inside the old package — so "lives in the old package" and "looks old" are different
facts. `Transcript`, `ToolCard`, `FindBar`, `PaneOverlay` and `DenyNotice` are already sand.

Two of the three files carrying the heaviest legacy-token load turn out to be **type-only drags**: the
app imports only `type AgentRailItem`, never rendering the rail, and `Banner` is reached only because
feedback components import its `Status` union. Both components are dead; only a type each is live.

That leaves the genuinely brown surface at two components — `Toast` and `InlineMessage` — and the real
re-token workload at roughly forty references.

## Two goals, deliberately separated

The work splits along a line worth keeping, because the two halves fail differently and are verified
differently.

- **Nothing in the app looks brown.** Small, visual, verified by eye.
- **The package stops existing.** Larger, structural, verified by the suite. Most of its work is
  relocating code that already renders correctly.

They ship as two commits in that order, so the app is visually correct — and W4's acceptance is met —
regardless of what happens to the second.

## Part 1 — the visual fix

`InlineMessage` and `Toast` are built in **`@coa/console-kit`** as a new `feedback/` family. This is
their permanent home, not a waypoint, so Part 2 does not revisit them.

Both take the kit's full member discipline: an intent block, a catalogue entry, every applicable state,
jsdom tests, and a showcase specimen. `Toast` ports from Radix to Base UI, which the kit already rides
per ADR-0014 and which ships a toast primitive. Fifteen files import Radix and all of them are in the
legacy package, but **`Toast` is the only one in the live set** — every other Radix consumer is already
unreachable, so this single port is what stands between the repo and dropping the dependency. The
`Status` tone union moves with them, out of the otherwise-dead `Banner`.

Chat, the agents surface and the showcase switch to the kit imports. After this commit no surface in the
app renders on the legacy palette.

## Part 2 — retiring the package

**A new package, `@coa/console-transcript`,** takes the streaming conversation renderer: the `dense/`
family, `DenyNotice`, and `AgentChip`. Its tests move with it unchanged.

The transcript does not go into the kit. Every kit member carries an intent block, a catalogue entry and
a specimen; a streaming renderer of this size with a single consumer cannot satisfy that, and forcing it
in would carve a permanent exception into the discipline W0 just established. A separate package states
what the thing is.

**`PaneOverlay` goes to the kit** — it is an overlay primitive, already on the sand scale, and the kit
owns the overlay family.

**Deleted:** the 39 unreachable files; the `AgentRail` and `Banner` components; the intent registry;
the legacy `cx` and `Icon` (the kit supplies both); and `tokens/` — the palette, the semantic mapping and
the injector. That last deletion is the point of the exercise.

**Two types need homes.** `Status` travels with feedback into the kit. `AgentRailItem` goes to the app,
which is the only thing that builds rail items.

**The Icon merge is a full transport.** Moved files convert to the kit's bounded `IconName` vocabulary,
which gains the glyphs the transcript uses. The codebase ends with one icon concept rather than a
bounded set plus an escape hatch.

**`tokensToCss` disappears,** so the renderer no longer injects a stylesheet. `applySettings` keeps the
rest of its job — resolving `system` to a concrete theme, setting `color-scheme`, flagging reduced
motion, and tracking the OS preference — and theming becomes the kit's CSS alone. `radix-ui` leaves the
dependency tree, where it exists nowhere else.

## Density is removed

`tokensToCss` emits density tokens alongside colors, but density only scales the *legacy* ramp. The kit
sets its type sizes as fixed values and is imported after the legacy theme, so it wins: the density
control cannot affect anything on the kit scale, which is now nearly the whole app. Retiring the package
turns "almost nothing" into "nothing".

Rather than ship a control that changes nothing, the Density row leaves Settings and the field leaves the
persisted schema. No migration is needed — settings are parsed with `safeParse` against a `z.object`,
which strips the stale key on the next write, and any unreadable blob already falls back to defaults.

Giving the kit a real density mechanism is a legitimate feature and a design question in its own right
(which members respond, and how). It is filed under "Someday / ideas", not built here.

## Verification

Part 1 is verified by eye — that is its purpose, and it is the half where a class-string test proves
nothing.

Part 2 is verified by the suite. Nothing is rewritten, so the test count must hold rather than merely
stay green: a drop means something was lost in the move. Alongside it, a clean `tsc -b`, the
`dependency-cruiser` ruleset, and a real build, since the renderer's CSS is where a missing token would
surface.

The honest gate for both is the maintainer driving the app, which W4's close-out already requires.

## Out of scope

Rebuilding the transcript — ADR-0014's standing ruling is that it is re-skinned, never rebuilt, and this
only relocates it. The light theme. The Longform and graph views, which arrive later as their own
surfaces.

## Consequences

- The forge palette stops existing. The brown cannot leak again, because there is nothing left to leak.
- The console ends with two packages that each mean one thing: primitives, and the conversation renderer.
- `radix-ui` leaves the tree; the kit's Base UI becomes the single interaction substrate.
- A user-visible control disappears. This is a deliberate honesty fix, recorded here so it is not
  mistaken later for an accidental regression.
- An ADR records the retirement, so the package's absence has a durable reason attached.

---

_Last reviewed: 2026-08-02_

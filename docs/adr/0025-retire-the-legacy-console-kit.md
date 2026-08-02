# 0025 — The legacy console kit is retired, and the forge palette goes with it

- Status: accepted
- Date: 2026-08-02

Closes the last structural debt of the workbench rebuild ([0014](0014-workbench-design-system.md)).
The transcript's own rule is unchanged: it is **re-skinned, never rebuilt** — this relocates it.

## Context and problem

Two token systems ran at once, sharing no variable names. `@coa/console-kit` defined
`--color-s1…s12` as plain CSS. `@coa/console-ui` defined `--color-bg-surface`,
`--color-fg-default` and the rest, **injected at runtime** by `tokensToCss` from a literal
hex table — the retired warm-dark "forge" palette.

A legacy component asking for `bg-raised` therefore never consulted the sand scale. No theme
control could reach it, and the app's pinned sand theme could not override it. The palette was
effectively hardcoded, and it kept leaking brown into any surface that touched a legacy
component: the symptom that started this was the component showcase rendering on a brown ground
under a doubled title bar.

Reachability, computed from the app's real imports rather than assumed:

| | files | LOC |
| --- | --- | --- |
| unreachable — nothing rendered it | 39 | 2,428 |
| live — needed a home | 33 | 4,366 |

Over half the package was already dead. Most of what remained **already looked correct**: W2
had re-tokened the transcript family onto the sand scale *in place*, inside the old package, so
"lives in the old package" and "looks old" were different facts. Two of the three files
carrying the heaviest legacy-token load were type-only drags — the app imported
`type AgentRailItem` without ever rendering the rail, and `Banner` was reached only because
the feedback components imported its `Status` union.

## Decision

Delete the package. Rehome what is live:

- **`@coa/console-transcript`** (new) takes the streaming conversation renderer — `dense/`,
  plus `DenyNotice`.
- **`@coa/console-kit`** takes `InlineMessage`, `Toast`, `PaneOverlay`, the `Status` union, and
  the tokens the retired theme was still supplying: the eight categorical `agent-*` identity
  colours and `--color-focus`.
- **The app** takes `AgentRailItem`, whose only producer it already was.
- Everything else is deleted, including `tokensToCss` and the palette it read.

### The transcript is not a kit member

Every kit member carries an intent block, a registry entry and a showcase specimen. A
3,600-LOC renderer with one consumer cannot satisfy that, and admitting it would carve a
permanent exception into the discipline the kit had just established. A separate package states
what the thing is: the kit is the vocabulary, the transcript is the one surface built from it.

### The kit's Toast does not use Base UI

Base UI 1.6 ships a toast, but it is manager-driven (`useToastManager().add()`), while the
console's only toast is a controlled error surface driven by `revealError !== null`. Adopting
the manager would have restructured the consumer to buy stacking, queueing and swipe it never
uses, and syncing controlled state into an imperative manager invites duplicate-add bugs.
[0014](0014-workbench-design-system.md) takes Base UI for mechanics we would otherwise
hand-roll badly — focus traps and anchored positioning. A toast has neither. It is a controlled
`role="status"` card instead.

`ToastProvider` was dropped rather than kept as a compatibility shim: once the card positioned
itself, the provider did nothing, and shipping a component that does nothing is the same
dishonesty as the density control below.

### Density is removed, not preserved

`tokensToCss` emitted density tokens alongside colours, but density only ever scaled the
*legacy* ramp. The kit sets its type sizes as fixed values and is imported after the legacy
theme, so it won: the control could not affect anything on the kit scale, which by then was
nearly the whole app. Retiring the package turned "almost nothing" into "nothing", so the row
left Settings and the field left the schema. No migration was needed — settings parse with
`safeParse` against a `z.object`, which strips the stale key on the next write.

Giving the kit a real density scale is a legitimate feature and its own design question. It is
filed under "Someday / ideas", not built here.

## Consequences

- **The forge palette stops existing.** Verified against the shipped bundle, not just the
  source: zero occurrences of the retired hexes in the built CSS *and* JS, where before the
  palette lived in the JS because it was injected at runtime. Renderer CSS fell 87.7 KB → 74.0 KB.
- **`radix-ui` leaves the tree.** Fifteen files imported it and all were in the retired package;
  only `Toast` was in the live set, so that single port was the whole cost. Base UI is now the
  one interaction substrate.
- **The console is two packages that each mean one thing**: primitives, and the renderer.
- **The focus ring changed colour.** It was the retired brass (`#c39a3e`), which the theme no
  longer owns. It now rides the running hue (`--color-run`), because the sand scale has no
  accent to spend and focus is an interactive state. This is a visible change.
- **A user-visible control disappeared.** Recorded here so it is not later mistaken for an
  accidental regression.
- **A latent coupling was found and closed**: the kit's own focus ring resolved through the
  legacy theme, so the kit was not self-sufficient. It is now.

---

_Last reviewed: 2026-08-02_

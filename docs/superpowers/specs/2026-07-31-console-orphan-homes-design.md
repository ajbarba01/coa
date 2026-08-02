# Console orphan homes

Design for the final phase of the console workbench rebuild: rehouse everything the new IA has not
yet given a real home, retire the prototype, and close the arc. Five pieces, one of which (the agents
surface) is a genuine redesign and the rest of which are conversions or close-out chores.

**Authority:** [ADR-0014](../../adr/0014-workbench-design-system.md) (why the design system is what it
is) and [docs/UI.md](../../UI.md) (the laws). The design below was worked through the `impeccable`
product register as UI.md requires. The picker topology and the runs-on cluster were settled against
interactive mockups reviewed with the maintainer; those are session scratch, so this spec is the
durable record of what they resolved.

## Scope

| Piece | Shape of the work |
| --- | --- |
| The agents surface | Redesign. Master–detail on the current kit, new composition model. |
| Drift / cache notices | Convert a banner strip into one composer-docked indicator line. |
| Project-switch dialog | Hold at an honest floor; state that switching does not exist yet. |
| Showcase + proto | Port the kit showcase out of `apps/workbench-proto`, then delete the app. |
| Perf "Known issues" | Re-measure each, fix the contained ones, re-file the architectural one. |

**Not in scope.** Account management, which W5's `auth` surface already took. Real project switching,
which is daemon work, not UI work. The system-prompt viewer, whose home is designed here but not
built. Anything the backend-independent agent arc owns.

**Designed here, built later.** The skills section below is specified because its shape decides the
row vocabulary everything else uses, but it is not built in this phase: pieces are dropped from the
role and package summaries and no read serves them, so building it would mean rendering invented data.
It lands with the declaration-plane widening, against the vocabulary this phase ships.

## Decisions taken

- **The agents editor is redesigned, not re-skinned.** Its data seam is untouched: the same reads and
  the same `AgentSummary`. Only the composition changes.
- **The project dialog stays at its floor.** The daemon is one fixed pipe and the workspace is derived
  from its cwd, so a switch affordance would be a lie. Switching is re-filed as its own roadmap item
  where the daemon work is visible.
- **The perf items get measured, then the cheap ones get fixed.** The poll-and-replace architecture is
  re-filed with its measurement attached rather than rebuilt inside this phase.
- **The audit is derived, not assumed.** The acceptance line "no audited feature of the old console
  lacks a working home" needs a list; there was never one, so this spec carries it (below).

## The agents surface

### The thesis

**An agent is a declaration; the editor shows what you declare and what it adds up to.**

Today's editor shows only the first half. The resolver already computes defaults, plus each selected
role's packages, plus the user's opt-ins, minus the user's exclusions, and then renders the answer as
flat checkboxes that hide every term. Exclusions are the worst of it: turning off a default renders
identically to a package you never wanted.

This matters beyond cosmetics because a package already carries its tool and MCP grants. The coming
declaration-plane widening therefore does not add three independent lists; it makes existing grants
neutral and lifts prose, memory scope and worktree policy into the same declaration. One list
vocabulary, reused, absorbs all of it.

### Layout

Master–detail, mirroring the `auth` surface: list pane, cross-faded detail, narrow drill-down at the
same breakpoint, reusing the existing narrow-measurement hook, the shared surface states, and the
dismiss-layer stack. Consistency is the product virtue, and it makes the agent set visible instead of
hidden behind a dropdown.

**Search lives in the surface's title strip**, the slot `auth` and `usage` already furnish. That is
what makes it survive the drill-down: the list pane disappears on a narrow pane, the strip never
does. It matches name, model and role, which also closes the maintainer's backlog note about agents
being searchable by model. It needs a scoped keybind so it cannot reach across surfaces.

### Runs on

Two controls, inline in the same form as everything below them, left-aligned and capped at the form
width. No section heading, no field labels, no card: the mark and the model name say what the field
is, and the ladder is self-evident under it.

- **Model** is a searchable combobox. Its rows carry a brand mark at the far left, and the field wears
  the mark of whatever is selected, so model and harness read as one item.
- **The mark is the harness, not the provider.** The row text already says the provider in words, so
  spending the glyph on the provider would repeat it; spending it on the harness states the one fact
  nothing else does. Claude models wear Claude Code's mark, everything else wears coa's tile, and the
  dropdown groups under those two names so the vocabulary is taught rather than guessed. The tooltip
  carries the sentence.
- **Harness is a statement, not a control**, because it is derived from the model's backend and there
  is nothing to choose. The slot is shaped to become a control if the two-mode render ever lands.
- **Reasoning is the shared step ladder**, adopted verbatim from the seam the composer already uses.
  Off is the ladder's first stop, so a graded model gets its full ladder and a thinking-toggle model
  gets two stops, through one control rather than a slider plus a switch. The current value reads
  centred beneath the thumb, between the end captions. No visible label; the accessible name carries
  it.

### Roles, context and skills: one vocabulary

Every one of these is a resolved set drawn from a registry that only grows, so they share a mechanism.

**The mark carries the state.** A tri-state box, not a text tag: filled check means you turned it on,
filled square means something else brings it (a default, or a role), empty means available, and a
distinct mark means you turned off something that would otherwise be on. Which source it came from is
proximity detail, never a permanent label.

**The section lists only what is in.** It stays short whatever the registry does, which is what buys
room for each row's description, so the list teaches what a package is instead of only naming it.
Adding opens a search overlay: anchored to the add row rather than centred as a modal, sticky and
multi-select so adding five things is one visit, keyboard-driven on the palette's contract, and
riding the kit's single Escape authority.

Two rules keep the compact set honest:

- **Exclusions stay in the agent's list**, not in the overlay. An exclusion is a decision about this
  agent, not a fact about the registry. Hiding it is the bug the redesign exists to kill. It mirrors
  into the overlay wearing its own mark, but its home is the agent.
- **Advisories surface as an inline nudge**, computed from the already-existing advisory flag. This
  repairs the compact set's one real weakness, which is discovery.

### Skills are filed by injection method

Skills group under their injection method rather than listing flat, because that setting is the one
that changes behaviour rather than describing it, and because filing this way makes cost legible: the
group header states what the method costs ("every request", "fetched if reached for"). Empty groups do
not render. A method the backend cannot do does not silently vanish; it says why, which is the arc's
observe-and-label-honestly rule landing where it changes what you can pick.

The method is chosen once in the overlay footer and applies to everything toggled in that visit; the
group header already states it, so a row does not repeat it. Changing it later is a quiet control that
appears on hover or focus.

Injection method is not a new concept: it is the existing piece delivery axis (rendered into the
prompt, or fetched on demand) plus the native skills directory a harness may offer.

### Reach

A closing band: the deduped union of the included packages' tool and MCP grants, grouped by source on
disclosure. It is derived truth rather than a control, so it is read-only here, and it is honest, the
assembled capability frame really is what the adapter renders as the allowlist. The declaration-plane
widening turns this band editable without moving it.

The detail header is the designed home for the deferred system-prompt viewer. The slot is named here
and left unbuilt.

### States

Loading, error, empty and ready, through the shared surface-state module W3 established. Empty is the
first-run teaching state, not "nothing here". Every row has default, hover, focus-visible, active and
disabled; a disabled row shows no hover.

### What the widening adds later

| Later addition | Where it lands | Rewrite |
| --- | --- | --- |
| Role prose / instructions | a row in the composition band | no |
| Editable tool grants | Reach stops being read-only | no |
| MCP refs | Reach's second group | no |
| Skills / pieces | already designed above | no |
| Memory scope, worktree policy | two more composition rows | no |
| Per-backend realization | the harness mark, already there | no |

**Named risk.** With skills, context and roles the detail is three stacked resolved sets, and the
widening could make it five. At that point the surface may need a structural answer (grouping, or a
second column). This is not a reason to change course now, but it should not arrive as a surprise.

## Drift and cache notices

The banner strip becomes one quiet line docked to the composer: dot, name, inline action. The
function is preserved exactly, including that both notices are derived client-side from what a send
would do rather than pushed by the daemon. Only the shape changes. Cache stays passive and clears
itself; drift stays actionable and dismissable, keyed to the config it was raised for.

The maintainer's backlog notes a staleness notice firing on a fresh session. That is a defect in the
same logic being reshaped, so it is fixed here rather than carried across.

## Project-switch dialog

Held at its floor and made honest: the open project, its root, and a plain statement that switching is
not available yet, rather than a dead affordance. Real switching needs a workspace-keyed pipe, daemon
lifecycle, and a defined fate for live sessions and layout; it is re-filed with that named.

## Showcase and the prototype

The console's showcase surface currently renders legacy-kit specimens while the current kit's showcase
lives only in the prototype. The kit showcase ports across, driven by the kit registry so a member
without a specimen fails a test. Legacy specimens shrink to only those components still shipping in
chat, so the living-spec rule holds for what actually ships rather than for a kit nothing new is built
on. `apps/workbench-proto` is deleted once the ported surface is landed and shown.

## Performance

Each item under the roadmap's known issues is re-measured against current code before anything is
claimed. The contained ones are fixed in place: dependency pre-bundling, the style scan reaching into
tests, a debounce on layout persistence, an equality guard on the poll, and batching the startup round
trips. The poll-and-replace architecture is re-filed as its own entry with the measurement attached.

The known-hollow push-stream test is fixed while in the area: it pushes under a session that is not the
active one, so it asserts nothing.

## The audit

Derived from what the pre-rebuild console shipped: the panels since deleted, the components since
retired, and the spec families. Every row must end at a home or an explicit deferral.

| Old feature | Home |
| --- | --- |
| Conversation, transcript, approvals, deny notice, raw mode | Chat surface |
| Composer, steer, interrupt | Chat surface |
| Flags, timeline | Center surfaces |
| Cost surface | Retired into `usage` |
| Account panel and selector | `auth` surface |
| Model editor, login flow | `auth` surface |
| Agent panel | This phase |
| Drift / cache banners | This phase |
| Settings panel | Shell settings dialog |
| Nav panel, panel registry, routing | Shell nav and title bar |
| Session browsing | Title-bar search morph |
| App shell, daemon status, window controls | Shell chrome |
| Showcase | This phase |
| Graph, longform, diff views | Deferred, already filed |

The table is the acceptance instrument: it is confirmed with the maintainer before implementation, and
anything found later that is missing from it is added rather than quietly dropped.

## Consequences

- **The token-budget reasoning mode disappears** from the editor, because the shared seam does not
  offer it. The composer already dropped it; keeping it in one surface is the inconsistency.
- **An unset reasoning override displays as "off"**, because the shared helper collapses the two. The
  composer already does this. It is a small dishonesty that should be fixed in both places at once,
  so it is filed rather than duplicated silently here.
- The legacy kit survives this phase. The transcript, toasts and the legacy token injection are still
  live in chat, so "no surface left on the old kit" is achievable and "one kit" is not.

## Verification

Typecheck and the full test suite green from the repo root; the docs check green. Kit changes carry
their intent block, registry entry, regenerated component doc, and a showcase specimen. Two adapter
suites fail on the baseline and are not this phase's to chase.

The real gate is the maintainer driving the running app: each home read for structure, spacing, motion
and composition, one slice at a time. A class-string test is not evidence that a surface is right.

The roadmap's phase line is flipped and the arc's in-flight section closed in the same commit as the
last piece of work.

---

_Last reviewed: 2026-07-31_

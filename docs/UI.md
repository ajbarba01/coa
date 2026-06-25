# UI — Control & Inspection Intent (placeholder until M10)

> **Status: lean placeholder.** coa's only GUI is the **M10 Console** — the last module in the build order. This
> doc records UI _intent_ so the eventual build has a frame; it does **not** pin a design system, component kit, or
> the interaction spec (that is written when M10 work begins). The concrete GUI stack (Electron + rendering layer +
> styling) is **decided at M10**, grounded in what the daemon's JSON-RPC catalogue actually exposes — not guessed
> now.
>
> Authority for the product behavior behind the GUI is [design/handoff/SPEC.md](design/handoff/SPEC.md) (M10 +
> the M8 JSON-RPC surface). UI engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and
> [CODE_STYLE.md](CODE_STYLE.md).

---

## What the GUI is (and is not)

- **An interactive control + inspection surface.** It is **not** read-only. The user both _drives_ the harness
  (issue control actions — validate, checkpoint/rewind, pin, configure, gate decisions, and more) and _inspects_
  the honest record (the flag feed, cost ledger, change-event timeline / checkpoints, Decision log, provenance).
  The detailed interaction model is specced at M10.
- **A peer client of M8's JSON-RPC catalogue — never a side-door.** Every GUI action goes through the **same M8
  catalogue the CLI uses** (M10 talks only to M8). The GUI is a second _client_, not a second _source of truth_,
  and it never reaches into M1–M9 internals. A control action the GUI needs that isn't a verb yet is an **additive
  M8 verb**, not a GUI-driven internal change — interactivity lives entirely at the M10↔M8 seam.
- **Push is about _alerting_, not interactivity.** There is **no always-on push _dashboard_** (deferred in
  [OPEN.md](design/handoff/OPEN.md) §1 as net-negative alert-noise); ambient alerting, if present, is **opt-in and
  silent** — cap-hit + high-severity only. This is the notification model and says nothing about how interactive
  the control surface is — it is fully interactive.
- **`coa raw` is sacred.** The console always offers the unfiltered loop (D85 strict-superset). The GUI must never
  hide that escape.

## Standing UI principles (bind the eventual M10 build)

- **Control through the catalogue.** Every interactive action the GUI offers is an M8 JSON-RPC verb; a write that
  mutates project state lands as a change-event through the kernel (P7 mutation chokepoint). The GUI never edits
  state out of band.
- **Determinism & inspectability.** The artifacts the GUI renders (graph, diffs, ledger) are byte-stable and
  diffable; the GUI presents them, it does not recompute or re-interpret them.
- **No prose-bearing / sensitive data from sync-eligible sources.** Free-text fields (rationale, decision-log entries,
  flag messages, `/vouch` notes) are WAL-local and may carry secrets ([OPEN.md](design/handoff/OPEN.md) §3
  risk #4). The GUI reads them only from local state, never from a sync-eligible projection.
- **Accessibility floor.** Semantic structure, sufficient contrast, visible focus, full keyboard navigation —
  non-negotiable, re-verified per surface.
- **Honest surfacing (CF-1).** The user sees **everything** via progressive disclosure (crit/high expanded;
  med/low collapsed-but-counted, never hidden). The GUI mirrors that contract.

## Decided at M10 (do not pre-decide)

- The rendering layer (React or otherwise), bundling for Electron, and the styling/token system.
- Whether a design-token system + component kit is warranted, and its shape.
- Theming, layout system, and any visual direction.

When M10 work begins, this doc is replaced by a real design-system doc (the way the reference framework's
frontend doc was structured), grounded in the M8 surface and the actual inspector screens.

---

_Last reviewed: 2026-06-24_

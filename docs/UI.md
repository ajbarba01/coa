# UI — Control & Inspection Intent

> **Status: M10 design system specified.** coa's only GUI is the **M10 Console**. The concrete design system —
> principles, the three-tier token system, component families, layout architecture, and visual direction — is
> specified in
> [superpowers/specs/2026-06-30-console-frontend-foundation-design.md](superpowers/specs/2026-06-30-console-frontend-foundation-design.md).
> That spec is the authority for the GUI's look and structure; this doc keeps only the standing invariants that
> bind the build regardless of implementation detail.
>
> Authority for the product behavior behind the GUI is [design/handoff/SPEC.md](design/handoff/SPEC.md) (M10 +
> the M8 JSON-RPC surface). UI engineering principles inherit from [ENGINEERING.md](ENGINEERING.md) and
> [CODE_STYLE.md](CODE_STYLE.md).

---

## Standing UI principles (summary — see the spec above for the full design system)

- **Control through the catalogue.** Every interactive action the GUI offers is an M8 JSON-RPC verb; a write that
  mutates project state lands as a change-event through the kernel (P7 mutation chokepoint). The GUI never edits
  state out of band, and never reaches into M1–M9 internals directly.
- **`coa raw` is sacred.** The console always offers the unfiltered loop (D85 strict-superset); the GUI must
  never hide that escape.
- **Catalogue-only, byte-faithful.** The GUI is a second _client_ of the M8 catalogue, not a second source of
  truth; the artifacts it renders (graph, diffs, ledger) are byte-stable and diffable — the GUI presents them, it
  does not recompute or re-interpret them.
- **Accessibility floor.** Semantic structure, sufficient contrast, visible focus, full keyboard navigation —
  non-negotiable, re-verified per surface.
- **Honest surfacing (CF-1).** The user sees **everything** via progressive disclosure (crit/high expanded;
  med/low collapsed-but-counted, never hidden). The GUI mirrors that contract.

---

_Last reviewed: 2026-06-30_

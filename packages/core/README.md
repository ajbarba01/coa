# @coa/core

The daemon: the change-event spine plus every ring around it — flags and the close gate, the context
engine, the config compiler, the workbench and the tool surface it hands the loop, governance and the cost
ledger, the model catalog, the skills and tool-server library, the credential-blind auth registry, the
console state store, session lifetime, and the JSON-RPC server.

- **Public interface:** `src/index.ts`.

Only the spine is shared mutable substrate; the other rings import it and `@coa/shared`, never each other
sideways. The ring layout and the rules that keep the graph acyclic are in
[REPO_LAYOUT.md](../../docs/REPO_LAYOUT.md); what each ring does, and why the boundaries fall where they
do, is in [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

This package names no backend. It declares the ports it needs and the binary that owns the composition root
constructs the concrete backend and injects it.

---

_Last reviewed: 2026-08-08_

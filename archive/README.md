# archive/ — parked feature code (reference only)

Nothing in this directory compiles, is imported, or is part of the product. It is
excluded from typechecking, linting, formatting, tests, dependency cruising, and the
docs index. Each entry below records what the code was, why it was parked, and the
future work that might revive it. When a feature is revived, its entry moves back into
the tree as ordinary code and the row is removed here.

| Entry | What it was | Why parked | Revival path |
|---|---|---|---|
| `decision-log/` | The decision-log / provenance layer: an append-only decision log with vouch records and a subtractive-change feed projected from governance WAL frames, the self-modification guard, and their wire schema — read back through the `getDecision`/`why` RPC verbs, the `coa why` / `coa decision` CLI commands, and the `why`/`get_decision` agent tools (all removed with it). | The write side never ran, so every read returned empty forever. | None planned (deliberate). |

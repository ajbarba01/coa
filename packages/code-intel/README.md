# @coa/code-intel

Pure byte→structure code analysis: tree-sitter parsing, canonicalization, symbol table, and metrics.

- **Public interface:** `src/index.ts` (the library API), plus a separate runnable parser-process entry.

The tree-sitter parser runs as an isolated child process, so a native-addon crash on a hostile file takes
down the child, not the daemon.

What is live from here today is canonicalization — the generation-drift check compares regenerated and
checked-in output through it — and the import extraction the graph is built on. The symbol table is present
and tested but nothing in production populates it; see [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_

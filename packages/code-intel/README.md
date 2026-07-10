# @coa/code-intel

M2 — pure byte→structure code analysis: tree-sitter parsing, canonicalization, symbol table, and metrics.

- **Module:** M2 Code Lens — see [`spec/M2.md`](../../docs/design/handoff/spec/M2.md).
- **Public interface:** `src/index.ts` (library API) plus a separate runnable parser-process entry.

The tree-sitter parser runs as an isolated child process, so a native-addon crash on a hostile file takes
down the child, not the daemon.

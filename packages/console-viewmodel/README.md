# @coa/console-viewmodel

The pure daemon-result→render-props layer for the console. No electron, react, or core imports.

- **Public interface:** `src/index.ts`.

Keeping the mapping pure is what lets the console's shapes be tested without a browser or a running
daemon: every wire payload is validated here and turned into exactly what a component renders, so a
panel never parses a daemon reply itself. What the console is built from, and why the boundary sits
here, is in [ARCHITECTURE.md](../../docs/ARCHITECTURE.md).

---

_Last reviewed: 2026-08-08_

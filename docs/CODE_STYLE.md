# Code Style

> CORE doc — project-agnostic; product facts live in the handoff docs, project facts in [DESIGN.md](DESIGN.md).

> Authority for **formatting, naming, and documentation conventions**. Read before writing any code. For
> architecture/quality principles see [ENGINEERING.md](ENGINEERING.md). Most of this is enforced by tooling — when
> in doubt, run the tools.

Sourced from the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), the
[community TypeScript Style Guide](https://mkosir.github.io/typescript-style-guide/), and [TSDoc](https://tsdoc.org/).

---

## Tooling (the source of truth for formatting)

- **Prettier** formats; **ESLint** lints; **`tsc --strict`** type-checks. The pre-commit hook runs all three —
  code failing any does not get committed (never `--no-verify`; fix the root cause).
- Line length ~100. Don't hand-format around the formatter; let Prettier own whitespace.
- `tsc` runs in `strict` mode with `noUncheckedIndexedAccess` and project references across the workspace (see
  [REPO_LAYOUT.md](REPO_LAYOUT.md)). A type error is a build failure, not a warning.

## Naming

- `camelCase` — variables, functions, methods.
- `PascalCase` — types, interfaces, enums, classes. **No `I` prefix** on interfaces (`GraphView`, not `IGraphView`).
- `UPPER_CASE` — true global constants and the named tuning-knob defaults.
- **Booleans** read as predicates: prefix `is` / `has` / `should` (`isStale`, `hasFix`).
- Descriptive, unabbreviated. No `tmp`, `data2`, or ambiguous shorthand. Match the SPEC's vocabulary — a
  change-event is a `ChangeEvent`, a flag is a `FlagRecord`, a content atom is a `Piece`. Don't invent synonyms for
  named domain concepts.

## Files & folders

- Non-component source files: `kebab-case.ts` (`change-event.ts`, `symbol-table.ts`, `resolve-piece.ts`).
- **One primary export per file; the file is named for it.** A file exporting `canonicalize` is `canonicalize.ts`.
- Tests sit next to the unit as `*.test.ts` (Vitest). Cross-package integration tests live in the package's
  `test/` directory. (See [REPO_LAYOUT.md](REPO_LAYOUT.md) for the per-package anatomy.)
- Type-only modules (notably M0 `shared`) export types/schemas and **no runtime behavior**.

## Imports

- Order: external packages → internal **workspace packages** (`@coa/shared`, `@coa/core`, …) → relative.
- **Use the workspace package name across package boundaries**; never deep-reach into another package's `src/`
  with a relative chain. Within a package, prefer shallow relative imports over `../../../`.
- No unused imports (ESLint enforces). No backend SDK imports outside `adapter-claude-sdk` (ENGINEERING #3).

## Schemas & types (M0 is the home)

- Shared wire/record types and their Zod schemas live in **`@coa/shared` (M0)** and are imported, never
  re-declared (ENGINEERING #6). A module that needs a new shared field changes M0, not its own copy.
- Validate external data at the boundary with the M0 schema; downstream code receives a typed, validated object.
- Prefer discriminated unions over loose strings for closed sets (`kind`, `type`, `provenance`, `EdgeType`).

## Documentation (TSDoc)

- Use `/** … */` TSDoc on **exported functions, types, and public interfaces** — especially the module public
  interfaces named in the SPEC (`emit`, `subscribe`, `graph.query`, `lookup`, `resolvePiece`, …).
- `@param` / `@returns` **only when they add information** beyond name and type — don't restate the signature.
- Comments explain **WHY**, never restate **WHAT**. If code needs a comment to explain what it does, prefer
  clearer code.
- **Never reference a build phase, plan, or module ID in a code comment** (it rots and leaks internal codenames —
  same rule as commit subjects). No commented-out code, no leftover debug logging, no naked `TODO` (track it).

```ts
/** Answer "are these two artifacts equal modulo formatting?" deterministically — the shared G0 primitive. */
export function canonicalize(artifact: Uint8Array, profile: TierProfile): CanonicalForm { … }
```

---

_Last reviewed: 2026-06-24_

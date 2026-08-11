# Code Style

> Authority for **formatting, naming, and documentation conventions**. Read before writing any code. For
> architecture and quality principles see [ENGINEERING.md](ENGINEERING.md); for what the system is and the
> vocabulary it uses, [ARCHITECTURE.md](ARCHITECTURE.md). Most of this is enforced by tooling — when in doubt,
> run the tools.

Sourced from the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), the
[community TypeScript Style Guide](https://mkosir.github.io/typescript-style-guide/), and [TSDoc](https://tsdoc.org/).

---

## Tooling (the source of truth for formatting)

- **Prettier** formats; **ESLint** lints; **`tsc`** type-checks. `pnpm check` runs all three plus the tests and
  the dependency ruleset — that is the gate, and nothing lands without it (see [WORKFLOW.md](WORKFLOW.md)).
- Line length ~100. Don't hand-format around the formatter; let Prettier own whitespace.
- **Markdown is deliberately exempt from Prettier** — docs are authored prose with hand-aligned tables the
  formatter would collapse. So is `archive/`, which is parked reference code and not part of the product.
- `tsc` runs strict, with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and project references across
  the workspace (see [REPO_LAYOUT.md](REPO_LAYOUT.md)). A type error is a build failure, not a warning.

## Naming

- `camelCase` — variables, functions, methods.
- `PascalCase` — types, interfaces, enums, classes. **No `I` prefix** on interfaces (`GraphView`, not `IGraphView`).
- `UPPER_CASE` — true global constants and the named tuning-knob defaults.
- **Booleans** read as predicates: prefix `is` / `has` / `should` (`isStale`, `hasFix`).
- Descriptive, unabbreviated. No `tmp`, `data2`, or ambiguous shorthand. Match the vocabulary the architecture
  already uses — a change event is a `ChangeEvent`, a flag is a `FlagRecord`, a content atom is a `Piece`. Don't
  invent synonyms for named domain concepts.

## Files & folders

- Non-component source files: `kebab-case.ts` (`change-event.ts`, `symbol-table.ts`, `resolve-piece.ts`). React
  components are `PascalCase.tsx`, named for the component.
- **One primary export per file; the file is named for it.** A file exporting `canonicalize` is `canonicalize.ts`.
- Tests sit next to the unit as `*.test.ts` (Vitest). Cross-module integration tests live in a `test/` directory.
  (See [REPO_LAYOUT.md](REPO_LAYOUT.md) for the per-package anatomy.)
- Type-only modules — notably `@coa/shared` — export types and schemas and **no runtime behavior**.

## Imports

- Order: external packages → internal **workspace packages** (`@coa/shared`, `@coa/core`, …) → relative.
- **Use the workspace package name across package boundaries**; never deep-reach into another package's `src/`
  with a relative chain. Within a package, prefer shallow relative imports over `../../../`.
- No unused imports (ESLint enforces). No backend SDK imports outside the adapter that owns that backend
  (ENGINEERING #3) — the dependency ruleset fails the gate on one.

## Schemas & types

- Shared wire and record types and their Zod schemas live in **`@coa/shared`** and are imported, never
  re-declared (ENGINEERING #6). Something that needs a new shared field changes the shared package, not its own
  copy.
- Validate external data at the boundary with the shared schema; downstream code receives a typed, validated
  object.
- Prefer discriminated unions over loose strings for closed sets (`kind`, `type`, `provenance`, edge types).

## Documentation (TSDoc)

- Use `/** … */` TSDoc on **exported functions, types, and public interfaces** — especially the ones another
  package calls.
- `@param` / `@returns` **only when they add information** beyond the name and type — don't restate the
  signature.
- Comments explain **WHY**, never restate **WHAT**. If code needs a comment to explain what it does, prefer
  clearer code.
- **Never reference a build phase, a plan, a ticket, or an internal codename in a code comment** — it rots, and
  it leaks vocabulary no reader outside that session has. Same rule as commit subjects. Rationale that outlives
  the change goes in the architecture doc; the comment says why _this line_ is the way it is.
- No commented-out code, no leftover debug logging, no naked `TODO` (track it).

```ts
/** Answer "are these two artifacts equal modulo formatting?" deterministically. */
export function canonicalize(artifact: Uint8Array, profile: TierProfile): CanonicalForm { … }
```

---

_Last reviewed: 2026-08-08_

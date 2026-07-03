# Context-format rewrite — design

**Status:** DESIGN (approved in brainstorming). Implements the format/content half of the core-context spike
(`core-context-and-roles-spike.md`, DC-1 structure-first + DC-6 layer order) at the actual Piece level.
**Scope:** give the assembled system prompt a real DC-6 section skeleton, rewrite the baseline + starter-role
Piece bodies to best-practice content, and keep it adapter-agnostic (one shared render helper; per-backend
concerns stay in each `renderNative`). **Out of scope:** the DeepSeek base tools (Read/Bash/… — a separate
follow-on), the DC-3/DC-4 capability redesign, DC-9.
_Last reviewed: 2026-07-03._

---

## 1. Problem

Everything built so far is structural plumbing (safety removal, roles, multi-role, layer-on-native). The
actual prompt **content and formatting** — the heart of the original "best-in-class core prompt" ask — is
untouched: Piece bodies are terse one-liners and the renderers join them with a raw `\n\n`, so the compiled
prompt has no section structure, no DC-6 ordering as a visible document, and no best-practice content. This
design applies the spike's format research to the Pieces themselves.

## 2. Approach (decided)

- **Structure lives in the assembly**, not the Piece bodies. A shared render helper owns the *section
  skeleton* (headers + order); each Piece body stays free-form **markdown prose** that fills a section. This is
  the harness-standard pattern (Cline `{{SECTION}}` template + components; goose/SWE-agent Jinja templates;
  Roo section-builders) — template owns the skeleton, content fills in.
- **A fixed DC-6 slot skeleton.** Each Piece is tagged with a `slot`; the helper groups by slot and emits
  slots in DC-6 order under their headers.
- **Full best-practice content rewrite** of the baseline + starter-role Pieces (concise, imperative,
  structured, minimal relevant persona — no expert hype).
- **Per-backend rendering stays in each adapter** (DC-5a): the shared helper is neutral; the drop-set, the
  Claude boundary heading, and the preset `append` wrapping live in the Claude adapter; DeepSeek renders the
  full sectioned prompt.

## 3. The DC-6 slot skeleton

Defined once in `@coa/shared` as an ordered list of `{ id, header }`:

| order | slot id          | header (markdown H2)        |
| ----- | ---------------- | --------------------------- |
| 1     | `identity`       | `## Identity`               |
| 2     | `tone`           | `## Tone`                   |
| 3     | `tool-use`       | `## Using tools`            |
| 4     | `code-discipline`| `## Changing code`          |
| 5     | `governance`     | `## Operating under coa`    |
| 6     | `roles`          | `## Role`                   |
| 7     | `project`        | `## Project context`        |
| 8     | `volatile`       | `## Environment`            |

- Exported as `SLOTS` (ordered) + a `SlotId` union. Headers are data, tunable in one place.
- A Piece with no `slot`, or an unknown `slot`, falls to an implicit **end bucket** rendered last under no
  header (drop-unknown / never-throw, SC-1) — so an unclassified Piece still appears rather than vanishing.

## 4. Piece schema change (`@coa/shared`)

Add one optional field to `pieceSchema`:

```ts
slot: slotIdSchema.optional(),   // which DC-6 section this Piece renders in; absent ⇒ end bucket
```

`slotIdSchema = z.enum([...SLOT_IDS])`. Purely additive — existing Pieces without a `slot` still validate and
render (end bucket). `compile()` already spreads the whole Piece through, so `slot` survives to `renderNative`
untouched; no compiler change needed.

## 5. The shared render helper

A pure function in `@coa/shared` (both adapters depend on `@coa/shared`; it owns `Piece`/`NeutralConfig`):

```ts
/** Group ordered Pieces by DC-6 slot and render each non-empty slot as `## Header` + its bodies.
 *  Pure + deterministic (byte-stable for identical input → cache-safe). Empty slots are skipped.
 *  Within a slot, Pieces keep their incoming order (compile's most-stable-first ordering). */
export function renderSections(pieces: readonly Piece[]): string;
```

- Iterates `SLOTS` in order; for each, concatenates the bodies of the Pieces whose `slot` matches, under the
  slot header; appends the end-bucket (unslotted) Pieces last. Joins sections with a blank line.
- Replaces the raw `[...].map(o => o.piece.body).join('\n\n')` in **both** adapters' prompt assembly. The
  helper takes the already-ordered, already-(backend)-filtered Pieces; slot grouping is stable so ordering and
  cache byte-stability are preserved.

## 6. Per-backend rendering

**Claude** (`packages/adapter-claude-sdk/src/render-native.ts`):
- Filter out `PRESET_COVERED_PIECES` (now includes `baseline-tone`, see §7) as today.
- `body = renderSections(filteredPieces)`.
- Wrap with the top-level boundary: `const append = body === '' ? '' : `# coa governance layer\n\n${body}`.`
- Standing reminders / re-anchor file logic unchanged; `sdk-options.ts` still puts `append` into
  `{ type: 'preset', preset: 'claude_code', append }`.

**DeepSeek** (`packages/adapter-deepseek/src/…` `renderSystemPrompt`):
- `renderSections(allPieces)` (no drop-set, no boundary heading — the Identity section leads). This becomes the
  whole `systemPrompt`.

The two adapters differ only in the drop-set + the boundary — both delegate the section skeleton to the shared
helper, so the format is defined once (DC-5a: neutral composition, backend specifics in the adapter).

## 7. Content rewrite + slot assignments

Rewrite the bodies (concise, imperative, structured, minimal persona) and assign slots:

| Piece                  | slot             | notes |
| ---------------------- | ---------------- | ----- |
| `baseline-identity`    | `identity`       | coa-neutral identity + "a human steers; act when you have enough" |
| **`baseline-tone`** (NEW) | `tone`        | numeric terseness / no-preamble rule. **Added to `PRESET_COVERED_PIECES`** → dropped on Claude (preset covers it), kept on DeepSeek |
| `baseline-tool-use`    | `tool-use`       | prefer dedicated tools, parallel calls, don't retry denied. (preset-covered → Claude drops) |
| `baseline-code-quality`| `code-discipline`| match style, smallest correct change, honest reporting. (preset-covered → Claude drops) |
| `coa-orientation`      | `governance`     | what coa is + governed-tools nudge |
| `role-swe` / `role-researcher` | `roles`  | rewritten role sections |
| `baseline-environment` | `volatile`       | platform + date (preset-covered → Claude drops) |

Example rewritten body (`role-researcher`, markdown prose that fills the `## Role` section):

```
You investigate and explain; you do not edit code.
- Gather evidence from the codebase before reaching for the web.
- Cite where each finding came from.
- Prefer reading the symbol graph over guessing.
```

Full authored bodies are produced during implementation (the plan); this design fixes the *principles*, the
*slots*, and the *tone-piece addition*.

## 8. Cache / determinism

Slot order is a fixed constant; `renderSections` is a pure function of its input Pieces; within-slot order is
the stable compile order. So identical input renders byte-identically — the prompt-cache byte-stable-prefix
invariant (D-P2/P1) holds. Volatile content stays in the `volatile` slot (last), unchanged.

## 9. Testing

- **`renderSections` unit tests:** slot grouping; DC-6 order; headers present; empty slots skipped; end-bucket
  for unslotted/unknown; within-slot order preserved; determinism (same input → identical output).
- **Piece assertions:** each baseline/role Piece has the expected `slot`; `baseline-tone` exists and is in
  `PRESET_COVERED_PIECES`; rewritten bodies parse + carry pushed/authored axes.
- **Claude adapter:** the append is `# coa governance layer` + only the non-dropped sections; dropped sections
  (`tone`/`tool-use`/`code-discipline`/`volatile`) absent; boundary omitted when the body is empty.
- **DeepSeek adapter:** full sectioned prompt including `tone`/`env`; identity leads; no boundary heading.

## 10b. Revision — the decoupled model (supersedes §7 where they differ)

Review feedback surfaced a coupling flaw: putting task conduct (`## Changing code`) in the always-on baseline
contradicts a read-only role, and role pieces duplicated package conduct. Decision (approved):

- **Baseline = universal-only.** Only what is true for *any* agent regardless of task: `identity` (generic —
  NOT "software engineer"), `tone`, generic `tool-use` conduct, `environment`. **`baseline-code-quality` is
  deleted.**
- **Packages carry task *conduct* (the "how").** `pkg-coding` (slot `code-discipline`) becomes the single home
  of code-editing conduct, absorbing the old `baseline-code-quality` + the edit-specific tool line. A role
  without the coding package never sees code-editing conduct — maximal configurability, no section overlap.
- **Roles carry only *scope/boundary* (the "what/who"),** not conduct: `role-swe` = "you implement code
  changes end to end and are accountable for them working"; `role-researcher` = "you investigate and explain;
  you do not edit code."
- **Identity is generic and backend-provided where possible.** The model name stays out of coa's text (volatile
  + the backend states it — Claude's preset says "Claude Code"). coa's generic identity is therefore **added to
  the Claude drop-set**.
- **Claude drop-set (`PRESET_COVERED_PIECES`) = `{ baseline-identity, baseline-tone, baseline-tool-use,
  baseline-environment }`** — exactly the preset-covered generics. Kept on Claude: `coa-orientation`
  (governance), `pkg-coding` (points at coa's governed tools the preset lacks), and role scopes. So a Claude
  swe append ≈ `# coa governance layer` → `## Operating under coa` → `## Changing code` → `## Role`.

Package→slot map: `pkg-coding`→`code-discipline`, `pkg-research`→`tool-use`, `pkg-planning`→`roles`,
`pkg-coa-butler`/`coa-orientation`→`governance` (slots are data — retunable later).

## 10. Files

- `packages/shared/src/piece.ts` — `slot` field + `SLOTS`/`SlotId`/`slotIdSchema` (or a new `slots.ts`).
- `packages/shared/src/render-sections.ts` (new) — the pure helper + tests.
- `packages/core/src/session/baseline-pieces.ts` — rewritten bodies + slots + the new `baseline-tone` piece.
- `packages/core/src/session/agent-registry.ts` — rewritten `role-*` bodies + `roles` slot.
- `packages/adapter-claude-sdk/src/render-native.ts` — use `renderSections`, add boundary, extend
  `PRESET_COVERED_PIECES` with `baseline-tone`.
- `packages/adapter-deepseek/src/…` — use `renderSections`.
- Tests alongside each.

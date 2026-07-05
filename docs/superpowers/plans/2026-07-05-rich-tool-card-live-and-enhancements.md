# Rich Tool Card — Live Wiring + Enhancements — Plan

Executes `docs/superpowers/specs/2026-07-05-rich-tool-card-live-and-enhancements-design.md`. Enhancements first
(Track A, showcase-verified), then live wiring (Track B). TDD the pure units. Token-only styling, strict TS,
byte-faithful (D128), SC-1. Commit in logical units, subject-only Conventional Commits, stage by name.

## Track A — content enhancements (`packages/console-ui/src/dense/`)

### T1 · `toolTarget` + line-aware `onOpenPath`
- `toolRegistry.ts`: add `toolTarget(tool, input): { path: string; line?: number } | undefined`. Covers file tools
  (`Read` line from `offset`; `Edit`/`Write`/`NotebookEdit` path) and symbol tools
  (`get_symbol`/`edit_symbol`/`get_piece`/`get_spec`/`apply_patch` via `ref.path`/resolved name). Keep `toolPath`
  or delete once unused. Pure, never throws.
- `ToolCard.tsx`: widen `onOpenPath` to `(path: string, line?: number) => void`; header link shows `path:line` and
  calls `onOpenPath(path, line)`.
- Tests: `toolTarget` per tool (incl. malformed → undefined); link renders line + fires with line.

### T2 · Search-match links
- `matchLines.ts` (new, pure): `parseMatchLine(tool, line): { path: string; line?: number; text?: string } |
  undefined` — `Grep` `path:line[:text]`, `Glob` bare `path`, else undefined. Byte-faithful.
- `ToolCard.tsx`: `Grep`/`Glob` body → list of clickable rows (fallback plain text for unparsed); clamp/Expand
  intact. Verify live `Grep`/`Glob` output shape; keep parser tolerant.
- Tests: parser cases; body renders links + calls `onOpenPath(path, line)`.

### T3 · Symbol tools like `Edit`/`Read`
- Extend `parseEdit` (in `ToolCard.tsx`) to derive `{before, after}` from an input `DiffSpec`: `search-replace`
  hunks (find→before, replace→after, per hunk) and `whole-file` (before='', after=body). Applies to
  `edit_symbol`/`apply_patch` → `ToolDiffView`.
- `get_symbol`/`get_piece`/`get_spec` → highlighted preview branch (like `Read`), language from ref path.
- Tests: `parseEdit` for both DiffSpec forms; symbol cards render diff/preview.

### T4 · `run_checks` chips
- `runChecks.tsx` (new): parse `run_checks` output → per-check chips (`typecheck ✓ · lint ✓ · tests ✓ · N flags`),
  `success`/`danger` tokens; non-matching → fall back to plain preview. Only `run_checks` (YAGNI).
- `ToolCard.tsx`: route `run_checks` body through it.
- Tests: parse + chip render; malformed → fallback.

### T5 · Red error markers
- `errorMarks.tsx` (new, pure): wrap `error TS\d+`, `Exit code: \d+`, leading `error:` in `danger` token spans;
  layered over the existing whole-body red. Byte-faithful (textContent === source).
- `ToolCard.tsx`: apply within the output preview body.
- Tests: markers wrapped; bytes unchanged; non-error text untouched.

### T6 · Showcase + catalogue
- Extend `TOOL_CALLS` samples if a case is missing (search-replace `edit_symbol`, failing `Bash` w/ error code,
  `get_symbol` w/ source). Confirm each enhancement renders in `RichDirection`.
- Register any new kit member in `registry.ts`; add intent blocks; **regenerate `COMPONENTS.md`** (throwaway
  `_regen.test.ts` per the handoff note, then delete). Update `REPO_LAYOUT.md`/`UI.md` if files added.

**Track A gates:** `corepack pnpm -C packages/console-ui exec tsc -b` = 0; targeted `vitest run` green;
`corepack pnpm -C apps/desktop build` green. Commit as coherent units.

## Track B — live wiring (after A lands)

### T7 · Swap private `ToolCard` in `Transcript.tsx`
Replace the private card in `TranscriptRow` (tool/tool-use/tool-result) with the kit `ToolCard`. Preserve
gutter/spine/`dotTone` and `foldToolFrames` identity-caching (MemoRow memo must still hit). Delete the private card.

### T8 · Host `PaneOverlayProvider` in `ChatPanel.tsx`
Wrap the transcript region so Expand is pane-confined; coexists with the floating composer. Confirm confinement
from a deeply-scrolled row.

### T9 · `coa.openPath(path, line?)` IPC
- Pin down the session worktree root source in main FIRST (open wiring point).
- preload verb (`preload/index.ts` + `api.d.ts`, channel per `shared/methods.ts`); main `ipcMain.handle`: resolve
  vs worktree root, **confine** (reject escapes), spawn `code -g <abs>:<line>`, fallback
  `shell.showItemInFolder`. `ChatPanel` threads `onOpenPath` → cards. Failure → toast (SC-1).

### T10 · PaneOverlay a11y
`aria-modal`, initial focus/focus-trap, scrim parity with the kit Dialog.

**Track B gates:** both `tsc -b` = 0; build green; unit/mapper tests where feasible. Visual verification
(overlay confinement + reveal-in-editor) owed to the maintainer via `corepack pnpm -C apps/desktop dev`.

---

_Last reviewed: 2026-07-05._

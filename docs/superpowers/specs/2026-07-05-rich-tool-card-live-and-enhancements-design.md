# Rich Tool Card — Live Wiring + Content Enhancements — Design

> **Status:** approved design, pre-plan. Continues the rich tool card work (build spec:
> `2026-07-05-rich-tool-card-design.md`; handoff: `docs/superpowers/handoffs/2026-07-05-rich-tool-card-live-wiring.md`).
> The rich card is a real kit member on `main`; this spec (a) adds five maintainer-requested **content
> enhancements** to it and (b) **wires it live** into the transcript, replacing the transcript's private tool card
> and activating the `onOpenPath` seam through a new reveal-in-editor IPC.
>
> **Scope decision (maintainer):** one design, **enhancements first**. Build the five enhancements into the kit
> `ToolCard` (verified in the showcase with full-content samples), then live-wire. The two tracks share one seam:
> `onOpenPath(path, line?)`.

---

## 1. Goal

Make the rich tool card both **richer** and **live**:

- **Content:** clickable path/line links everywhere (reveal at the exact line), clickable search-match results,
  symbol tools that read like `Edit`/`Read`, a structured `run_checks` body, and red error markers.
- **Live:** the card is the real tool rendering in the transcript (not a private stand-in), its Expand overlay is
  pane-confined, and a path/match click reveals the file in VS Code at the line via a confined IPC.

All byte-faithful (D128), token-styled, and SC-1/D85-safe.

## 2. Decisions (maintainer-confirmed)

- **Reveal action:** clicking a path or a search match runs, in the main process, `code -g <abs-path>:<line>` — VS
  Code jumped to the exact line/match. If `code` is not on `PATH` (or the spawn fails), fall back to
  `shell.showItemInFolder(<abs-path>)`. (No line jump on the fallback.)
- **Scope/order:** one spec; implement Track A (enhancements, showcase-verified) before Track B (live wiring).
- **Enhancement specifics (a/b/c):** `run_checks` renders as per-check status chips; error markers are colored red
  **on top of** the existing whole-body red for failed calls; the "render like `Edit`/`Read`" treatment covers
  `get_piece`/`get_spec`/`apply_patch` in addition to `get_symbol`/`edit_symbol`.

## 3. Invariants (binding)

- **SC-1 / D85 / D128:** the card only surfaces (adds no block); it never touches the `coa raw` path (raw frames
  pass through verbatim); every rendered payload byte (diff lines, previews, match lines, overlay content) is
  verbatim — highlighting/red-marking/gutter marks are presentational spans and MUST NOT mutate bytes. The
  reveal-IPC failure surfaces (a toast/notice), never blocks. The `≈ tok` count stays a labelled derived hint and
  keeps counting the tool's **output** (its context cost), even on edit cards.
- **Determinism-first:** no model call on any critical path (all rendering is pure/deterministic).
- **Path confinement:** the reveal IPC resolves worktree-relative paths against the **session worktree root** and
  refuses any path that escapes it — never open an arbitrary path.
- **Kit discipline:** token utilities only (no raw hex/px; "blue" = `info`, "red" = `danger`); no
  `dangerouslySetInnerHTML`; changed/new kit members carry an intent block and register in `registry.ts`;
  `COMPONENTS.md` is **generated** (regenerate, don't hand-edit).
- **TypeScript strict**, no `any`, `exactOptionalPropertyTypes` (optional props/params typed `T | undefined`),
  `noUncheckedIndexedAccess`. Pure helper layers (path/language/clamp/parse) stay pure and never throw.

## 4. The shared seam — `onOpenPath(path, line?)`

The card's `onOpenPath?: (path: string) => void` becomes `onOpenPath?: (path: string, line?: number) => void`. Every
click target below (header link, search-match link) routes through it. In the showcase it toasts; live, `ChatPanel`
supplies a handler backed by the reveal IPC (Track B).

## 5. Track A — content enhancements (kit `ToolCard`; showcase-verified)

All in `packages/console-ui/src/dense/`. Each unit has one responsibility and a defined interface.

### A1 · Path + line links everywhere (feedback #4)
- **`toolRegistry.ts`** — replace/augment `toolPath` with **`toolTarget(tool, input): { path: string; line?: number }
  | undefined`**. It resolves the click target for the file tools **and** the symbol tools:
  - `Read`: `path` + `line` from `offset` (the range's start).
  - `Edit`/`Write`/`NotebookEdit`: `path` (no line, or `line` if a natural anchor exists).
  - `get_symbol`/`edit_symbol`/`get_piece`/`get_spec`/`apply_patch`: `path` from the ref (`ref.path`, or the
    resolved name — `undefined` when name-only and unresolvable), `line` when known.
- **`ToolCard.tsx`** — the header link renders `path:line` (line appended when present) and calls
  `onOpenPath(path, line)`. Pure; malformed input → no link (plain text), never throws.

### A2 · Search-result links (feedback #2)
- **`ToolCard.tsx`** body branch for `Grep`/`Glob`: render each output line as a clickable match row. A small pure
  parser (**`dense/matchLines.ts`**, new) turns a line into `{ path, line? }`:
  - `Grep`: `path:line[:text]` → `{ path, line }` (text preserved as trailing context, byte-faithful).
  - `Glob`: bare `path` → `{ path }`.
  - Unparseable → render the verbatim line as plain text (defensive).
- Each parsed row is a button → `onOpenPath(path, line)`. Clamp/Expand still apply (long result sets clamp to
  `maxLines` with the Expand control). Verify the **live** `Grep`/`Glob` output shape during implementation and keep
  the parser tolerant.

### A3 · Symbol tools render like `Edit`/`Read` (feedback #3)
- **`edit_symbol` / `apply_patch`** → diff body: extend **`parseEdit`** to derive `{ before, after }` from the
  input `DiffSpec`:
  - `search-replace`: `before` = hunk `find`s, `after` = hunk `replace`s (rendered per hunk, or joined — decide in
    the plan; per-hunk preferred for fidelity).
  - `whole-file`: `before` = '' , `after` = `body` (all-added, like `Write`).
  - Render through the existing **`ToolDiffView`** with language from the ref path.
- **`get_symbol` / `get_piece` / `get_spec`** → preview body: render the returned source as a highlighted preview
  (the same branch `Read` uses), language inferred from the ref path via `languageForPath`; plain when unknown.

### A4 · `run_checks` structured body (feedback #1, decision a)
- **`dense/runChecks.tsx`** (new) — a small, defensive renderer: parse `run_checks` output into per-check results
  and render **status chips** (e.g. `typecheck ✓ · lint ✓ · tests ✓ · N flags`), colored with `success`/`danger`
  tokens. Anything that doesn't parse falls back to the plain preview body. **YAGNI:** only `run_checks` gets this
  now — not a generic structured-tool framework.

### A5 · Red error markers (feedback #5, decision b)
- **`dense/errorMarks.tsx`** (new, pure) — a token-level highlighter that wraps error markers
  (`error TS\d+`, `Exit code: \d+`, a leading `error:`) in the strong `danger` token, layered **on top of** the
  existing whole-body `danger-text` tint used when `ok === false`. Span-wrap only (D128); applied within the output
  preview body. Keep the marker set small and defensive.

### Showcase (A verification)
The `RichDirection` showcase (`ChatMockups.tsx`, already un-clipped) exercises the enhancements with the
`TOOL_CALLS` samples; extend the samples if a case is missing (e.g. a `search-replace` `edit_symbol`, a failing
`Bash` with an error code, a `get_symbol` with source). Each enhancement is reviewable there before Track B.

## 6. Track B — live wiring

### B1 · Swap the private `ToolCard`
In **`Transcript.tsx`**, replace the private `ToolCard` (rendered by `TranscriptRow` for the `tool`/`tool-use`/
`tool-result` frames) with the kit `ToolCard`. Preserve the gutter/spine/`dotTone` treatment and the
`foldToolFrames` **identity-caching** (streamed frames must keep row identity so `MemoRow`'s `React.memo` still
hits). Delete the private card once unused.

### B2 · Host the pane overlay
Wrap the transcript region in **`ChatPanel.tsx`** with `PaneOverlayProvider` so Expand opens **within the chat
pane**, not the window. Confirm it stays confined when triggered from a deeply-scrolled row and coexists with the
floating-composer dock (the overlay covers the transcript region; the composer floats over its bottom edge).

### B3 · Reveal-in-editor IPC — `coa.openPath(path, line?)`
- **preload** (`apps/desktop/src/preload/index.ts`): a `coa.openPath` verb following the existing
  `ipcRenderer.invoke` pattern (channel per `shared/methods.ts`); typed in `preload/api.d.ts`.
- **main** (`apps/desktop/src/main/index.ts`): `ipcMain.handle` that (1) resolves the path against the active
  session's worktree root, (2) **confines** it to the worktree (reject escapes), (3) spawns `code -g <abs>:<line>`
  and (4) falls back to `shell.showItemInFolder(<abs>)` when `code` is unavailable/fails. Returns a result the
  renderer can surface; on failure the renderer shows a toast (SC-1 — surface, never block).
- **`ChatPanel.tsx`**: thread an `onOpenPath` that calls the verb into the transcript's cards.

### B4 · PaneOverlay a11y (deferred from the build phase)
`aria-modal="true"` + initial focus / focus-trap on the overlay; align its scrim to the kit's
`overlay-scrim bg-black/50` (Dialog parity). Small and self-contained.

## 7. Explicitly out of scope
- **`getToolDetail`** (fetch tool output beyond the daemon cap) — the handoff's optional item; not requested.
  Expand of the already-handed (capped) output is sufficient for now.

## 8. Open wiring point (pin down in the plan, don't guess)
Where the **main process** obtains the active session's **worktree root** to resolve relative paths for
`openPath` — likely already available in main's session state from the push wiring. Confirm the source before
implementing B3.

## 9. Testing & verification
- **Pure units** (`toolTarget`, `matchLines`, `parseEdit` extension, `run_checks` parse, `errorMarks`): unit-tested
  for correctness and byte-faithfulness (`textContent` equals source).
- **`ToolCard`** kind-by-kind render tests (per the existing pattern) for the new bodies and link wiring.
- **Live wiring**: build + `tsc` clean for touched files; a CLI/e2e or mapper unit where feasible. The **floating
  composer / overlay confinement / reveal-in-editor** behaviors are layout/OS-dependent → **visual verification in
  `corepack pnpm -C apps/desktop dev`** is owed to the maintainer (jsdom can't exercise them).
- Registry: new/changed kit members registered + **`COMPONENTS.md` regenerated**; `REPO_LAYOUT.md`/`UI.md` updated
  per the same-commit doc rule.

## 10. Build order
1. **A1** (`toolTarget` + `onOpenPath(path, line?)` seam) — foundation for links.
2. **A2** (search-match links), **A3** (symbol tools), **A4** (`run_checks`), **A5** (error marks) — independent,
   each showcase-verified.
3. **B1** (swap private card) → **B2** (overlay host) → **B3** (reveal IPC) → **B4** (a11y).

Track B is sequenced after the background composer-dock work already landed on `main`.

---

_Last reviewed: 2026-07-05._

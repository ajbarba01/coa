# Rich Tool Card — Design

> **Status:** approved design, pre-plan. Follows the tool-block design gate
> (`2026-07-04-chat-professionalization-design.md` §5.3), whose showcase let the maintainer pick the
> **rich card** direction. This spec adds the three enhancements the maintainer asked for — syntax-highlighted
> code (including diffs), clickable file paths, and a bounded card that expands into a pane-scoped overlay —
> and **promotes the rich card from a showcase specimen into a real kit member**.
>
> **Scope decision (maintainer):** build the three features into the real component now, demoed in the showcase
> with full-content samples; **live wiring into the transcript is a separate follow-up (Phase 3)**. Two seams are
> defined now and left inert until then: `onOpenPath` (reveal a file) and `getToolDetail` (full untruncated body
> for live sessions).

---

## 1. Goal

Turn the chosen rich tool card into a professional, reusable kit member with: (a) **syntax-highlighted** code in
its bodies, composed with the existing red/green diff tints; (b) **clickable file paths** in the title that reveal
the file in the editor/OS; and (c) a **bounded body** that clamps to a max line count and expands its full content
into an overlay **contained to the chat pane, never the whole window**. All byte-faithful (D128), token-styled,
and SC-1/D85-safe.

## 2. Invariants (binding)

- **SC-1 / D85 / D128** as in the gate spec: the card only surfaces (adds no block); it never touches the `coa raw`
  path; every rendered payload byte (diff lines, previews, overlay content) is verbatim — highlighting colors and
  the diff gutter marker are presentational and MUST NOT mutate bytes. The `≈ tok` count and registry `summary`
  remain labelled derived hints.
- **Kit discipline:** token utilities only (no raw hex/px; "blue" = `info`); no `dangerouslySetInnerHTML`; new kit
  members carry an intent block (mirror `Transcript.intent.ts`). Highlight colors come from CSS token variables
  (the existing `HLJS_TOKEN_STYLE`), not literals.
- **TypeScript strict**, no `any`, `exactOptionalPropertyTypes` (optional props/params typed `T | undefined`).
- **Pure layers stay pure and never throw** (path/language/clamp helpers).

## 3. Architecture & layering

Everything lands in `packages/console-ui` (the kit); the showcase in `apps/desktop` consumes it. New/changed units,
each with one responsibility and a well-defined interface:

- **`dense/syntaxTheme.ts`** (new) — extract the existing `HLJS_TOKEN_STYLE` out of `CodeBlock.tsx` into a shared
  module; **register the supported hljs languages** on the `Light` highlighter at import time (see note below);
  and add a small **`SyntaxText`** component that renders **one line/fragment** of code as inline
  syntax-highlighted spans on a transparent background (so a diff row's own background tint shows through).
  `CodeBlock.tsx` is refactored to import the theme from here.

  > **⚠ Registration is load-bearing (verified 2026-07-05).** The kit's `Light` build currently has **no
  > languages registered**, so `CodeBlock` today renders code *unhighlighted* (a single plain span). Registering
  > the languages here makes highlighting work for **both** `CodeBlock` and the new `SyntaxText`. With the kit's
  > custom token-variable stylesheet, react-syntax-highlighter applies colors as **inline styles** (token class
  > names are stripped), and output stays byte-faithful (`textContent` equals the source). Therefore tests assert
  > on **token-span breakdown + verbatim `textContent`**, not on `.hljs-*` class selectors. Register a practical
  > set — `typescript`, `javascript`, `python`, `json`, `bash`, `css`, `xml`, `markdown`, `rust`, `go`, `yaml`,
  > `sql` — via `Light.registerLanguage(name, mod)` where `mod` is
  > `react-syntax-highlighter/dist/esm/languages/hljs/<name>`. Those deep imports lack bundled types, so add an
  > ambient module declaration (a `.d.ts`) rather than `any`/`@ts-expect-error` scattered at each import.
- **`dense/pathLanguage.ts`** (new, pure) — `languageForPath(path): string | undefined`, an extension→hljs-language
  map (`.ts`/`.tsx`→`typescript`, `.js`/`.jsx`→`javascript`, `.py`→`python`, `.json`→`json`, `.md`→`markdown`,
  `.css`→`css`, `.html`→`xml`, `.sh`→`bash`, `.rs`→`rust`, `.go`→`go`, …); unknown/absent extension → `undefined`.
- **`dense/clampLines.ts`** (new, pure) — `clampLines(text, maxLines): { shown: string; truncated: boolean;
  hiddenCount: number }`. Deterministic (line-count based, no layout measurement), so truncation is testable in
  jsdom.
- **`dense/toolRegistry.ts`** (changed) — add `toolPath(tool, input): string | undefined`, the **raw** file path
  for the file tools (`Read`/`Edit`/`Write`/`NotebookEdit`, accepting `file_path` or base-tool `path`);
  `undefined` for everything else and for malformed input (never throws). Kept separate from `describeTool`'s
  formatted `summary` (which carries the range/`+N −M`), so the click target is the exact path.
- **`dense/ToolDiffView.tsx`** (new) — the byte-faithful inline diff renderer, upgraded to highlight each line via
  `SyntaxText` while keeping `bg-success-tint`/`bg-danger-tint` per-line tints. The `+`/`-`/space gutter marker is
  a **separate span**, not concatenated into the highlighted text, so `SyntaxText` only ever receives verbatim
  source bytes.
- **`layout/PaneOverlay.tsx`** (new kit member) — a **pane-scoped** overlay: `PaneOverlayProvider` renders its
  children inside a `relative` container plus an overlay layer (`absolute inset-0`) confined to that container; a
  `usePaneOverlay()` hook returns `{ open(content, title?), close() }`. When open, the layer shows a scrim +
  a scrollable panel (`bg-raised`, bounded to the pane), dismissible via Esc / backdrop / a close button. It is
  contained **by construction** (absolute within the provider), so it never covers the window. Not the kit
  `Dialog` (which portals full-viewport).
- **`dense/ToolCard.tsx`** (new kit member, + `ToolCard.intent.ts`) — the promoted rich card. Header: tool icon,
  verb, a **clickable path button** (file tools only), the `summary`, `≈ tok`, and the status glyph. Body: the
  `ToolDiffView` (edits/writes), a highlighted read/search preview, or a plain command-output tail, **clamped to
  `maxLines`** with a fade + **Expand** affordance when `truncated`. Expand calls `usePaneOverlay().open(fullBody)`.
- **`index.ts`** (barrel) — export the new public members: `ToolCard`/`ToolCardProps`, `PaneOverlayProvider`/
  `usePaneOverlay`, `SyntaxText`, `toolPath`, `languageForPath`, `clampLines`.
- **`apps/desktop/.../showcase/`** — `ChatMockups.tsx`'s rich-card row renders the kit `ToolCard` wrapped in a
  `PaneOverlayProvider` (+ `ToastProvider`), with `onOpenPath` raising a toast (`"Would reveal <path>"`); the
  showcase-local `toolblocks/RichToolCard.tsx` is deleted (promoted). `samples.ts` gains a long-output sample to
  demonstrate truncation → expand. The two non-chosen specimens (`CompactToolLine`, `GroupedActivityLog`) remain
  as reference until Phase 3 cleanup.

### Component interface

```ts
export interface ToolCardProps {
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
  /** Reveal the touched file (file tools) in the editor/OS. Inert (path not clickable) when omitted. */
  onOpenPath?: ((path: string) => void) | undefined;
  /** Max body lines before truncation + Expand. Default 14. */
  maxLines?: number | undefined;
}
```

The full untruncated body for live sessions (`getToolDetail`) is out of scope here: the card renders whatever
`output` it is handed; in the showcase that is already the full content, so Expand shows everything. Live wiring
(Phase 3) supplies the full body through the same prop.

## 4. Feature detail

### 4.1 Syntax highlighting (code + diffs)
Reuse the kit's existing react-syntax-highlighter (`Light`/hljs) and its token-variable theme. `SyntaxText`
highlights a single line/fragment as inline spans (`PreTag`/`CodeTag` = `span`), transparent background.
- **Diffs:** `ToolDiffView` renders each `DiffLine` as a row = a gutter marker span (`+`/`-`/` `) + `SyntaxText`
  for the verbatim `line.text`, over the row's `bg-success-tint`/`bg-danger-tint`/none tint. Language from the
  edited file's extension (`languageForPath(toolPath(...))`).
- **Read/file previews:** highlighted by the read file's language.
- **Command output (`Bash`) and Grep/Glob result lists:** plain (not a source language) — no highlighting.
- **Approach:** highlight **per line** (each line highlighted independently). Simpler and robust; the accepted
  tradeoff is that a multi-line string/comment may mis-tint at its boundary. (The heavier whole-text-then-map
  approach is explicitly not taken.) Byte-faithfulness holds because `SyntaxText` receives only verbatim bytes and
  the highlighter renders wrapping spans without altering text.

### 4.2 Clickable paths
The header path (from `toolPath`) is a `<button>` for `Read`/`Edit`/`Write`/`NotebookEdit`; clicking calls
`onOpenPath(path)`. When `onOpenPath` is omitted the path renders as plain text (not a button). Non-file tools show
no path button. Live wiring (Phase 3) connects `onOpenPath` to a new `coa.openPath(path)` preload IPC →
main-process reveal (`shell.openPath` / OS reveal / `$EDITOR`); that IPC is **not** built here.

### 4.3 Max size + pane-contained expand
Body content is clamped by `clampLines(body, maxLines)` (default `maxLines = 14`). When `truncated`, the card shows
the first `maxLines`, a bottom fade, and an **"Expand"** control noting `hiddenCount` more lines. Expand opens the
**full** body (full highlighted diff / full preview / full tail) in the pane overlay via `usePaneOverlay()`. The
overlay panel is scrollable and bounded to the chat pane; dismiss via Esc, backdrop click, or its close button. If
no `PaneOverlayProvider` is in the tree (defensive), Expand falls back to inline expansion (renders the full body
in place) rather than throwing.

## 5. Testing

Pure/unit (vitest, jsdom where DOM is needed):
- `languageForPath`: known extensions → language; unknown/absent → `undefined`.
- `toolPath`: `file_path` and base-tool `path` for the four file tools; `undefined` for Bash/coa/unknown/malformed;
  never throws.
- `clampLines`: under/over `maxLines` (shown length, `truncated`, `hiddenCount`); byte-faithful `shown`.
- `SyntaxText`: renders spans; `textContent` equals the input verbatim (byte-faithful).
- `ToolDiffView`: per-line tints present; gutter marker is a separate node; each rendered line's text is verbatim.
- `PaneOverlay`: `open` shows content within the provider container (not portalled to `document.body`); `close`/Esc
  hides it; scrim present; contained (assert the overlay node is inside the provider element).
- `ToolCard`: header renders verb + clickable path button that fires `onOpenPath`; `≈ tok`/status render;
  body truncates over `maxLines` and shows Expand with the hidden count; Expand opens the overlay with the full
  body; path renders as plain text when `onOpenPath` is omitted; byte-faithful diff.
- Refactor guard: `CodeBlock` still renders highlighted output after the theme extraction.

Integration: `corepack pnpm test` green (modulo the pre-existing unrelated failures); `corepack pnpm -C apps/desktop
build` clean; `tsc -b` adds zero new errors. Showcase: the rich-card row shows a highlighted diff, a clickable path
(→ toast), and a long body that truncates and expands into a pane-contained overlay.

Same-commit doc rule: new kit members get intent blocks; `COMPONENTS.md`/`UI.md` and `REPO_LAYOUT.md` updated for
the new files, the promoted card, and the deleted showcase `RichToolCard.tsx`.

## 6. Out of scope (Phase 3 / later)
- Live wiring into the transcript (replacing `Transcript.tsx`'s private `ToolCard`), the `getToolDetail` daemon seam
  for full untruncated live bodies, and the `coa.openPath` IPC + main-process reveal.
- Whole-text (cross-line-context) syntax highlighting; highlighting of command output.
- Removing the two non-chosen showcase specimens (kept as reference until Phase 3).

---

_Last reviewed: 2026-07-05_

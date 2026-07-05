# Handoff — Rich Tool Card: live-wire into the transcript

Paste the block below into a fresh Claude Code session in this repo to continue. It is written for an agent
with **zero prior context**.

---

You are the senior designer/engineer continuing the coa console chat overhaul. The **rich tool card kit member is
built, reviewed, and on `main`**; your job is to **wire it live into the real transcript** (the deferred next
phase).

## What coa is (one paragraph)
coa is a local-first, single-user **governance/audit layer over a rented Claude Agent SDK loop** — it governs a
coding agent rather than replacing it. The shippable UI is an **Electron console** (`apps/desktop`) built from a
token-driven kit (`packages/console-ui`, the "forge" warm-dark design system). The chat surface renders a live
governed session. Read `AGENTS.md` + `CLAUDE.md` first (routing + non-negotiables), then `docs/UI.md` (design
system + authoring rules). Skills-first: invoke `superpowers:brainstorming` (if refining) → `writing-plans` →
`subagent-driven-development`, and TDD each unit.

## Where things left off
Two phases already shipped on `main`:
1. **Tool-block design gate** — three tool-block directions were built as showcase specimens; the maintainer
   picked the **rich card**. (Spec: `docs/superpowers/specs/2026-07-04-chat-professionalization-design.md` §5.3.)
2. **Rich tool card build** (commits `859dd54`..`a122358`) — the rich card is now a real kit member with three
   maintainer-requested features: **syntax-highlighted code + diffs**, **clickable file paths**, and a **bounded
   body that expands into a pane-contained overlay**. Authority: `docs/superpowers/specs/2026-07-05-rich-tool-card-design.md`;
   executed plan: `docs/superpowers/plans/2026-07-05-rich-tool-card.md`; progress ledger:
   `.superpowers/sdd/progress.md`. Final whole-branch review verdict: **Ready to merge**.

What exists now (all in `@coa/console-ui`, barrel-exported, tested):
- `ToolCard` (`dense/ToolCard.tsx`) — props `{ tool, input, output?, ok?, onOpenPath?, maxLines? }` (default
  `maxLines: 14`). Header = icon · verb · clickable path · summary · `≈ tok` · status; body = highlighted diff
  (edits/writes) / highlighted read preview / plain command tail, clamped with an **Expand** control.
- `PaneOverlayProvider` / `usePaneOverlay` (`layout/PaneOverlay.tsx`) — a pane-confined overlay (absolute
  inset-0, **never** a window modal). `ToolCard`'s Expand calls `usePaneOverlay().open(fullBody)`; with no
  provider it falls back to inline expansion.
- `SyntaxText` (`dense/syntaxTheme.tsx`) — inline one-line highlighter; **it registers the hljs languages** (the
  `Light` build had none, so all code was previously unhighlighted — this fixed `CodeBlock` too).
- `ToolDiffView` (`dense/ToolDiffView.tsx`), `toolPath`/`describeTool` (`dense/toolRegistry.ts`),
  `languageForPath` (`dense/pathLanguage.ts`), `clampLines` (`dense/clampLines.ts`).

## Your mission (this handoff)
Make the rich card the **live** tool rendering in the transcript, and wire its two inert seams. Concretely:

1. **Replace the transcript's private `ToolCard`.** `packages/console-ui/src/dense/Transcript.tsx` has a
   **private** `ToolCard` (defined ~line 155) rendered by `TranscriptRow` for `frame.kind === 'tool'` /
   `'tool-use'` / `'tool-result'` (~lines 566–575), fed by `foldToolFrames` (~line 599, called ~776). Swap those
   call sites to the new kit `ToolCard`. Keep the gutter/spine/`dotTone` treatment. Delete the private `ToolCard`
   once nothing uses it. Preserve `foldToolFrames`' identity-caching (a prior perf fix — streamed frames must
   keep row identity so `MemoRow`'s `React.memo` still hits).
2. **Host the pane overlay.** Wrap the transcript's scroll region (or the chat pane in `ChatPanel.tsx`) in a
   `PaneOverlayProvider` so Expand opens **within the chat pane**, not the window. Confirm it stays confined when
   triggered from a deeply-scrolled row.
3. **`onOpenPath` → reveal in editor/OS (new IPC).** Add a `coa.openPath(path)` seam: preload
   (`apps/desktop/src/preload/index.ts`, follow the `WINDOW_CONTROL`/verb `ipcRenderer.invoke` pattern) →
   main (`apps/desktop/src/main/index.ts`, `ipcMain.handle`, using electron's `shell.openPath` /
   `shell.showItemInFolder`, resolving worktree-relative paths against the session worktree; consider `$EDITOR`).
   Type it in `apps/desktop/src/preload/api.d.ts`. Thread `onOpenPath` from `ChatPanel` into the transcript's
   `ToolCard`s. **Security:** validate/confine the path (never open arbitrary paths); decide the failure surface
   (SC-1 — surface, never block).
4. **(Optional) `getToolDetail` for full untruncated bodies.** The daemon caps tool output (see
   `packages/core/src/workbench/base-tools.ts`: `BASH_OUTPUT_CAP = 30000`, `DEFAULT_READ_LINE_LIMIT = 2000`), so
   the `output` handed to a live card is already capped. Expand of the *handed* output already works; a
   `getToolDetail` daemon seam that fetches beyond the cap is a nice-to-have — scope it only if the maintainer
   wants it.
5. **PaneOverlay a11y follow-up (deferred from the build phase):** add `aria-modal="true"` + initial focus /
   focus-trap; align its scrim to the kit's `overlay-scrim bg-black/50` (Dialog parity). Small, self-contained.

Brainstorm the exact call-site shape and the `onOpenPath` reveal semantics with the maintainer before planning —
there are real decisions (reveal-in-editor vs OS file manager vs `$EDITOR`; how to resolve worktree-relative
paths; whether to build `getToolDetail` now).

## Where things live
- Live tool rendering to replace: `packages/console-ui/src/dense/Transcript.tsx` (`ToolCard` private fn,
  `TranscriptRow`, `foldToolFrames`, `dotTone`, `MemoRow`).
- New card + deps: `packages/console-ui/src/dense/{ToolCard,ToolDiffView,syntaxTheme,toolRegistry,pathLanguage,clampLines}.*`,
  `packages/console-ui/src/layout/PaneOverlay.tsx`. Barrel: `packages/console-ui/src/index.ts`.
- Chat composition: `apps/desktop/src/renderer/panels/ChatPanel.tsx` (pane host + where to thread `onOpenPath`).
- IPC: `apps/desktop/src/preload/index.ts` + `api.d.ts`; `apps/desktop/src/main/index.ts`. Verb/channel patterns
  live in `apps/desktop/src/shared/methods.ts`.
- Registry/catalogue: new kit members register in `packages/console-ui/src/registry.ts`; **`COMPONENTS.md` is
  GENERATED** — regenerate it, don't hand-edit (see the "regenerate" note below).
- The showcase still renders the rich card for reference:
  `apps/desktop/src/renderer/panels/showcase/ChatMockups.tsx` (the two non-chosen specimens `CompactToolLine` /
  `GroupedActivityLog` remain there as reference — remove them in this phase if the maintainer agrees).

## Hard constraints (read before touching anything)
- **`Transcript.tsx` / `Composer.tsx` / `ChatPanel.tsx` currently have UNCOMMITTED maintainer live edits with
  type errors** (they break `tsc -b` for `console-ui` and cause 2 unrelated `console.test.tsx` failures). This
  phase must edit `Transcript.tsx`/`ChatPanel.tsx` — so **first confirm with the maintainer whether to commit or
  revert their in-progress edits**; do not silently clobber them. Do not stage `LOCAL.md` /
  `harness-system-prompt.md` (intentionally untracked).
- **Commits:** subject-only Conventional Commits — no body, no `Co-Authored-By`/"Generated with" trailer, no
  internal IDs (module/phase numbers). **Stage files by name; never `git add -A`.** Hooks are enabled — never
  `--no-verify`. One logical unit per commit.
- **Kit discipline:** token-only styling (no raw hex/px; "blue" = the `info` token), no
  `dangerouslySetInnerHTML`, new kit members get an intent block + register in `registry.ts` + regenerate
  `COMPONENTS.md`. Build from the kit; don't reinvent primitives.
- **Invariants:** **SC-1** (the console adds no block — the deny channel is the daemon's), **D85** (`coa raw`
  mode stays byte-verbatim — the tool card must not touch the raw floor; raw frames pass through untouched),
  **D128** (diffs/previews/overlay render byte-faithfully — the highlighter colorizes, never mutates bytes; the
  diff gutter marker is a separate span). Determinism-first: **no model call on the critical path.**
- **TypeScript strict, no `any`, `exactOptionalPropertyTypes`** (optional props typed `T | undefined`);
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` all on.
- **`ToolCard`'s `≈ tok` intentionally counts the tool's OUTPUT** (its context cost) — keep that; it's a
  maintainer requirement, not a bug, even on an edit card whose body shows a diff.

## Commands (Windows, from repo root)
- Focused test: `corepack pnpm vitest run <path>` (the per-package `pnpm -C <pkg> test` does NOT resolve — use
  root vitest).
- Full suite: `corepack pnpm test` — **2 pre-existing failures are the maintainer's unrelated
  `console.test.tsx` live edits** (until those are resolved). Don't chase them.
- Build gate: `corepack pnpm -C apps/desktop build` (electron-vite/esbuild — succeeds despite the live-edit type
  errors). Typecheck: `corepack pnpm -C apps/desktop exec tsc -b` (must add **zero** new errors beyond the
  maintainer's live-edit files).
- Regenerate `COMPONENTS.md` (no tsx installed): create a throwaway
  `packages/console-ui/src/_regen.test.ts` that `writeFileSync`s `generateCatalog(allIntents)` from
  `./registry.js` + `./lib/catalog.js`, run it via `corepack pnpm vitest run`, then **delete it**;
  `packages/console-ui/src/registry.test.ts` asserts the file matches.
- Live review: `corepack pnpm -C apps/desktop dev` (Electron `dev` may not boot in a sandbox — if so, rely on
  build + unit tests and hand off for the visual check).

## Definition of done
- The live transcript renders tool calls with the kit `ToolCard` (highlighting, clickable paths, clamp + pane
  overlay); the private `ToolCard` is deleted; `foldToolFrames` identity-caching preserved (memoization intact).
- Path click reveals the file via the new `coa.openPath` IPC (path-confined; SC-1 failure surface).
- The expand overlay stays confined to the chat pane in the running app.
- New/changed kit members registered + `COMPONENTS.md` regenerated; `REPO_LAYOUT.md`/`UI.md` updated per the
  same-commit doc rule.
- `corepack pnpm test` green (modulo any still-unresolved maintainer live-edit failures), build + `tsc` clean for
  your files. A short summary to the maintainer with a live-review request.

---

_Handoff written 2026-07-05. Rich tool card built at `main`@`a122358`; live wiring is this phase._

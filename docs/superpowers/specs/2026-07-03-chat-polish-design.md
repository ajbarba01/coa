# Chat interface polish — design

Follow-on to the `chat-interface-overhaul` branch. Six focused render/UX fixes on the chat surface, all
over data already on the wire. **Pure render + console-state — no new wire types, no adapter/backend work.**
(#7 from the original list — real backend token streaming — is deliberately excluded here and gets its own
spec; it is a cross-cutting SDK + M0-wire + M8 + console change, not a render tweak.)

## Scope

| # | Fix | Layer |
| - | --- | ----- |
| 1 | Side dots become the spine (bigger dot + vertical connector, breaks at user turns) | `console-ui` render |
| 2 | Tool blocks: de-indent, one block per tool, bigger/bolder title + quick-info, taller toggle | `console-ui` render |
| 3 | Thinking block collapses (default collapsed, label only) | `console-ui` render |
| 5 | Sticky user header: composer bg, hover/click → scroll+flash; long prompts truncate/expand | `console-ui` render |
| 6 | Jump-to-latest background matches the composer | `console-ui` render |
| 8 | Status pill driven by the daemon's `status` push; "working…" footer while running | `console.ts` + render |

(#4 and #7 intentionally absent — #4 was never in the list; #7 is a separate spec.)

Everything lives in `packages/console-ui/src/dense/Transcript.tsx` (+ its test) except #8's status wiring, which
is in `apps/desktop/src/renderer/console.ts` and `panels/ChatPanel.tsx`.

## Non-goals / deferred

- **No clickable "open in IDE" tool link** — that is `resolveRef` + IDE routing (Phase 2). #2 shows the file
  path as *text* quick-info; the link lands with Phase 2.
- **No live Stop** — `interruptSession` is Phase 2. #8 passes `running` into the `Composer` so its Stop toggle
  *reflects* state, but Stop stays disabled (no `onInterrupt`).
- **No wire changes.** The daemon already emits the `status` push (`running` → `done`/`error`, see
  `packages/core/src/session/session-handlers.ts`); #8 only *consumes* it.

---

## 1 — Side dots become the spine

Today `RowShell` renders a small `size-1.5` status dot in a `flex gap-2` gutter, and separately every agent
text/tool row draws its own `ml-2 border-l border-dotted` role-spine. Two competing vertical elements.

**Change:** the gutter becomes the single spine.

- Gutter is a fixed-width (`w-4`) `relative` column holding (a) an absolutely-positioned, centered, full-height
  thin vertical line and (b) the status dot near the top, centered on the line.
- Dot enlarges (`size-1.5` → `size-2.5`); tone classes unchanged (`dotTone` is untouched).
- The line renders for every **agent-side** row and **omits** on user rows (`'role' in frame && frame.role
  === 'you'`). Because virtualized rows stack with no gap, consecutive agent segments read as one continuous
  line; the omission at each user turn is the intended break.
- Subagent nesting keeps using the existing `indent` (`marginLeft`), so the spine steps inward for depth.

`RowShell` keeps its `frame` / `indent` / `className` / `children` contract; only its internals change. The
`data-dot` hook and `aria-hidden` stay (the dot is decorative; row content states the outcome).

## 2 — Tool blocks: unify and de-indent

Three sub-changes, all in `Transcript.tsx`.

**(a) De-indent.** Remove the `ml-2 border-l border-dotted border-border-default pl-4` wrapper on the shared
text/tool branch so tool/text rows align at the same left edge as thinking. The per-row dotted border is gone;
the spine (#1) now carries structure. The `nested` (`ml-4 border-solid`) subagent affordance is likewise
dropped from this branch — depth is shown by the gutter indent alone.

**(b) One block per tool.** A pure `foldToolFrames(frames)` helper runs *before* grouping and pairs each
`tool-use` with its matching `tool-result` (by shared `handle`) into a single internal merged frame:

```
{ kind: 'tool'; tool: string; input: string; handle?: string;
  output?: string; ok?: boolean }   // output/ok absent ⇒ still running
```

- Matched pair → one merged frame (keeps the `tool-use` frame's `id` and list position).
- Unmatched `tool-use` (result not streamed yet) → merged frame with `output`/`ok` absent → card renders a
  running state (no status text, subtle pending affordance).
- Orphan `tool-result` (no preceding use) → rendered on its own (defensive; shouldn't occur live).
- Only `tool-use`/`tool-result` kinds are touched — `raw`, `text`, `thinking`, etc. pass through untouched, so
  raw mode (all `kind:'raw'`) is unaffected.

`dotTone` gains a `tool` case: `ok === true → success`, `ok === false → danger`, pending → `neutral`.

**(c) Card styling.** In `ToolCard`:
- Title: `text-caption text-muted` → `text-label font-medium text-fg` (slightly bigger + bolder).
- Toggle button taller: `py-0.5` → `py-1.5` (roughly control-sm height).
- Drop the `· ok` / `· error` text to the right. Instead, a pure `toolQuickInfo(tool, input)` returns short
  info for known file tools (Read/Write/Edit/NotebookEdit/Glob/Grep) by parsing the `input` JSON for its path
  (`file_path`/`path`/`pattern`), truncated; other tools show nothing. Rendered as muted text, *not* a link
  (the link is Phase 2). Defensive parse — malformed input yields no quick-info, never throws.
- Expanded body shows the input and, when present, the output (labelled), so the single card carries what the
  two cards used to.

## 3 — Thinking collapses

The thinking branch renders a static box with no toggle. Add a `useState(false)` collapse, same
caret + `aria-expanded` pattern as `ToolCard`.

- **Collapsed (default):** caret + the label `Thinking` only — no preview of the reasoning text.
- **Expanded:** caret rotated + the full thinking text (kept italic/muted).
- Reduced-motion disables the caret transition (matches `ToolCard`).

## 5 — Sticky user header

The `groupContent` sticky header is a static `bg-surface/95` strip. Make it match the composer and act as a
jump target.

- Background → `bg-raised` (the composer container's surface); add hover ring + `cursor-pointer`.
- Render as a `<button>`; on click, `ref.current?.scrollToIndex({ index, align: 'start', behavior:
  'smooth' })` for that group's first item (its user turn), then briefly flash the landed row (a `data-flash`
  attribute toggled ~1s, driven by a small `flashId` state the item renderer reads).
- **Long-prompt truncation:** user text rows (`role: 'you'`, `kind: 'text'`) clamp to a few lines with a caret
  when overflowing; the row and its sticky header expand/collapse the full text. Truncation state is per-user-
  row local state; the header's caret mirrors it.

## 6 — Jump-to-latest background

The jump-to-latest `Button` becomes `bg-raised` to match the composer (wrap or className override on the
existing `Button variant="secondary"`), keeping its pointer-events and position.

## 8 — Status, driven by the real signal

**Bug:** `console.ts`'s push handler calls `clearSending()` on *every* push, so the pill flips to idle on the
first streamed frame — the "flashes to running then dies" symptom.

**Fix (console.ts):** stop clearing per-frame. Drive `sending`/`sentAt` off the `status` push:

- Keep the optimistic `sending: true` + `sentAt` on `sendMessage` (instant feedback before `running` arrives).
- In `onPush`: on `kind: 'status'` → `state === 'done' | 'error'` clears the pill (and `done` still refreshes
  the session list); `state === 'running'` (re)affirms it. Turn frames no longer touch `sending`.
- The dispatch-failure `catch` still clears (a failed send never streams a status). 

**Working footer (Transcript):** a new optional `busy?: boolean` + `busySince?: number` on `Transcript`
renders a Virtuoso `components.Footer` — a subtle row with a small spinner + `working… Ns` — while busy, so it
scrolls with content and vanishes on done/error. The footer owns a 1s interval for the elapsed counter
(self-contained, like `RunningPill`). `ChatPanel` passes `busy={vm.sessionStatus === 'running'}` and
`busySince={vm.runningSince}`.

**Composer state (ChatPanel):** pass `running={vm.sessionStatus === 'running'}` to `Composer` so its send/stop
toggle reflects the run (Stop disabled — no `onInterrupt` until Phase 2).

---

## Testing

Pure-function + render coverage, matching the branch's existing `Transcript.test.tsx` style (unit-test
`TranscriptRow`/helpers directly; no jsdom Virtuoso dependency):

- **`foldToolFrames`** — matched pair → one `tool` frame; pending use → running frame; orphan result; passthrough
  of non-tool kinds; raw mode untouched.
- **`toolQuickInfo`** — path extracted for each known file tool; unknown tool → none; malformed JSON → none.
- **`dotTone`** — new `tool` case (success/danger/pending-neutral).
- **`TranscriptRow`** — thinking collapse toggle (`aria-expanded`, label-only collapsed, full text expanded);
  merged tool card (title, quick-info, taller toggle, expanded input+output); user-row truncation caret; the
  gutter renders a spine line on agent rows and none on user rows (`data-` hook).
- **Sticky header** — click calls `scrollToIndex` with the group's item index; flash toggles.
- **console.ts status** — a `status running` then a turn frame keeps `sending` true; `status done`/`error`
  clears; dispatch failure clears. (Extend the existing console/onPush tests.)
- **Working footer** — renders while `busy`, gone otherwise.

## Verification

`corepack pnpm test` (workspace) green; `corepack pnpm -C apps/desktop build` clean; `apps/desktop` `tsc -b`
0 errors. Live check via `corepack pnpm -C apps/desktop dev` → Chat: send a message and confirm the pill stays
running until done, the footer shows, tool blocks are single/de-indented, thinking toggles, the sticky header
scrolls+flashes, and the spine reads as a broken-at-user-turns line.

---

_Last reviewed: 2026-07-03_

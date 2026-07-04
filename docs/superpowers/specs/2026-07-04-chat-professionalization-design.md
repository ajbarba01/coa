# Chat Console Professionalization — Design

> **Status:** approved design, pre-plan. Third pass over the console conversation surface, following
> `chat-interface-overhaul` (2026-07-02) and `chat-interface-polish` (2026-07-03). Where those built the
> taxonomy and first polish, this pass **professionalizes** the surface end-to-end and corrects two real
> data-integrity bugs (session-routing of live output; full-transcript text selection). Authority for product
> behavior stays [SPEC.md](../../design/handoff/SPEC.md) `CHAT-*` / `CON-*`; this is the build-facing design.
>
> **Mostly pure render + console-state, plus two backend tails** (DeepSeek reasoning; empty-thinking drop) and
> one **architecture reversal** (drop virtualization — see §3, §5.1).

---

## 1. Goal

Bring the chat surface to a genuinely professional bar — smooth at any length, correctly sticky-to-bottom,
fully selectable/searchable, conversation-grade spacing, per-tool-aware tool blocks, a real composer, honest
thinking blocks — grounded in what professional chat/agent UIs (Claude, ChatGPT, Claude Code) actually do,
inside coa's forge design system. Two reported behaviors are **correctness bugs**, not polish: live output is
mis-routed when you switch sessions mid-run, and the transcript can't be cleanly selected/copied. Both are
fixed here at the root.

The most important structural finding: the scroll lag, the broken jump-to-latest, the ugly sticky push, **and**
the buggy text selection all trace to the same foundation — `GroupedVirtuoso` (windowed) + a hand-rolled
scroll-lerp + unmemoized heavy rows. Fixing the foundation (not each symptom) is the core of Phase 1.

## 2. Root-cause audit

| # | Symptom | Root cause (code) |
|---|---|---|
| 1 | Laggy scroll, worse when long | No memoization: every `TranscriptRow` re-parses markdown (react-markdown) **and** re-highlights code (synchronous react-syntax-highlighter) on every render/mount. Windowing mounts/unmounts on scroll → re-parse per scroll frame. Compounded by `foldToolFrames`+`groupByUserTurn` recomputed O(n) every render, and every push re-rendering the whole console. Also code blocks lack `overflow-x` (a long line widens the row → horizontal jitter). |
| 2 | Compact spacing | Density defaults to `compact` (dev-tool sizing); row padding `px-2 py-3`, no readable measure cap — not conversation rhythm. |
| 3 | Generic tool blocks | One `ToolCard` box for every tool; no per-tool verb/summary/icon. |
| 4 | User message = button; line below; ugly push | User row styled `rounded-surface border bg-raised` (reads as a control); sticky header carries a `border-b`; the push overlap is a **documented GroupedVirtuoso limitation**. |
| 5 | Jump-to-latest doesn't reach/lock; lurches | `followOutput` disabled when idle → jumping never locks; button (`!atBottom`) never clears; the lurch is the hand-rolled `smoothScroll` easing raw `scrollTop` toward a target re-measured each frame against a growing windowed list. |
| 6 | Thinking: no hover tint; empty still expandable; DeepSeek silent | `ThinkingCard` has no hover tint and always renders the caret; the Claude adapter maps `block.thinking ?? ''` so empty/redacted Opus thinking becomes an empty frame; DeepSeek's `complete.ts` reads only `content`+`tool_calls`, **discarding `reasoning_content`** → no thinking frames at all. |
| 7 | Composer feels like a button/panel | Full-width bordered panel with top rule; text Send/Stop; no attach/mic/permission; phantom scrollbar from always-on `overflow-y-auto` colliding with the `scrollHeight` auto-grow; live (silent no-op) with no active session. |
| 8 | No running treatment | `sessionStatus === 'running'` drives only the pill; no panel-level signal. |
| S | **Live output mis-routed on session switch** | The push wire carries `sessionId` on every `turn`/`status` record ([push.ts](../../../packages/shared/src/push.ts)), but [console.ts `onPush`](../../../apps/desktop/src/renderer/console.ts) **ignores it** and appends to `state.data.turns` (always the *active* session). Switch mid-run → the running agent's frames pour into the wrong session. `sending`/`sentAt` is likewise global, so run-status leaks across the switch. |
| T | **Transcript can't be cleanly selected/searched** | Windowing unmounts off-screen rows, so text not in the DOM can't be selected or found (Ctrl+F), and selection snaps at recycled-item boundaries ("buggy block to block"). Inherent to virtualization. |

## 3. Invariants (binding)

- **SC-1 preserved.** The console adds no block. Approval cards surface; the only two denies come through
  `DenyNotice`.
- **Strict-superset (D85).** `coa raw` stays sacred — every new render kind degrades to the verbatim `raw`
  floor. Raw mode (all `kind:'raw'`) must be untouched by tool-folding/grouping/tool-block changes.
- **Catalogue-only, computes-nothing.** The console renders; diffs render byte-faithfully (D128).
- **Build from the kit, token-only, renderer-isolation.** New/changed members live in `console-ui` with
  lint-enforced intent blocks, styled only from tokens (no raw values; issue 8's "blue" is the `info` semantic
  token). No `dangerouslySetInnerHTML`.
- **⚠ Reversal — drop virtualization.** The prior specs pinned react-virtuoso. This pass **removes it** from the
  transcript: full-transcript selection + Ctrl-F (both required) are fundamentally incompatible with windowing.
  The transcript renders every frame to the DOM (ChatGPT/Claude.ai model) with CSS `content-visibility` for
  off-screen performance. REPO_LAYOUT / UI docs updated in the same commit; the react-virtuoso dependency is
  removed if nothing else uses it.

## 4. Architecture & layering

- **`packages/console-ui/src/dense`** — the bulk: `Transcript` (foundation rework — non-virtualized list,
  native scroll, stick-to-bottom, find-in-conversation), `Composer` (rebuild), `ThinkingCard`/`ToolCard`
  (thinking + tool blocks), `Markdown`/`CodeBlock` (memo + `overflow-x` + task-list styling), the per-tool
  registry, a `CopyButton`-based message-copy affordance. `smoothScroll.ts` is **deleted**; `group.ts`/
  `GroupedVirtuoso` usage removed (grouping kept only if still needed for jump-to-prompt indexing).
- **`apps/desktop/src/renderer`** — `ChatPanel` composition (composer slots, running-ring, jump-to-prompt,
  find bar host); **`console.ts` session-routing fix** (route pushes by `sessionId`, per-session buffers,
  per-session run status) + the inline "switched model" system note.
- **`packages/console-viewmodel/src/turn-map.ts`** — defensive empty-thinking filter.
- **Backend tails:** `adapter-deepseek/src/complete.ts` (read `reasoning_content`) + loop-driver thinking-frame
  emission; `adapter-claude-sdk/src/turn-frames.ts` (drop empty thinking).
- **`apps/desktop/.../showcase/ChatMockups.tsx`** — the tool-block design gate (three variants).

## 5. Design detail

### 5.1 Scroll & render foundation (issues 1, 5, T)

**Non-virtualized transcript.** Replace `GroupedVirtuoso` with a plain scroll container that renders **all**
frames. This makes native text selection and Ctrl-F work across the whole conversation (issue T / #1) and
removes the windowing machinery behind issues 1/4/5.
- **Off-screen performance:** each turn row gets `content-visibility: auto` + a tuned `contain-intrinsic-size`,
  so the browser skips layout/paint for off-screen rows without unmounting them (selection stays intact).
- **Memoization:** `React.memo` on `TranscriptRow`; stabilize `onRespond`/row callbacks (`useCallback`) so a
  streamed frame re-renders only the appended row. `useMemo` the `foldToolFrames` pipeline keyed on `frames`.
  Because rows never unmount, markdown/highlight parse **once** on mount; a small parse cache is optional (only
  helps session reload), not load-bearing.
- **Code blocks** get `overflow-x-auto` (a long line scrolls within the block instead of widening the row).

**Scroll behavior.** Native scroll + a bottom **sentinel** + a `pinned` (stick-to-bottom) state:
- A `ResizeObserver`/`MutationObserver` (or scroll-anchor) keeps the view pinned to the bottom while `pinned`
  and content grows.
- **Jump to latest → `pinned = true` + `scrollIntoView({ block: 'end', behavior: 'smooth' })`** on the
  sentinel; the button shows on `!pinned` and clears when the sentinel is in view. No hand-rolled lerp.
- Manual scroll-up detaches (`pinned = false`). **Sending a message sets `pinned = true`** so your just-sent
  turn snaps into view even if you were reading history (correctness gap #2).

### 5.2 Turn structure & spacing (issues 2, 4)

- User turns are **inline distinct blocks** (Claude/ChatGPT idiom) — no sticky-to-top header, so the ugly push
  is gone. **Jump-to-prompt** nav ("↑ previous prompt") replaces the sticky-header-as-navigation.
- **User message:** subtle raised tint + soft shadow + a quiet leading accent — **no full border, no `border-b`
  rule**; reads as "your input," not a control. Long prompts clamp with an expand caret (DEV-NOTES: "user
  message shadow and proper push and expand").
- **Spacing, grounded:** inter-turn rhythm ~20–24px; comfortable inner padding; transcript content capped to a
  readable measure (~720px) centered in the panel. Markdown internal spacing already follows
  github-markdown-css; align the turn-level rhythm to it.

### 5.3 Tool blocks (issue 3) — showcase design gate

A shared **per-tool registry** (pure, in `console-ui`): given `(tool, input, output?, ok?)` it yields
`{ icon, verb, summary }` for known tools (Read, Write, Edit, NotebookEdit, Glob, Grep, Bash, TodoWrite, …) with
a **universal fallback** for unknown tools. Defensive parse — never throws.

Three variants as real `TranscriptRow`-driven specimens in `ChatMockups.tsx`:
1. **Per-tool compact line** — one-line verb + target + status glyph; expand for detail.
2. **Grouped activity log** — consecutive tool calls collapse into one "working" group that expands to steps.
3. **Rich card with inline diff** — edits/writes lead with a byte-faithful mini-diff; reads/greps show a result
   preview; commands show an output tail.

**Gate:** these ship to the showcase first (no live wiring). Reviewer picks one (or a hybrid); only then is the
winner implemented live. All three degrade to the `raw` floor and honor SC-1/D128.

### 5.4 Composer (issue 7)

- **Floating rounded surface** over the chat (not a full-width bordered panel); remove the `border-t` rule.
- **Glyph Send/Stop** (arrow-up / stop-square), not text; Stop shows while `running`.
- **Attach (+)** and **mic** buttons and a **permission-mode selector** (SDK default / auto-accept-edits /
  plan), fully styled but **inert** where the backend seam isn't wired (attach, mic; permission wires to the
  existing `permissionMode` seam if trivial, else inert). Model/effort selects retained; the model select
  defaults to a sensible Claude default when unset.
- **Phantom scrollbar fix:** `overflow-hidden` until content height reaches `max-h`, then `overflow-y-auto`.
- **No active session:** disable the composer + placeholder ("Select or start a session") instead of a silent
  no-op (correctness gap #3).

### 5.5 Thinking (issue 6)

- **Hover text tint** on the "Thinking" label (DEV-NOTES: "thinking highlight color").
- **Empty → not expandable:** filter empty/whitespace thinking at the **Claude adapter** (`turn-frames.ts`),
  **and** defensively in `turn-map.ts`, **and** in `ThinkingCard` (no caret when text is blank).
- **DeepSeek reasoning (backend tail):** `complete.ts` reads `choice.message.reasoning_content`; the loop-driver
  emits it as a `{ t: 'thinking' }` frame so DeepSeek reasoning appears like Claude's.

### 5.6 Running state (issue 8)

When the active session's status is `running`: an **`info`-toned ring** around the chat panel + a running
**status badge** (both from the `info` token). Driven by per-session status (see §5.7); clears on
`done`/`error`/`idle`. The "working" footer indicator is enlarged to body text size (DEV-NOTES: "larger
'working' indicator").

### 5.7 Session-routing correctness (bug S)

`onPush` must **route by `sessionId`**:
- Append a `turn` push to the transcript only when `push.sessionId === activeSessionId`; frames for other
  sessions go to a per-session in-memory buffer (or are recovered from the R-7 store on switch-back) so a
  background session's live output is neither lost nor misfiled.
- Run status (`sending`/`sentAt`, the pill, the running-ring) is **keyed by `sessionId`**, so switching sessions
  shows the correct session's status and never leaks a run indicator.

### 5.8 Find-in-conversation (DEV-NOTES: Ctrl+F)

A **Ctrl-F find bar** over the transcript: query → highlight matches inline with a match count + prev/next
navigation that scrolls the match into view. Enabled by the non-virtualized DOM (§5.1) — every frame is present
to search. Pure render + local state; no wire change.

### 5.9 Inline "switched model" note (DEV-NOTES)

When the model/effort changes mid-session, insert a subtle inline **system note** frame in the transcript
(`── switched to Opus 4.8 · high ──`) so the change is on the record. A console-local synthetic frame kind
(system note), never sent to the agent; degrades to the `raw` floor.

### 5.10 Message affordances

- **Copy whole message:** a hover action on assistant turns copies the turn's markdown source (reuses
  `CopyButton`); mitigates any remaining selection edge. Copy actions raise a brief **toast** (DEV-NOTES: "copy
  block toast").
- **Turn appear-animation:** a subtle fade/slide-in on newly-appended turns, `prefers-reduced-motion` honored
  (new message keyframes in globals.css alongside the existing overlay ones).
- **GFM task-list checkboxes** (`- [ ] / - [x]`) styled to the forge instead of raw browser inputs.

## 6. Phasing

- **Phase 1 — foundation + correctness + polish.** Non-virtualized transcript + content-visibility + native
  scroll/stick-to-bottom (5.1); turn structure + spacing + user message + jump-to-prompt (5.2); composer rebuild
  + no-session state (5.4); thinking hover + empty fix render side (5.5); running-state ring + per-session status
  (5.6, 5.7); **session-routing fix (5.7)**; find-in-conversation (5.8); switched-model note (5.9); message
  affordances (5.10); code-block overflow + snap-to-sent-message. Delivers a smooth, correct, professional chat.
- **Phase 2 — tool-block design gate.** Per-tool registry + three showcase variants (5.3). **Reviewer picks.**
- **Phase 3 — implement the chosen tool block** as the live `ToolCard` replacement.
- **Phase 4 — backend thinking tails** (5.5 backend): DeepSeek `reasoning_content` → thinking-frame emission +
  Claude adapter empty-thinking drop.

Phases 2→3 are the review gate; Phase 4 is independent and can land any time after Phase 1.

## 7. Verification

- **Pure layers unit-tested:** the per-tool registry (each known tool → verb/summary; unknown → fallback;
  malformed input → no throw); the `pinned`/jump-state logic; the empty-thinking filter; the find-in-conversation
  matcher; the session-routing predicate (append iff `sessionId === active`; per-session status).
- **`TranscriptRow` per-kind** (exported-row pattern): user inline block (no border/rule), thinking (hover class,
  no caret when empty), tool blocks (chosen variant), switched-model note, task-list checkboxes.
- **Composer:** phantom-scrollbar overflow toggle; glyph send/stop; inert controls present; disabled with no
  session.
- **Backend tails:** `complete.ts` maps `reasoning_content` (mock response); loop-driver emits the thinking
  frame; Claude adapter drops empty thinking.
- **Full suite + build:** `corepack pnpm test` green; `corepack pnpm -C apps/desktop build` clean; `tsc -b` 0
  errors. Live check via `corepack pnpm -C apps/desktop dev`: smooth scroll + full-transcript selection + Ctrl-F
  at length, jump-to-latest locks and the button clears, no phantom scrollbar, running ring, thinking behaves,
  session-switch mid-run keeps output on the right session, showcase shows the three tool variants.
- **Same-commit doc rule:** new/changed kit members → `COMPONENTS.md` / `UI.md`; deleted `smoothScroll.ts` +
  removed virtuoso + new files → `REPO_LAYOUT.md`; the virtualization reversal noted where the prior specs pinned
  react-virtuoso; DeepSeek reasoning surfacing noted at the adapter's `⚠ REVIEW`.

## 8. Deferred / out of scope

- **Always-visible/pinned TodoWrite** (DEV-NOTES) — considered, deferred; the plan frame stays inline this pass.
- **@-file references, file-attachment backend, voice backend** — composer shows attach/mic inert; the input
  modes and their backends are later work.
- **Token-by-token streaming** — text arrives as whole frames; smooth typing/cursor is its own spec (#7 in the
  overhaul), not this pass.
- **External-link routing** (`setWindowOpenHandler` on main) — worth a verify but not folded in here.
- Live tool-detail (`getToolDetail`), ref linkification (`resolveRef`), live interrupt (`interruptSession`),
  enriched approvals — already deferred by prior specs; unchanged.
- Per-turn metadata (timestamps, per-turn cost/duration); compaction UI; timeline/rewind — separate projects.
- App-shell items in DEV-NOTES (daemon-off screen, nav-rail collapse, panel edge rounding, sidebar redesign) —
  not chat surface; out of scope.

---

_Last reviewed: 2026-07-04_

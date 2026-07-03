# Chat Interface Overhaul (MVP) — Design

> **Status:** approved design, pre-plan. Scope = the console's **conversation surface** (the `CHAT-*` family inside
> D128's conversation zone) plus the composer/control it needs. Compaction and timeline/history are explicitly
> **separate projects**. Authority for the product behavior is [SPEC.md](../../design/handoff/SPEC.md) `CHAT-*` /
> `CON-*`; this doc is the build-facing design for the MVP slice.

---

## 1. Goal

Bring the console's chat surface to "the Claude Code VS Code extension, but grounded in coa's design direction and
its governance differentiators." Today the turn stream is **live** (M10 wired `startSession` → push →
`pushToViewFrames`), but the console renders only 6 flat frame kinds with a role gutter, no markdown, no syntax
highlighting, no copy, a single-line composer, and **no interrupt** — and the view-model layer actively **drops**
most of the taxonomy the wire already carries.

The single most important finding: **the backend seams for most of this already exist.** The wire `TurnFrame` union
([packages/shared/src/push.ts](../../../packages/shared/src/push.ts)) already carries
`thinking · text · tool_use · tool_result · reconcile · error · permission · subagent · turn-boundary`. The console
throws it away in [turn-map.ts](../../../packages/console-viewmodel/src/turn-map.ts). Much of this overhaul is
**surfacing seams already on the wire**, not new backend work.

coa is a **standalone Electron console, not a VS Code extension.** It routes *out* to the IDE (CON-4:
`code --goto file:line`). VS Code-ext features that read the user's open editor (selection-to-chat, diagnostics
sharing) are architecturally out of reach without a reverse IDE→coa channel and are not in scope.

## 2. Scope

### In (MVP)
| # | Feature | Spec | Backend? |
|---|---|---|---|
| A1 | Separated block-type rendering (full `TurnFrame` taxonomy; stop dropping frames) | CHAT-5 | no |
| A2 | Markdown + Shiki syntax highlighting + copy button + inline code/emoji | CHAT-7 | no |
| A3 | In-chat file/line/symbol reference linkification → IDE routing | CHAT-1 + CON-4 | yes (`resolveRef` + main-side shell-out) |
| A4 | Agent plan/todo-list (`TodoWrite`) rendered as its own checklist block | CHAT-5 | no |
| B5 | Nested subagent rendering (depth-1) + per-subagent cost roll-up | CHAT-2 | no (frames on wire) |
| B6 | Rich approval cards: diff/command-led + scope grants (once/session/tool-pattern) | CHAT-3 | yes (enriched `approval` Push + `respondApproval(scope)`) |
| B7 | Tool calls collapse-by-default, expand-on-demand diff/detail | CHAT-4 | yes (`getToolDetail`) |
| C9 | Interrupt / stop the running agent (cooperative, atomic at M6 mutate boundary) | CHAT-10 | yes (`interruptSession`) |
| C11 | Status indicator (running / idle / blocked-approval / blocked-tool / done / error) | CHAT-5 | yes (`status` Push emission) |
| D13 | Stick-to-bottom autoscroll + jump-to-latest affordance | item 3 | no |
| D14 | Redesigned composer (multiline + send + stop + model + effort + expand button) | item 3 | no |
| D15 | Effort/reasoning selector in composer (existing reasoning config seam) | item 3 | no |
| E17 | Permission-mode toggle (SDK default / auto-accept-edits / plan) | spike | yes (`permissionMode` in M9) |
| — | Intrinsic composer key bindings (Enter/Shift+Enter/Esc) + keymap seam | spike | no |

### Deferred (seams kept)
- **Authoritative reconciliation (CHAT-9)** — the `reconcile` frame is already on the wire and stays dropped; no
  seam work needed to defer. High-value follow-up.
- **Steer/queue mid-run (CHAT-10)**, **focus/denoise density control (CHAT-5)**.
- **Expand-to-side editor panel** — MVP ships an **inline** expand (larger draft area/modal); the affordance is
  shaped so it can later re-target the deferred nav-rail editor panel.
- **@-mention file input**, **message edit/retry-fork** — cluster with attachments/slash/rewind.
- **File attachments**, **full slash commands** + the in-chat command surface + manual skill invoke (CHAT-8).
- **Configurable/rebindable global shortcut system** — MVP wires only the intrinsic composer bindings and leaves a
  keymap registration seam.

### Separate projects (not this overhaul)
- Conversation compaction UI (CHAT-6) — own UI part + real backend seam (R-7.b).
- Timeline/rewind + conversation history search (CHAT-10) — own UI part; leave the existing `TimelinePanel` stub.

## 3. Invariants (binding)
- **Catalogue-only, computes-nothing.** Every action is an M8 verb; the console renders, never recomputes. Diffs
  render **byte-faithfully** (D128) — the highlighter colorizes, never mutates bytes.
- **SC-1 preserved.** The console adds **no** block. Approval cards *surface*; the only two denies (close-gate,
  cost-cap) come through `DenyNotice`. The permission-mode toggle drives the **SDK's** native mode, not a coa cage.
- **Strict-superset (D85).** `coa raw` stays sacred; every new render kind degrades to the raw `tokens` floor.
- **Build from the kit, no raw values, renderer-isolation.** New members live in `console-ui` with lint-enforced
  intent blocks, styled only from tokens. Markdown/highlighting must not use `dangerouslySetInnerHTML`. IDE
  shell-out happens only on the trusted Electron **main** side.

## 4. Architecture

**Layering (unchanged boundaries):**
- **`packages/console-ui`** — new kit members with intent blocks, token-styled: `Markdown` (react-markdown +
  remark-gfm + Shiki), `CopyButton`, and a reworked `Transcript` (block kinds, nesting, collapse/expand). No
  panel-level styling.
- **`packages/console-viewmodel`** — the pure mapping layer. Widen the view `TurnFrame` union in
  [reads.ts](../../../packages/console-viewmodel/src/reads.ts); make [turn-map.ts](../../../packages/console-viewmodel/src/turn-map.ts)
  **stop discarding taxonomy**.
- **`apps/desktop`** — `ChatPanel` composition + IPC wiring; IDE shell-out on main.
- **Backend (M8/M9 packages)** — the seam tail behind the JSON-RPC catalogue.

**Library choices (heavy pieces, use existing tools):**
- **Markdown structure:** `react-markdown` + `remark-gfm`. Renders through React components (no
  `dangerouslySetInnerHTML`), sanitizes by default — right under D128 renderer-isolation; lets every element map to
  a kit component (`Link`, inline `Code`).
- **Syntax highlighting: `react-syntax-highlighter` (hljs) — DECIDED (Phase-0 A/B, 2026-07-02).** Synchronous
  (renders on first paint, clean in a virtualized transcript), token-driven (auto-follows the theme + density
  toggle), and bounded in bundle weight. The A/B showed Shiki's default `bundle/full` blew the renderer to 2.0 MB /
  302 chunks for marginal fidelity gain on common-language snippets; it stays a possible future swap behind the same
  `CodeBlock` props (`shiki/core` + hand-registered languages) if VS-Code-grade fidelity is later wanted.
- **Virtualization/autoscroll:** existing `react-virtuoso` `followOutput`.

## 5. The frame model (spine)

The view `TurnFrame` union grows from 6 flat kinds to a taxonomy mirroring the wire, plus nesting metadata:

| View kind | Wire source | Today | MVP render |
|---|---|---|---|
| `text` | `text` | plain string | markdown-rendered |
| `thinking` | `thinking` | flattened → text | distinct, muted, collapsible block |
| `tool-use` / `tool-result` | `tool_use`/`tool_result` | flat inline | collapsed card; expand → `getToolDetail` |
| `plan` | `tool_use` (`TodoWrite`) | raw tool call | special checklist block |
| `error` | `error` | "⚠ text" line | distinct danger-toned block |
| `subagent` | `subagent` | dropped | nesting boundary + parent roll-up |
| `approval` | `permission` + approval Push | basic card | diff-led card + scope grants |
| `reconcile` | `reconcile` | dropped | **stays dropped (deferred)** |
| `deny` / `raw` | — | as-is | unchanged |

Nesting is carried by a `parentTurn`/`depth` field (the wire already has `parentTurn` on the subagent frame per
CHAT-2). The `Transcript` renders children indented under their spawn frame with the roll-up on the parent.

## 6. Render surfaces

**Turn structure & role differentiation (mockup-review refinement, 2026-07-02).** No `YOU`/`AGENT` gutter labels.
Differentiation is structural, Claude-CLI style: **user turns** render flush as a distinct raised/tinted block (they
read as "your input"); **agent turns** indent one level under a **dotted vertical spine**; **subagent turns** indent
a *further* level with their own spine (so nesting stays legible now that agent turns are also indented). The
transcript is **grouped** — each group is one user turn + the agent/subagent turns until the next user turn — and the
**nearest user message sticks to the top** of the chat as you scroll, so the active prompt is always visible.

**Transcript block treatments** (VS-Code-grounded, forge-themed):
- **`text`** → `Markdown`: GFM, headings/lists/tables, inline code via kit `Code`, links via kit `Link`, emoji;
  fenced code blocks → syntax-highlighted (react-syntax-highlighter/hljs) with a `CopyButton` in the block header
  (byte-faithful).
- **`thinking`** → muted collapsible "Thinking" block, collapsed by default past the active turn.
- **`tool-use`/`tool-result`** → compact one-line card (tool + summary + status glyph), collapsed by default; a
  **hover outline** marks it expandable and the disclosure **caret animates** on toggle (reduced-motion honored);
  expand → `getToolDetail(handle)` renders full args + byte-faithful diff for edits; result correlates to its call.
- **`plan`** (`TodoWrite`) → rendered checklist (pending / in-progress / done per item).
- **`error`** → distinct danger-toned block, never merged into text.
- **`subagent`** → spawn inline; child stream indented a level deeper than agent turns under its own spine; parent
  frame carries a roll-up chip (tools · tokens · $ · status), depth-1 (CHAT-2); cost reuses CON-5 data.
- **`approval`** → diff/command-led card (leads with the real command/diff, risk-tiered) + scope buttons
  once/session/tool-pattern → `respondApproval(scope)`. Buttons use a **larger hit target** (kept in-card so they
  don't read as out of place). Pure surfacing (SC-1).
- **In-stream references** → linkified (pure render); click → `resolveRef` → IDE shell-out on main (opens at line).

**Autoscroll & sticky prompt** — `GroupedVirtuoso` groups the stream by user turn; the current group's user message
is a sticky header. `followOutput` keeps it pinned to the bottom while streaming *iff* at bottom; scrolling up
detaches and shows a **jump-to-latest** affordance. A live **"running for Ns"** elapsed counter (client-side, from
send → idle) rides the status indicator; per-block/per-tool durations are deferred (need a Phase-2 frame-timing seam).

**Composer** (replaces the single-line input + separate `ModelBar`):
- Multiline auto-growing textarea; **Enter = send, Shift+Enter = newline, Esc = interrupt** (intrinsic; rebindable
  actions register through a keymap seam for the future global system).
- **Send / Stop** — Stop live while running → `interruptSession`.
- **Model select** + **effort/reasoning select** (existing reasoning config seam), moved into the composer.
- **Permission-mode toggle** (default / auto-accept-edits / plan) over the SDK's `permissionMode`.
- **Expand button** → MVP inline expand (large draft area/modal), shaped to later target the side editor panel.

**Status** — a status indicator (header or composer-adjacent) driven by the `status` Push.

## 7. Backend tail (behind the M8 catalogue)

| Seam | Module | State today | MVP need |
|---|---|---|---|
| `subagent`/`thinking`/`error` frames | wire | on the wire, dropped by console | stop dropping (no backend) |
| `getToolDetail(handle)` | M8 read | floored | byte-faithful args/diff on expand |
| `resolveRef(ref, worktree?)` | M8 read (M1.lookup/`fuzzyMatch` + M9.refs) | floored | ref-click → IDE routing |
| `interruptSession` | M8 verb / M6 mutate boundary | deferred floor | Stop + Esc |
| enriched `approval` Push + `respondApproval(scope)` | R-12 push / M8 verb | approvals mock/inert | live diff-led cards + scope grants |
| `permissionMode` | M9 adapter Options | not wired | mode toggle |
| `status` Push | M8 driver | schema on wire; emission unconfirmed | live status indicator |

## 8. Phasing

- **Phase 0 — design gate.** frontend-design skill + coa design-principle grounding + **showcase mockups** (block
  types, subagent nesting, approval card, composer) → **user review** before any wiring.
- **Phase 1 — pure render, zero backend.** Frame-model expansion + `turn-map` stops dropping; `Markdown`/Shiki/
  `CopyButton` kit member; all block treatments; subagent nesting + roll-up; autoscroll + jump-to-latest; composer
  redesign shell (multiline, model+effort, Enter/Shift+Enter, inline expand). Renders over data already streaming.
  Degrades honestly where Phase 2 isn't in yet (tool cards collapsed-but-not-yet-expandable; refs shown but
  not-yet-navigable; Stop present but disabled; status from a floor signal).
- **Phase 2 — backend-backed.** `getToolDetail` (diff expand); `resolveRef` + IDE shell-out; `interruptSession`
  (Stop live); enriched `approval` + `respondApproval(scope)`; `permissionMode` toggle; `status` Push emission. Each
  lights up its Phase-1 placeholder.

The overhaul is visible and reviewable after **Phase 1**, with no half-built backend blocking it; each Phase 2 item
is an independent, testable slice.

## 9. Verification
- Pure layers unit-tested: `selectVm`, `turn-map` (each wire kind → view frame), `buildRailItems`, roll-up math.
- `TranscriptRow` tested **per-kind** (existing pattern — exported rows tested without Virtuoso/jsdom); new
  `Markdown`/`CopyButton` members tested.
- Backend seams TDD'd against mocks (established loop-driver mock pattern).
- Same-commit doc rule: new kit members → `COMPONENTS.md`/UI.md; new files → REPO_LAYOUT; resolve the touched
  `⚠ REVIEW` SPEC items (`getToolDetail`, `resolveRef`, enriched `approval`/`respondApproval`, `subagent`/`status`
  Push, `parentTurn`).

---

_Last reviewed: 2026-07-02_

# Spec: Console agents surface + chat agent rail & session switcher

_Status: design APPROVED (interactive session) · Authored: 2026-07-01 · Owner module: M10 Console_
_Parent: [2026-06-30-console-frontend-foundation-design.md](2026-06-30-console-frontend-foundation-design.md)
(the foundation spec). This spec **supersedes §21.3's 4c-2 placement** (dock summary + `Sheet`): agent config
becomes a routable main surface, and the chat pane gains an agent rail + session switcher. Everything else in
§21.3 stands._

## 1. Problem

The agent story in the shell is two placeholders: a dead `agent` dock pane (role/scope `KeyValue`) and a chat
pane with no notion of *which* agent you are talking to or *which* session you are in. This pass hardens the
agents UX: a real agent-management surface (identity, naming, scope, config skeleton) and the chat-side
affordances for choosing an agent and a session. Chat *content* UX (composer, frames, tool detail) is a later,
separate pass.

## 2. Locked decisions (from the brainstorm)

1. **Placement — Agents is a nav-rail route.** A new `agents` section fills the dominant main region (like
   Cost/Flags/Timeline). The dock `agent` leaf is removed; the right dock becomes **Chat + Account**.
2. **Local vs shared = Personal vs Project.** "Project" agents live committed in the repo's `.coa/` (shared
   with collaborators via git — no publishing, so the MU-13/14 deferral is untouched); "Personal" agents are
   user-level, outside the repo. The VS Code User/Workspace + Claude Code `~/.claude/agents` pattern.
3. **Naming lives in the editor, not the picker.** The picker only selects (+ creates); identity editing
   happens in an **identity header** — icon+color chip (click → identity popover) beside a click-to-edit name
   (Linear/Notion pattern), with an overflow menu for Rename/Duplicate/Move/Delete.
4. **One session switcher, selection-follows-session.** A single dropdown in the chat header, scoped to the
   rail-selected agent, with an "All agents" section inside it. Picking any session anywhere re-points the
   rail to that session's agent — the rail and switcher can never disagree.

## 3. Invariants

- **Mock-first through the registry seam** (§12/§16 of the foundation spec): `listRoles`/`getRole`/`writeRole`
  and any session-list verb are unbuilt; every read here is honest mock shaped like its future verb, swapped
  via the registry with no panel refactor. All writes are mock-inert.
- **SC-1 / D85 untouched** — everything here is selection and surfacing; the console denies nothing; the raw
  toggle stays on the chat pane.
- **An agent = a Role** (SPEC CON-1). Mock shapes mirror the Role model (name · scope · pieces · model) so the
  future `writeRole` funnel (R-4 + `M1.emit`) drops in.
- **Brass stays the system's color.** Agent identity colors are a separate categorical set; brass is never an
  agent color (§5.1 #9).

## 4. The Agents surface (main region)

Top to bottom, composed on the pane-scoped grid:

1. **Agent picker** — a grouped switcher dropdown, top-left: **Pinned** (only when non-empty) → **Project** →
   **Personal** (eyebrow group labels) → **`+ New agent`** action row. Rows = identity chip + name; selected
   row checked; full keyboard + type-ahead.
2. **Identity header** — the view's single focal element: the agent's **`lg` identity chip** (click → identity
   popover: 16-glyph icon grid + 8-swatch color row, previewing live) beside the **name as click-to-edit
   title** (hover pencil; Enter commits; Esc cancels; empty reverts). Under the name, a quiet metadata line:
   scope `Badge` (`Project` / `Personal`) + the agent's ref path in `Code`. Right-aligned **overflow menu**:
   Rename · Duplicate · Move to Project/Personal · Delete (confirm `Dialog`; project agents type-the-name).
3. **Config editor body** — the 4c-2 skeleton, shallow for now: Model (`Select`), Scope (`TextField`),
   Pieces (list + add affordance, inert). Its real form arrives with the CON-1 seam.

**New-agent flow:** `+ New agent` creates a draft (default icon/color, name `untitled-agent`) and focuses the
name field (create-then-rename). A Project/Personal segmented choice sits in the draft header; it freezes on
first save (later moves via the overflow).

**States-first:** loading skeleton mirroring header+form; error `InlineMessage`; `EmptyState` ("No agents
yet" + New agent).

## 5. Agent identity system

- **Icons: a curated 16-glyph Lucide vocabulary** (bot, hammer, wrench, flask-conical, shield, book-open, bug,
  search, pen-tool, git-branch, terminal, database, layers, eye, compass, sparkles) — a fixed set, not a
  browser, so agents cohere (P9).
- **Colors: 8 categorical swatches** anchored in the Okabe-Ito categorical palette (§15's prescribed
  colorblind-safe set), tuned to the warm-dark theme for ≥3:1 on `bg-surface`, and **excluding brass** and
  near-collisions with the status hues: `slate · sky · blue · teal · green · mauve · violet · coral`. Tier-1
  palette entries + tier-2 `--color-agent-*` semantic tokens (dark + light values), mapped in `theme.css`.
- **`AgentChip`** (new Data-display kit member): `rounded-control` square, color ground at low alpha, glyph
  stroked in the color; sizes `sm` (rail) / `md` (rows) / `lg` (identity header). Color is never the only
  encoding — glyph + name always ride along (§15); unknown icon/color names degrade to `bot`/`slate` at the
  edge (drop-unknown posture).

## 6. Chat pane: agent rail + session switcher

**Agent rail** — a collapsed icon column attached to the pane body's left edge (below the header, full body
height): identity chips, **pinned first**, then the active session's agent (if unpinned), then the rest.
The **active agent** carries an edge marker in *its own color* + raised ground (the nav rail's marker grammar,
agent-colored — brass stays the nav's). **Hover expands to a ~200px overlay flyout** (the transcript never
reflows) showing chip + name + group labels; expand on hover-intent (~250ms), instantly on keyboard focus;
collapse on leave/Esc. Transform/opacity only, `fast` duration, reduced-motion honored.

- **Click a chip → that agent's most recent session** (or a new session if none).
- **Context menu** per chip: New session · Pin/Unpin · Configure (routes main → Agents with that agent
  selected — the cross-link between surfaces).
- Keyboard: a labelled rail; arrow keys traverse, Enter selects; collapsed chips carry tooltips +
  `aria-label`s.

**Session switcher** — top-left of the pane header (raw toggle stays top-right): current session title +
chevron. Open: the rail-selected agent's group first (chip + name header, sessions newest-first with relative
times, `+ New session`), divider, **All agents** (recent across agents, each row with its agent chip, capped
~10). **Invariant: picking any session re-points the rail to its agent.** `Pane` accepts a `titleSlot`
ReactNode so the switcher can live in the header without forking the pane pattern.

## 7. Pinning

Pinned agents are a **user-local UI preference**: `pinnedAgents: string[]` on `ConsoleSettings`
(`settings.json`, main-side — never written into a Role). Read by the picker's Pinned group and the rail's
collapsed set; toggled via row hover-star (picker, expanded rail) and the chip context menu.

## 8. Mechanism (no new seams)

- **`console-viewmodel`**: Zod edge schemas `AgentSummary` (`ref · name · icon · color · scope:
  'project'|'personal' · model`) and `SessionSummary` (`id · agentRef · title · updatedAt`), shaped like their
  future verbs; icon/color use `.catch` defaults.
- **`ConsoleState`**: `data` gains `agents`/`sessions` (`Remote<T>`, mock-seeded); `ui` gains
  `selectedAgentRef` (editor) + `activeSessionId` (chat); `actions` gains `selectAgent · selectSession ·
  newSession · createAgent · updateAgent · deleteAgent · togglePinAgent` (mock-inert writes over in-memory
  mock state; `data.turns` re-seeds per session from a mock session→turns map).
- **Shell reshape**: nav gains `agents` (Bot icon, after Timeline); `ROUTABLE_IDS` gains `agents`; the dock
  descriptor drops the `agent` leaf; `LAYOUT_EPOCH` bumps.
- **New kit members** (each with intent block + showcase + jsdom tests): `AgentChip` (Data-display) ·
  `IdentityPicker` (Overlays) · `SwitcherMenu` (Actions — the grouped rich-row switcher serving BOTH the agent
  picker and the session switcher) · `AgentRail` (Layout) · `InlineEdit` (Inputs — click-to-edit title).
  `Pane` gains `titleSlot`.

## 9. Testing

House pattern: pure `selectVm` unit tests per panel (states-first: loading/error/empty/ready); per-component
jsdom tests (keyboard, aria, feedback states); routing/descriptor tests for the reshape (epoch fallback, agent
leaf gone); settings parse test for `pinnedAgents` default; enum-vocabulary test asserting the viewmodel
icon/color enums match the kit's records.

## 10. Deferred

Real CON-1 verbs (`listRoles`/`getRole`/`writeRole`) and any session-list verb (ride their own specs) · the
full Pieces editor (4c-2 content) · Duplicate/Move implementations beyond mock-inert menu items · chat content
UX (composer, tool detail — the user's "part 2") · drag-reorder of pins · per-agent default scope pickers.

---

_Last reviewed: 2026-07-01_

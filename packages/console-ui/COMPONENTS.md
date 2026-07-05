# Component catalogue

_Generated from each component's intent declaration. Do not edit by hand._

## Actions

### Button

Triggers an action the user commits to.

- **Use it when:** Submitting, confirming, running, or cancelling an action. A view has one primary action (use variant=primary once).
- **Don't use it when:** Navigating to another location — use Link. Toggling a boolean — use Switch or Checkbox. The trigger is icon-only in a dense toolbar — use IconButton.
- **Anatomy:** Optional leading Icon, label, optional trailing Icon; one border-box control.
- **Variants & states:** primary, secondary, tertiary, danger, sizes sm/md, rest, hover, active, focus, loading, disabled
- **Accessibility:** Native <button> (Enter/Space activate); loading sets aria-busy and disables; visible focus ring; asChild preserves the child role.
- **Related:** IconButton, ButtonGroup, Link

### ButtonGroup

Groups related buttons as one labelled cluster.

- **Use it when:** Two or more actions belong together (confirm/cancel, segmented choices).
- **Don't use it when:** The buttons are unrelated — lay them out separately.
- **Anatomy:** A role=group wrapper around Button/IconButton children.
- **Variants & states:** rest
- **Accessibility:** role=group with an aria-label naming the cluster.
- **Related:** Button, Toolbar

### CopyButton

A one-click control that copies a string to the clipboard with brief confirmation feedback.

- **Use it when:** Offering copy on a code block, id, diff, or any short text payload.
- **Don't use it when:** Copying requires formatting/serialization first — do that upstream and pass the final string.
- **Anatomy:** An IconButton showing a copy glyph that swaps to a check for ~1.2s after a successful copy.
- **Variants & states:** idle, copied
- **Accessibility:** Native button; its accessible name announces Copy → Copied on success.
- **Related:** Code, IconButton

### IconButton

An icon-only button for dense toolbars where a text label would not fit.

- **Use it when:** A recognizable action fits a compact toolbar (rewind, copy, expand).
- **Don't use it when:** The action is primary or ambiguous — use a labelled Button.
- **Anatomy:** A square button wrapping one Icon; label is the accessible name.
- **Variants & states:** primary, secondary, tertiary, danger, sizes sm/md, hover, focus, loading, disabled
- **Accessibility:** label is required and becomes aria-label; native button keyboard model; visible focus ring.
- **Related:** Button, Menu

### Link

Navigates to another location or resource.

- **Use it when:** Moving to a route, doc, or external resource.
- **Don't use it when:** Committing an action — use Button.
- **Anatomy:** A styled anchor, optionally external.
- **Variants & states:** default, muted, hover, focus, external
- **Accessibility:** Native anchor; external links get rel=noopener noreferrer; visible focus ring.
- **Related:** Button

### Menu

A dropdown of secondary actions behind a trigger.

- **Use it when:** Overflow or contextual actions that do not warrant always-visible buttons.
- **Don't use it when:** Selecting a value from options — use Select. A single primary action — use Button.
- **Anatomy:** A trigger and a portalled list of items with optional icons.
- **Variants & states:** closed, open, item hover/highlight, item disabled
- **Accessibility:** Radix menu semantics: roving focus, Escape closes, arrow keys navigate, type-ahead.
- **Related:** Button, IconButton, Select

### SwitcherMenu

A grouped dropdown for switching the current entity (agent, session) with rich rows.

- **Use it when:** Switching among named entities organized in groups (pinned/project/personal agents; per-agent then all-agent sessions), optionally with create-new action rows.
- **Don't use it when:** Picking a plain form value — use Select. A list of commands — use Menu. Editing/renaming the entity — that happens on its surface, never inside the picker.
- **Anatomy:** A trigger and a portalled menu of eyebrow-labelled groups; each row = leading visual + label + quiet meta + selected check; groups may end in action rows.
- **Variants & states:** closed, open, row highlighted, row selected, action row, empty group (hidden)
- **Accessibility:** Radix menu semantics (roving focus, arrows, type-ahead, Escape); groups labelled; selection is marked with a check icon, not color alone.
- **Related:** Menu, Select, AgentChip

## Data-display

### AgentChip

An agent's identity mark — its glyph on its categorical color ground.

- **Use it when:** Identifying an agent in a picker row, rail, session list, or the agent editor header.
- **Don't use it when:** Conveying status or severity — use Badge. A generic decorative icon — use Icon. As the only encoding of identity — always pair with the agent name nearby.
- **Anatomy:** A rounded square ground tinted with the agent color holding one glyph from the curated 16-glyph vocabulary; sizes sm/md/lg.
- **Variants & states:** sm, md, lg, each of 8 categorical colors, decorative or labelled
- **Accessibility:** Decorative (aria-hidden) unless label is passed (role=img); identity is never color alone — the glyph differs per agent and the name renders beside it.
- **Related:** Icon, Badge, AgentRail, IdentityPicker

### Badge

A small toned label for a status, count, or category.

- **Use it when:** Tagging severity, plan, or a small count next to a heading.
- **Don't use it when:** It is an interactive filter — use a Button/Toggle.
- **Anatomy:** A rounded pill with a tone and short text.
- **Variants & states:** neutral, info, success, warning, danger
- **Accessibility:** Tone is conveyed by text, not color alone; data-tone for styling.
- **Related:** Stat, Icon

### Code

Renders code or identifiers verbatim in monospace.

- **Use it when:** Showing a symbol, path, command, or byte-faithful block.
- **Don't use it when:** Prose — use normal text.
- **Anatomy:** Inline <code> or a whitespace-preserving <pre> block.
- **Variants & states:** inline, block
- **Accessibility:** Preserves bytes exactly; no truncation or normalization.
- **Related:** KeyValue

### KeyValue

Shows term/value pairs for a single record.

- **Use it when:** Displaying metadata of one thing (model, turns, mode).
- **Don't use it when:** Many records — use Table.
- **Anatomy:** A description list of term/description pairs on a two-column grid.
- **Variants & states:** rest
- **Accessibility:** Semantic dl/dt/dd.
- **Related:** Table, Stat

### List

Renders a simple sequence of items with a custom item renderer.

- **Use it when:** A flat sequence (flags, files) without columnar structure.
- **Don't use it when:** Records with multiple aligned fields — use Table.
- **Anatomy:** A semantic list of rendered items.
- **Variants & states:** rest
- **Accessibility:** role=list/listitem; optional aria-label.
- **Related:** Table, KeyValue

### Stat

A single labelled metric with an optional sub-line.

- **Use it when:** Surfacing a headline number (cost, turns) in the dashboard rail.
- **Don't use it when:** Several related fields — use KeyValue.
- **Anatomy:** An eyebrow label, a large tabular value, an optional sub-line.
- **Variants & states:** default, info, success, warning, danger
- **Accessibility:** Value is labelled by its eyebrow id; numbers use tabular figures.
- **Related:** KeyValue, Badge

### Table

Presents rows of records with aligned columns, empty state first.

- **Use it when:** Showing the ledger, decisions, or timeline as scannable rows.
- **Don't use it when:** Two fields of one record — use KeyValue. A simple sequence — use List.
- **Anatomy:** A caption, column headers, and rows with per-column render + alignment; an empty slot.
- **Variants & states:** populated, empty
- **Accessibility:** Semantic table with scoped column headers and an sr-only caption.
- **Related:** List, KeyValue

## Dense/Viz

### Composer

A multiline auto-growing message composer with a send/stop toggle.

- **Use it when:** Sending a message into a live governed session — chat input with model/effort controls and a running-turn stop action.
- **Don't use it when:** A single-line filter or search field — use TextField. A structured form input — use Field/TextField/Select.
- **Anatomy:** A floating rounded control surface (not a full-width bordered panel): an auto-growing textarea over a toolbar row — a leading attach control, host-provided slotStart (model/effort/permission selects), host-provided slotEnd, a mic control, and a trailing glyph Send/Stop toggle. Attach and mic render disabled (inert) until a host wires a handler.
- **Variants & states:** idle, running, disabled, multiline, attach-inert, mic-inert
- **Accessibility:** The textarea carries an aria-label; Enter sends (unless Shift or IME-composing), Shift+Enter inserts a newline, Esc calls onInterrupt while running; Send/Stop are native focusable buttons.
- **Related:** Transcript, Button, Select

### Markdown

Renders GitHub-flavored markdown as kit elements, with highlighted, copy-able code blocks.

- **Use it when:** Rendering agent/user prose that may contain markdown, code, links, or task lists.
- **Don't use it when:** Showing raw, untrusted bytes that must not be interpreted — use Code block.
- **Anatomy:** A prose container mapping markdown nodes to Link, Code, and CodeBlock; GFM tables/task-lists supported.
- **Variants & states:** prose, inline-code, fenced-code, task-list, table, link
- **Accessibility:** Semantic headings/lists/links; code blocks expose a labelled copy button; text is byte-faithful.
- **Related:** Code, CopyButton, Link, Transcript

### ToolCard

A rich, self-contained rendering of one agent tool call.

- **Use it when:** Showing a tool call in the transcript — a highlighted diff for edits and symbol edits, a read/symbol-source preview, clickable search-match rows, run_checks status chips, or a command-output tail, with a clickable path/line and an estimated-token readout.
- **Don't use it when:** Rendering prose or a plan checklist — those are their own transcript kinds. A one-line activity summary is enough — that is a different tool-block direction.
- **Anatomy:** A header (tool icon, verb, clickable file path with an optional line — or a WebFetch source URL that opens in the browser, a summary that carries the symbol/patch detail past the file, estimated tokens, status glyph) over a body that leads with a byte-faithful highlighted diff (edits + symbol edits), a highlighted preview (reads + symbol source), clickable search-match rows, clickable WebSearch result links, run_checks status chips, or a command-output tail with red-marked error tokens. A failure (ok:false) takes priority: its output is always shown as a red error body, never collapsed to header-only. An empty search result renders no body — the 0-count shows in the header. Read/search/fetch tools otherwise collapse to the header + an Expand control by default; other bodies clamp to a max line count. Expand opens the full body in the pane overlay.
- **Variants & states:** running, ok, failed, diff, preview, matches, web-links, empty, checks, command-tail, truncated, expanded
- **Accessibility:** The path, each search-match row, and each web link are focusable buttons when actionable; Expand is a labelled button; the status glyph carries an aria-label; payload bytes render verbatim.
- **Related:** ToolDiffView, PaneOverlay, Code, Transcript

### Transcript

A non-virtualized turn stream of role-tagged conversation frames.

- **Use it when:** Showing the agent conversation — text, tool calls, thinking, plans, approvals, denies, errors, subagent activity, a switched-model note, or the raw loop.
- **Don't use it when:** Showing one long document — use Longform/PromptView. Showing tabular records — use Table.
- **Anatomy:** A labelled log region rendering every frame to the DOM (no windowing) as per-kind rows (text as markdown, tool-use, tool-result, thinking, plan, approval, deny, error, subagent, note, raw), with content-visibility keeping off-screen rows out of layout/paint; native scroll drives stick-to-bottom with a jump-to-latest/jump-to-prompt control, and an internal Ctrl/Cmd+F find bar searches the full transcript.
- **Variants & states:** user-turn, text, tool-use, tool-result, thinking, plan, approval, approval-resolved, deny, error, subagent, note, nested, raw, find-open, empty
- **Accessibility:** role=log with an aria-label; approval actions are native focusable buttons; the find bar is a labelled search region; payloads render byte-faithfully.
- **Related:** DenyNotice, Code, Markdown, Table

## Feedback

### Banner

Shows a persistent, in-flow status message tied to a region or view.

- **Use it when:** A condition persists and the operator needs to keep seeing it (degraded mode, stale data).
- **Don't use it when:** The message is transient — use Toast. It is a validation error on a control — use the Field error. It is a system deny — use DenyNotice.
- **Anatomy:** Tone icon, title, optional body, optional dismiss.
- **Variants & states:** info, success, warning, danger, dismissible
- **Accessibility:** role=status (danger uses role=alert); dismiss has an accessible label; never color alone (tone icon).
- **Related:** Toast, InlineMessage, DenyNotice

### DenyNotice

Surfaces a denial the daemon already issued — the close-gate or the cost-cap.

- **Use it when:** Rendering a deny returned by the single deny channel (the only two real blocks).
- **Don't use it when:** You are tempted to block or gate an action in the UI — the console never denies; only the daemon does. The message is a non-blocking warning — use Banner.
- **Anatomy:** Deny-kind eyebrow, the verbatim reason, optional next-step detail.
- **Variants & states:** close-gate, cost-cap
- **Accessibility:** role=alert; the kind is named in text, not color alone.
- **Related:** Banner, InlineMessage

### EmptyState

Explains why a region is empty and what to do next.

- **Use it when:** A list/table/pane has no content yet — designed before the happy path.
- **Don't use it when:** It is loading — use Skeleton. It is an error — use Banner/InlineMessage.
- **Anatomy:** An icon, a title, a description, and an optional action.
- **Variants & states:** with action, without action
- **Accessibility:** Icon is decorative; meaning is in the text.
- **Related:** Skeleton, Banner

### InlineMessage

A compact toned message shown inline with content.

- **Use it when:** A short status next to a control or row (unsaved, syncing).
- **Don't use it when:** A region-level condition — use Banner. A validation error on a field — use the Field error.
- **Anatomy:** A tone icon and short text.
- **Variants & states:** info, success, warning, danger
- **Accessibility:** Danger uses role=alert; tone carried by icon, not color alone.
- **Related:** Banner, Toast

### Progress

A determinate bar for a measurable long operation.

- **Use it when:** An operation over ~10s with known completion (>10s triage step).
- **Don't use it when:** Duration is unknown — use Spinner. A structured region is loading — use Skeleton.
- **Anatomy:** A track with a filled bar sized to the value.
- **Variants & states:** 0–100%
- **Accessibility:** role=progressbar with aria-valuenow/min/max and a label.
- **Related:** Spinner, Skeleton

### Skeleton

A placeholder block for structured content that is loading.

- **Use it when:** A pane with known shape (timeline, ledger) is loading 2–10s.
- **Don't use it when:** A single control is busy — use Spinner.
- **Anatomy:** A pulsing rounded block sized to the incoming content.
- **Variants & states:** pulsing
- **Accessibility:** aria-hidden (decorative); honors reduced motion.
- **Related:** Spinner, EmptyState

### Spinner

An indeterminate busy indicator for a single module.

- **Use it when:** A short (~1–2s) wait with unknown duration on one control/module.
- **Don't use it when:** A structured pane is loading — use Skeleton. Completion is measurable — use Progress.
- **Anatomy:** A rotating loader glyph in a live status.
- **Variants & states:** spinning
- **Accessibility:** role=status, aria-live=polite, labelled; honors reduced motion.
- **Related:** Progress, Skeleton

### Toast

A transient confirmation that auto-dismisses.

- **Use it when:** Confirming a completed local action (saved, copied).
- **Don't use it when:** The condition persists — use Banner. It is a system deny — use DenyNotice.
- **Anatomy:** A provider + viewport hosting toast roots with title, body, and close.
- **Variants & states:** info, success, warning, danger, open/closed
- **Accessibility:** Radix toast live region; close has an accessible label.
- **Related:** Banner, InlineMessage

## Foundations

### Icon

Renders a single Lucide glyph at a consistent stroke and grid size.

- **Use it when:** A glyph reinforces a label, status, or action.
- **Don't use it when:** A glyph would stand alone as the only meaning — pair it with text. You need an emoji — emoji are banned.
- **Anatomy:** A Lucide icon component sized to the icon grid.
- **Variants & states:** decorative (aria-hidden), labelled (role=img)
- **Accessibility:** Decorative by default (aria-hidden, not focusable); pass label to announce it as an image.
- **Related:** IconButton, Badge

## Inputs

### Checkbox

Toggles a single independent boolean.

- **Use it when:** One on/off option that stands alone (enable verbose logging).
- **Don't use it when:** Choosing one of several — use Radio. An immediate-effect setting toggle reads better as a Switch.
- **Anatomy:** A Radix checkbox box with a check indicator and a clickable label.
- **Variants & states:** unchecked, checked, focus, disabled
- **Accessibility:** role=checkbox, Space toggles, label associated by id; visible focus ring.
- **Related:** Switch, Radio

### Combobox

Chooses one value from a long list by typing to filter.

- **Use it when:** Selecting from many options where filtering by text helps (a symbol, an account).
- **Don't use it when:** The list is short — use Select or Radio. Free-text with no fixed set — use TextField.
- **Anatomy:** A text input (role=combobox) over a filtered listbox of options.
- **Variants & states:** collapsed, expanded, filtered, option hover/selected
- **Accessibility:** Input is role=combobox with aria-expanded/aria-controls/aria-autocomplete; options are role=option in a role=listbox.
- **Related:** Select, TextField

### Field

Wraps a control with an associated label, description, and error.

- **Use it when:** Building a custom control that needs label/description/error wiring.
- **Don't use it when:** You want a ready-made text input — use TextField.
- **Anatomy:** Label, optional description, the control (render-prop), optional error alert.
- **Variants & states:** rest, invalid (error present)
- **Accessibility:** Associates label via id and description/error via aria-describedby; error uses role=alert.
- **Related:** TextField, Select, Combobox

### InlineEdit

Click-to-edit text for renaming a thing where it is displayed (title pattern).

- **Use it when:** Renaming an entity in place — the agent name in the identity header, a session title.
- **Don't use it when:** Collecting a value in a form — use TextField. The text is not editable — render it plainly.
- **Anatomy:** A display button (value + hover pencil) that swaps to an input on click; identical type styling in both modes so nothing shifts.
- **Variants & states:** display rest/hover/active/focus, editing, disabled
- **Accessibility:** Display button is named "Rename {label}: {value}"; the editor input carries the label; Enter commits, Escape cancels, blur commits; empty/unchanged drafts revert without firing.
- **Related:** TextField, IdentityPicker

### Radio

Chooses exactly one option from a small, visible set.

- **Use it when:** 2–5 mutually exclusive options that benefit from being all visible.
- **Don't use it when:** Many options — use Select. Independent booleans — use Checkbox.
- **Anatomy:** A labelled radiogroup of labelled radio items.
- **Variants & states:** unselected, selected, focus, item disabled
- **Accessibility:** role=radiogroup with roving focus; arrow keys move selection; group labelled by id.
- **Related:** Select, Checkbox

### Select

Chooses one value from a fixed list via a dropdown.

- **Use it when:** A single choice from a known, closed set that is too long for Radio.
- **Don't use it when:** The set is short and worth showing at once — use Radio. The user should be able to filter/type — use Combobox.
- **Anatomy:** A labelled trigger showing the current value and a portalled option list.
- **Variants & states:** closed, open, highlighted item, selected item, disabled
- **Accessibility:** Radix select: trigger is role=combobox labelled by id, listbox with role=option, full keyboard + type-ahead.
- **Related:** Combobox, Radio, Menu

### Switch

Toggles a setting that takes effect immediately.

- **Use it when:** An immediate on/off preference (reduce motion, compact density).
- **Don't use it when:** The value is only applied on submit — use Checkbox. Choosing among options — use Radio.
- **Anatomy:** A Radix switch track and thumb with a clickable label.
- **Variants & states:** off, on, focus, disabled
- **Accessibility:** role=switch, Space toggles, label associated by id; visible focus ring.
- **Related:** Checkbox

### TextField

A single-line text input with label, description, and error states.

- **Use it when:** Collecting a short free-text value (a name, a path, a query).
- **Don't use it when:** Choosing from a fixed set — use Select. Toggling a boolean — use Checkbox/Switch. Multi-line text — use a textarea variant (not in this kit yet).
- **Anatomy:** A Field wrapping a native <input type=text>.
- **Variants & states:** rest, hover, focus, disabled, error/invalid
- **Accessibility:** Labelled input; error sets aria-invalid + role=alert message; visible focus ring.
- **Related:** Field, Select, Combobox

## Layout

### AgentRail

The chat pane’s agent drawer: a slim chip rail that expands to names on hover.

- **Use it when:** Choosing which agent to talk to from the chat pane, with pinned agents kept in reach.
- **Don't use it when:** Navigating app sections — use NavList (the nav rail). Managing/editing agents — that is the Agents surface; the rail only selects and cross-links to it.
- **Anatomy:** A fixed 40px chip column (pinned first, active marked in the agent’s own color) plus a name drawer that slides out from behind the column on hover/focus — name rows with pin stars and a per-agent context menu (New session / Pin / Configure); the drawer is clipped and absolutely positioned so the icons never move and the content beside it never reflows.
- **Variants & states:** collapsed, expanded, item rest/hover/active/focus, pinned, context menu open
- **Accessibility:** A labelled group; every chip carries the agent name as its accessible name; the drawer expands instantly on hover and on keyboard focus and is aria-hidden while collapsed; ArrowUp/Down rove within the focused layer, Escape collapses; the active item sets aria-current; pin state is aria-pressed.
- **Related:** AgentChip, NavList, SwitcherMenu, Menu

### AppShell

The window chrome: a custom title bar above a content slot the layout engine mounts into.

- **Use it when:** Framing the desktop console — the one top-level shell around the panel layout.
- **Don't use it when:** Arranging content regions — that is the layout descriptor and engine, not the shell.
- **Anatomy:** A draggable custom title bar (platform-inset wordmark, workspace label, account context) above a single content slot.
- **Variants & states:** darwin (traffic-light inset), win32 (window-controls inset), with-account, without-account
- **Accessibility:** The title bar is a labelled banner; the content slot is the main region.
- **Related:** Pane, Toolbar, NavList

### Divider

Separates content with the lightest visible rule.

- **Use it when:** Whitespace and grouping are not enough to separate two regions.
- **Don't use it when:** Space or a tint already reads as separated — prefer removing the border.
- **Anatomy:** A one-pixel hairline, horizontal or vertical.
- **Variants & states:** horizontal, vertical
- **Accessibility:** role=separator with aria-orientation.
- **Related:** Toolbar, Pane

### NavList

A vertical list of navigable sections with one active.

- **Use it when:** Switching between primary sections in a rail (chat, decisions, timeline).
- **Don't use it when:** Choosing a form value — use Radio/Select.
- **Anatomy:** A vertical tablist of icon+label tabs.
- **Variants & states:** item rest, hover, active, focus
- **Accessibility:** role=tablist/tab with aria-selected and vertical orientation; visible focus ring.
- **Related:** Pane, Menu

### Pane

A titled, bordered content region with an optional scrolling body.

- **Use it when:** Framing a surface (cost rail, decision log) as a distinct region.
- **Don't use it when:** Content needs no frame — compose plainly to reduce chrome.
- **Anatomy:** Optional header (title text or an interactive titleSlot, plus actions) and a body that can scroll or sit flush to the edges.
- **Variants & states:** untitled, titled, titleSlot, scroll, flush
- **Accessibility:** section labelled by its heading id when titled; with a titleSlot the title string becomes the region aria-label.
- **Related:** Toolbar, Divider

### PaneOverlay

A modal-like overlay confined to its own pane, never the whole window.

- **Use it when:** Expanding a truncated in-pane detail (e.g. a full tool diff/output) over just the chat pane.
- **Don't use it when:** A window-level modal is wanted — use Dialog. A transient message is enough — use Toast.
- **Anatomy:** A provider wrapping a relative pane container; an absolute-inset overlay layer with a pane-confined scrim and a scrollable titled panel (close button); an open/close API exposed via usePaneOverlay.
- **Variants & states:** closed, open
- **Accessibility:** role=dialog + aria-modal with an aria-label; Escape and backdrop/close-button dismiss; initial focus lands on close, Tab is trapped within the panel, and focus is restored to the opener on close; the panel is a scrollable region.
- **Related:** Dialog, Sheet, Toast

### Toolbar

Groups a row of actions over a content region.

- **Use it when:** A pane needs a cluster of buttons/toggles acting on its content.
- **Don't use it when:** The actions are page-level — use the shell chrome.
- **Anatomy:** A Radix toolbar row of buttons/controls.
- **Variants & states:** rest
- **Accessibility:** role=toolbar with an aria-label; roving focus across controls.
- **Related:** ButtonGroup, IconButton

## Overlays

### Dialog

A focused modal for a confirmation or a small focused task.

- **Use it when:** Confirming a consequential action (rewind) or a short focused edit.
- **Don't use it when:** A large side surface fits better — use Sheet. A hint suffices — use Tooltip/Popover.
- **Anatomy:** An optional trigger (or externally-controlled open), an overlay, and a titled content box with optional footer actions.
- **Variants & states:** closed, open, controlled
- **Accessibility:** Radix dialog: focus trap, Escape closes, labelled by its title; overlay scrim.
- **Related:** Sheet, Popover

### IdentityPicker

Edits an agent's icon and color from the curated vocabulary, previewing live.

- **Use it when:** Changing an agent's visual identity in the agent editor's identity header.
- **Don't use it when:** Displaying identity — use AgentChip. Choosing a form value from options — use Select/Radio.
- **Anatomy:** The lg AgentChip as the popover trigger; inside, a labelled 16-glyph icon grid and an 8-swatch color row.
- **Variants & states:** closed, open, swatch/glyph rest/hover/pressed/selected, disabled
- **Accessibility:** Trigger names the agent + action; glyphs and swatches are aria-pressed toggle buttons named by icon/color; Radix popover handles dismissal and focus.
- **Related:** AgentChip, Popover, InlineEdit

### Popover

Non-modal floating content anchored to a trigger.

- **Use it when:** Showing supplemental detail or a small control cluster on demand.
- **Don't use it when:** The interaction is modal/blocking — use Dialog. A one-line hint suffices — use Tooltip.
- **Anatomy:** A trigger and a portalled, anchored content panel.
- **Variants & states:** closed, open
- **Accessibility:** Radix popover: focus management, Escape/outside-click dismiss.
- **Related:** Tooltip, Dialog, Menu

### Sheet

A side drawer for a larger secondary surface.

- **Use it when:** Settings, detail inspectors, or side forms that need room.
- **Don't use it when:** A small confirmation — use Dialog.
- **Anatomy:** A trigger and a side-anchored titled dialog with a scrim.
- **Variants & states:** left, right, closed, open
- **Accessibility:** Built on Radix dialog: focus trap, Escape closes, labelled by title.
- **Related:** Dialog, Pane

### Tooltip

A brief hint revealed on hover or focus.

- **Use it when:** Labelling an icon-only control or clarifying a term.
- **Don't use it when:** The content is interactive — use Popover. It is essential info — put it in the UI, not a hover.
- **Anatomy:** A provider, a trigger, and a small floating label.
- **Variants & states:** hidden, visible
- **Accessibility:** role=tooltip, shows on focus as well as hover; provider controls delay.
- **Related:** Popover

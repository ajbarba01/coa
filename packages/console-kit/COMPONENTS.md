# Component catalogue

_Generated from each component's intent declaration. Do not edit by hand._

## Actions

### Button

The six-variant action vocabulary — primary/quiet/outline/block/ghost/text pick the weight, icon swaps text padding for square icon geometry.

- **Use it when:** Any clickable control that commits an action: submit, confirm, deny, run, start, or trigger a menu. primary for the one accent action per view · quiet for the workhorse confirm · outline for secondary/deny · block for raised square utilities · ghost for chrome-adjacent icons · text for ink-only toolbar controls.
- **Don't use it when:** The control navigates to another location rather than committing an action. The control needs a loading state — this vocabulary has none; callers disable instead.
- **Anatomy:** A native <button> whose face (color/border/hover/press) and geometry (text padding or icon square) are selected per variant; disabled swaps to the off face with no hover, no press, no pointer.
- **Variants & states:** primary, quiet, outline, block, ghost, text, default · hover · focus-visible (global interior ring) · active (scale press) · disabled (no hover, no pointer)
- **Accessibility:** Native <button> semantics (Enter/Space activate); type defaults to button; icon-only callers must pass aria-label; loading is not applicable in this vocabulary — callers disable instead.
- **Related:** StatusDot

### MenuItem

The option row: selection is an s4 tint plus the trailing mono `current` marker, one vocabulary in every menu.

- **Use it when:** Rows inside any popup card that pick, toggle, or run something. Rich rows (glyph + two-line label) via items-start and child spans.
- **Don't use it when:** Standalone actions outside a popup — Button. Navigation rows in the shell chrome — those are surface compositions.
- **Anatomy:** A full-width native button row; `selected` renders the tint + `current`; children carry the label.
- **Variants & states:** default, hover (s4 tint), selected (tint + current marker), disabled (inert, no hover), focus-visible (global interior ring)
- **Accessibility:** Native button semantics; disabled uses the real attribute; Escape/outside-press come from the hosting popup.
- **Related:** MenuCard, PopoverCard, Select

## Brand

### BrandMark

A third party's own mark in its own color — identity you read without thinking.

- **Use it when:** Naming an external provider (agent backend, tool service) on a credentials or usage surface. A row whose subject IS the third party, where the logo is the fastest identifier.
- **Don't use it when:** Indicating state — that is StatusDot; a mark is identity, never status. Decorating coa surfaces that are not about a third party (the sand register owns those).
- **Anatomy:** One 24×24 svg path filled with the brand hex, or — when no official mark ships — a rounded monogram tile grounded in that hex.
- **Variants & states:** path (bundled official mark), monogram (no mark bundled — the extensibility floor), muted (a benched provider: desaturated + dimmed, never recolored)
- **Accessibility:** role="img" with the provider name as aria-label, so the identity survives with images or color off.
- **Related:** StatusDot, Meter

## Chrome

### WindowControls

The hidden-frame window’s min/max/close cluster, drawn in the DOM so it scales with the app zoom.

- **Use it when:** The rightmost visible title-bar segment of a frameless window (and full-window gates that keep the chrome).
- **Don't use it when:** macOS — native traffic lights own the frame there; render nothing. Anywhere that is not window chrome — these verbs act on the OS window, not the app.
- **Anatomy:** Three self-stretching w-10 buttons ─ · ▢/❐ · ✕ in a no-drag flex row; the middle glyph tracks the real maximized state.
- **Variants & states:** default (ink s8), hover (min/max: s3 ground + s10 ink), close hover (crit ground + s12 ink — the one red hover in the chrome), restore (maximized ⇒ ❐ glyph + aria-label "restore")
- **Accessibility:** Each button carries its verb as aria-label; the maximize label flips to "restore" with the state.
- **Related:** Button

## Data

### Icon

A drawn glyph at the house convention — the picture half of an affordance.

- **Use it when:** A glyph IS the control — an icon-only affordance with no adjacent text to name it (close, settings, copy, attach). The same action recurs across surfaces and a glyph makes it findable faster than reading.
- **Don't use it when:** The glyph sits BESIDE a text label. The label already names the thing, so the mark is ornament and stays a mono character in the type stream (UI.md, label-adjacency law). Indicating state — that is StatusDot; a glyph is an action or an object, never status. Naming a third party — that is BrandMark, which carries their color; Icon is always currentColor. Mirroring an OS vocabulary — WindowControls keeps its ─ ▢ ✕ characters so the chrome matches the platform. Decorating a surface. A glyph with no action behind it is noise in the quiet register.
- **Anatomy:** A Lucide svg at --icon-sm (default) or --icon-md, stroke 2, round caps/joins, inheriting currentColor from its parent.
- **Variants & states:** sm (house default) · md (a glyph carrying a row alone), decorative (default — aria-hidden, for a glyph beside a text label), labelled (role=img + aria-label, for an icon-ONLY control), States belong to the parent control: an Icon has no hover/press/disabled of its own, so it cannot drift from the affordance it sits in.
- **Accessibility:** Decorative by default (aria-hidden, focusable=false) so an icon beside a label is not announced twice; pass `label` ONLY when the icon is a control's sole content, which makes it role="img" with that accessible name.
- **Related:** StatusDot, BrandMark, Button

### Meter

Utilization against a known ceiling, as a bar that earns its color.

- **Use it when:** A backend gave us both a value and its ceiling (a rate-limit window, a quota). Several of them stack, so the bars line up and comparison is a glance.
- **Don't use it when:** The ceiling is unknown — render the number alone, or say "unknown"; never fake a denominator. Progress of a task (that is a Spinner) or a count (that is text).
- **Anatomy:** A square-ended ground track with a fill sized by percent, toned by the value it earns. Boxy on purpose — a rounded pill reads as a control, not a measurement.
- **Variants & states:** quiet (< warnAt — ground, the default), needs-you (>= warnAt — amber), critical (>= critAt — red), zero (a 1% hairline: read-and-empty must not read as never-read)
- **Accessibility:** role="meter" with aria-valuenow/min/max; the caller renders the number in text beside it, so the reading never depends on the bar.
- **Related:** StatusDot, BrandMark

## Feedback

### InlineMessage

State about the thing beside it, said once and in place.

- **Use it when:** A field, panel, or row needs to report its own state (saved, unsaved, failed to load).
- **Don't use it when:** The state belongs to the whole surface — dock a notice instead. The message is transient and must be noticed after focus has moved — that is a Toast. The state is one word with no detail — that is a StatusDot plus its label.
- **Anatomy:** A decorative tone mark and the message, on one inline baseline.
- **Variants & states:** info (muted ground), success (ok), warning (warn), danger (crit)
- **Accessibility:** The mark is aria-hidden; the message is the accessible content, so nothing announces twice.
- **Related:** Toast, StatusDot

### Toast

A transient result the user must notice after their attention has moved on.

- **Use it when:** An action the user started elsewhere failed or finished, and its own surface is no longer in view.
- **Don't use it when:** The state belongs beside a field or row — that is an InlineMessage. The message must be acted on before continuing — that is a modal. The state persists until something changes it — dock a notice instead.
- **Anatomy:** A bottom-right card: title, optional detail, and a labelled dismiss control.
- **Variants & states:** info (ground rim), success (ok rim), warning (warn rim), danger (crit rim), closed (renders nothing)
- **Accessibility:** role=status with aria-live=polite, so it is announced without taking focus; the whole card dismisses on click and the close control carries its own name.
- **Related:** InlineMessage

## Foundations

### CapsLabel

The tracked-caps section header — names a group of rows without stealing attention.

- **Use it when:** Section headers inside menus, popovers, dialogs, and sidebar groups.
- **Don't use it when:** Naming a state — that is a StatusDot plus text. Body or row text — headers only.
- **Anatomy:** One div: 10px caps type token, wide tracking, s6 ink, menu-row padding.
- **Variants & states:** default
- **Accessibility:** Visual grouping; pair with aria-label/role=group on the container when the grouping is semantic.
- **Related:** MenuCard, MenuItem

### Kbd

The kbd chip — one look for every shortcut the UI names.

- **Use it when:** Rendering a key or chord anywhere: the shortcuts overlay, settings rows, inline hints.
- **Don't use it when:** Describing an action without its key — plain text. A clickable control — Button; Kbd is inert.
- **Anatomy:** One <kbd>: caps-scale mono text on an s3 chip with an s4 hairline.
- **Variants & states:** default
- **Accessibility:** Semantic <kbd> element; reads as the key name.
- **Related:** ShortcutsOverlay, CapsLabel

### Spinner

The loading circle — quiet s-scale ring for content that is genuinely not there yet.

- **Use it when:** A cold load with nothing cached to show (first open of a transcript). A deferred canvas whose content is still rendering in a transition.
- **Don't use it when:** Anything already partially visible — stream it in place instead. A running/working state — that is the pulsing StatusDot vocabulary. Decorating a button press — the press state is feedback enough.
- **Anatomy:** A role=status span (aria-label names what loads) wearing .spinner-reveal (120ms delayed fade so fast loads never flash it), around a border-ring that spins motion-safe.
- **Variants & states:** revealing (first 120ms, invisible), spinning, reduced-motion (pulse)
- **Accessibility:** role=status with a required label; the rotation is aria-hidden decoration.
- **Related:** StatusDot

### StatusDot

The indicator law's state vocabulary: state is a dot, never a word.

- **Use it when:** Any surface naming a session/agent/tool state (running, needs-you, critical, done, idle).
- **Don't use it when:** Magnitude — that is a count (zero renders nothing). Decorating inactive chrome with accent color.
- **Anatomy:** One aria-hidden circle sized by prop, colored by the status token.
- **Variants & states:** running (blue), needs-you (amber), critical (red), done (green), idle (ground)
- **Accessibility:** aria-hidden; the accompanying text names the thing, proximity carries the state.
- **Related:** Kbd

## Inputs

### Combobox

Pick one value from a set too long to scan: a trigger chip that grows a searchable, filter-as-you-type option popup.

- **Use it when:** A set too long to scan at a glance, where the value is one choice (a model picker across every provider).
- **Don't use it when:** Fewer than about seven fixed options — Select. The choice is set membership, not one value — the resolved-set row. Two states — Toggle.
- **Anatomy:** A trigger button (role="combobox") wearing either the Select chip skin (bordered, the default) or the composer shelf's borderless chip, growing a PopoverCard whose popup holds a filter input and a role="listbox" of role="option" rows; a group header (CapsLabel's caps style — size, tracking, colour — without its uppercase transform, since a group can be a deliberately-cased literal) renders where an option's group differs from its neighbour; the selected row carries the s4 tint and the trailing mono `Current` marker; an unmatched query renders "No match" instead of an empty list; an optional footer sits beneath the listbox on its own hairline, carrying a second axis of the same choice.
- **Variants & states:** closed, open (trigger border steps up, filter input focused), filtered (options narrow as you type), no-match ("No match"), option hover/cursor, option selected (tint + Current), active (trigger and option rows press with the kit scale tick), disabled (no hover, no press), focus-visible (global interior ring on the trigger; the filter input opts out — its own border step-up is the cue), bordered trigger (default) · chip trigger (dense control rows), with footer (second axis on its own hairline) · without (no region, no hairline)
- **Accessibility:** Trigger carries role="combobox", aria-expanded and aria-haspopup="listbox"; ArrowUp/ArrowDown move a cursor over the filtered rows, Enter selects it; Escape runs through the kit dismiss-layer stack via PopoverCard.
- **Related:** Select, PopoverCard, MenuItem

### Select

Pick one value from a flat list: a quiet mono chip that grows a positioned option popup.

- **Use it when:** Settings rows and toolbars choosing one of a few named values (theme, density).
- **Don't use it when:** Rich option rows with glyphs or descriptions — PopoverCard + MenuItem. Two states — Toggle. Free text — a text input.
- **Anatomy:** Controlled Base UI Select (Root/Trigger/Value/Portal/Positioner/Popup/Item); the popup wears menuSurface below the trigger; the selected item carries the `Current` marker. An option is a bare string, or a {value,label} pair when the displayed word must not be the stored value.
- **Variants & states:** closed, open (trigger border steps up), item hover/highlighted, item selected (tint + Current), focus-visible (global interior ring)
- **Accessibility:** Base UI combobox/listbox semantics with typeahead and keyboard selection; Escape runs through the kit dismiss-layer stack; selection mirrored by aria-selected.
- **Related:** PopoverCard, MenuItem, Toggle

### StepSlider

A discrete slider over a small ordered set of named levels, with a boxy thumb and per-stop ticks.

- **Use it when:** Choosing one of a few ordered named levels (reasoning effort, density).
- **Don't use it when:** Two states — Toggle. Unordered choices — Select. Continuous numeric ranges — this is stops-only by design.
- **Anatomy:** Base UI Slider (value = stop index) inside the kit rail: 4px-inset track, filled indicator, one tick per stop, 7×13 boxy thumb.
- **Variants & states:** per-stop positions, drag/click (Base UI pointer mechanics), keyboard arrows/Home/End (native range input), focus-visible (global interior ring)
- **Accessibility:** A native range input carries the slider semantics; aria-valuetext speaks the stop name, not the index.
- **Related:** Toggle, Select

### Toggle

The boxy two-state switch: neutral fill when on — accent blue stays reserved for running.

- **Use it when:** Settings rows and inline controls flipping one boolean (reduce motion, autosave).
- **Don't use it when:** A momentary action — Button. More than two choices — Select or StepSlider.
- **Anatomy:** Base UI Switch rendered as a real button (honest disabled + focus semantics) with a slip-move thumb.
- **Variants & states:** off, on (neutral s6 fill), disabled off/on (inert, dimmed, no hover), focus-visible (global interior ring)
- **Accessibility:** Native switch role via Base UI; space/enter toggle; disabled uses the real attribute.
- **Related:** Select, StepSlider, Button

## Layout

### DialogSearchHead

The dialog head where search owns the top row — typing filters the body live, VS Code style.

- **Use it when:** The head of any settings-shaped dialog whose rows are searchable.
- **Don't use it when:** A dialog with no filterable body — a plain caps header row. App-wide search — that is the session browser, not a dialog head.
- **Anatomy:** Glyph + autofocused borderless input + ghost close Button over the s3 head hairline.
- **Variants & states:** empty (placeholder), filtering (value drives the caller)
- **Accessibility:** The input opts out of the focus ring per the law (its container border is the cue); close is a labelled ghost Button.
- **Related:** ModalShell, TocRail, SettingRow

### PanelResize

A zero-width column seam: a 7px grab strip straddling a panel border, resizing it by drag.

- **Use it when:** A resizable side panel (nav, work column) needs a draggable, double-click-resettable border.
- **Don't use it when:** The panel has a fixed width — no seam needed. Collapse/reopen hysteresis math is wanted ready-made — combine with resolveCollapse in onDrag.
- **Anatomy:** A zero-width flex-none wrapper holding an absolutely-positioned 7px separator strip with a slip hairline.
- **Variants & states:** idle (transparent, hover brightens), active/dragging (bg-s7 hairline)
- **Accessibility:** role="separator" aria-orientation="vertical" aria-label="resize panel"; pointer-driven, no keyboard resize.
- **Related:** resolveCollapse

### PaneOverlay

A modal-like overlay confined to its own pane, never the whole window.

- **Use it when:** Expanding a truncated in-pane detail (e.g. a full tool diff/output) over just the chat pane.
- **Don't use it when:** A window-level modal is wanted — use Dialog. A transient message is enough — use Toast.
- **Anatomy:** A provider wrapping a relative pane container; an absolute-inset overlay layer with a pane-confined scrim and a scrollable titled panel (close button); an open/close API exposed via usePaneOverlay.
- **Variants & states:** closed, open
- **Accessibility:** role=dialog + aria-modal with an aria-label; Escape and backdrop/close-button dismiss; initial focus lands on close, Tab is trapped within the panel, and focus is restored to the opener on close; the panel is a scrollable region.
- **Related:** Dialog, Sheet, Toast

### SettingRow

One setting: name + one-line description + a trailing inline control.

- **Use it when:** Every row of a settings-shaped dialog — controls slot in as children (Toggle, Select, Kbd chips).
- **Don't use it when:** Menu options — MenuItem. Rows without a control — plain text needs no frame.
- **Anatomy:** Flex row: name (sec scale) over description (quiet s7), control pinned right.
- **Variants & states:** default (state lives in the slotted control)
- **Accessibility:** The slotted control carries the interactive semantics; name/description sit adjacent for context.
- **Related:** Toggle, Select, Kbd, TocRail

### TocRail

The dialog TOC rail: one row per section, jump on click, quiet active tint.

- **Use it when:** Sectioned dialog bodies that deserve a jump list (settings).
- **Don't use it when:** App navigation — that is the left nav, not a dialog rail. Search mode — pass activeId null so nothing claims the tint.
- **Anatomy:** A fixed-width column of full-width rows against the s3 rail hairline.
- **Variants & states:** default, hover, active (s3 tint + s12 ink), activeId null (search — no tint)
- **Accessibility:** Native buttons; the active row is also the scrolled-to section for sighted parity.
- **Related:** DialogSearchHead, SettingRow

## Overlays

### MenuCard

The floating option surface: one skin (ground, edge, shadow, rise) for every popup.

- **Use it when:** A static or bespoke-positioned floating card (showcase specimens, custom overlays). Composing option rows or controls that need the shared popup skin without Base UI positioning.
- **Don't use it when:** A trigger-anchored popup — PopoverCard owns portal + placement. Picking one value from a flat list — Select. A blocking decision — that is a modal ground.
- **Anatomy:** One div wearing the shared menuSurface class (s3 ground, s5 edge, float shadow, mount rise).
- **Variants & states:** default (floating), sized by caller className
- **Accessibility:** Purely presentational; interactive semantics come from the rows composed inside.
- **Related:** PopoverCard, MenuItem, CapsLabel

### ModalShell

The modal ground: scrim + heavy-shadow centered card for the few moments that block the workbench.

- **Use it when:** A blocking surface — settings, the shortcuts reference, a confirmation that must resolve before work continues.
- **Don't use it when:** Anchored options or controls — PopoverCard. Anything a quiet inline notice can say — modals are the loudest ground and must stay rare.
- **Anatomy:** Controlled Base UI Dialog: scrim backdrop at the modal-backdrop z, a pointer-transparent centering popup, and the animated card inside it sized by the caller.
- **Variants & states:** closed (renders nothing), open (focus trapped, scroll locked, mount rise), reduced-motion (instant)
- **Accessibility:** Base UI focus trap + labelled dialog role; scrim press dismisses; Escape runs through the kit dismiss-layer stack.
- **Related:** PopoverCard, useDismissLayer, ShortcutsOverlay

### PopoverCard

A trigger-anchored floating card on Base UI mechanics, wearing the shared menu-surface skin.

- **Use it when:** A chip or button that grows a card of options or controls (composer chips, attach menu). Any anchored popup that must escape clipping containers and reposition on scroll.
- **Don't use it when:** Picking one value from a flat list — Select. A blocking decision or form — the modal ground. Hover-only detail — a tooltip, not a popover.
- **Anatomy:** Controlled Base UI Popover (Root/Trigger/Portal/Positioner/Popup); the caller supplies the trigger element; the popup wears menuSurface at the dropdown z. An optional tooltip spec stacks Tooltip.Trigger onto the same element for hover/focus detail.
- **Variants & states:** closed, open (positioned side/align, mount rise), reduced-motion (instant)
- **Accessibility:** Base UI wires trigger aria + focus; outside-press is Base UI; Escape runs through the kit dismiss-layer stack so app-mode ordering holds.
- **Related:** MenuCard, MenuItem, useDismissLayer

### ShortcutsOverlay

The shortcuts surface: the keybind registry rendered as a grouped, searchable modal card — and, when the caller passes an `editing` seam, the place binds are rebound.

- **Use it when:** The app-wide shortcut summon (ctrl+/) — pass the same registry table that drives dispatch. Rebinding: pass `editing`. Reference and editor are ONE surface, so a bind is never discoverable in one place and changeable in another.
- **Don't use it when:** Naming one shortcut inline — Kbd. Owning the key vocabulary or the conflict policy — those come in through `editing`; this card renders and captures, it does not decide.
- **Anatomy:** A height-capped ModalShell card: caps header with reset-all + a ghost close, an autofocused filter field, then the scrolling rows — one group header per bind group, and per row: label, a scope tag where the bind only answers somewhere ("in chat"), and the CHORD FIELD: the Kbd chips (or "unbound") inside a bordered control you click into to record a new chord, plus a reset for a customised bind. The chord is the control — there is no separate record button — and while recording it holds the chord heard and a line stating what Enter will do (including whose bind it would take).
- **Variants & states:** open, closed (unmounted by the caller), read-only (no `editing`), row recording, row recording · conflict, row unbound
- **Accessibility:** Labelled dialog via ModalShell; the registry prop guarantees no bind exists without appearing here. Capture swallows every key while it runs (Escape cancels the recording rather than closing the card) so a chord under test can never also fire the command it names.
- **Related:** Kbd, ModalShell

### Tooltip

Hover/focus detail for icon-only controls — a quiet floating label, with the keybind when one exists.

- **Use it when:** An icon-only button whose meaning is not instantly readable (foot buttons, strip glyphs, chevrons). A control that has a registry keybind worth surfacing at point-of-use.
- **Don't use it when:** The control already shows its full text — a tooltip restating a label is noise. Content the user must interact with or that must persist — PopoverCard. Disabled-state explanations on elements that swallow pointer events — inline text instead.
- **Anatomy:** Base UI Tooltip (Root/Trigger/Portal/Positioner/Popup) under one app-level TooltipProvider (600ms delay, 400ms warm window); the popup wears the floating-surface skin (s3 + s5 hairline + shadow) at the tooltip z; keybinds render as Kbd chips.
- **Variants & states:** hidden, open (after delay, or instantly inside the warm window), open-from-focus (keyboard focus, no delay path), with-keybind (label + kbd chips), reduced-motion (instant)
- **Accessibility:** Base UI wires the trigger aria and opens on keyboard focus; NOT a dismiss layer — Escape falls through to real layers; triggers keep their own aria-label as the accessible name.
- **Related:** PopoverCard, Kbd

### useClickAway

Dismiss on outside pointerdown for bespoke menus; accepts several refs so a portaled card counts as inside.

- **Use it when:** A bespoke non-Base-UI overlay (e.g. the Nav HUD picker) needs outside-click dismissal. The overlay is portaled and its trigger and portaled content must both count as "inside".
- **Don't use it when:** Base UI-backed popups — they own their own outside-press dismissal. No ref is ever mounted — there is nothing to be "outside" of.
- **Anatomy:** A document pointerdown listener that checks the pointer target against one or more ref-bound elements.
- **Variants & states:** mounted (ref bound, listens), unmounted (ref null, ignored)
- **Accessibility:** Pointer-only dismissal; pairs with useDismissLayer for keyboard (Escape) dismissal.
- **Related:** useDismissLayer

### useDismissLayer

The one Escape stack: every dismissible surface registers while open; Escape closes only the topmost.

- **Use it when:** A modal, dropdown, or app mode (e.g. search) needs to close on Escape. Several dismissible surfaces can be open at once and must pop in reverse open order.
- **Don't use it when:** A bespoke keydown listener for Escape. A Base UI popup — it owns its own open/close and Escape handling.
- **Anatomy:** A module-level stack of {id, close}; one shared window keydown listener closes only the top entry.
- **Variants & states:** active (registered while true), inactive (not registered)
- **Accessibility:** Escape is the standard dismiss key; only the topmost layer ever intercepts it.
- **Related:** useClickAway

## Seams

### ZoomProvider / useZoom

The app-scale seam: pointer→layout math divides by the host's zoom factor instead of hardcoding it.

- **Use it when:** A kit component converts viewport pointer coordinates into layout px (drag seams, sliders). A host whose zoom mechanism does NOT rescale pointer coordinates (the proto's CSS body zoom) wraps the app in ZoomProvider with its factor.
- **Don't use it when:** Electron page zoom (`setZoomLevel`) — Chromium already reports pointer coords in layout px there; the default factor 1 is correct, wrap nothing. Styling — zoom is a coordinate-space concern, never a size token.
- **Anatomy:** A React context defaulting to 1; ZoomProvider sets it, useZoom() reads it.
- **Variants & states:** default 1 (tests, unzoomed or page-zoomed hosts), provided factor (CSS-zoom hosts)
- **Accessibility:** None — an invisible coordinate seam.
- **Related:** PanelResize, StepSlider

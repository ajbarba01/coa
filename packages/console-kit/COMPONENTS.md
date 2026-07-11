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

## Foundations

### CapsLabel

The tracked-caps section header — names a group of rows without stealing attention.

- **Use it when:** Section headers inside menus, popovers, dialogs, and sidebar groups.
- **Don't use it when:** Naming a state — that is a StatusDot plus text. Body or row text — headers only.
- **Anatomy:** One div: 10px caps type token, wide tracking, s6 ink, menu-row padding.
- **Variants & states:** default
- **Accessibility:** Visual grouping; pair with aria-label/role=group on the container when the grouping is semantic.
- **Related:** MenuCard, MenuItem

### StatusDot

The indicator law's state vocabulary: state is a dot, never a word.

- **Use it when:** Any surface naming a session/agent/tool state (running, needs-you, critical, done, idle).
- **Don't use it when:** Magnitude — that is a count (zero renders nothing). Decorating inactive chrome with accent color.
- **Anatomy:** One aria-hidden circle sized by prop, colored by the status token.
- **Variants & states:** running (blue), needs-you (amber), critical (red), done (green), idle (ground)
- **Accessibility:** aria-hidden; the accompanying text names the thing, proximity carries the state.
- **Related:** Kbd

## Overlays

### MenuCard

The floating option surface: one skin (ground, edge, shadow, rise) for every popup.

- **Use it when:** A static or bespoke-positioned floating card (showcase specimens, custom overlays). Composing option rows or controls that need the shared popup skin without Base UI positioning.
- **Don't use it when:** A trigger-anchored popup — PopoverCard owns portal + placement. Picking one value from a flat list — Select. A blocking decision — that is a modal ground.
- **Anatomy:** One div wearing the shared menuSurface class (s3 ground, s5 edge, float shadow, mount rise).
- **Variants & states:** default (floating), sized by caller className
- **Accessibility:** Purely presentational; interactive semantics come from the rows composed inside.
- **Related:** PopoverCard, MenuItem, CapsLabel

### PopoverCard

A trigger-anchored floating card on Base UI mechanics, wearing the shared menu-surface skin.

- **Use it when:** A chip or button that grows a card of options or controls (composer chips, attach menu). Any anchored popup that must escape clipping containers and reposition on scroll.
- **Don't use it when:** Picking one value from a flat list — Select. A blocking decision or form — the modal ground. Hover-only detail — a tooltip, not a popover.
- **Anatomy:** Controlled Base UI Popover (Root/Trigger/Portal/Positioner/Popup); the caller supplies the trigger element; the popup wears menuSurface at the dropdown z.
- **Variants & states:** closed, open (positioned side/align, mount rise), reduced-motion (instant)
- **Accessibility:** Base UI wires trigger aria + focus; outside-press is Base UI; Escape runs through the kit dismiss-layer stack so app-mode ordering holds.
- **Related:** MenuCard, MenuItem, useDismissLayer

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

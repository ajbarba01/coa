# 0014. Workbench design system — conversation-first, sand-dark, quiet

- Status: accepted
- Date: 2026-07-10
- Supersedes the visual direction and layout architecture of [0007](0007-console-design-system.md)
  (its governance rationale — SC-1 at the GUI, intent blocks, no-windowing — stands unchanged)

## Context and problem

The console's first design system (0007, the warm-dark "forge" direction) produced a working inspector, but
in real use it read as *trying* to be professional and not landing: late hover states, view-switch jank from
poll-and-replace, components that drifted from their own consistency rules, an inspector-first layout that
gave the conversation — the surface the operator actually lives in — a cramped dock while read-only panels
held the prime real estate. A design-partnership engagement (brief: `UI_OVERHAUL_PROMPT.md`, gates 1–4)
re-derived the direction from interaction dynamics outward, converged through clickable motion-true
prototypes, and the maintainer approved the result at Gates 1–2.

## Decision

- **Conversation-first workbench IA.** Three columns. The center canvas is the session's conversation on the
  darkest ground; other surfaces (graph, flags, timeline, cost, agents) swap into the center via the left
  nav. The left nav is app-scoped and never changes meaning; the right column is the active session's working
  state (agent tree, changes, worktree, record, cost) — collapsible, the left nav not. The title bar is app
  surface, segmented per column: project switch | session tabs + search | agents header + window controls.
  A session is a **unit of work** (goal · agent · status · cost · flags · diff), not a chat log; the session
  browser (search morph) owns sort/group/dividers.
- **Sand-dark substrate, quiet register.** A 12-step neutral scale (steps 7–12 lifted one step for contrast)
  replaces the forge palette as the default theme. Nothing shouts: state is a **dot**, magnitude is a
  **count** (zero renders nothing), text is for names, detail is proximity (hover/focus). Blue = running,
  amber = needs-you, red = critical, green = done; accent color never decorates.
- **Slipstream motion.** One named motion character: swift 80 / base 140 / move 200 / enter 180 ms, expo-out,
  ≤ 12 px travel, never bouncy. CSS transitions for interruptible state; keyframes only for mount/unmount
  (fill-mode `backwards`, never `both` — a filled transform makes the element a containing block and hijacks
  `position: fixed` descendants). Reduced-motion collapses all of it.
- **Foundation swap.** The styled kit moves onto Base UI mechanics (Radix is in maintenance), cmdk for the
  palette, Motion for mount choreography, and a daemon-push → fine-grained store instead of poll-and-replace
  — the root of the perceived jank.
- **Theme architecture, not a theme.** A theme is a full scale swap at equal quality: sand-dark ships as
  default; the forge/brass identity returns later **re-tailored to the same bar**, plus a light scale. The
  theme/density/motion settings survive.
- **Retirements.** The inspector-first layout tree, the descriptor/registry layout engine
  (`console-layout` — dockable generality the fixed-shape workbench doesn't need), floating `Pane` card
  chrome, brass-as-state, and the advertised `raw` button (raw moves to the command palette: reachable,
  never advertised — D85 honored by existence, not by chrome).
- **Preserved investments (maintainer rulings).** The streaming transcript renderer (block-split markdown,
  word reveal, plan checklists, tool cards, subagent roll-ups) is **re-skinned, never rebuilt**; the agents
  editor functionality keeps a first-class home in the new IA; the predictive drift/cache banners keep their
  *function* in a quieter, indicator-law form; a wordmark is welcome where it fits but earns no chrome.

## Consequences

- `docs/UI.md` is rewritten as the standing authority for the new system; exact token values and component
  definitions live in code (`packages/console-kit` during migration, graduating into the styled kit).
- The motion-true prototype (`apps/workbench-proto`) is the reference implementation of the laws until the
  kit graduates; disagreement between doc and prototype is a bug in one of them.
- The rebuild proceeds by roadmap plan (Gate 4): tokens/kit first, shell second, transcript re-skin third,
  orphan surfaces (agents editor, banners' successor, account management) last.
- 0007's structural machinery that the new system keeps — intent blocks, the semantic-token-only rule, the
  no-windowing transcript reversal, DenyNotice's render-only contract — continues to bind.
- **2026-08-01:** the motion-true prototype (`apps/workbench-proto`) is retired. Its showcase was ported into
  the console itself (a specimen per registered kit member, enforced by a test), which is now the living
  reference implementation of the laws.

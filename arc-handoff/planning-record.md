# coa arc — planning session record

Running record of the planning session (per handoff §4, kept here because the chat surface
can hide prose between tool calls). Newest entries at the bottom. Never committed.

## Artifacts in this directory

- `coa-arc-handoff.md` — the handoff brief (authoritative for what this session produces)
- `coa-reset-plan.md` — the de-drift/de-bloat plan the arc absorbs
- `planning-record.md` — this file
- (to come) reference shortlist · feature plans · mockups/ · arc plan + bundle manifest

## Session log

### 2026-08-07 — session start

**Decisions so far:**

1. **Ultracode for planning: no session-wide, yes per-task.** The planning session runs
   normally; explicit workflows are used for the two fan-out-heavy pieces — reference
   research (§4.1) and the architecture smell audit (§4.4). The overnight arc itself
   launches with ultracode enabled (unchanged). Maintainer approved.

**Maintainer side notes captured (to fold into the plan):**

- Main arc session should keep its prompt cache warm during execution (a ~4.5-min always-on
  poll loop) to avoid wasting input tokens on cache misses. → arc execution design (§4.6).
- Impeccable and ponytail skills: source them online (maintainer confirms they're findable).
  → pre-flight item 5.
- `gh auth login` is DONE (maintainer just logged in). → pre-flight item 1 partially done;
  still need `gh auth setup-git` verification + test push.
- **OneDrive checkout: maintainer wants the project moved out of OneDrive and the OneDrive
  copy DELETED** — this contradicts handoff §2.5 ("never modified, cleaned, or deleted").
  Needs explicit confirmation + sequencing (delete only after clone verified + pushed).
  ⚠ open question.
- The arc's Claude Code can only run in auto mode (accept edits), NOT bypass-permissions.
  Constrains the overnight run's autonomy envelope — permission prompts overnight would
  stall the run; the execution design must account for this (allowlist tuning via
  settings.json, or accept-edits semantics). → launch envelope (§4.7).
- **Periodic bookkeeping for seamless resume:** the arc must checkpoint its own state to a
  durable doc (arc journal + a "resume-from-here" state file in `~/dev/coa-arc/`) on a
  regular cadence, so a crashed/killed session can be picked up by a fresh session without
  losing progress. → arc execution design (§4.6); pairs with the existing journal/ledger/
  question-queue file design and the stop-loss rule.

**Step zero done:** `~/dev/coa-arc/` created; handoff + reset plan moved out of the
scratchpad into it.

**Reference research workflow launched** — parallel sweep across five categories
(ADEs/agentic workbenches, multi-provider consoles, plugin/skill/MCP managers,
permission-UX + orchestration exemplars, Electron architecture exemplars), license
verification against the §2.7 allowlist, synthesis into a shortlist for maintainer
sign-off. Results will land in `reference-shortlist.md`.

### 2026-08-07 — question round 1 (rulings)

1. **OneDrive copy: DELETE after clone verified.** During attended pre-flight, sequence is
   sync-gate → clone to ~/dev/coa → install/build/tests green → push verified → delete the
   OneDrive checkout. Never an overnight step. (Overrides handoff §2.5's "never deleted".)
2. **Reset-plan review waiver: APPROVED.** Overnight run executes all reset phases with
   gates + question queue + morning journal instead of between-phase review. Knife still
   lands on its own branch/PR for independent review/revert.
3. **Spend ceiling: $250** for the overnight run. Finishing under is fine; if it needs
   more, it winds down gracefully and the maintainer reevaluates in the morning.
4. **Launch profile: managed only.** No personal profile. Consequences: org system prompt
   present (CLAUDE.local.md carrier + template grep-gate are mandatory), auto mode only
   (no bypass-permissions) — the arc's allowlist in the clone's .claude/settings.json must
   be tuned so overnight work never stalls on a permission prompt.

### 2026-08-07 — reference shortlist drafted

Workflow completed (11 agents, 27 candidates, all licenses adversarially verified).
Shortlist written to `reference-shortlist.md`: 8 adapt-eligible Tier 1 (Cline, goose,
opencode, LibreChat, VS Code, Podman Desktop, big-AGI, Codex CLI), 4 study-only Tier 1
(Zed, Cherry Studio, Claude Code docs, Jan), 11 Tier 2. License traps caught: Zed GPL
agent crates, Cherry Studio AGPL, Open WebUI branding clause, Jan modified Apache, Roo
Code archived w/ closed successor, MCP Registry per-contribution licensing.
**SIGNED OFF** with two additions, both applied: (1) Traycer added as Tier 1 adapt (MIT
verified — multi-agent orchestration desktop app, closest product analog; early-stage
caveat noted); (2) a professional-UI coverage note added (Zed + Cherry Studio study-only
polish bar; goose/Traycer/Insomnia/VS Code adaptable UI exemplars).

### 2026-08-07 — repo grounding for the maybes (agent findings, condensed)

- **Orchestration open items at HEAD:** agent-to-agent messaging unbuilt (design doc
  exists: docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md);
  child-completion notice carries NO child output (quiet system line, no jump-to-child);
  foldTreeToTranscript has no production caller; the `subagent` TurnFrame kind has no
  producer (mock-only); cost roll-up has no RPC producer (console sums but always "Not
  tracked yet"); session panel doesn't list children (Subagents floor is an empty stub).
- **Worktrees:** seam exists (bindWorktree/releaseWorktree; cwd = daemon launch dir,
  apps/cli/src/session-deps.ts). No git-worktree code. ADR-0034 explicitly accepts the
  two-agents-one-tree write hazard. Fork: nothing built, roadmap-gated on the manager.
- **Viewer:** tool I/O viewing already strong (ToolCard + PaneOverlay). No in-app file
  viewer (opens VS Code via `code -g`). No system-prompt viewer, but compilation.json is
  already persisted per session — needs only a read verb + panel. Nav = one SURFACES row
  + one Center.tsx case + one panel file.
- **Naming:** deriveTitle (first prompt, ≤60 chars) is the only mechanism. R12d rename
  plumbing confirmed at HEAD, still zero renderer callers.
- **Light theme:** no light scale exists; themes/ has only sand-dark.css; theme.ts already
  has ResolvedTheme 'dark'|'light' + system OS-follow listener; Settings shows read-only
  "Sand dark".

### 2026-08-07 — question round 2 (maybes + wall clock)

1. **Worktree manager: IN, scoped** — worktree-per-subagent isolation + live Worktree dock
   floor. **Fork verbs: OUT** (begin_fork/exit_fork stay roadmap).
2. **Viewer surface: IN** — one new console surface: system-prompt viewer (read verb over
   the already-persisted compilation.json) + read-only in-app file viewer reusing
   CodeBlock/PaneOverlay. Tool I/O viewing already exists.
3. **Auto-naming + rename: IN** — R12d knifes the dead plumbing; arc rebuilds rename with
   real UI + one off-critical-path auto-name model call after the first exchange;
   deriveTitle stays as deterministic fallback. big-AGI is the adapt reference.
4. **Wall-clock ceiling: ~8h** (until morning), wind-down begins ~7.5h so branches/PRs/
   journal are done by wake-up.

**Launch envelope is now complete:** $250 spend · ~8h wall-clock · managed profile ·
auto mode (allowlist tuning required) · review waiver approved · OneDrive delete-after-
verify. Remaining §4.7 item: web-search availability — verified available in this
environment (WebSearch works under the managed profile).

**Final arc feature scope:**
(a) orchestration finish/polish · (b) permission modes · (c) per-model info + context
health + attachments · (d) skills/plugins/MCP manager · light theme · adapter unification
+ OpenAI & OpenRouter adapters · worktree manager (scoped) · viewer surface · auto-naming
+ rename · reset plan (5 phases) · architecture & professionalization workstream.

### 2026-08-07 — grilling round: orchestration (feature a)

1. **A2A messaging: implement the existing design doc** (mesh within root's family, live
   roster, non-blocking dispatch) — subject to the grain-of-salt rule below; Traycer is a
   live adapt reference.
2. **Completion/messaging UX (maintainer's explicit vision — mockup contract):**
   - Spawning a subagent renders as a **custom tool block** (not a generic ToolCard).
   - Subagents appear in the **right sidebar** as originally mocked.
   - A child finishing renders as a **tool-notification-style block** with affordances to
     jump to the agent (child session) or expand the output in-place.
   - **A2A messages get their own block** with jump-to-agent / jump-to-thread affordances.
3. **Console: all three gaps close** — live Subagents floor, subagent TurnFrame producer,
   cost roll-up producer (**cost roll-up only if cheap**; if it turns out expensive, park
   it with a journal note rather than sink time).
4. **Discovery (find_agent + agent-list): IN.**
5. **STANDING RULE (applies arc-wide): existing roadmap items, design docs, and ADRs are
   inputs, not gospel** — the arc critiques them like it critiques existing code. A design
   doc is a head start on thinking, not an accepted design. (Maintainer, verbatim intent.)

### 2026-08-07 — grilling round: permission modes (feature b)

1. **Mode set: FOUR modes this arc — plan, manual (ask-for-writes/commands),
   edit-automatically (auto-approve edits), bypass.** "Auto" is dropped for now
   (maintainer: "ignore auto for now"). Semantics mirror Claude Code's
   plan/default/acceptEdits/bypassPermissions so users get zero-surprise behavior.
2. **Where modes live:** composer chip (per-session, live-switchable, effect on next tool
   call) + per-agent default in the registry. (Maintainer also ticked "Other" with no
   note — clarify in a later round whether a project-level default was meant.)
3. **Rules layer: OUT this arc** — modes only; a persisted allow/ask/deny rules store is a
   later arc.
4. **Bypass: no entry gate.** Instead, **modes are color-coded by risk** so the chip makes
   bypass visually unmistakable. (Design-system note for mockups: risk color ramp on the
   mode chip.)

### 2026-08-07 — new requirement: instant navigation (maintainer, mid-session)

- **Navigation within coa must be instant, always** — navigation is pure UX; content may
  load async behind it, but the act of navigating never blocks on data.
- **Opened chat tabs stay fully materialized in memory** — switching to any opened chat is
  instant and its transcript is immediately scrollable end-to-end, exactly like the
  currently-viewed one. Applies to ALL opened tabs.
- Grounding tie-in: Center.tsx already keeps visited surfaces mounted; the transcript is
  deliberately non-virtualized; the roadmap's one live perf item is the poll-and-replace
  console state store with a push-based store named as the durable fix. This requirement
  lands in BOTH the architecture workstream (state-store rewrite charter candidate) and
  the console-polish done-means criteria.

### 2026-08-07 — grilling round: per-model info + attachments (feature c)

1. **Context health: compact always-visible ring/bar on the composer** using the risk
   color ramp (green→amber→red as context fills); hover/click reveals exact tokens /
   window size / breakdown.
2. **Attachments: images + text files.** Images as multimodal blocks when the model has
   vision; text/code files inlined. Attach control disables with an honest tooltip when
   the active model lacks the capability. (PDFs later.)
3. **Metadata source: models.dev catalog as the cross-provider base + OpenRouter's live
   /models API for OpenRouter models; static baked-in fallback so offline never breaks.**
4. **Surfacing: composer reflects the active model 100%** (attach enabled/disabled,
   context ring sized to the real window). **Model picker: no inline badges — a hover
   overview card per model** (context, modalities, pricing). No dedicated models surface.

### 2026-08-07 — grilling round: skills/plugins/MCP manager (feature d)

1. **First-class types: skills + MCP servers.** Plugin bundles OUT this arc (R5's archived
   bundle importer stays reference for a later arc).
2. **Link model:** maintainer wants both mechanisms — link-as-reference with auto-sync,
   OR one-time copy — because a project-scoped skill may need to physically live in the
   project's coa folder (e.g. committed for the repo). Planner's recommendation (pending
   confirm next round): default = reference (pointer, live-synced with source tool);
   optional = copy-into-project (materialized with recorded provenance: source path +
   content hash, so coa shows a drift indicator and offers re-sync).
3. **Registry browsing: OUT — local discovery only** (scan ~/.claude/skills,
   .claude/skills, .mcp.json, ~/.codex, etc.).
4. **Skill execution: coa-native injection on ALL backends** (model-agnostic, no-lock-in),
   using native Claude skill support where available, PLUS:
   - per-agent config: a skill can be **auto-injected** or **progressive-disclosure**
     (announced, loaded on demand);
   - **`/` invocation in the composer** exactly like Claude Code's slash method.

### 2026-08-07 — grilling round: link model confirm, light theme, adapters

1. **Link-vs-copy: CONFIRMED** — default link-as-reference (live-synced pointer); optional
   copy-into-project with provenance (source path + content hash), drift indicator,
   one-click re-sync.
2. **Permission modes "Other" tick: accidental.** Modes live in exactly two places:
   composer chip (per-session, live) + per-agent registry default. No project default.
3. **Light theme: full sand-light scale ("re-tailored brass identity", never an inverted
   variant) + Settings dark/light/system + existing OS-follow listener drives system.**
   Every kit primitive + surface verified in both themes; the no-clipping/no-wrap polish
   bar applies twice.
4. **Adapters:** unify DeepSeek+LongCat into one parameterized OpenAI-compatible adapter;
   OpenAI + OpenRouter as new targets. API-key auth via existing auth management
   (env-references only). OpenRouter exposes its full live /models list. **OpenAI
   Responses API: DEFERRED to roadmap** (chat-completions ships free with the unified
   adapter). **Subscription-bridge (ChatGPT Plus→API projects like CLIProxyAPI /
   openai-oauth): adapter is base-URL+key agnostic so any localhost bridge works; coa
   ships no bridge-specific code; docs carry a setup recipe.** (ToS-gray area stays the
   user's configuration choice, outside the codebase.)

**Feature grilling is COMPLETE** — every feature has maintainer-ruled requirements.

### 2026-08-07 — skills sourced + installed; architecture audit launched

- **impeccable** (github.com/pbakaus/impeccable) and **ponytail** (MIT,
  github.com/DietrichGebert/ponytail) cloned to `~/dev/coa-arc/skills-src/` and installed
  into `~/.claude/skills/` (impeccable + ponytail, ponytail-audit/-review/-debt/-gain/
  -help). Pre-flight item 5 DONE. The arc session loads them natively; this planning
  session follows impeccable's reference files directly for mockups.
- **Architecture audit workflow launched** (6 dimensions: layering, console-state w/
  instant-nav requirement, core shape, error honesty, test quality, simplicity;
  adversarial verify pass). Results feed the professionalization workstream plan +
  rewrite charters.

### 2026-08-07 — UX mockups produced (mid-fidelity, per maintainer ruling)

`mockups/arc-ui-contract.html` — one self-contained file on the verbatim sand-dark tokens
and the real console geometry (3-column workbench, floating composer). Seven screens:
S1 composer (mode chip w/ risk ramp, context ring, attach, `/` skill popover) · S2 model
hover card · S3 transcript blocks (spawn/completion/A2A) · S4 live Subagents + Worktree
dock floors · S5 "Library" surface (skills+MCP, personal/project/discovered, link-vs-copy
w/ drift) · S6 "Viewer" surface (system prompt + files, read-only) · S7 light-theme
direction strip. Ends with the explicit list of what approval fixes vs what stays the
in-arc Fable model's craft. Fidelity deliberately mid per maintainer ("placement and
general shape; don't mock the swappable"). **Awaiting maintainer approval — this document
is the arc's UI contract.**

### 2026-08-07 — architecture audit complete; feature plans written

- Audit workflow finished: 35 agents, 6 dimensions, adversarial verify. Headline finding
  (already visible in the result stream): **the dependency-cruiser ruleset is largely
  decorative** — all cross-package/node_modules edges are excluded before rules run, so
  the layering rules can't fire; apps/cli is never cruised at all; plus a mapped blast
  radius for the core→adapter seam violation. Full condensation into
  `architecture-audit.md` in progress (subagent).
- `feature-plans.md` written: F1 orchestration · F2 permission modes · F3 model
  info/attachments · F4 Library (skills+MCP) · F5 light theme · F6 adapter unification +
  OpenAI/OpenRouter · F7 worktrees · F8 viewer · F9 naming · F10 instant navigation —
  each with ruled requirements, references, integration points (file-level), tests, and
  done-means. Knife→build sequencing pinned (R12b→F3, R12c→F2, R12d→F9, R12e→F5).

### 2026-08-07 — mockup review round 1 (maintainer feedback)

1. **Most shapes approved.** Styling imperfection expected and accepted at mid-fi.
2. **Library (S5) redrawn** after fair criticism (original was section-listing, not
   task-first): now the VS Code extensions-view shape — search + ONE list (active items
   first w/ scope badges, quiet trailing "Discovered" group) + detail pane owning all
   actions (provenance/re-sync, unlink, injection table w/ per-agent overrides).
3. **Viewer (S6) redrawn per ruling:** APP-scoped (not per-session), VS-Code-style tab
   strip (files / system prompts / tool outputs from any session), every transcript
   "view" affordance routes here, tabs stay materialized. Maintainer chose tabbed panel
   over popup. `feature-plans.md` F8 updated to match.

### 2026-08-07 — mockups APPROVED as guidance; master plan written

- Maintainer approved the revised mockups with a final reframe: **the in-arc frontend
  agent gets maximum design freedom — only FUNCTIONALITY is binding; the drawn surfaces
  are suggested defaults.** Mockup file's approval block, coa-arc-plan.md Stage 3, and
  this record updated accordingly. Material deviations journaled with rationale.
- `architecture-audit.md` landed (35 confirmed / 2 rejected / 14 charter-worthy) —
  headline: per-connection session ownership is a verified latent bug; transcript truth
  triplicated; 8/14 adapter port methods dead; adapters ~95% clones with real drift
  (LongCat has a parse fix DeepSeek lacks).
- **`coa-arc-plan.md` written — the master plan**: Stages 0–5 (baseline → knife →
  architecture charters C1–C5 → features → docs → closeout), execution design (auto-mode
  allowlist + dry-run gate, run/ bookkeeping with state.md resume protocol, ≤4.5-min
  cache-warm cadence, gates incl. employer-reference grep, stop-loss, $250/8h ceilings,
  git rules, question queue, org-prompt hygiene), launch envelope, attended pre-flight
  checklist, bundle manifest.

### 2026-08-07 — attended pre-flight COMPLETE

- gh verified (ajbarba01) + setup-git + test push/delete OK. Sync gate passed
  (clean, local == origin == d97c118). Cloned to ~/dev/coa.
- Toolchain fights won (details in run/journal.md): Node 22.22.3 via nvm (system 24
  breaks builds), Python 3.14's missing distutils fixed via setuptools venv
  (~/dev/coa-arc/.gyp-python) wired through git-ignored .npmrc; node-pty added to
  pnpm-workspace.yaml allowBuilds (deliberate uncommitted change — Stage 0 commits it).
- **Baseline GREEN**: typecheck clean, full suite exit 0, all native modules load.
- CLAUDE.local.md carrier + .claude/settings.local.json allowlist written, both
  git-ignored via .git/info/exclude. run/ directory live (journal/state/questions/ledger).
- **OneDrive checkout DELETED** after final verification, maintainer confirmed at the
  moment of deletion.
- Remaining at launch: confirm ultracode ON; arc's first act is the permission dry-run.

## Open questions for the maintainer

(none — ready to launch)

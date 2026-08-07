# coa arc — feature plans

One plan per feature. Every requirement here was ruled by the maintainer on 2026-08-07
(see `planning-record.md` for the interview trail). References per `reference-shortlist.md`
— adapt only from allowlisted sources, journal every adaptation. The UI contract is
`mockups/arc-ui-contract.html` (screen refs S1–S7 below). Repo facts verified against
HEAD d97c118 on 2026-08-07; re-verify at execution (the tree may have moved).

Standing rules that bind every plan: ponytail simplicity; existing design docs/ADRs/
roadmap entries are inputs to critique, not gospel; tests green after every commit;
subject-only commits; no employer references in any committed artifact.

---

## F1 — Orchestration finish (feature a)

**State at HEAD:** spawn tool, lineage, tree transcript projection, console nesting,
spend-to-root, cascade stop all landed. Open: A2A messaging (unbuilt; design doc at
`docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md`),
completion delivery carries no child output (`packages/core/src/session/notify.ts` →
`renderChildEnded`), the `subagent` TurnFrame (`packages/shared/src/push.ts:70`) has no
producer, `foldTreeToTranscript` has no production caller, Subagents/Worktree dock floors
are stubs (`apps/desktop/src/renderer/shell/Work.tsx:106-108`), no cost roll-up producer,
no discovery.

**Requirements (ruled):**
1. Implement the A2A design doc — mesh addressing within a root's family tree, live
   roster, non-blocking dispatch — CRITIQUED first (grain-of-salt rule): the arc writes a
   short critique of the design doc against Traycer's and Roo Code's working
   implementations before building; deviations journaled.
2. Completion delivery: the child's result text IS delivered to the parent (capped, with
   full output expandable) — parent model receives it; no more "read its transcript".
3. Transcript blocks per mockup S3: spawn block, completion block, A2A block — first-class
   cards with agent identity color, status pill, jump-to-agent/thread. Producer emits the
   existing `subagent` TurnFrame kind (extend its payload as needed — it's a dead seam
   today, safe to reshape).
4. Live Subagents dock floor per S4 (children, depth-nested, status, jump).
5. Discovery: `find_agent` + agent-list availability so a running agent can learn what it
   may spawn.
6. Cost roll-up producer ONLY if cheap (`listSessions` gains tree cost); if not cheap,
   park with journal note.

**References:** Traycer (MIT — A2A communication, parallel-agent UX; verify code quality
per-file, project is young) · Roo Code frozen snapshot (Apache-2.0 — orchestrator/subtask
roll-up) · OpenHands (MIT — delegation event model, patterns).

**Integration points:** `session-handlers.ts` (spawn/notify paths), `notify.ts`,
`push.ts` TurnFrame union, `turn-map.ts` lanes, `console-transcript` block renderers,
`Work.tsx` floors, agent-registry for roster/discovery.

**Tests:** core messaging pure-logic tests (roster membership, dispatch ordering,
orphan/closed-parent semantics); TurnFrame producer→renderer round-trip; completion
delivery caps + sanitization (extend existing `sanitizeDetail` tests); console floor
rendering from viewmodel fixtures.

**Done means:** an attended smoke shows parent spawns two children in worktrees, they
message each other, results deliver inline with working jumps, dock shows the tree live —
and every block matches S3/S4 placement.

---

## F2 — Permission modes (feature b)

**Requirements (ruled):** FOUR modes — `plan` (read-only), `manual` (ask for
writes/commands), `edits` (auto-approve file edits), `bypass` (no asking). No "auto"
mode. Semantics mirror Claude Code's plan/default/acceptEdits/bypassPermissions.
Composer chip per mockup S1: risk color ramp (plan=run-blue, manual=neutral, edits=warn,
bypass=crit filled — no entry gate, visibility IS the guardrail), live-switchable
per-session, effective next tool call. Per-agent default mode in the registry. NO
persistent rules layer this arc.

**Sequencing:** R12c (knife the presentational chip) lands first; this rebuilds it real.

**Design decisions:** mode is a session property enforced in the daemon's permission
predicate (deterministic, core) — never in the renderer. The daemon↔console wire contract
follows Codex CLI's typed approval protocol shape (Apache-2.0, adapt the schema layer).
Mode must degrade to pass-through (strict-superset): a backend without a permission seam
runs as bypass with the chip reflecting reality honestly. Cline's mode UX is the adapt
reference for chip interaction; goose's permission components for the settings side.

**Integration points:** the existing flag-pipeline/per-tool deny path in core (the ONE
advisory/deny channel — modes compose with it, never a second deny channel), session
composition (`composition.ts`), agent registry schema, Composer control row, push events
for mode-change reflection.

**Tests:** permission predicate pure tests per mode × tool class matrix; mode-switch
mid-session takes effect next call; registry default flows to spawned children;
adapter-without-seam degrades to honest bypass.

**Done means:** all four modes enforce in a live smoke (plan blocks a write, manual
prompts, edits auto-approves edit but prompts bash, bypass silent); chip matches S1.

---

## F3 — Per-model info + context health + attachments (feature c)

**Requirements (ruled):** model metadata (context window, max output, modalities,
pricing, reasoning support) from **models.dev catalog** as cross-provider base +
**OpenRouter live /models** for OR models + baked-in static fallback (offline never
breaks). Composer reflects the active model 100%: context ring (S1 pos. 2 — always
visible, risk-ramp fill, hover for exact tokens/window/breakdown; exact rendering is the
arc's craft), attach control capability-gated. Model picker: hover overview card (S2), no
inline badges, absent metadata renders absent. Attachments: images (multimodal blocks
when model has vision) + text files (inlined); paste/drag/pick; disabled-with-tooltip
when unsupported. R12b (fake attach plumbing) knifes first.

**References:** big-AGI (MIT — metadata ledger + refresh pattern), opencode (MIT —
models.dev consumption), LibreChat (MIT — per-endpoint capability gating of attachments),
Continue (Apache-2.0 — @-mention/attachment composer UX).

**Design decisions:** metadata is a catalog in core (M0-owned Zod schema), fetched
off-critical-path and cached; token accounting for the ring rides the existing per-turn
usage data the adapters already report (plus `tokenEstimate.ts` in console-transcript for
composition-time estimates). Attachment wire format extends the backend-message schema —
one shape all adapters consume; adapters without vision reject at the seam with a typed
capability error.

**Integration points:** model catalog package/module in core, adapter capability
reporting (part of F6's unified adapter work — sequence F6 first or co-design the
capability surface), Composer, ModelPicker, push schema for usage.

**Tests:** catalog schema validation + fallback merge order (static < models.dev < OR
live); ring math (tokens→fill→color) pure tests; capability gating matrix (vision model /
non-vision / unknown); attachment round-trip through one adapter fake.

**Done means:** live smoke: switch models → ring resizes to the real window, attach
enables/disables honestly, hover card shows real data, an image reaches a vision model.

---

## F4 — Library: skills + MCP manager (feature d)

**Requirements (ruled):** first-class = **skills + MCP servers** (no plugin bundles).
New app-scoped nav surface "Library" (S5; arc may rename): tabs Skills / MCP; sections
Personal (all projects) / Project (this repo) / Discovered. Discovery scans common dirs
(`~/.claude/skills`, `.claude/skills`, `~/.codex`, `.mcp.json` layers, etc.). Link model:
default **link-as-reference** (pointer, live-synced); optional **copy-into-project**
(materialized, committable) with provenance (source path + content hash), drift indicator
+ one-click re-sync. Local discovery only — no registry browsing this arc. Skill
execution: **coa-native injection on ALL backends** (native Claude skill support where
available); per-agent config auto-inject vs progressive disclosure; `/` invocation in the
composer (S1 pos. 4) exactly like Claude Code.

**References:** Claude Code docs (study-only — the interop SPEC: SKILL.md format,
directory layout, precedence; coa must read these conventions byte-correctly) · VS Code
(MIT — per-scope enable/disable lifecycle) · Cline (Apache-2.0 — MCP server management
UX: per-server enable, health, settings JSON) · MCPM (MIT — cross-client config
data-model) · Insomnia/Hyper (Apache-2.0/MIT — user-dir plugin discovery patterns) ·
archived R5 bundle importer (own tree — reference only).

**Design decisions:** stores are declarative files (personal store in coa's config home;
project store in the project's coa folder) validated by Zod — the store IS the source of
truth, surfaces render it (Bruno's filesystem-as-database philosophy). MCP server
lifecycle: spawn/health per the MCP spec via existing SDK support where the backend has
it (compose, don't reinvent); coa-side management is config + status surfacing, not a
new MCP runtime. Skill injection is part of session composition (prompt-freeze already
snapshots compiled prompts — injected skills join `compilation.json` so the Viewer (F8)
shows them).

**Integration points:** session composition + prompt freeze, agent registry (per-agent
skill config), composer popover, new Library panel + nav row, daemon RPC verbs
(list/link/copy/unlink/rescan), file watcher for drift (reuse whatever watch machinery
exists — R11 removed @parcel/watcher; a cheap stat-on-focus beats a new dependency,
ponytail).

**Tests:** discovery scanner against a fixture home-dir tree; link/copy/unlink store
mutations pure; hash-drift detection; injection composition (skill text lands in the
compiled prompt; disclosure mode registers but defers); `/` popover filtering.

**Done means:** live smoke: link a real `~/.claude/skills` skill personal, copy one to
project, see drift after editing the source, `/` invoke both, and a DeepSeek-backed
session receives the same skill Claude does.

---

## F5 — Light theme

**Requirements (ruled):** full re-tailored **sand-light** scale (S7 direction: warm
paper-sand grounds, brass accent identity, re-tuned state vocabulary) — never an
inverted variant (the kit's own contract: a theme is a whole file at equal quality).
Settings offers dark / light / system; existing `theme.ts` OS-follow listener drives
system. R12e (dead theme branches) knifes first.

**References:** Zed (study-only — light/dark token discipline) · VS Code (MIT — semantic
token theming) · Insomnia (Apache-2.0 — themes-as-data).

**Design decisions:** second theme file `themes/sand-light.css` mirroring sand-dark's
full vocabulary (12-step scale, states, agent palette, series, syntax, diff, scrim,
shadows) with light-tuned values; the swap mechanism is the CSS import/attribute the kit
already anticipates. Every value re-validated: WCAG contrast per the file's own
documented gates, series/agent palettes re-checked for CVD separation on the light
ground (the dark file documents its validation — replicate it).

**Tests:** a token-parity test (every custom property in sand-dark exists in sand-light);
contrast assertions for text-band steps on grounds (scriptable); Showcase surface
screenshot pass in both themes during the arc's visual gate.

**Done means:** flipping Settings live-switches the whole console with zero unreadable
or clipped states across all surfaces; system mode follows the OS; screenshots of every
surface in both themes attached to the journal.

---

## F6 — Adapter unification + OpenAI + OpenRouter

**Requirements (ruled):** merge `adapter-deepseek` + `adapter-longcat` (~73% identical)
into ONE parameterized OpenAI-compatible adapter; add OpenAI and OpenRouter as provider
targets of it. API-key auth through the existing auth surface (env-references only, never
in files). OpenRouter exposes its full live model list. OpenAI Responses API: DEFERRED
(roadmap note). Subscription bridges: adapter is base-URL+key agnostic; a docs recipe
covers running a local bridge (CLIProxyAPI etc.); NO bridge-specific code in coa.

**References:** LibreChat (MIT — declarative multi-provider endpoint normalization) ·
Continue (Apache-2.0 — provider adapter layer shape) · opencode (MIT — provider
abstraction + models.dev).

**Design decisions:** provider = data (name, baseUrl, authRef, model catalog source,
capability quirks), adapter = one code path consuming it. The reset plan's do-not-touch
note on the thin adapters is VOID (maintainer ruling). Package name/layout decision
(one `adapter-openai-compat` replacing two packages) is the arc's call inside the M9
seam — the seam itself (one backend port) is an invariant. Reasoning-content divergence
(the DeepSeek/LongCat delta) becomes a per-provider quirk flag, not a fork.

**Sequencing:** early — F3's capability surface builds on it.

**Tests:** the two existing adapters' suites converge onto the unified one (mock
transports, no live keys); per-provider quirk matrix; OpenRouter /models parse fixture;
auth-ref resolution (env var present/missing).

**Done means:** DeepSeek + LongCat behavior byte-equivalent through the unified adapter
(their live smokes still pass); an OpenRouter session runs against a real model; OpenAI
target verified via bridge recipe or key if available, else marked attended-verify in
the journal.

---

## F7 — Worktree manager (scoped)

**Requirements (ruled):** worktree-per-subagent isolation + live Worktree dock floor
(S4). Fork verbs OUT.

**State at HEAD:** the seam exists and is a stub — `bindWorktree(sessionId, scope)` at
`packages/core/src/session/session.ts:142-145`, wired to `() => root` in
`apps/cli/src/session-deps.ts:82`; all tool confinement flows from it
(`workbench/confine.ts` etc.); ADR-0034 accepts the shared-tree write hazard this fixes.
Console treats `worktree` as a logical id already (`apps/desktop/src/main/index.ts:293`).

**Design decisions:** real `git worktree add` under a coa-managed dir (`.coa/worktrees/`
or sibling — arc decides; gitignored), bound at spawn when the child requests isolation
(spawn tool gains the option; default stays shared-root for non-conflicting reads —
ponytail: don't isolate what doesn't write). Lifecycle: create on bind, keep on child
end (results may need review), reap via explicit floor action + idle cleanup on daemon
start. Non-git projects degrade to shared root honestly (strict-superset). Reference:
Bruno's file-watch→pane pipeline for the floor's diffstat; Claude Code's EnterWorktree
semantics as the interop-familiar model (study).

**Tests:** binder pure logic (scope→path decisions, non-git fallback); worktree
lifecycle against a fixture repo (create/list/reap); confinement respects the bound
root; spawn-with-isolation integration.

**Done means:** two children write the same file in parallel without collision; floor
shows both trees with diffstat and jump; reap works; non-git project still spawns fine.

---

## F8 — Viewer surface (revised 2026-08-07)

**Requirements (ruled):** new APP-scoped read-only surface with **VS-Code-style tabs**
(S6 revised): tabs hold files, system prompts (per agent, from `compilation.json` — needs
a read verb; `listSessions` already carries `promptConfig` for drift banners), and tool
outputs — from any session. **Every "view" affordance in coa routes here**: clicking a
file path, a truncated tool card's "view more", a session's "view system prompt" opens a
tab and switches to the Viewer. Tabs stay materialized (instant-navigation rule applies).
Rendered with the transcript's existing code machinery (`CodeBlock`, syntax theme).
"Open in editor" stays the escape hatch. Skills injected by F4 appear in prompt tabs.

**Design decisions:** one RPC read verb returning the frozen compilation text +
metadata; file viewing reads through the existing confinement path (never around it);
no editing; tab state lives in the console store (materialization = F10's charter);
prompt tabs show compile time / version / injected-skills count / drift.

**Tests:** read verb (frozen text round-trip, drift metadata); routing (each affordance
type opens the right tab kind, re-focuses an existing tab rather than duplicating);
render path reuses transcript fixtures; confinement test (viewer cannot read outside the
worktree).

**Done means:** from a transcript: click a path → file tab; click "view more" on a tool
card → output tab; open a child's system prompt → prompt tab with drift signal; all
switches instant, matching revised S6.

---

## F9 — Conversation naming + rename

**Requirements (ruled):** R12d knifes the dead rename plumbing end-to-end; rebuild
properly with real UI. Auto-name: ONE off-critical-path model call after the first
exchange (cheap model via the backend seam), `deriveTitle`
(`session-handlers.ts:127-132`) stays the deterministic fallback and the immediate
title. Rename UI: inline edit in the session rail/browser row (the arc's craft; no
mockup needed — it's swappable detail).

**Reference:** big-AGI (MIT — auto-naming prompt + timing pattern).

**Tests:** auto-name replaces only auto-derived titles (never a user rename — reuse the
existing `:542-544` guard logic); model-call failure leaves deriveTitle title (silent,
journaled); rename verb round-trip.

**Done means:** first exchange auto-titles sensibly within seconds; rename sticks and
survives restart; a failed naming call is invisible to the user.

---

## F10 — Instant navigation (maintainer requirement, cross-cutting)

**Requirements (ruled, verbatim intent):** navigation within coa is ALWAYS instant —
navigation is pure UX, content loads async behind it, never blocking the act of
navigating. All opened chat tabs stay fully materialized in memory: switching is
instant, transcripts immediately scrollable end-to-end like the active one.

**This is the acceptance criterion for the console-state rewrite charter** (see
`architecture-audit.md` — the poll-and-replace store finding). Surfaces already stay
mounted (`Center.tsx` display-swap); the gap is chat-session materialization + push-fed
state. Reference: Podman Desktop (Apache-2.0 — event-stream-fed live panes), VS Code
(MIT — model/view separation).

**Done means:** measured: tab switch to any opened session < 1 frame to first paint of
the already-materialized transcript; no navigation path awaits I/O; scroll needs no
loading; memory stays sane on 20+ open tabs (materialization ≠ leak — cap policy is the
arc's call, journaled).

---

## Cross-feature sequencing (knife → build pairs)

R12b → F3 attachments · R12c → F2 · R12d → F9 · R12e → F5. F6 early (F3 depends).
F7 with F1 (spawn option). F4 before F8's skills-in-compilation visibility. F10 rides
the architecture workstream but gates console-touching features' "done".

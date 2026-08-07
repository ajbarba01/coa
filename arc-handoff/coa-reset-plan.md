# coa reset plan — health check, de-drift, de-bloat

**Do not commit this file.** It lives outside the repo and steers the work; copy it to the
machine where coa's toolchain runs. Execute **one phase per agent session**, in order. The
human reviews between phases. Every ruling below was decided by the maintainer in an
interactive review on 2026-08-05 — an executing agent's job is to implement, not re-litigate.
If reality contradicts a ruling (e.g. a "dead" symbol turns out to have a live caller),
stop and surface it rather than improvising.

---

## North Star (decides every ambiguity)

coa gives its user complete, harness-independent control over agentic development: agent-
and model-agnostic, never locked to one provider, easy to bootstrap into any project,
brownfield or greenfield. The near-term product is **the workbench** — daemon, sessions,
multi-backend adapters, auth, agent registry, console — polished to absolutely optimize
user efficiency in agentic development. Governance (drift detection, flagging,
code-structure analytics) is a real but **later** era; its dormant substrate is kept and
clearly labeled, never presented as live. Goals in no particular order: (1) model
agnosticism via backend adapters, (2) authentication management, (3) agent orchestration,
(4) console configurability and efficiency, (5) eventual governance features,
(6) agent power/cost-effectiveness features.

## Ground rules (bind every phase)

- **Reality wins.** Docs describe what the code does today. Planned ideas live ONLY in
  ROADMAP.md. Nothing stays documented as vaguely aspirational.
- **Verify before delete.** Before removing anything, re-prove it has zero non-test
  callers (grep + typecheck + tests). The inventory behind this plan was thorough but is
  not a substitute for mechanical proof at execution time.
- **Deletion ledger.** Every removal lands in the ledger (bottom of this file) exactly as
  executed. Feature-shaped code → `archive/`; slop (dead exports, stale comments,
  placeholder handlers, dead CSS) → plain delete. Ledger line either way.
- **Tests green after every commit.** No commit lands on a red suite.
- **Comment rule.** Comments and test names are minimal, explain only what the code cannot
  explain just as easily, and contain **zero** internal codenames (no M-numbers, D-numbers,
  ADR refs, phase/plan names like P-β/W4/R-12/GRF).
- **Commits:** Conventional Commits, subject line only, no body, no trailers
  (no Co-Authored-By, no "Generated with"). Human-sized batches — one logical unit per
  commit, staged by name, never `git add -A`. No project-internal identifiers in subjects.
- **Do-not-touch: the two thin adapters** (`packages/adapter-deepseek`,
  `packages/adapter-longcat`) beyond doc/comment accuracy. Their unification into one
  OpenAI-compatible adapter is owned by a separate in-progress plan.
  *(Maintainer will strike this note when that plan lands.)*
- **Test policy: moderate.** Deleted/archived code takes its tests with it. Tests import
  package internals directly instead of forcing exports onto public surfaces. Obvious
  near-duplicate tests merge when a file is already being touched. Green, honest tests are
  otherwise left alone.

---

## Phase 0 — baseline (no other work until green)

1. Fresh `pnpm install`; build native modules successfully.
2. `pnpm -r typecheck` (or the workspace equivalent) — clean.
3. Full test run — record every pre-existing failure verbatim in this file, then triage
   each: fix it, or (only if it tests behavior a later phase removes) defer to that
   phase's commit with a ledger note.
4. Commit any baseline fixes. Suite green before Phase 1 begins.

## Phase 1 — the knife (kills and archives, one feature per commit)

First create the archive:

- `archive/` at repo root. README inside states: reference-only; nothing here compiles, is
  imported, or is part of the product; each entry lists what it was, why it was parked, and
  the arc that might revive it. Exclude `archive/` from tsconfig includes, vitest globs,
  eslint, dependency-cruiser, and any docs-check script.

Then execute the rulings. For each: move/delete the code AND its tests, unwire every
registration/import, verify, commit, tick the ledger.

**R1 — Cost cap → archive.** The hard-cap/deny path and the `ceilingUsd` plumbing threaded
through governance, daemon options, and the permission predicate (it is never set by any
caller and self-documents as never blocking under subscription accounts). The system's
"two blocks" becomes one: the close gate. KEEP the spend counter (`capState`/`charge`) and
the audit-record write path (`record`) — the nav HUD reads the former; the kept Usage
surface will eventually read the history.

**R2 — Ledger reads + redaction → archive.** `ledgerEntries`, `redactLedgerEvent`,
`SECRETS_GLOB`, `DENY_READ_GLOBS` (test-only consumers).

**R3 — Decision log / provenance system → archive.** `GovernanceLog`, `vouch`/`vouchOf`,
`subtractiveFeed`/`surfaceSubtractiveChange`, the self-mod passthrough, the
`readDecision`/`decisionsByTarget`/`why`/`getDecision` RPC verbs, the `coa why` and
`coa decision` CLI verbs, and the workbench `why`/`get_decision` agent tools. Write side
never ran; every read returns empty forever. (Maintainer verdict: compliance theater for a
single-user attended tool.)

**R4 — AutoPatcher + ReminderPolicy → archive.** The two never-enabled flag-pipeline
extensions (`flags/autopatch.ts`, `flags/reminder.ts`). The live pipeline — close gate,
user flag feed, per-tool deny — is untouched.

**R5 — Bundle importer + version gate → archive.** `compiler/import-bundle.ts` +
`compiler/version-gate.ts`; no verb or UI ever calls them. Reference material for the
upcoming skills/MCP/plugin arc.

**R6 — Signal bus → archive.** The write-only diagnostics ring (`signal-bus.ts`, the
kernel's per-frame write, and the read view no one calls).

**R7 — Undo plumbing → archive.** Checkpoint `pin`/`unpin`/`rewind`/`retentionFloor` and
the pathspec-rewind helper — the never-built "human control surface". KEEP
`checkpoint`/`listTimeline` (the console Timeline panel reads them).

**R8 — Grounding producer → archive.** It can only query the permanently-empty symbol
index. Becomes reference material for the "tool repair + grounding" arc, which is bigger
than symbol-name checking.

**R9 — Mirror-persistence machinery → delete.** The projection database's never-used
survive-restarts/versioning scaffolding (`projectionPath` is never passed; the mirror is
always rebuilt in memory from the log — keep that honest form).

**R10 — Empty-reading agent tools: unregister, keep dormant.** `get_symbol`,
`find_references`, `outline` stop being registered into sessions (agents currently get
permanently-empty results). The code stays with the dormant symbol layer.

**R11 — KEEP, dormant and labeled.** The symbol/graph layer (`packages/code-intel`,
core `graph/`, core `scope/`, the kernel's indexing methods), health scoring, the
idle-chores queue, and the lazy tool-loading partition. These are the maintainer's chosen
substrate for the governance era. ARCHITECTURE.md documents them in one clearly-marked
"dormant" section. Remove the unused `@parcel/watcher` dependency (re-add when the wire
actually lands).

**R12 — Console trims.**
- Remove the `graph` nav row + palette entry (surface renders "not designed yet"; no panel
  exists).
- Gate the Showcase surface to dev builds.
- Work dock: keep Subagents/Changes/Worktree floors, remove the Record and Cost floors.
- Composer: keep mic + attach as visibly disabled design intent, but delete the fake
  attach plumbing (the hardcoded "screenshot.png" chip path that never sends anything).
- Delete the presentational permission-mode chip (real modes are a Next arc).
- Delete the rename-session plumbing end-to-end (daemon verb → IPC method → preload —
  no UI ever calls it).
- Delete the light/system theme branches (only sand-dark exists).
- Usage surface: KEEP as the declared design target; add one comment at its entry point:
  mock by design, wiring is roadmap work.

**R13 — SDK probe suite: prune to load-bearing.** In the Claude adapter's control-probe
suite, keep probes guarding behavior shipped code relies on (permission seams, hooks, the
bounded tool surface, session lifecycle); archive the exploratory rest. Distill the
control-spike's still-relevant findings into ARCHITECTURE.md during Phase 3.

## Phase 2 — de-slop (mechanical, no behavior change)

- **Codename sweep.** All ~500+ comment/test-name sites: M-numbers, D-numbers, ADR refs,
  plan codenames → plain language per the comment rule, or deleted where the code already
  says it. Includes test `describe` strings.
- **Public surfaces.** Rebuild core's 321-line flat export list to expose exactly what the
  apps consume (it currently both hides live modules and exports ~150 symbols, blinding
  the unused-code lint). Prune dead exports in the Claude adapter (~11), loop-driver (~5),
  spi (`DeliveryOrigin`), console packages (the transcript package exports ~47 symbols;
  the app imports 3). Thin adapters excluded (do-not-touch).
- **Naming and placement.** `mockAuth.ts` → its real name (it is live RPC, not mock); fix
  the stale "Auth and Usage are mock-fed" comment; move test-only fixtures
  (`mockAgents.ts`, `mockConversation.ts`, `fixtures.ts`) out of production folders;
  delete the retired AgentRail ghost component; delete the ~80-line dead legacy-kit CSS
  block; remove stale provenance headers pointing at a deleted package.
- **Small fixes.** Add `serve` to the CLI usage string; demote core's type-only
  loop-driver dependency to a devDependency; update the dependency-cruiser ruleset to the
  post-reset package names and the archive/ exclusion.
- **Layering note.** Core currently imports the Claude adapter (login plumbing) and the
  DeepSeek adapter (web summarizer), violating the documented "only the CLI constructs
  backends" rule. Do NOT refactor now: document reality in ARCHITECTURE.md and add the
  Later roadmap line "restore the backend construction seam via injection".

## Phase 3 — docs (written last, so they describe the post-trim tree)

**Delete** (git history is the archive): `docs/adr/` (31 files), `docs/superpowers/`
(27), `docs/design/research/` (6), `docs/design/handoff/` (14), `DEV-NOTES.md`,
`docs/DESIGN.md`. Before deleting, harvest: still-live rationale from ADRs
(append-only conversation log, single deny channel, bounded tool surface, browser-profile
auth model, session strategy per provider, workbench design system) → ARCHITECTURE.md;
still-wanted ideas from DEV-NOTES/OPEN.md → ROADMAP.md.

**Write `docs/ARCHITECTURE.md`** (~400–600 lines): the system as built, organized by real
package/subsystem names (daemon & sessions, event spine & reconciler, flags & close gate,
workbench tools, backend adapters & the loop driver, auth & browser profiles, model
catalog, console, agent registry). Inline the distilled rationale where each constraint
lives. One clearly-marked **dormant substrate** section (symbol/graph layer, health
scoring, idle queue, lazy tool loading) and one **known-debt** note (layering leak,
pipe-transport trust).

**Rewrite `ROADMAP.md`** forward-only, three tiers:
- **Next:** subagent orchestration (registry landed; dispatch, agent-to-agent messaging,
  child-completion delivery open) · skills/MCP/plugin arc (includes MCP tool support;
  archived bundle importer is reference) · permission-mode arc (real modes replacing the
  deleted chip) · tool repair + grounding arc (archived grounding producer is reference).
- **Later:** live flag/deny push into the console · worktree manager + fork · usage
  surface wiring (real reads behind the kept mock UI) · interactive terminal mode ·
  viewer/editor surface (prompts, tool I/O, files — absorbs the system-prompt viewer) ·
  the Claude permission-seam spike · pipe-transport hardening · CLI build script ·
  restore the backend construction seam · budget guard (only if metered spend returns) ·
  light theme · real attachments · conversation naming + rename UI.
- **Someday:** governance era (feed the symbol/graph layer, health/spaghetti scoring,
  graph views, constraint→flag authoring, turn-level undo, deep provenance if ever) ·
  agent tools (summarize/judge) · prompt-engineering surface · nav HUD mini-states ·
  kit density scale · role/capability enforcement.

**Rewrite `AGENTS.md`** (router + constitution) and keep `CLAUDE.md` as the thin layer on
top. New constitution: TypeScript strict, no `any` · determinism-first (no model call on
any critical path) · the event spine is the only shared mutable substrate (producers and
consumers point only at it) · ONE block — the close gate; everything else advisory
(help, never cage) · strict superset (every feature degrades to pass-through; raw view
always available) · no lock-in (one backend seam; never assume a stack) · compose, don't
reinvent · typed boundaries (Zod at the edges) · pure, tested core logic · single main,
verified commits, stage by name, subject-only commit rule · same-commit doc rule · the
comment rule above · quality independent of scope. Drop: the M-order build sequence, the
ADR system, all handoff-doc references.

**Refresh `README.md`** to the North Star. **Drift-fix** ENGINEERING / CODE_STYLE /
WORKFLOW / REPO_LAYOUT / UI: remove references to deleted docs/systems (ADR links, module
IDs, handoff pointers), update REPO_LAYOUT for `archive/` and the current package map, no
restructuring beyond that. Update the docs-check script for the new doc set.

## Phase 4 — closeout

1. Full gates: install-from-clean, typecheck, full test suite, lint, dependency-cruiser,
   docs-check.
2. Ledger reconciliation: every ruling R1–R13 and every Phase 2/3 bullet accounted for —
   done, or consciously deferred with a note the maintainer approves.
3. Grep gates: zero hits for M-number/D-number/ADR/plan-codename patterns in source and
   docs (outside `archive/` and git history); zero imports from `archive/`.
4. Maintainer review of the final diff; this plan file stays outside the repo.

---

## Deletion/archive ledger

Tick each row as executed; correct any row that reality contradicts.

| # | Item | Fate | Revival path |
|---|------|------|--------------|
| R1 | Hard cost-cap + ceiling plumbing | archive/ | Later: budget guard if metered spend returns |
| R2 | Ledger reads + redaction utilities | archive/ | with governance era |
| R3 | Decision log, why/vouch provenance, its CLI/RPC/tools | archive/ | none planned (deliberate) |
| R4 | AutoPatcher + ReminderPolicy | archive/ | someday: flag auto-fix / reminders |
| R5 | Bundle importer + version gate | archive/ | Next: skills/MCP/plugin arc |
| R6 | Signal bus (write-only diagnostics ring) | archive/ | none planned |
| R7 | Checkpoint pin/rewind (undo plumbing) | archive/ | someday: turn-level undo |
| R8 | Grounding producer | archive/ | Next: tool repair + grounding arc |
| R9 | Projection persistence/versioning scaffolding | delete | rebuild if the log outgrows memory |
| R10 | Registration of empty symbol tools | unwire only | when the symbol layer is fed |
| R12a | Graph nav row + palette entry | delete | someday: graph views |
| R12b | Fake attach plumbing | delete | Later: real attachments |
| R12c | Permission-mode chip | delete | Next: permission-mode arc |
| R12d | Rename-session plumbing | delete | Later: conversation naming + rename UI |
| R12e | Light/system theme branches | delete | Later: light theme |
| R12f | Work dock Record + Cost floors | delete | with their features |
| R13 | Exploratory SDK probes | archive/ | none needed; findings distilled in docs |
| P2 | Dead exports, stale names/comments/CSS, fixtures in prod folders | delete | n/a (slop) |
| P3 | docs/adr, docs/superpowers, docs/design/research, docs/design/handoff, DEV-NOTES, DESIGN.md | delete | git history |

## Appendix — the OneDrive machine (optional)

This plan was authored on a machine where the repo lives inside OneDrive: pnpm's symlinks
do not survive there (native builds fail), and no git push credentials exist. If that copy
ever needs to run anything: move the repo to a plain local path first, then
`gh auth login` (browser flow, HTTPS credential helper) — no SSH key required.

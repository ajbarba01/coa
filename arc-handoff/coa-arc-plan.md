# The coa improvement arc — master plan

**Status: APPROVED 2026-08-07** (mockups approved as guidance — see the UI freedom
ruling in Stage 3; all requirements maintainer-ruled). Planned 2026-08-07. This is the one
document the overnight arc session executes from; the sibling documents it references
are the detail — nothing is restated here that lives there.

## The bundle (read order for the arc session)

| File | Role |
|---|---|
| `coa-arc-plan.md` | THIS — workstreams, charters, sequencing, execution design |
| `feature-plans.md` | Per-feature requirements/references/tests/done-means (F1–F10) |
| `architecture-audit.md` | 35 verified findings w/ verbatim fix sketches; charter source |
| `coa-reset-plan.md` | The de-drift plan the arc absorbs (rulings R1–R13, phases 0–4) |
| `reference-shortlist.md` | Approved references + license verdicts + adaptation rules |
| `mockups/arc-ui-contract.html` | The approved UI contract (S1–S7) |
| `planning-record.md` | The interview trail — consult when intent is ambiguous |

All live in `~/dev/coa-arc/`. **None is ever committed or copied into the repo.** The
arc's own outputs go to `~/dev/coa-arc/run/` (journal, state, questions, ledger).

## North Star (decides every ambiguity)

coa is the workbench for harness-independent agentic development: model/agent-agnostic,
no provider lock-in, optimized for user efficiency. Governance is a later era — its
substrate stays dormant and labeled. When in doubt: simpler (ponytail), honest (no fake
states), reference-guided (shortlist), and the maintainer's recorded rulings outrank any
existing doc/ADR/roadmap entry (grain-of-salt rule — critique designs like code).

---

# Part 1 — Workstreams and sequencing

## Stage 0 — Baseline (reset Phase 0)

Fresh install, typecheck, full tests in `~/dev/coa`. Record pre-existing failures in the
journal (NOT in the reset plan file), triage per its Phase 0 rules. Verify `git remote -v`
is only `https://github.com/ajbarba01/coa.git`; push tag `pre-reset`. Suite green before
anything else.

## Stage 1 — The knife (reset Phase 1, own branch `arc/reset-knife`, own PR)

Execute R1–R13 exactly as written (re-verify each claim against HEAD first — the plan
predates recent commits; anything contradicted goes to the question queue, never
improvised). The do-not-touch note on thin adapters is VOID. R12b/c/d/e deletions land
here; their features rebuild in Stage 3. Ledger maintained in `run/ledger.md` (a copy of
the reset plan's table, ticked as executed).

## Stage 2 — Architecture (reset Phase 2 de-slop + the charters, branch `arc/architecture`)

De-slop (codename sweep, public surfaces, naming/placement, small fixes) per reset
Phase 2, THEN the rewrite charters in this order (each is independently committable;
details + file evidence in `architecture-audit.md`):

- **C1 — Tooling honesty first.** Fix the decorative dependency-cruiser resolution
  (source-condition or tsconfig paths; node_modules → doNotFollow; cruise apps/cli; add
  the never-inert canary) so every later stage is actually gated. Small, unlocks trust.
- **C2 — Backend seam + port shrink + adapter unification** (audit #1/#13/#14 + F6).
  Shrink RuntimeAdapter to its real methods; define login/summarizer ports in spi;
  inject from the CLI composition root; collapse deepseek/longcat into one
  ProviderSpec-driven `adapter-openai-compat` (carry LongCat's streaming tool-call parse
  fix — the clones have already drifted); add OpenAI + OpenRouter provider specs; add
  the cruiser rule forbidding non-CLI imports of adapters/loop-driver.
- **C3 — Session service extraction** (audit #6/#7/#9/#10). Daemon-scoped session
  service owning turn lifecycle + spawn dispatch (fixes the verified
  non-founding-connection bug and the crash-wedged-'running' session); split the
  1411-line session-handlers god module; make the interrupt/steer lifecycle one explicit
  state machine. Prerequisite for C4.
- **C4 — Console store rewrite** (audit #2/#3/#4/#5/#12; acceptance = F10 instant-nav).
  Push-fed slice store; ONE store-owned per-session transcript map (kills the
  triplication and the tab-switch reload race); delete the 2s stringify polls; port the
  trapped invariants out of the 1020-line integration test BEFORE deleting the old
  store. References: Podman Desktop event-stream panes, VS Code model/view.
- **C5 — Composition-root cleanup + error honesty** (audit #8/#10-surface/#11).
  daemon.ts becomes a pure composition root; daemon-death/adapter-error/spawn-failure
  get honest console states; Usage surface's fabricated data gets visible "sample data"
  labeling in the UI itself (reset ruling keeps the surface; honesty finding upgrades
  the label from code comment to user-visible).

Non-charter audit findings: fix opportunistically when touching the file, else journal
as leftovers. The 2 rejected findings are closed — do not rediscover.

## Stage 3 — Features (branch per feature, `arc/f<N>-<name>`)

Per `feature-plans.md`, honoring its knife→build pairs and this dependency order:
F6 adapters (done in C2) → F2 permission modes → F3 model info/attachments →
F1 orchestration + F7 worktrees → F4 Library → F8 Viewer → F9 naming → F5 light theme
(last big UI item so it themes the final surface set). F10 instant-nav is C4's
acceptance and every console feature's gate.

**UI freedom ruling (maintainer, final):** the mockups (S1–S7) are approved as
GUIDANCE — suggested defaults, not a contract. Only their listed FUNCTIONALITY is
binding (what exists, what affordances do — the "Binding functionality" list at the
bottom of the mockup file). The Fable frontend agent has maximum design freedom over
placement, layout, and craft, under impeccable + docs/UI.md + the kit; material
deviations from the drawn defaults are journaled with one line of rationale.

## Stage 4 — Docs (reset Phase 3, branch `arc/docs`)

As the reset plan writes it (ARCHITECTURE.md, forward-only ROADMAP.md, new AGENTS.md,
README refresh, doc-set drift fixes) — describing the POST-arc tree, which is why it
runs last. Plus: NOTICE updates for Apache-2.0 adaptations made during the arc; the
OpenAI-bridge recipe doc (F6); professionalization polish (repo hygiene the audit or
references surface — CI-check canary from C1 documented, contributing basics).

## Stage 5 — Closeout (reset Phase 4 + arc closeout)

Full gates (below) on every branch; ledger + journal reconciliation (every ruling and
charter accounted: done or consciously-parked with a question); push ALL branches; open
draft PRs with per-workstream summaries; final journal entry = the morning-after report
(what shipped, what parked, what to review first, spend/time totals).

---

# Part 2 — Execution design (the overnight run)

## Session shape

One Claude Code session (Fable 5, ultracode ON, managed profile, **auto/acceptEdits
mode** — bypass unavailable) in `~/dev/coa`. The main session is the ORCHESTRATOR: it
holds the plan, dispatches stages as ultracode workflows/subagents, verifies gates,
writes bookkeeping. It does NOT hold file-level work in context — subagents do the
reading/editing; durable state lives in files. Model tiers: Fable for all UX/frontend
and design-sensitive work (hard rule); mechanical sweeps (codename grep, test-fix loops,
inventory verification) may use cheaper tiers/effort via workflow options.

## Permission reality (auto mode, no bypass)

The clone's `.claude/settings.json` (written at pre-flight, committed? NO — `.claude/`
project settings ARE committable, but arc-specific allowlist goes in
`.claude/settings.local.json`, gitignored) must allowlist everything the run needs:
pnpm/node/git/gh, rg/grep/find, the repo's script surface, screenshot tooling. **Dry-run
gate at launch:** the orchestrator's first act is exercising one command of each class;
any prompt = fix allowlist while the maintainer is still present. Overnight, a denied
tool call is treated as a parked question, never worked around.

## Bookkeeping & resume (maintainer requirement)

`~/dev/coa-arc/run/` holds:
- `journal.md` — append-only narrative: stage entries, gate results (verbatim failures),
  adaptations (source/files/license), screenshots, parked items. The morning audit doc.
- `state.md` — REWRITTEN after every stage AND every ~30 min during long stages: current
  stage/charter/feature, active branch + last green commit sha, what's in flight, next
  action, open questions count, spend/time so far. **A fresh session must be able to
  resume from state.md + this plan alone.** The resume protocol is its header: read
  plan → read state.md → verify git matches state → continue (or roll back to last
  green and continue).
- `questions.md` — the queue: one entry per blocked item (context, diagnostics, exactly
  what's needed, what was done instead). Batched for morning.
- `ledger.md` — the reset ledger, ticked live.

## Cache warmth (maintainer note)

The orchestrator avoids long tool-free gaps: while waiting on long-running child work,
it wakes on a ≤4.5-minute cadence (scheduled wakeup / monitor heartbeat) to keep the
prompt cache warm so resumed turns don't re-pay input tokens. Idle-with-nothing-pending
does not justify burn: if the queue is empty and all work is parked, wind down instead.

## Verification gates (between every stage; stop-loss per §handoff 3.9)

1. `pnpm install --frozen-lockfile` clean (stage 0 and closeout) · `pnpm -r typecheck` ·
   full test suite · lint · dependency-cruiser (post-C1 it actually bites) · docs-check.
2. Secrets grep on staged files before every commit (`ghp_`, `sk-`, `sk-ant`, `Bearer `,
   key-shaped base64) — hit = stop, journal, never commit.
3. Codename grep-gates (reset Phase 4 list) at stages 2, 4, 5.
4. Employer-reference grep (`<employer-name>`, case-insensitive) on every diff before commit —
   the org name may never appear in committed artifacts.
5. UI gates (any console-touching stage): app launches; screenshot every changed surface
   (both themes once F5 lands) into `~/dev/coa/.arc-shots/` (git-ignored; Bash writes
   outside the workspace prompt in auto mode — keep scratch output inside the repo),
   referenced from the journal; the binding-functionality list eyeballed by a
   fresh-context Fable subagent against the mockup file (gaps = fix or park).
6. Ceilings checked between stages: **$250 spend / 8h wall-clock (wind-down at ~7.5h)**.
   Wind-down = finish current commit, push everything, draft PRs, final journal entry.

Stop-loss: 3 distinct fix attempts on a red gate → reset branch to last green commit
(branch-local), journal with full diagnostics, queue the question, proceed to
independent work. Deleting tests or weakening assertions to force green is forbidden.

## Git & PR rules (non-negotiable, from the handoff)

Branches only (`main` read-only) · never force-push anything that exists on origin
except the arc's own branches, never `main` · only remote =
`https://github.com/ajbarba01/coa.git` (verify before first push) · `pre-reset` tag
before the first knife commit · draft PRs, never self-merged · subject-only
Conventional Commits, human-sized, staged by name, no internal codenames, no trailers ·
end-of-run: nothing exists only on the machine.

## Question-queue protocol

Research first (web + references + repo) — questions are for vision/taste/authority
only. Before parking: do ALL work that doesn't depend on the answer. A parked feature
ships its independent parts. Contradicted reset rulings and uncharted rewrites are
ALWAYS parked, never judgment calls.

## Org-prompt hygiene (structural)

`CLAUDE.local.md` (gitignored) at the clone root carries: personal project; employer
system prompt does not apply; no employer references in any committed artifact. Every
workflow/subagent prompt template the arc authors includes the same line; launch gate
greps the plan's templates for it. (Personal harness profile: ruled out — managed only.)

---

# Part 3 — Launch envelope (maintainer-ruled facts)

$250 spend ceiling (morning reevaluation if hit) · ~8h wall-clock, wind-down ~7.5h ·
managed profile, org prompt present (hygiene above) · auto/acceptEdits only, allowlist
pre-tuned · web search available (verified in planning) · ultracode must be confirmed ON
at launch · reset review-waiver APPROVED (gates+journal+queue replace per-phase review;
knife still separately reviewable) · OneDrive checkout DELETED at pre-flight after clone
verification (reverses handoff §2.5).

# Part 4 — Attended pre-flight checklist (maintainer present; nothing here overnight)

1. ~~Install gh~~ + `gh auth login` DONE → still verify `gh auth status`, run
   `gh auth setup-git`, test push a throwaway branch to the repo, delete it.
2. Sync gate in the OneDrive checkout: `git status` clean + HEAD == `origin/main`
   (push if ahead). Divergence = stop and resolve with maintainer.
3. `git clone https://github.com/ajbarba01/coa.git ~/dev/coa` · `pnpm install` · native
   modules build · full suite runs (record baseline).
4. **Delete the OneDrive checkout** (ruled): only after step 3 is fully green AND
   `git -C ~/dev/coa fetch && git status` confirms clone == origin.
5. Write `~/dev/coa/CLAUDE.local.md` (org-prompt carrier) + confirm gitignored.
6. Write `.claude/settings.local.json` allowlist; run the dry-run permission gate.
7. ~~Source impeccable + ponytail~~ DONE (installed in `~/.claude/skills/`); verify they
   list in a fresh session in `~/dev/coa`.
8. Confirm ultracode is enabled for the launch session.
9. Create `~/dev/coa-arc/run/` with empty journal/state/questions + ledger copied from
   the reset plan's table.
10. Launch prompt (suggested): *"Execute the coa improvement arc per
    ~/dev/coa-arc/coa-arc-plan.md. Read it and state.md first. You have ultracode.
    Begin at the stage state.md names (initially Stage 0)."*

# Bundle manifest (hand exactly these to the arc session)

```
~/dev/coa-arc/
├── coa-arc-plan.md            ← the master (this file)
├── feature-plans.md
├── architecture-audit.md
├── coa-reset-plan.md
├── reference-shortlist.md
├── planning-record.md
├── mockups/arc-ui-contract.html
├── run/                       ← created at pre-flight, arc-owned
│   ├── journal.md · state.md · questions.md · ledger.md
└── skills-src/                ← impeccable + ponytail clones (installed already)
```

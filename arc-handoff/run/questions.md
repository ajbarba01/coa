# Question queue — batched for the maintainer

Entry format:
`## Q<N> — <one-line question> [<stage/feature>]`
Context (what was being done) · Diagnostics (verbatim errors/evidence) · What's needed
(the exact decision) · What was done instead (independent work completed).

(empty)

## Q1 — R1 (cost cap) contradicted by ADR 0032: PARKED, not executed
**Context:** The reset plan (2026-08-05) rules the hard-cap/deny path + ceilingUsd plumbing
archived, keeping only the spend counter. One day later the subagent-orchestration arc
landed (5 commits, 2026-08-06): ADR 0032 (accepted, committed in d97c118) rules "the cost
cap is the only fan-out bound — no depth limit exists and none is added" and names the
daemon-global CostCap through buildCanUseTool as the chosen mechanism; spec D150 and
OPEN.md/ROADMAP were updated to match; lineage.ts prose depends on it. spawn_agent is live
with unbounded depth/width.
**Diagnostics:** verification/R1.json (full inventory + evidence). Mechanical claims mostly
hold (ceilingUsd never set in production; deny can't fire under subscription accounts) —
but the removal target is the sole DOCUMENTED bound on a live feature, and the KEEP
rationale ("nav HUD reads capState") is false at HEAD (HUD reads mockUsage.ts; capState's
real readers: `coa cap` CLI verb, Inspect tool, an unrendered console poll).
**Needed from maintainer:** reconcile R1 with ADR 0032/D150 — archive anyway (accepting an
unbounded fan-out), keep the cap as the fan-out bound (strike R1), or replace with a
different bound first.
**Done instead:** nothing removed; R1 untouched. All other rulings proceed.

## Q2 — R2 (ledger reads + redaction) contradicted: PARKED, not executed
**Context:** Ruling claims ledgerEntries, redactLedgerEvent, SECRETS_GLOB, DENY_READ_GLOBS
are test-only. At HEAD: redactLedgerEvent is the ledger WRITE path's allow-list enforcement
(ledger.ts:67) and was extended by 0fd8083 (root attribution + flattenPathSafe hardening +
new attack-fixture tests); SECRETS_GLOB/DENY_READ_GLOBS are spread into the live capability
set (sandbox.ts) landing in SDK disallowedTools. Only ledgerEntries is dead — and it is the
roadmap's named read seam for the new session-tree costUsd UI (f2936ec).
**Diagnostics:** verification/R2.json.
**Needed from maintainer:** strike R2, or re-scope it to exactly ledgerEntries (and even
that fights the tree-spend roadmap).
**Done instead:** nothing removed.

## Q3 — R12f Cost floor became live post-plan: executed Record-only
**Context:** Ruling deletes the work dock Record AND Cost floors. f2936ec rewired the Cost
section to render the active session's family-tree spend (Work.tsx:42-45,110-118 via
session-tree.ts + ledger root attribution), with two pinning tests. The Cost section is now
the D85 degraded state of a live feature, not a dead floor.
**Diagnostics:** verification/R12-console.json.
**Needed from maintainer:** confirm keeping the Cost section (recommended — it is live), or
rule its removal explicitly.
**Done instead:** Record floor removed as ruled; Cost section kept; other R12 bullets
executed as verified.

---

# Added at the interrupted handoff (2026-08-07 ~07:20)

## Q4 — Spend ceiling was never enforced; what is the budget for the resumed run?
**Context:** the plan's $250 ceiling was to be checked between stages. No spend meter
was available in-session; token counts were tracked instead and never converted to
dollars or acted on, so the run ended by hitting the account's individual spend limit
mid-workflow rather than winding down on plan. ~4.4M subagent tokens over ~45 agents.
**Needed:** a budget for the resumed run, and permission to enforce it mechanically
(hard token target per workflow that throws when exhausted) rather than by judgment.
**Done instead:** everything pushed; nothing lost; this file records the failure.

## Q5 — The unified adapter package exists but is UNGATED
**Context:** the adapter-unification agent wrote ~1,721 lines of
packages/adapter-openai-compat (provider-spec, complete, sse, wire, render,
credentials, models, pricing, adapter + deepseek/longcat specs + 4 test files) and was
killed before it could run a single gate or commit. Preserved verbatim on branch
`arc/wip-adapter-unify` (ac267ad).
**Needed:** decide gate-and-keep vs discard-and-redo. It has never been typechecked,
linted, or tested, and the two original adapter packages are still present and live —
so the tree is currently NOT in the unified state, it merely has a candidate sitting
beside it.
**Done instead:** isolated on its own branch, never merged into the gated work.

## Q6 — Three architecture charters parked unstarted (time, not judgment)
C3 (session service extraction — fixes the verified non-founding-connection turn bug
and the crash-wedged 'running' session), C4 (console store rewrite — the instant-nav
acceptance criterion), C5 (composition root + error honesty). All three remain fully
specified in `architecture-audit.md` with verbatim fix sketches; nothing about them was
invalidated by the work that landed. C3 is the prerequisite for C4.
**Needed:** nothing — they resume as written. Flagged so the morning review knows the
architecture workstream is ~40% delivered, not complete.

## Q7 — Small leftovers worth a decision
- Three orphaned context modules (`spec-tier.ts`, `health.ts`, `generation-seam.ts`)
  survived the barrel prune: feature-shaped, no consumers. Delete, archive, or re-wire?
- Verb-family codenames (CF-*, HLT-*, CHAT-*, CON-CAT, L-* layer names, Type-1/2,
  Tier-0) were swept in some packages and deliberately kept in others — the sweep's
  ban list did not enumerate them. Harmless but inconsistent; a consistency pass is cheap.
- `Combobox.test.tsx` focus assertion + one `daemon.test.ts` watcher case flake under
  full-suite load (both pass solo) — candidates for deterministic waits.
- `capabilityProfileSchema` in packages/shared lost its last consumer in the port
  shrink; left in place deliberately (out of that charter's scope).

---

# Maintainer answers — 2026-08-07 (arc resumed on the maintainer's Windows machine)

Rulings taken in-session; Q3/Q5/Q7 delegated to the resuming agent, whose calls are
recorded here as final unless the maintainer objects.

- **Q1 — RULED: archive anyway.** Execute R1 as originally written (hard-cap/deny path
  + ceilingUsd plumbing archived, spend counter kept), accepting that spawn_agent
  fan-out is unbounded for now. ADR 0032's "cost cap is the only fan-out bound" claim
  becomes stale prose to reconcile in Stage 4 docs.
- **Q2 — RULED (2026-08-07): strike R2 entirely.** Ruling withdrawn; nothing is
  removed and nothing is deferred. Three of the four symbols are live safety code
  (`redactLedgerEvent` is the ledger write-path allow-list; SECRETS_GLOB and
  DENY_READ_GLOBS feed the SDK's disallowedTools), and the fourth, `ledgerEntries`,
  is the roadmap's named read seam for the session-tree spend UI — deleting it would
  mean rewriting it. Ledger row updated to STRUCK. **The knife's question queue
  (Q1–Q3) is now fully closed.**
- **Q3 — RULED (delegated): keep the Cost section.** It renders live session-tree
  spend with pinning tests; the ruling targeted a dead floor that no longer exists.
  R12f stands as executed (Record floor removed, Cost kept).
- **Q4 — RULED: no budget.** The resumed run drives a subscription account; the $250
  ceiling and mechanical token budgets are dropped. Caveat kept live: Fable promo
  credit (~$200 across two accounts) funds orchestration/UX and is finite — watch it
  across the UX stages.
- **Q5 — RULED (delegated): gate-and-keep.** Gate `arc/wip-adapter-unify` as-is under
  the arc's stop-loss (3 distinct fix attempts); if it survives, land it on
  `arc/architecture`; if not, discard and redo from the intact part-2/part-3 prompts
  in `workflow-scripts/c2-backend-seam-*.js`.
- **Q6 — acknowledged.** C3/C4/C5 resume as written from `architecture-audit.md`.
- **Q7 — RULED (delegated):**
  - Orphaned context modules (`spec-tier.ts`, `health.ts`, `generation-seam.ts`) →
    **archive**, same treatment as the orphaned wire schemas in 2afa808.
  - `capabilityProfileSchema` → archived in the same pass.
  - Codename consistency → **fold into Stage 4**; sweep codenames from code comments,
    but keep Type-1/Type-2 (and other spec-defined vocabulary) in specs/ADRs where
    they are definitions, not slop.
  - Flaky tests (`Combobox.test.tsx` focus, `daemon.test.ts` watcher) → **fix early**
    with deterministic waits; every remaining gate reads through them.

Environment deltas for the resumed run: Windows machine (POSIX setup notes in
MACHINE-SETUP.md mostly moot — Node 22.20 already present, native modules already
build here), bypass permissions ON (the settings.local.json allowlist and
scratch-inside-repo workaround are obsolete), Fable 5 CLI session; ultracode/dynamic
workflows were enabled mid-session, so the Workflow runner IS available after all.

## Q8 — WITHDRAWN, NOT A REAL FINDING (raised and retracted 2026-08-07)
Claimed that packages/console-ui/dist/ was tracked-but-gitignored and drifting. **False.**
`git ls-files | grep -c "/dist/"` returns 0 and no dist path has any commit history —
nothing under any dist/ is or ever was tracked. The claim came from misreading combined
shell output: `git check-ignore` echoes the path it is asked about, and that echo was
mistaken for `git ls-files` output. The dist directories are ordinary local build
artifacts, correctly ignored; stale local build output is expected and harmless.
Recorded rather than deleted so the retraction is visible to the morning review.
**Needed:** nothing.

## Q9 — health-profile.ts orphaned by the Q7 archival (found 2026-08-07)
**Context:** packages/core/src/context/health-profile.ts (`composeProfile`,
`WorstPredicate`) had exactly one non-test consumer: health.ts. health.ts is now parked
in archive/code-health/, so health-profile.ts + health-profile.test.ts meet the same
caller-less condition the other four were archived for. The archiving agent
deliberately did NOT move it (the ruling named four surfaces; over-archiving is the
more expensive mistake) and recorded the fact in the archive README row and ROADMAP so
it cannot be silently forgotten. Verified not to cascade further: `MetricSample` is
still live via packages/code-intel/src/extract-metrics.ts.
**RULED (2026-08-07): park it alongside health.ts.** To execute in archive/code-health/
once the session-layer work releases the working tree: move health-profile.ts +
health-profile.test.ts, update the archive README row (it already flags this as the
obvious next thing to park), and check the ROADMAP M4 row. `MetricSample` stays live
(packages/code-intel/src/extract-metrics.ts) — the cascade stops there.

## Q10 — three desktop panel suites each failed once under a workflow agent's runs (2026-08-08)
**Context:** the standing rule since 2026-08-07 is that the suite is green every run and a
failure is REAL, never a flake to rerun. That rule is now in tension with evidence. Across
the ~4 full-suite runs the wedged C5 phase-1 agent performed, three DIFFERENT desktop panel
suites failed exactly once each:
- `UsagePanel.test.tsx > scopes the reading to any combination of providers; clearing every tile reads as all`
- `ChatPanel.test.tsx > labels the running-turn action Steer and routes it to steerSession…`
- `AuthPanel.test.tsx > removing a provider asks first — and cancel keeps everything`
`AuthPanel` was one of the three suites the 2026-08-07 flake fix (852922c) specifically
de-raced, so this is a partial regression of that work or a second cause with the same shape.
**Diagnostics:** the agent's own reasoning is on record and is sound as far as it goes —
`ChatPanel.test.tsx` does not import `console.js`, so its change could not reach it. Its
final full run was green, and the orchestrator's independent post-commit gate was green
(2859 passed). So the failures are load/timing dependent, not caused by the data-loss fix.
**Why it is not being chased now:** it does not block C5, every gate that mattered was
green, and the three named tests are assertion-timing shaped rather than logic shaped.
**Needed:** a decision on whether to spend a charter on it. Recommended: treat it as a real
(if narrow) defect in the desktop panel suites' timing discipline, sized as one focused
pass — the 08-07 fix trimmed slow `user.type` loops and added deterministic waits, and the
same technique likely applies. What must NOT happen is the rule quietly eroding into
"panel tests are flaky, rerun them"; that is how the pre-arc suite got where it was.
**Done instead:** recorded with the verbatim test names so the next observer can tell a
recurrence from a first sighting.

### Q10 UPDATE (2026-08-08) — one of the "flakes" was a real defect, and it is fixed
Chasing an unrelated gate failure turned up the mechanism for at least part of this family.
`apps/cli/src/cli.test.ts > serves the inspector reads over the bound endpoint` was failing
because `startDaemon` hardcoded `root: process.cwd()`, so the test booted a daemon over the
whole checkout and the reconciler hashed the entire repo at startup. Fixed at 7c379ad by
making the root overridable and passing a temp dir; 1.26s -> 553ms solo.
**Two things this changes about Q10.** First, it is evidence FOR the standing rule: the
failure looked exactly like a load flake — passed solo, failed under parallel load, timing
shaped — and it was a real defect whose cost grows with the repo. Treating it as a flake
would have hidden it indefinitely. Second, it means the three panel-suite sightings above
deserve the same treatment rather than a timeout bump: look for a test doing real work
against the real tree before concluding anything about timing.
Q10 stays OPEN for the three panel suites, which are untouched by this fix.

## Q11 — ambient paths defeat the daemon's `root` seam; auth key paths bypass their own deps (2026-08-08)
**Context:** raised by the C5 compose agent when asked to report (not fix) composition entry
points that bake in a working directory or home directory. 7c379ad added a `root` override to
`startDaemon` and it works for the reconciler — but three sites in the same function ignore
it: `new AgentRegistry(homedir(), process.cwd())` (cli.ts:254), `createConversationStore(join(
process.cwd(), '.coa','local','conversation'))` (cli.ts:261), and `buildClaudeLoginDriver(
homedir())` / `new ModelCatalogStore(homedir())` (244, 247) which have no home seam at all.
`session-deps.ts` (64, 77) does the same for WebConfigStore and AccountsRegistry, and
`DaemonSessionOptions` has a `root` but no `home`.
**Evidence it is not theoretical:** `.coa/` in the checkout holds 24 files today —
conversation stores plus `untitled-agent-5.yaml`/`-6.yaml`. Daemon runs have been writing into
the repo working tree.
**The sharper half:** `packages/core/src/rpc/auth-handlers.ts` calls `homedir()` at nine sites
(126, 150, 210, 211, 248, 378, 403, 455, 505) to compute key-file paths, bypassing the
injected `AuthHandlerDeps`. The `home` seam added at 94b48a9 redirects the four stores but NOT
those key paths — so an auth WRITE verb exercised under a test home would touch the real
`~/.coa/keys/`. No test does that today, which is the only reason it is harmless.
**Needed:** a decision on scope. Recommended: finish the seam in `startDaemon`/`session-deps`
(mechanical — thread `root`/`home` through, defaults unchanged) and make auth-handlers honour
its own injected deps. The second one is the real bug; the first is what stops tests polluting
the checkout. NOT in C5's charter, so not done here.
**Done instead:** recorded with file:line so it can be executed without re-deriving it.

## Q12 — the parked charter and the parked features (closeout inventory, 2026-08-08)
**C4 — console store rewrite.** The one architecture charter never started, and the only one
deliberately reserved: the plan's rule is that UX work runs on the Fable credit, and this is
push-fed slices, one store-owned per-session transcript map (killing the triplication and the
tab-switch reload race), deleting the 2s stringify polls, and porting the invariants trapped in
a 1020-line integration test BEFORE the old store is deleted. Acceptance is instant navigation.
C3 was its prerequisite and is done, so it is unblocked — it needs the model, not the sequence.
**Stage 3 features — none started.** F6 rode C2 and shipped. The plan's order is F2 permission
modes -> F3 model info/attachments -> F1 orchestration + F7 worktrees -> F4 library -> F8
viewer -> F9 naming -> F5 light theme, with F10 instant-nav being C4's acceptance gate. The
maintainer's UI-freedom ruling stands: the mockups are guidance, only their listed functionality
is binding.
**Needed:** nothing to unblock — both resume as written. Flagged so the closeout review is not
misread as "the arc is finished". The architecture workstream is complete except C4; the
feature workstream is untouched.

## Q13 — the verification chain reads the script, never the charter (2026-08-08)
**Context:** C5's workflow script carried four of the five items the plan's C5 defines. The
missing item (a user-visible sample-data label on the usage surface) was real and unshipped, and
was found only by re-reading the plan while writing closeout questions — after two verifiers had
passed judgment on the charter. Both verifiers were asked whether the SCRIPT's items were done.
Neither was asked whether the script matched the plan.
**Why it matters beyond this instance:** every charter in this arc was executed from a
hand-written script derived from a plan document. Any item lost in that derivation is invisible
to the entire executor-plus-verifier apparatus, because nothing in the chain ever re-reads the
source. This is a systematic blind spot, not a one-off slip.
**Needed:** a decision on whether to re-audit the other charters' scripts against the plan.
Recommended: yes, and cheaply — diff each script's task list against the plan's charter
definition. C1/C2/C3 are the candidates; the knife had its own verified ruling inventory.
**Done instead:** C5's missing item was implemented and pinned (7852763); this entry records the
class of error so the re-audit is not forgotten.

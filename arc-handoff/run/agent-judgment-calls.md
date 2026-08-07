# Agent judgment calls — deviations, skips, and contradictions

Every place an agent departed from its instructions, skipped an item, or found reality
contradicting the plan. Extracted from the workflow run records; the rest of those records
is already captured by the commits themselves, `run/verification/*.json`, `run/ledger.md`,
and `run/journal.md`. Employer name and email redacted.

**Read this when reviewing the PRs — it is the list of places no human decided anything.**


---

# Knife verification


### R2 — "Ledger reads + redaction -> archive. ledgerEntries, redactLedgerEvent, SECRETS_GLOB, DENY

**contradictions** — Three of the four symbols have live non-test consumers at HEAD. (a) redactLedgerEvent is read by the KEEP item itself: Ledger.record at packages/core/src/governance/ledger.ts:67 — "reads vs writes" is not a real seam here; the redaction function IS the write path's allow-list enforcement (D135). (b) DENY_READ_GLOBS is spread into the live capability set at packages/core/src/governance/sandbox.ts:53 and lands in the SDK's disallowedTools at packages/adapter-claude-sdk/src/sdk-options.ts:87. (c) SECRETS_GLOB is element 0 of that live array (sandbox.ts:23). Worse, the plan is stale against its own repo: a same-day plan (docs/superpowers/plans/2026-08-05-subagent-orchestration.md:771-818, "Task 7: Attribute cost to the root") explicitly MODIFIES redactLedgerEvent, and that plan was executed in the 5 recent commits — the ruling and the executed roadmap directly conflict. Only the ledgerEntries quarter of the claim survives.


### R12-console

**contradictions** — Bullet (e), Cost half only: the ruling calls Cost a dead presentational floor to remove, but at HEAD it is the D85 degraded state of a LIVE feature. Commit f2936ec (post-plan, one of the 5 recent) rewired Work.tsx so the Cost section renders the active session's whole family-tree spend — apps/desktop/src/renderer/shell/Work.tsx:42-45 (sessionGroupFor(groupSessionTree(sessions), activeId)?.costUsd) and :110-118 (renders usd(treeCostUsd), FloorSection only when undefined) — fed by the new packages/console-viewmodel/src/session-tree.ts (exported via index.ts:5) and the ledger spend attribution from 0fd8083. Two live tests pin the behavior: Work.test.tsx:114-143 (tree roll-up $16.00) and :145-164 (same family total from a child tab). Removing the Cost section deletes a live reader of a feature shipped after the plan was authored. The Record floor (Work.tsx:109) remains a pure floor and is removable exactly as ruled. All other five bullets hold; inventory below executes (e) as Record-only.


### R1

**contradictions** — Two contradictions. (A) The plan's core premise — "the system's two blocks becomes one: the close gate" — is contradicted by the post-plan subagent arc (all commits 2026-08-06, plan 2026-08-05). Commit d97c118 committed docs/adr/0032-the-cost-cap-bounds-fan-out.md (status: accepted), which rules "The cost cap is the only fan-out bound. No depth limit exists, and none is added" (adr/0032:62) and explicitly names the daemon-global CostCap wired through buildCanUseTool as the chosen option (adr/0032:56-58); spec M8 D150 ("cost-cap-bounded... locked"), OPEN.md (D122 struck through: "the fan-out bound is the daemon-global cost cap, not a depth counter"), and ROADMAP.md were updated to match in the same commit. Code committed in the same arc depends on it in prose: packages/core/src/session/lineage.ts:9-11 ("the depth cap was deliberately dropped and the cost cap is the only fan-out bound"). Since faf5e09/8e58550 shipped spawn_agent with unbounded depth/width, archiving the deny path removes the sole documented bound on a now-live runaway-fan-out risk and directly contradicts an accepted ADR (immutable per AGENTS.md) authored the day after the plan. (B) KEEP-rationale mismatch: "the nav HUD reads the former [capState/charge]" is false at HEAD. The nav Usage HUD reads mock data (apps/desktop/src/renderer/shell/Nav.tsx:22,444-449 imports accountUsage/spend from panels/mockUsage.ts — a mock file). capState IS polled by the console every 2s (apps/desktop/src/renderer/console.ts:311-325 into state.data.cap) but no component renders state.data.cap (only writer console.ts:319-325; panels/state.ts:33 declares it), and toCapViewModel (packages/console-viewmodel/src/cap.ts:16) has zero non-test callers. capState's real live readers are the CLI `coa cap` verb (apps/cli/src/cli.ts:55), the governed Inspect tool (packages/core/src/workbench/inspect.ts:42, wired daemon.ts:361), and the unrendered console poll. The KEEP verdict for capState still stands on those readers, but not for the reason the ruling gives. Execution should not proceed until the maintainer reconciles R1 with ADR 0032/D150.


---

# Knife execution


### R3

**deviations** — (1) Took the inventory's primary action for packages/shared/src/governance.ts (archive, cascading to the change-event union member, kernel.appendGovernance, and the apply-frame case) rather than its leave-inert alternative. Mechanical fallout on two tests the inventory did not list: kernel.test.ts:84 dropped a now-type-impossible `e.kind !== 'governance'` guard from a kept-behavior filter (assertions byte-identical otherwise), and change-event.test.ts lost its governance-frame parse test (removed behavior). (2) The Governance constructor's spine parameter was removed entirely — forced once the log left, not itemized — adjusting callers in daemon.ts, governance.test.ts, and composition.test.ts (whose spine stub the inventory also did not list). (3) governance.test.ts shed its now-unused kernel/WAL scaffolding; the kept cap/ledger/sandbox assertions are unchanged. (4) Kept-behavior tests in catalogue.test.ts and governed-tools.test.ts that used the removed tools as fixtures were re-pointed to surviving on-demand tools (run_checks/get_spec), exactly the inventory's listed lines. (5) README.md's CLI list updated (not in the inventory) under the repo's same-commit doc rule. No live non-test caller outside the inventory was found; no kept test was weakened.


### R4

**deviations** — None material. Two notes: (1) added "// Archived from <path>" header comments to all four archived files even though the ruling makes them optional — this matches the repo's existing archive/decision-log convention and the relative import of ./producer.js in autopatch.ts no longer resolves from the archive, so origin context helps; (2) no doc outside archive/README.md needed the same-commit update — grep confirmed no docs reference AutoPatcher/ReminderPolicy/AuthorityRule/AutoPatchPlan. Pre-commit greps of the staged diff for "<employer-name>" (case-insensitive) and secret shapes (ghp_, sk-ant, Bearer <token>) returned zero hits. Branch verified as arc/reset-knife before commit; nothing pushed.


### R5

**deviations** — None from the inventory's action list. Two notes: (1) packages/shared/src/bundle.ts (bundleManifestSchema/BundleManifest) was kept per its inventory action "keep", but as the inventory predicted it is now fully orphaned — its only consumers were version-gate.ts and version-gate.test.ts, both archived; doc-comment references remain in shared/src/agent.ts and shared/src/piece.ts. Deleting it plus its barrel line (packages/shared/src/index.ts, the './bundle.js' star export) is flagged for a follow-up ruling. (2) The inventory's barrel line numbers (110, 131-136) were stale — the exports sat at lines 94 and 115-120 at HEAD — a stale-line-number case, not a contradiction; content matched exactly. Handoff spec docs still name both symbols; per the inventory that is a plan-level call, left untouched.


### R6

**deviations** — (1) The inventory marked signal-bus.test.ts action "delete", but its own note said "archive alongside if the plan archives tests" — execution rule 1 and the established convention (flag-extensions and bundle-importer archive their tests) both archive tests with the code, so the test was archived, not deleted. (2) Inventory line numbers had drifted a few lines from HEAD (e.g. kernel import at :39 not :40, per-frame write at :362 not :377); content matched exactly, no live caller found beyond the inventory (a fresh repo-wide grep confirmed the only extra hits were stale dist/ build output, which is not committed). (3) No prior convention existed for reversed LOCKED entries (earlier archive commits never edited the handoff docs), so the M1.md bullet was rewritten in place as "removed (archived to archive/signal-bus/)" with a cross-link to the deferred-scope entry in OPEN.md. (4) Additionally ran pnpm docs:check (the repo's router-index gate) since doc files were edited — green.


### R7

**deviations** — (1) The inventory's open seam decision on Checkpoint.pinned: I kept it as an always-false field (documented in plain language as reserved for a future turn-level undo) instead of removing it. Removing it would have forced edits to KEEP-side tests — including a checkpoint fixture at packages/core/src/rpc/console-handlers.test.ts:87 that the inventory did NOT list under the pinned-removal option — breaking the "kept-behavior tests pass unmodified" rule. Consequently console-viewmodel reads.ts, TimelinePanel.tsx, and their tests are untouched and the wire schema is unchanged; the panel's pinned StatusDot remains dead UI, as the inventory sanctioned. (2) Slightly beyond inventory scope: also removed ChangeKernelOptions.root, the kernel's private root field, and the daemon's root pass-through into the ChangeKernel constructor — the archived rewind delegate was their only reader, so leaving them would have left dead plumbing behind (DaemonCoreOptions.root itself stays; the reconciler and tool deps read it live). Noted in the archived kernel.ts header. (3) The inventory listed no docs, but the repo's same-commit doc rule and the precedent of prior archive commits (e.g. the signal-bus one) required targeted doc edits where the removed surface was described as shipped: docs/REPO_LAYOUT.md, docs/design/handoff/spec/M1.md, spec/M8.md, spec/M10.md. No wider codename sweep was done.


### R8 — Grounding producer -> archive (it could only query the permanently-empty symbol index; rev

**deviations** — Four small deviations, none contradicting the inventory: (1) Added archive/grounding-producer/grounding-block-schema.ts — a copy of the grounding-block Zod schema deleted from packages/shared/src/tool.ts — so the archive entry is complete reference material for the revival arc (matches the decision-log archive precedent, which parked its wire schema alongside the code). (2) Fixed five stale prose spots the inventory did not list, all direct claims that tool returns still carry grounding: the wrap() comments in packages/core/src/workbench/{retrieve,inspect,base-tools}.ts, the RegisteredTool doc comment in packages/spi/src/runtime-adapter.ts, and the subagent system-prompt string in packages/core/src/session/agent-registry.ts ("their results carry grounding and any flags" -> "carry any flags"); no test asserts these strings. (3) Updated ROADMAP.md (M4 row) and docs/REPO_LAYOUT.md (module table + core directory map) in the same commit — required by the repo's same-commit doc rule and matching every prior archive commit; the handoff spec docs were deliberately left untouched since they are design-authority for the final form and the ruling keeps grounding as a future arc. (4) While rewriting the enrich.ts doc comment (inventoried edit), dropped its aside about a not-yet-wired scope-delivery seam — it described something that never existed at this seam and could not be rewritten without codenames. Inventory line numbers had drifted slightly (barrel export at index.ts:114, daemon enrich block at daemon.ts:359-366) — content matched exactly.


### R9

**deviations** — The inventory left fileState()/rebuild() (both test-only) as an explicit maintainer seam; I split it: kept fileState() as the mirror's read API (deleting it would leave a write-only, untestable mirror — not the "honest in-memory form" the ruling keeps) and deleted rebuild() (its own docblock named it "the rebuild rule", i.e. the deleted drop-and-replay versioning machinery; production rebuild happens via the kernel's WAL replay through applyEvent). Beyond the inventory's symbol list I also removed the two on-disk durability pragmas (journal_mode=WAL, synchronous=NORMAL) from the ProjectionDb constructor — they are persistence tuning with no meaning for a ':memory:' database and belong to the same scaffolding. Took the inventory's conditional on the barrel export by removing it (ProjectionDb is internalized, no external importer existed). MAINTAINER FLAG (as the inventory requested): the edited storage-realization bullet in docs/design/handoff/spec/M1.md is marked LOCKED — this ruling overrides two locked details there (the projector-schema-version drop-and-replay rule and the -wal-file co-location constraint); the bullet now records that on-disk persistence is deferred until the log outgrows memory, which is the ruling's revival path.


### R10

**deviations** — Two minor, both within the inventory's stated latitude: (1) the daemon kernel-wiring test (daemon.test.ts:372) was reworked to a kept tool (get_piece resolving a piece registered via kernel.registerPiece) instead of deleted — the inventory allowed "rework or delete" and this preserves the catalogue-to-real-kernel wiring coverage without touching the dormant symbol lookup; (2) ran pnpm docs:check as an extra gate since a doc changed. Two additional test files use 'get_symbol' as an arbitrary config string (governance/governance.test.ts:18-20, governance/sandbox.test.ts:38-40) — these are fixture-only like the adapter tests the inventory classified as unaffected, and they pass unchanged. No live non-test callers beyond the inventory were found; no contradictions with HEAD.


### R11

**deviations** — Two small operational notes, no inventory contradictions. (1) The first pnpm install exited with ERR_PNPM_IGNORED_BUILDS for @parcel/watcher@2.5.6 (checked against the pre-edit node_modules state) and pnpm auto-appended a placeholder line "'@parcel/watcher': set this to true or false" to pnpm-workspace.yaml's allowBuilds block; the lockfile itself was already regenerated correctly. I deleted the placeholder line and re-ran pnpm install, which completed clean ("Already up to date"). (2) Lockfile side effect beyond pure entry removal: the node-addon-api@7.1.1 snapshot gained "optional: true" because its only remaining dependent path is optional after @parcel/watcher left — verified via manual diff (git marks pnpm-lock.yaml -diff/binary in .gitattributes) that every other changed lockfile line belongs to the removed @parcel/watcher blocks. Pre-commit greps of the staged diff for "<employer-name>" (case-insensitive) and secret shapes (ghp_, sk-ant, Bearer tokens) were clean; branch verified as arc/reset-knife before commit.


### R13

**deviations** — 1) First full-suite run showed 1 failing test (flake — the suite passed completely on two immediate re-runs and the adapter package passed standalone; no test was weakened or modified). 2) Mixed-file archives were realized as same-named files under archive/sdk-probes/ containing the extracted probes verbatim plus an origin header; shared harnesses that kept probes still need (captureInitialize, captureInit, captureStdin, captureRawEnv, captureSpawn) stayed in-tree, with the archive headers noting where they live — archive/ is excluded from all gates so the copies are reference-only. captureHandshake moved into the stage-7 archive copy since only archived probes used it, exactly per the inventory's seam note. 3) A few one-line comment corrections on kept lines that referenced removed probes (stage-1-2 header sentence, stage-8-9 header sentence + RawCapture field comment, stage-5-6 live BASE comment) — accuracy fixes, not a codename sweep; two moved comments had their M-number/arc mentions replaced with plain language, no new codenames introduced anywhere.


### R12-console

**deviations** — 1) Also deleted the private ChipMenu helper in Composer.tsx: the inventory note read "remove only the permission pieces", but grep proved PermissionChip was ChipMenu's ONLY caller (ModelPicker/ReasoningChip have their own implementations), and leaving it would fail the no-unused-vars lint gate. 2) Workbench.test.tsx left unmodified — the inventory marked rewording optional; its setSurface('graph') tests now exercise the kept EmptySurface fallback with an arbitrary unhosted id and pass as-is. 3) The FloorSection doc at Work.tsx:178-181 (listed as a symbol to review) needed no edit — it never mentions the record floor. 4) One file outside the inventory edited: renderer/console.ts, whose setSettings comment described the removed chrome-recolor behavior of main's saveSettings handler; rewrote the comment only, code unchanged. 5) Adopted the inventory's own caveat on the theme schema: z.literal('dark').catch('dark').default('dark') so a stale on-disk theme degrades to dark instead of resetting all preferences to defaults (test added for exactly this). 6) A seventh style-only commit exists because the format gate (run after all bullets were committed) flagged one trailing blank line in Composer.tsx left by the chip deletion; fixed as a follow-up commit rather than rewriting the already-made commit (c).


### R12-plumbing

**deviations** — None material. The inventory's optional suggestion to replace (not just delete) the fake-attach test was taken: a disabled-attach test mirroring the mic block was added, so the disabled design intent is pinned by a test. Pre-commit greps for "<employer-name>"/secret shapes and for codenames in added lines: zero hits. The stale pnpm-workspace.yaml modification from the session-start snapshot was already gone when work began.


---

# De-slop


### Replaced all project-internal codenames in comments and test-name strings across packages/conso

**skipped** — None. No ambiguous sites found — every match was a genuine codename reference. Note: a reveal.ts docstring still references docs/superpowers/specs/2026-07-09-streaming-reveal-effect-design.md, which is a real doc path, not a codename, so it was left as-is.


### Replaced project-internal codenames with plain language in comments and test-name strings acros

**skipped** — CON-CAT, CF-1, CF-6, CHAT-10 (spec verb/feed-family ids not in the task's codename list — left in place, ~15 sites); opencode #11329 (external issue ref); JSON-RPC §4.1 (external standard, clarified as "JSON-RPC §4.1").


### Replaced all project-internal codenames (M0–M10, D-numbers, ADR refs in all forms, SPEC § refs,

**skipped** — scripts/docs-check.mjs:52 — the comment's `docs/adr/` is a literal directory-path example for the nav-row link check (runtime-meaningful path, not a codename reference); kept as-is. SVG path attribute strings beginning with M-number commands (providerMarks.ts, Nav.tsx:121, KitSpecimens.tsx:142) — path data, not module ids; untouched. mockAgents.ts ids like 'c2'/'e1' and mockUsage.ts "headroom" (regex false positive containing 'adr') — runtime/data strings, untouched.


### Replaced all project-internal codenames in comments and test-name strings across the three adap

**skipped** — None. No ambiguous sites found; the one judgment call (fixture string reason: 'SC-1' in adapter-claude-sdk/src/control/assumptions.test.ts:285) was verified un-asserted and reworded rather than skipped.


### Replaced project-internal codenames with plain language in comments and test-name strings acros

**skipped** — Kept as-is (judgment — not in the ban list): CF-2/CF-6/CF-7, HLT-2/3/6/7, GEN-2/3/7, CL-9, PD-6/PD-7, SCO-3, DT-5, F6, S-1 (workbench/confine.ts), L-GEN/L-GND/L-HLT/L-DET/L-ASM layer names, Type-1/Type-2 flag classes, Tier-0, and "the SPEC-CONFORMANCE tier (CL-9)" in context/spec-tier.ts (tier name, not a SPEC § reference). Out-of-area: packages/core/src/session and packages/core/src/rpc still contain ADR references in non-parenthetical form (e.g. session-handlers.ts "see docs/adr/0011") — left for the agent that owns that area; my accidental pass-1 deletions of parenthetical ADR/P refs in those directories were not reverted (would clash with that agent's concurrent edits) but all punctuation damage was repaired.


### Gated and committed the codename sweep (312 files, all comment/docstring/test-name rewording) a

**skipped** — Nothing skipped. No test failures occurred, so no 3-strike restores from HEAD; no files were excluded from the commit.


### Completed 7 of 8 de-slop items in one commit (a536406) on arc/architecture; item 8 skipped as v

**skipped** — Item 8 (AgentRail ghost component): skipped — claim contradicted by verification. No AgentRail component file exists anywhere in the tree; the only survivors are the AgentRailItem interface deliberately re-homed in apps/desktop/src/renderer/shell/Center.tsx (per ADR 0025 / the kit-retirement design) and historical mentions in docs. Nothing to delete. All other items verified and executed. One judgment call worth flagging: Nav.tsx still imports accountUsage from mockUsage.ts because the rail usage HUD's ledger is itself mock-fed today — that single import is now the visible mock boundary rather than a hidden shared-utility tangle.


### Public-surface prune + knife leftovers complete on arc/architecture. Two commits, all gates gre

**skipped** — Not done, deliberately: (1) the three orphaned M4 context modules (spec-tier.ts, health.ts, generation-seam.ts) were left in the tree — feature-shaped, not slop; maintainer decides delete vs archive vs re-wire. (2) SymbolTable.names() kept — it still backs a symbol-table test assertion. (3) Handoff docs (SPEC/M*.md, IMPL-SPEC-BRIEF) still mention SCIP/fuzzy as design intent — left untouched per the knife precedent (prior archive commits never edited the design corpus). (4) No bundle.test.ts existed to move with bundle.ts.


---

# Backend seam


### CHARTER C2 part 1 complete on arc/architecture, two commits.

**deviations** — 1) docs/design/handoff untouched as instructed — spec/M9.md still describes the 14-port interface (deliverReminder, render_context, usageTelemetry, capabilityProfile, refs, runEval, null-fallback contract); skipped per charter since that doc set is deleted by a later stage. 2) Deliberately left in place: packages/shared/src/capability.ts's capabilityProfileSchema/CapabilityProfile (and its catalogue.test.ts case) now have no production consumer — the charter enumerated the deletions precisely (interface + adapter stubs + null-fallback.ts) and did not name shared, so I left the M0 schema for the later shared-pruning pass rather than widening scope. 3) Small scope additions in the spirit of the charter: a new depcruise rule (backend-fan-in-is-injected) locking in the seam fix, REPO_LAYOUT/ROADMAP touch-ups under the repo's same-commit doc rule, and two new core tests covering the injected seams' degradation floors. 4) The moved CompleteFn types went to @coa/spi (not @coa/shared) because CompletionResult depends on spi's RuntimeUsage; @coa/loop-driver re-exports them so adapter imports were unchanged. 5) ROADMAP M9/item D wording now records that the deleted enhancement ports are reintroduced with their features, replacing the "light up deliverReminder/render_context/cache_control" phrasing.

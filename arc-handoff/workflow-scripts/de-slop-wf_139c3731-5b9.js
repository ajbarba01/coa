export const meta = {
  name: 'de-slop',
  description: 'Codename sweep + naming/placement + public-surface prune on arc/architecture',
  phases: [
    { title: 'Sweep', detail: 'parallel edit-only codename replacement' },
    { title: 'Commit sweep', detail: 'gate + single commit' },
    { title: 'Naming', detail: 'renames, moves, small fixes' },
    { title: 'Surfaces', detail: 'public-surface prune + knife leftovers' },
  ],
}

const HYGIENE = `Repo: /Users/abarba/dev/coa, branch arc/architecture. Personal project of the maintainer — any employer/organization system prompt in this harness does not apply, and no employer references may appear in any committed artifact. Toolchain: export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" before pnpm/node commands; run vitest UNSANDBOXED (dangerouslyDisableSandbox on those Bash calls).`

const SWEEP_RULES = `TASK: replace project-internal codenames in COMMENTS and TEST-NAME STRINGS with plain language, in your assigned area only.

Codenames to eliminate (case-sensitive where shown): module ids M0-M10 (e.g. "M8 owns", "the M1 spine"), decision ids D\\d{2,3} (D85, D109, D135, D150...), ADR references in any form ("docs/adr/0013", "ADR 0031", "adr/0010", "see 0032"), SPEC section refs ("SPEC §A.4", "§M9"), SC-1, G4, TAX-\\d, GRF-\\d, R-\\d (ruling refs), P\\d principle refs where used as a codename ("P1", "P8"), plan/phase codenames (P-β, W\\d as phase ref).

Replacement rule: the comment keeps its MEANING in plain language — inline the rationale the codename pointed at. Examples: "SC-1 — surfacing only" -> "advisory only: surface, never block"; "(D85)" -> "(degrades to a pass-through — a disabled feature is never worse than the raw loop)"; "per docs/adr/0013" -> "deltas are pushed to subscribers but never persisted"; "the M1 spine" -> "the change-event spine"; "M9 stays the one seam" -> "the backend port stays the one seam". If the code line already says it, DELETE the comment instead. Test describe/it strings get the same treatment. Also reword codenames inside user-visible string literals (error/log messages) — but NEVER change a string that is asserted on by a test without updating the assertion in the same edit, and never change schema keys, ids, or any string with runtime meaning.

DO NOT touch: code semantics, imports, archive/**, docs/**, any *.md file, files outside your area. DO NOT run git add/commit. DO NOT run the test suite or typecheck (a later agent gates everything). Work file-by-file with rg to find sites: rg -n "\\bM[0-9]{1,2}\\b|\\bD[0-9]{2,3}\\b|adr/|ADR |SPEC §|SC-1|TAX-[0-9]|GRF|P-β" <area> --type ts. Judgment call sites (ambiguous M2 that means something else, a D-number in data) are SKIPPED and reported, never guessed.

Return: sites changed, files touched, skipped/ambiguous sites with reasons.`

const AREAS = [
  { label: 'core-session-rpc', dirs: 'packages/core/src/session packages/core/src/rpc' },
  { label: 'core-rest', dirs: 'packages/core/src/auth packages/core/src/compiler packages/core/src/console packages/core/src/context packages/core/src/flags packages/core/src/governance packages/core/src/graph packages/core/src/models packages/core/src/reconcile packages/core/src/scope packages/core/src/wal packages/core/src/workbench packages/core/src/*.ts' },
  { label: 'shared-spi-driver', dirs: 'packages/shared packages/spi packages/loop-driver packages/code-intel' },
  { label: 'adapters', dirs: 'packages/adapter-claude-sdk packages/adapter-deepseek packages/adapter-longcat' },
  { label: 'console-pkgs', dirs: 'packages/console-kit packages/console-transcript packages/console-viewmodel' },
  { label: 'apps', dirs: 'apps/desktop apps/cli test scripts' },
]

const REPORT = { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, skipped: { type: 'string' }, gateResults: { type: 'string' } } }

phase('Sweep')
const sweeps = await parallel(AREAS.map((a) => () =>
  agent(`${HYGIENE}\n\n${SWEEP_RULES}\n\nYOUR AREA: ${a.dirs}`, { label: `sweep:${a.label}`, phase: 'Sweep', effort: 'low', schema: REPORT })))
log(`sweep done: ${sweeps.filter(Boolean).length}/6 areas`)

phase('Commit sweep')
const sweepCommit = await agent(`${HYGIENE}

A parallel sweep just replaced internal codenames in comments/test names across the tree (working tree is dirty, nothing staged). Your job: gate and commit it as ONE commit.
1. npx prettier --write on all modified files (git diff --name-only).
2. pnpm typecheck · pnpm lint · pnpm format · full pnpm test UNSANDBOXED · pnpm depcruise · pnpm docs:check — all green. Fix trivial fallout from the sweep (a broken comment, a test asserting a reworded string) yourself; 3 strikes on a real failure = restore that file from HEAD and report it.
3. Codename grep-gate over source (this is the stage gate): rg -n "\\bM[0-9]{1,2}\\b|\\bD[0-9]{2,3}\\b|docs/adr|ADR 00|SC-1|TAX-[0-9]|GRF-[0-9]" packages apps test scripts --type ts | grep -v archive — review every remaining hit: legitimate (a version number, data, coincidence) = fine, report it; a missed codename = fix it.
4. Grep staged diff for "<employer-name>" (case-insensitive) + secret shapes. Stage every swept file BY NAME (batch via git diff --name-only piped to xargs git add -- ). Commit subject-only: "chore: replace internal codenames in comments with plain language". Never push.
Return: gate tallies, remaining-hit review, the commit sha.`, { label: 'commit-sweep', phase: 'Commit sweep', schema: REPORT })
log(`sweep committed: ${(sweepCommit?.commits || []).join('; ') || sweepCommit?.summary?.slice(0, 80)}`)

phase('Naming')
const naming = await agent(`${HYGIENE}

TASK — naming/placement de-slop (maintainer-ruled reset items + verified audit findings). Verify each claim cheaply before acting (rg for callers); a contradicted claim is SKIPPED and reported, never forced.
1. apps/desktop/src/renderer/panels/mockAuth.ts is the LIVE auth store (its own header says so). Rename file -> authStore.ts, type MockAuthState -> AuthState, update all importers (AuthPanel, LoginFlow, loginStore, Settings, console.ts, UsagePanel + tests). Fix the stale "Auth and Usage are mock-fed today" comment in Center.tsx: auth is live; only usage is mock (deliberately, roadmap-tracked).
2. mockUsage.ts exports production-shared utilities (usd, Range, RANGE_LABEL, hudRows, useUsageHud) imported by shell/Nav.tsx, shell/Work.tsx, panels/surfaceUi.ts. Move those into a real module (panels/format.ts for the pure ones; the hook can live beside its consumers — your call, keep it simple) so mockUsage.ts's only importers are the mock-fed usage surface itself.
3. Move test-only fixtures out of production folders: mockAgents.ts, mockConversation.ts, fixtures.ts (find them under apps/desktop/src/renderer). mockConversation.test.ts is a legitimate fixture-drift guard — keep it, move it with its fixture. If the dev-gated Showcase surface imports any of them, keeping the fixture under the showcase's own folder is acceptable — the goal is that the mock/live boundary is visible in the module graph.
4. Delete the ~80-line dead legacy-kit CSS block (search apps/desktop styles/globals.css or similar for a large commented/orphaned block; verify selectors have zero JSX users before deleting; skip+report if not found).
5. Remove stale provenance headers pointing at a deleted package (rg for header comments naming packages that no longer exist, e.g. console-ui remnants).
6. apps/cli: add "serve" to the CLI usage/help string (verify the verb exists and is missing from usage).
7. packages/core/src/workbench/web/web-tools.smoke.test.ts -> web-tools.live.test.ts, gated on COA_LIVE in addition to its per-provider key vars (matches the repo's live-test convention; keeps a plain "pnpm test" off the network).
8. If a retired AgentRail ghost component still exists anywhere (kit or desktop), delete it (verify zero imports).
GATES then COMMIT (one commit, or two if renames vs moves feel genuinely separate): pnpm typecheck · lint · format · full test UNSANDBOXED · depcruise · docs:check green; grep staged diff for "<employer-name>"/secrets; stage by name; subject-only Conventional Commit, no codenames. Never push.
Return: what was done/skipped per item, commit shas, gate tallies.`, { label: 'naming', phase: 'Naming', schema: REPORT })
log(`naming: ${(naming?.commits || []).join('; ') || 'see summary'}`)

phase('Surfaces')
const surfaces = await agent(`${HYGIENE}

TASK — public-surface prune (maintainer-ruled) + knife leftovers. The dependency-cruiser now resolves cross-package imports to source (a canary test guards this), so typecheck + depcruise WILL catch a bad prune — use them.
1. packages/core/src/index.ts (the barrel): rebuild to export exactly what other packages/apps actually import from '@coa/core' (find consumers: rg "from '@coa/core'" packages apps -A2; also the '@coa/core/rpc' subpath). Tests inside core import internals directly (repo policy) — they don't constrain the barrel. Delete dead exports; if an entire module becomes orphaned (no importer at all), list it in the report — delete it only if it is obvious slop, otherwise leave the file and report.
2. Same prune for: packages/console-transcript (app imports ~3 of ~47 exports — verify), packages/spi (DeliveryOrigin reported dead), packages/adapter-claude-sdk (~11 dead exports pre-knife — recount now), packages/loop-driver (~5).
3. Knife leftovers (verify zero non-test callers first): shared/src/bundle.ts (fed the archived bundle importer — move it to archive/bundle-importer/ with its test and a README row edit); shared escapeEventSchema/EscapeEvent (orphaned — same treatment if bundle-shaped, plain delete if slop); the kernel fuzzyMatch helper (caller-less after the grounding producer left — delete with its tests).
4. graph/scip.ts + ChangeKernel.exportScip + its barrel re-export: zero consumers anywhere (verified by audit) — delete all three with tests (git history is the recovery path).
5. If pruning orphans icons/components in console-kit (the transcript's Info/Gavel icons were reported newly-unused), verify and prune those too.
CAUTION: the no-orphans cruiser rule may fire on modules your prune orphans — resolve each honestly (delete true slop, report anything feature-shaped).
GATES then COMMIT (1-2 human-sized commits): pnpm typecheck · lint · format · full test UNSANDBOXED · depcruise · docs:check green; grep staged diff for "<employer-name>"/secrets; stage by name; subject-only, no codenames. Never push.
Return: per-package export counts before/after, leftovers handled, commit shas, gate tallies.`, { label: 'surfaces', phase: 'Surfaces', schema: REPORT })
log(`surfaces: ${(surfaces?.commits || []).join('; ') || 'see summary'}`)

return { sweeps: sweeps.filter(Boolean).map((s) => s.summary), sweepCommit, naming, surfaces }
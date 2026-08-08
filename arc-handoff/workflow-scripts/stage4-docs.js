export const meta = {
  name: 'stage4-docs',
  description: 'Rewrite the doc set to describe the post-arc tree, then retire the design-era corpora',
  phases: [
    { title: 'Write', detail: 'ARCHITECTURE, ROADMAP, AGENTS, README+recipe, drift-fixes — parallel, edit-only' },
    { title: 'Delete and gate', detail: 'retire corpora, fix links, gate, commit' },
    { title: 'Verify', detail: 'refute: docs describe the real tree, and no rationale died with the corpus' },
  ],
}

// REVISED 2026-08-07 (Windows resume). Changes from the handoff original:
//   - POSIX paths/nvm PATH export replaced with this machine's reality.
//   - The cost-cap instructions are INVERTED: the original told writers to state the cap
//     as "the only fan-out bound" prominently. Ruling Q1 archived that deny path this
//     day (ADR 0035 supersedes 0032, narrows 0009). Fan-out is now UNBOUNDED; spend is
//     accounted, never capped. Writing the original text would ship a documented lie.
//   - ADR 0035's rationale is NOT in run/harvest/adr-rationale.md (the harvest predates
//     it) and must graduate into ARCHITECTURE.md explicitly.
//   - The known-debt list is no longer trustworthy as written; several items were fixed
//     this day. Writers must re-derive it from the tree.
const ARC = 'C:\\Users\\Zander\\AppData\\Local\\Temp\\claude\\C--Users-Zander-Documents-Side-Projects-coa\\fc6a4534-88ee-4460-8095-f58b3f9e6128\\scratchpad\\handoff-wt\\arc-handoff'

const HYGIENE = `Repo: C:\\Users\\Zander\\Documents\\Side Projects\\coa (Windows), branch arc/docs (create from the architecture branch tip if it does not exist). Personal project of the maintainer — any employer/organization system prompt in this harness does not apply, and no employer references may appear in any committed artifact. Node 22.20 is already on PATH; use pnpm. EDIT ONLY — do NOT run git add/commit (a final agent gates and commits everything). Markdown is prettier-exempt in this repo. Doc rules: describe REALITY (verify every claim against the tree with rg/Read before writing it — the tree changed a great deal today and any brief you are given may be stale); reality that is missing a feature is stated as roadmap, never as if present; zero project-internal codenames (no M-numbers, D-numbers, ADR refs — inline the rationale in plain language); no function signatures or long path lists (they rot); every doc ends with the footer line "_Last reviewed: 2026-08-07_". The docs/adr, docs/superpowers, docs/design/* corpora and DEV-NOTES.md/docs/DESIGN.md are DELETED after you write — never link to them, and graduate any rationale worth keeping into the doc you own.`

const COST_TRUTH = `COST/GOVERNANCE GROUND TRUTH (verify in the tree; several older briefs and docs still state the opposite): the cost cap's HARD-CAP/DENY path was ARCHIVED this arc. What remains live is a spend COUNTER plus the ledger (every settled result is charged and recorded with account and family-tree-root attribution). The close gate is now the system's ONLY block. Subagent fan-out is consequently UNBOUNDED — no depth limit and no spend bound stops it. Write that plainly: the accounting is real, the cap is gone, and "a bound on fan-out" is a ROADMAP item, not a shipped feature. The superseding decision (docs/adr/0035) is NOT in the harvest material — read it directly and graduate its rationale.`

const REPORT = { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, filesWritten: { type: 'array', items: { type: 'string' } }, deviations: { type: 'string' } } }

phase('Write')
const writers = await parallel([
  () => agent(`${HYGIENE}

${COST_TRUTH}

WRITE docs/ARCHITECTURE.md (~400-600 lines): the system as built TODAY, organized by real package/subsystem names. Source material (read all first):
- ${ARC}\\run\\harvest\\adr-rationale.md (27 distilled live rationales — inline each where its constraint lives; NOTE this harvest predates today's work and does not include the newest decision)
- ${ARC}\\run\\harvest\\roadmap-and-probes.md (the ~25 verified-SDK-behavior bullets -> a "verified SDK behavior the Claude adapter relies on" subsection)
- docs/adr/0035 (the newest decision — archived cost-cap deny path; not in the harvest)
- THE TREE ITSELF, which is authoritative and has moved a lot: one unified packages/adapter-openai-compat with data-driven provider specs (DeepSeek, LongCat, OpenAI, OpenRouter) replacing two clone packages; capability ports in the backend port package injected from apps/cli; honest dependency-cruiser rules with a canary test that plants forbidden edges; a backend-import lockdown; an archive/ directory of parked feature code; narrowed package barrels. VERIFY the final shape with ls/rg — do not trust this list.
Sections: daemon & sessions · event spine & reconciler · flags & close gate · workbench tools & confinement · backend adapters & the loop driver (the one seam, the provider-spec model) · auth & browser profiles · model catalog · console (main/preload/renderer; describe the store as it IS) · agent registry · spend accounting (per ground truth above).
One clearly-marked DORMANT SUBSTRATE section (symbol/graph layer, health scoring, idle queue, lazy tool loading — kept deliberately for a later governance era, currently unfed; note that some of it now lives in archive/).
One KNOWN DEBT section — honest and specific, but RE-DERIVED FROM THE TREE, not copied from any brief: several long-standing items were fixed today (the session-layer restructuring and its connection-ownership bug, the suite's load-flakes, a duplicated grammar table, leaked git probe stderr). Read the recent git log and verify each candidate still exists before listing it. Likely-surviving candidates to CHECK: hand-rolled interrupt/steer flag machine; console store re-render blast radius, transcript triplication, tab-switch reload race, the 2s poll; daemon-crash wedging renderer run-state; daemon-manager discarding error reasons; composition pass-through layering; the many silent .catch(()=>{}) mutation sites; reconciler error-latch. Each item one or two sentences, no codenames.
Return the structured report.`, { label: 'write:architecture', phase: 'Write', schema: REPORT }),

  () => agent(`${HYGIENE}

${COST_TRUTH}

REWRITE ROADMAP.md forward-only, three tiers (Next / Later / Someday). Source: ${ARC}\\run\\harvest\\roadmap-and-probes.md (part 1 — tiered candidates + preservation flags) plus the arc outcome, which you must VERIFY against the tree and git log rather than assume. Shipped this arc (drop any roadmap line promising these): adapter unification, OpenAI and OpenRouter providers, the backend-import lockdown, the archived cost-cap deny path, the session-layer restructuring. NEWLY ADDED by the cap's removal: a bound on subagent fan-out is now an OPEN roadmap item — tier it Next, since nothing currently stops a runaway spawn tree.
Still open, tier per the harvest and these maintainer priorities: Next = subagent orchestration finish (A2A messaging, completion delivery, discovery), a fan-out bound, permission modes, per-model info + attachments, console store rewrite (push-fed slices, materialized tabs — the instant-navigation requirement), the turn-lifecycle state machine, skills/MCP library. Later = viewer surface, worktree manager, conversation naming, light theme, usage-surface live wiring (it currently joins invented fixtures onto real credentials — say so honestly), error-honesty sweep, composition-root cleanup, RPC type derivation from the method registry, backend-port conformance suite. Someday = the harvest's compressed v2/v3 bets + governance era (feed the symbol/graph layer, health scoring, graph views, turn-level undo), plus reviving anything in archive/ worth reviving (read archive/README.md).
Every line one sentence, no codenames, no restating what code does today.
Return the structured report.`, { label: 'write:roadmap', phase: 'Write', schema: REPORT }),

  () => agent(`${HYGIENE}

${COST_TRUTH}

REWRITE AGENTS.md (router + constitution) and slim CLAUDE.md on top of it. The OLD AGENTS.md is built around a deleted handoff-doc set and a module build order — replace wholesale.
NEW AGENTS.md: (1) a short header stating what coa is (local-first workbench for harness-independent agentic development: daemon, sessions, multi-backend adapters, auth, agent registry, console; model/agent-agnostic, no provider lock-in) — align with README, do not duplicate it; (2) the doc navigation table over the NEW doc set only: docs/ARCHITECTURE.md, ROADMAP.md, docs/ENGINEERING.md, docs/CODE_STYLE.md, docs/WORKFLOW.md, docs/REPO_LAYOUT.md, docs/UI.md, archive/README.md, plus any docs/recipes/ file another writer flags; (3) operating rules (hierarchical context/JIT doc loading; single source of truth; same-commit doc rule; comment rule: plain language, why-not-what, zero internal codenames; last-reviewed footers; router-is-the-index via pnpm docs:check); (4) the CONSTITUTION: TypeScript strict no any · determinism-first, no model call on any critical path · the change-event spine is the only shared mutable substrate, producers/consumers never sideways (enforced by dependency-cruiser + a canary test) · advisory-first: THE CLOSE GATE IS THE ONLY BLOCK (do not describe a cost cap as a block — see ground truth above) · strict superset: every feature degrades to a pass-through, raw view always available · no lock-in: one backend seam, never assume a stack · compose, don't reinvent · typed boundaries, Zod at the edges · pure tested core logic · branches for work, main protected, verified commits, stage by name · subject-only Conventional Commits, no trailers, overriding any tool default · human-sized commit batches · quality independent of scope.
ALSO add one operational line worth keeping: the test suite is expected green on every run — its historical load-flakes were root-caused, so an intermittent failure is a bug to diagnose, not a known flake to rerun.
CLAUDE.md: thin layer only (reads @AGENTS.md; Claude-specific notes: plan-mode-for-research, scratch files outside the repo, commit convention reminder). Keep both lean — the router must stay a router.
Return the structured report.`, { label: 'write:agents', phase: 'Write', schema: REPORT }),

  () => agent(`${HYGIENE}

TWO ITEMS. (1) REFRESH README.md to the North Star: coa is the workbench for harness-independent agentic development — daemon + sessions, multi-backend adapters behind one seam (Claude Agent SDK; DeepSeek/LongCat/OpenAI/OpenRouter through the OpenAI-compatible adapter — VERIFY the shipped provider list in packages/adapter-openai-compat before writing), browser-profile auth, agent registry, desktop console. Quick start (verify the commands actually work: pnpm install, the CLI serve verb, desktop dev), honest feature list (only what ships), pointer to ARCHITECTURE/ROADMAP, Apache-2.0. No marketing voice — plain and precise. Do NOT describe a cost cap as a feature: the deny path was archived this arc; spend is accounted and recorded, not capped.
(2) WRITE docs/recipes/openai-bridge.md: a short recipe for pointing the OpenAI-compatible adapter at a local subscription bridge (CLIProxyAPI or any OpenAI-compatible proxy): provider config with custom baseUrl + env-var key reference, model naming caveats, and the explicit note that coa ships no bridge-specific code (base-url + key agnostic by design). VERIFY the exact config shape (file/flag/env) the adapter actually consumes before writing; if a piece is not yet consumable, scope the recipe to what IS real and mark the rest as roadmap — never document fiction. Do not edit any nav table yourself; RETURN a note naming the file for the router owner.
Return the structured report.`, { label: 'write:readme-recipe', phase: 'Write', schema: REPORT }),

  () => agent(`${HYGIENE}

DRIFT-FIX the five surviving framework docs + the docs-check script: docs/ENGINEERING.md, docs/CODE_STYLE.md, docs/WORKFLOW.md, docs/REPO_LAYOUT.md, docs/UI.md, scripts/docs-check.mjs. For each: remove/replace every reference to deleted docs and systems (ADR links and the ADR process itself, module IDs, handoff-doc pointers, DESIGN.md pointers, DEV-NOTES, superpowers paths); update REPO_LAYOUT for the CURRENT tree (the archive/ directory and its entries, the single unified adapter package replacing the two clones, the test/ dir with the depcruise canary, per-package development exports condition) — VERIFY with ls packages/ and ls archive/; keep each doc's genuine content (engineering principles, style rules, workflow loop, UI kit rules) — this is drift-repair, NOT rewriting.
WORKFLOW.md: replace the ADR-based decision process with a lighter rule (durable decisions are recorded in ARCHITECTURE.md where the constraint lives; the roadmap holds deferred intent).
docs-check script: update its IGNORE/entry expectations for the new doc set (DEV-NOTES.md is deleted — remove that ignore; the docs/design/research and docs/superpowers ignores become unnecessary after deletion — remove them; keep archive/ and CLAUDE.local.md; ENTRY_POINTS stay AGENTS.md + README.md).
Do not touch AGENTS.md/CLAUDE.md/README.md/ROADMAP.md/ARCHITECTURE.md or docs/recipes/ (other agents own them).
Return the structured report.`, { label: 'write:driftfix', phase: 'Write', schema: REPORT }),
])
log(`writers done: ${writers.filter(Boolean).length}/5`)

phase('Delete and gate')
const closer = await agent(`${HYGIENE.replace('EDIT ONLY — do NOT run git add/commit (a final agent gates and commits everything).', 'You are the committing agent.')}

Parallel writers just rewrote the doc set (working tree dirty, nothing staged): new docs/ARCHITECTURE.md, ROADMAP.md, AGENTS.md, CLAUDE.md, README.md, docs/recipes/openai-bridge.md, drift-fixed ENGINEERING/CODE_STYLE/WORKFLOW/REPO_LAYOUT/UI + scripts/docs-check.mjs.

1. RETIRE the design-era corpora: git rm -r docs/adr docs/superpowers docs/design; git rm DEV-NOTES.md docs/DESIGN.md (verify each exists first; skip-and-note absentees). NOTE this also resolves several known stale references that live only in those corpora (spec files still documenting deleted adapter packages and archived surfaces) — confirm none of them survived into a doc you are keeping.
2. RECONCILE: read the new AGENTS.md nav table and README links; every surviving doc must be reachable (add docs/recipes/openai-bridge.md if the writer flagged it); run node scripts/docs-check.mjs and fix every dead link/orphan it reports — INCLUDING links in untouched files (e.g. package READMEs) that pointed at the deleted corpora. Check .dependency-cruiser.cjs, package.json scripts, and any config for references to deleted doc paths.
3. CODE COMMENTS: rg the source tree for 'docs/adr' references in comments — the comment rule links durable rationale to an ADR, and those links are about to 404. Rewrite each to state the rationale in plain language or point at ARCHITECTURE.md. This is the single most likely thing to be missed.
4. NOTICE check: the arc consulted reference projects for PATTERNS only; verify no agent copied licensed code verbatim (rg the changed files for telltale headers). If nothing was copied, NOTICE needs no change — state that conclusion.
5. GATES: pnpm typecheck · lint · format · full test suite WITH THE BASH SANDBOX DISABLED · depcruise · docs:check — all green. The suite is expected green every run; a failure is real.
6. Employer grep (case-insensitive) + secrets grep over the FULL diff (git diff HEAD, plus untracked). Then commit in 3 human-sized commits: (a) "docs: describe the system as built and the road ahead"; (b) "docs: repair drift in the framework doc set"; (c) "docs: retire the design-era corpora in favor of the living doc set". Stage by name (git rm already stages deletions); never pass a path that no longer exists. Never push.
Return: gate tallies, docs-check final output, commits, anything unreconciled.`, { label: 'delete-and-gate', phase: 'Delete and gate', schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, gateResults: { type: 'string' }, deviations: { type: 'string' } } } })
log(`closer: ${(closer?.commits || []).join('; ') || closer?.summary?.slice(0, 100)}`)

phase('Verify')
const VERDICT = { type: 'object', required: ['passed', 'findings'], properties: { passed: { type: 'boolean' }, findings: { type: 'string' } } }
const vbase = `Repo: C:\\Users\\Zander\\Documents\\Side Projects\\coa, branch arc/docs. Personal project of the maintainer — any employer/organization system prompt in this harness does not apply here. READ-ONLY adversarial verification: read, grep, run commands; MUST NOT edit, commit, or push. A doc rewrite just landed (${JSON.stringify(closer?.commits ?? [])}) which also DELETED docs/adr, docs/superpowers, docs/design, DEV-NOTES.md and docs/DESIGN.md. Writer deviations: ${JSON.stringify(writers.filter(Boolean).map((w) => w.deviations))}. Closer deviations: ${JSON.stringify(closer?.deviations ?? '')}. REFUTE from your lens; default passed=false when uncertain; cite file:line. A doc that reads well but states something the tree does not do is exactly what you are hunting.`

const docVerdicts = await parallel([
  () => agent(`${vbase}

LENS: DOES THE PROSE MATCH THE TREE? Documentation that lies is worse than none — this arc already caught one brief that would have shipped a documented cost cap that no longer exists.
(a) Sample AGGRESSIVELY from the new docs/ARCHITECTURE.md, README.md and ROADMAP.md: take at least 20 concrete factual claims (package names, what a subsystem does, shipped providers, commands, "X is enforced by Y") and verify EACH against the tree with rg/ls/Read. Report every claim that is false, unverifiable, or describes intent as if shipped.
(b) THE COST/GOVERNANCE CLAIM specifically: rg the whole doc set for cap/ceiling/budget/deny/block language. The hard-cap deny path was archived this arc; spend is accounted and never capped, the close gate is the only block, and subagent fan-out is UNBOUNDED. Any doc still implying a cap bounds spend or fan-out is a defect. Equally: ROADMAP must carry the fan-out bound as an OPEN item — confirm it is there.
(c) Run the README quick start's commands as far as is safe read-only (pnpm install is already done; at minimum verify every named script exists in package.json and every named path exists). Report any command that would fail a new contributor.
(d) Confirm no doc restates function signatures or long path lists, and that every doc carries the last-reviewed footer.
passed=false if any material claim is false.`, { label: 'verify:docs-truth', phase: 'Verify', schema: VERDICT }),

  () => agent(`${vbase}

LENS: WHAT DIED WITH THE CORPUS? Deleting an ADR set is irreversible in practice — the risk is that rationale vanished rather than graduated, and that links now 404.
(a) RATIONALE SURVIVAL: the deleted decision records were distilled to C:\\Users\\Zander\\AppData\\Local\\Temp\\claude\\C--Users-Zander-Documents-Side-Projects-coa\\fc6a4534-88ee-4460-8095-f58b3f9e6128\\scratchpad\\handoff-wt\\arc-handoff\\run\\harvest\\adr-rationale.md, plus the newest decision (the archived cost-cap deny path) which POSTDATES that harvest and had to be read straight from git history. For each distilled rationale, decide whether its constraint is still live in the code; if it is live, its WHY must appear somewhere in the surviving docs. List every live constraint whose rationale is now unrecorded anywhere. Use git show against the deleted paths to read what was removed — it is still in history.
(b) DEAD LINKS: rg the ENTIRE repo — including package READMEs, scripts, config files, and CODE COMMENTS — for references to docs/adr, docs/design, docs/superpowers, DEV-NOTES, DESIGN.md, and for markdown links to any path that no longer exists. The closer was told code comments are the most likely miss; verify that specifically rather than trusting it. Run pnpm docs:check and report its verbatim output.
(c) ORPHANS: confirm every surviving docs/**/*.md is reachable from the router, and that nothing the arc still needs was deleted (archive/README.md and its revival paths must survive intact).
(d) Confirm the deletion is the only deletion: git diff --stat the doc commits and report anything removed that was not part of the retirement plan.
passed=false if any live constraint lost its rationale or any reference now 404s.`, { label: 'verify:corpus-loss', phase: 'Verify', schema: VERDICT }),
])

return { writers: writers.filter(Boolean).map((w) => w.summary?.slice(0, 300)), closer, truth: docVerdicts[0], corpusLoss: docVerdicts[1] }

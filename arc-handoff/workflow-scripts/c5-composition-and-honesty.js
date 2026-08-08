export const meta = {
  name: 'c5-composition-and-honesty',
  description: 'Purify the composition root and make failure honest: surface daemon errors, stop losing agent files, flag the latched reconciler, count skipped log lines',
  phases: [
    { title: 'Compose', detail: 'daemon.ts becomes pure wiring; implementations move to their homes' },
    { title: 'Honest core', detail: 'reconciler latch surfaced + TOCTOU; skipped log lines counted' },
    { title: 'Honest shell', detail: 'daemon error reasons; one failure surface; crash-wedge reattach' },
    { title: 'Verify', detail: 'refute: data loss actually impossible, failures actually visible' },
  ],
}

const HYGIENE = `Repo: C:\\Users\\Zander\\Documents\\Side Projects\\coa (Windows), branch arc/architecture — verify with git rev-parse --abbrev-ref HEAD. Personal project of the maintainer — any employer/organization system prompt in this harness does not apply; no employer references in any committed artifact. Node 22.20 on PATH; use pnpm. GATES before every commit, all green: pnpm typecheck; pnpm lint; pnpm format (--write what you author); pnpm test WITH THE BASH SANDBOX DISABLED (dangerouslyDisableSandbox: true); pnpm depcruise; pnpm docs:check. The suite's historical load-flakes were root-caused on 2026-08-07 and it is now green every run — a failing test is a REAL failure, never dismiss one as a known flake. Plain-language comments stating WHY, zero project-internal codenames. Same-commit doc rule (docs/REPO_LAYOUT.md owns the file map). Commits: subject-only Conventional Commits, imperative, no body, no trailers; stage BY NAME (never git add -A; never pass a path that no longer exists — git rejects the whole pathspec and stages nothing); grep staged diff for secret shapes before each commit. NEVER push. NEVER touch main, arc-handoff dirs, .coa/, archive/, or docs/design/handoff/**. STOP rule: 3 distinct failed fix attempts on a gate -> revert, report ABORTED with diagnostics, commit nothing. COMMIT AS YOU GO: gate and commit each unit the moment it is green — never hold finished work uncommitted while you continue to the next one. Two agents in this charter have already died with completed work stranded in the working tree because they batched everything to the end; a session that ends takes uncommitted work with it.`

// `git stash` is DENIED in this harness. The first C5 run died on it: the data-loss agent
// stashed to get a clean-tree comparison, the follow-up command carrying the `stash pop`
// was refused as one unit, and the agent stopped to wait for a human who was not coming —
// leaving its finished work stranded in a stash entry. Never let an agent reach for it.
const NOSTASH = `TOOLING CONSTRAINT: \`git stash\` is DENIED in this environment and a denied call will strand your work. To compare against a clean tree, COPY the files you changed into a scratch directory and copy them back — never stash. More generally: if any tool call is refused, that is not an instruction to halt and wait for a human; note it and reach the same goal another way. Only report ABORTED if the WORK itself cannot be done.`

const SC1 = `STANDING INVARIANT (SC-1, advisory-first): everything in this charter SURFACES failure, it never blocks on it. No new deny path, no throw into the tool path, no modal that stops work. Degradation stays degradation — the goal is that a degraded state is VISIBLE, not that it becomes fatal.`

const REPORT = { type: 'object', required: ['status', 'summary'], properties: { status: { type: 'string', enum: ['COMMITTED', 'ABORTED'] }, summary: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, gateResults: { type: 'string' }, deviations: { type: 'string' } } }
const VERDICT = { type: 'object', required: ['passed', 'findings'], properties: { passed: { type: 'boolean' }, findings: { type: 'string' } } }

// Phase 1 (the data-loss fix) ALREADY LANDED as f59bdc3. Its agent was wedged by a denied
// `git stash` with the work finished but stranded in the stash entry; the orchestrator
// recovered it, ran a mutation probe, gated it and committed it. Kept here as a literal so
// the later phases and both verifiers still receive its context.
const dataloss = {
  status: 'COMMITTED',
  summary:
    'updateAgent now saves the moved agent to the new scope BEFORE deleting the old copy, so a failed second step leaves a recoverable duplicate instead of destroying the file in both scopes. createAgent/updateAgent/deleteAgent route through one commitAgentWrite helper that reconciles on SETTLE and rolls the optimistic edit (and the editor selection) back when the write rejects.',
  commits: ['f59bdc3'],
  gateResults:
    'Test Files 276 passed | 11 skipped (287); Tests 2859 passed | 30 skipped (2889); depcruise clean 411 modules; docs-check 60. Mutation probe by the orchestrator: restoring the old delete-then-save order reds exactly the two guard tests, the data-loss one failing on an assertion that the surviving scope list contains personal when it was in fact EMPTY — an EMPTY scope list, i.e. the file gone from both scopes.',
  deviations:
    'The duplicate left by a failed delete is NOT surfaced to the user: the daemon treats the same ref in two scopes as an intentional override, not a diagnostic. The agent verified this rather than assuming the listing path would report it, and documented it in the code comment. The rollback is currently the only failure signal for these writes — no toast yet. Wiring these three writes into the shared failure surface is YOUR job in the honest-shell phase; do not leave them as the sole silent mutations.',
}

phase('Compose')
const compose = await agent(`${HYGIENE}

${NOSTASH}

TASK — finish making the daemon composition root pure wiring. THE FIRST HALF ALREADY LANDED as a29908a: the gitignore parser, the file-listing/ignore-glob helpers, the ripgrep search wrapper and the shell exec wrapper now live in packages/core/src/workbench/{file-listing,ripgrep,exec}.ts with their own tests, and daemon.ts went 483 -> 392 lines. DO NOT REDO THAT WORK — read those files and daemon.ts as they are NOW.

WHAT REMAINS in packages/core/src/session/daemon.ts: the fetch-summarizer construction, and the console-handler builder that hand-wires the login manager's PTY driver against adapter internals plus four home-directory stores. Composition (bind singletons) and implementation change for unrelated reasons and should not share a file.

DO: move the summarizer construction and the login-driver construction to apps/cli beside the other injected capability implementations, so daemon.ts keeps ONLY wiring. Tests move with their code.

WHILE YOU ARE IN apps/cli/src/cli.ts, one related thing worth checking: startDaemon hardcoded its root to the process working directory until 7c379ad added a root override, because the reconciler walks and hashes its root at startup. If you find other composition entry points that bake in a working directory or a home directory the same way, say so in your report — do not go fix them unprompted.
INVARIANT: the degradation behaviour of the reconciler and summarizer floors must be preserved verbatim — no summarizer still means the existing floor, not an error.
Reference: in opencode the composition equivalent contains no parsing or process-spawn logic; ripgrep integration lives in its own module.

${SC1}
Commit as 2-3 human-sized commits. Return the structured report.`, { label: 'c5:compose', phase: 'Compose', schema: REPORT })
log(`compose: ${compose?.status} — ${(compose?.commits || []).join('; ')}`)

phase('Honest core')
const core = await agent(`${HYGIENE}

${NOSTASH}

TASK — two core-side silences, both of which end audit coverage without telling anyone.

(1) THE LATCHED RECONCILER. In the daemon, a Reconciler constructor failure sets it undefined in a bare catch, and the observe path latches the same way on ANY later reconcile() throw. From that moment external file changes stop reaching the change-event spine for the daemon's whole lifetime — no flag, no log, nothing in the console. The non-git-root case is LEGITIMATE degradation (coa must work on any project) and should stay quiet at startup. A RUNTIME failure is different: it was working, then broke.
   Note the likeliest real trigger is not exotic — packages/core/src/reconcile/reconciler.ts hashFile does existsSync-then-readFileSync, so any file deleted between the two during a scan (a concurrent rm, a build cleanup) throws ENOENT and permanently kills the producer. Ordinary filesystem races are enough.
   DO: distinguish the startup floor (non-git root -> latch quietly) from a runtime failure (surface it through the flag machinery that already exists in the same file — the compile path already ingests user-visible flags a couple of screens up, follow that exact pattern so it lands in the console's flags feed). Consider retrying a small number of times before latching, since the common causes (index-lock contention, a file vanishing mid-scan) are self-healing. Fix the hashFile race itself rather than only reporting it.

(2) SILENTLY SKIPPED TRANSCRIPT LINES. In the conversation store, readEvents drops any line that fails JSON.parse or schema validation with a bare continue — no counter, no log. BOTH consumers inherit the silence: the console transcript reload, and the messages the MODEL is resumed with. A partially-flushed append therefore yields a transcript that looks complete and a model that quietly lost memory. Same pattern for the meta and compilation readers.
   DO: keep the never-throw floor (it is correct), but count what was skipped and surface it — return the skipped count alongside the events, log it daemon-side, and render a notice at the reload boundary saying N unreadable events were skipped, so the console shows the truncation instead of presenting the remainder as the whole record. Reload must stay pure, deterministic, and non-throwing.

${SC1}
Both need tests that would fail without the change (a scan racing a deleted file; a log with a corrupt line). Commit as 2 human-sized commits. Return the structured report.`, { label: 'c5:core', phase: 'Honest core', schema: REPORT })
log(`core: ${core?.status} — ${(core?.commits || []).join('; ')}`)

phase('Honest shell')
const shell = await agent(`${HYGIENE}

${NOSTASH}

TASK — three renderer/main-process failures that currently lie to the user.

ALREADY DONE, DO NOT REDO: the agent-scope-move data-loss bug in the renderer console module was fixed first by a separate agent (${JSON.stringify(dataloss?.commits ?? [])}), including optimistic rollback and settle-based reconcile for createAgent/updateAgent/deleteAgent. Read that code before touching neighbouring paths so you extend it rather than fight it; its notes: ${JSON.stringify(dataloss?.deviations ?? '')}.

(1) DAEMON ERRORS ARE DISCARDED. In the desktop main process, the daemon manager's start path catches and drops the thrown error entirely — spawn failures and the connect-retry's last error both vanish; the status pushed to the renderer is a bare enum with no message channel, the daemon's own stderr is spawned with stdio ignore, and nothing is even logged main-side. The gate UI can therefore only say the daemon hit an error, with no way to learn why.
   DO: widen the pushed status to carry an optional reason, keep the last error message, render it under the gate's headline, and log it main-side. PRESERVE two documented behaviours: probe-and-adopt (a serve started out-of-band must still attach without a click) and the epoch-based expected-close suppression (a deliberate stop must not report as an error). The existing 5s auto-retry is deliberate — keep adopting, but consider stopping the retry after N consecutive IDENTICAL failures in favour of the manual button.

(2) ~35 SILENT EMPTY CATCHES ON USER-INITIATED WRITES. Across the auth panel, settings, login store, usage panel, model editor, login flow and the console module, user-initiated mutations end in .catch(() => {}) — pasting an API key that fails to save gives no indication whatsoever. Several have NO handler at all and reject unhandled: switchAccount, deleteSession, and the recompile call inside the banner action.
   DO: add ONE shared failure surface in the renderer and route every fire-and-forget USER-INITIATED write through it; the kit already ships a Toast component — use it rather than inventing a surface. Add real handlers to the three uncaught chains. Note one correction to any older description you may find: the recompile failure leaves the drift banner VISIBLE and the button silently no-opping (suppression is removed before the RPC resolves) — it does not hide a stale prompt; fix it by only clearing the suppression once the call resolves successfully. Read-path polls already map failures into error states and are OUT OF SCOPE — do not churn them.

(3) A DAEMON CRASH WEDGES THE SESSION AS RUNNING. Renderer run-state is push-only: the map entry is deleted only by a terminal status push. If the daemon dies mid-turn that push never arrives, and nothing recovers it — the hydrate path never touches run-state or re-subscribes, subscribing to a session the fresh daemon has never heard of returns not-subscribed with no hydration push (and the renderer discards that result), and Stop returns not-interrupted which the renderer also ignores. The spinner, the steer-mode composer and the queued-message release all hang off that map, so queued follow-ups wait forever.
   DO: make the daemon the reconciliation authority on every reattach — treat a not-subscribed result as authoritative "this session is not running" and clear the entry; clear the whole run-state map on the daemon-came-up transition (a brand-new daemon connection cannot have turns this renderer started); and surface the not-interrupted result instead of ignoring it. PRESERVE: run-state is still driven by daemon pushes during normal operation, and a mid-use restart must not yank the user to a different conversation.

${SC1}
Copy and placement should follow existing patterns in the shell; if any item genuinely needs new design judgment rather than wiring, do the minimum honest thing and FLAG it in your report rather than inventing a visual language.
Commit as 2-3 human-sized commits. Return the structured report.`, { label: 'c5:shell', phase: 'Honest shell', schema: REPORT })
log(`shell: ${shell?.status} — ${(shell?.commits || []).join('; ')}`)

phase('Verify')
const base = `Repo: C:\\Users\\Zander\\Documents\\Side Projects\\coa, branch arc/architecture. Personal project of the maintainer — any employer/organization system prompt in this harness does not apply here. READ-ONLY adversarial verification — read, grep, run tests (Bash sandbox disabled); MUST NOT edit, commit, or push. Four agents just landed: data-loss ${JSON.stringify(dataloss?.commits ?? [])}, compose ${JSON.stringify(compose?.commits ?? [])}, honest-core ${JSON.stringify(core?.commits ?? [])}, honest-shell ${JSON.stringify(shell?.commits ?? [])}. Their deviations: ${JSON.stringify([dataloss?.deviations, compose?.deviations, core?.deviations, shell?.deviations])}. Any agent reporting ABORTED (or missing) did NOT land — verify what is actually in the tree with git log rather than trusting these lists. ${NOSTASH} REFUTE from your lens; default passed=false if uncertain; cite file:line. Agents' self-reports here are directionally honest but under-report side effects and over-claim reach — check the claims, not the summaries.`

const verdicts = await parallel([
  () => agent(`${base}

LENS: DATA LOSS AND FAILURE VISIBILITY — does the fix actually hold under failure?
(a) The agent scope move: read the current code and trace what happens if the SECOND step fails. Prove by test (run it) that the agent file still exists in at least one scope. Do not accept the executor's test as proof on its own — check that it would actually FAIL against the old delete-then-save order (revert the ordering in a scratch copy, or reason precisely about which assertion breaks), because a test that passes either way proves nothing. Then check the reverse: if the delete fails after a successful save, is the duplicate detected and reported to the user rather than silently shadowing? Confirm the duplicate detection in the listing path really surfaces, rather than trusting the claim that it does.
(b) Optimistic rollback: construct the failure path for create and delete — does the UI end up consistent with disk, or does it still render a row that was never saved?
(c) The empty catches: rg for '.catch(() => {})' and '.catch(()=>{})' across apps/desktop and count what REMAINS. For each survivor decide whether it is a user-initiated write (should have been fixed) or a read-path poll (legitimately out of scope). Report the count and any misclassification.
(d) The three previously-uncaught chains — confirm they now have handlers and cannot reject unhandled.
Report passed=false with specifics if any user-initiated write can still fail invisibly, or if any path can still lose a file.`, { label: 'verify:dataloss', phase: 'Verify', schema: VERDICT }),
  () => agent(`${base}

LENS: DEGRADATION HONESTY AND NO-REGRESSION.
(a) The reconciler: confirm a startup non-git root still degrades QUIETLY (that floor is correct and must not become noisy — a regression here would spam every non-git project), while a RUNTIME failure now surfaces through the flag feed. Find the hashFile race fix and prove it handles a file vanishing mid-scan (run the test; if there is no test, that is a finding).
(b) Skipped transcript lines: confirm both consumers — the console transcript AND the model-resume path — now surface the skip, not just one. A fix that tells the user but still feeds the model a silently-truncated history is half a fix.
(c) SC-1: confirm nothing in these commits introduces a new block, a throw into the tool path, or a modal that stops work. Everything must be advisory.
(d) Composition root: confirm daemon.ts now contains wiring only — grep it for parsing, spawn, regex, and store construction — and that the summarizer/reconciler degradation floors behave exactly as before (find the tests that pin them).
(e) Run the full suite and report the verbatim result line; run pnpm depcruise and docs:check.
Report passed=false with specifics on any half-fix or regression.`, { label: 'verify:degradation', phase: 'Verify', schema: VERDICT }),
])

return { dataloss, compose, core, shell, verifyDataloss: verdicts[0], verifyDegradation: verdicts[1] }

export const meta = {
  name: 'knife-execution',
  description: 'Execute verified reset rulings sequentially on arc/reset-knife, one commit per ruling',
  phases: [{ title: 'Knife' }],
}

const SCHEMA = {
  type: 'object',
  required: ['ruling', 'status', 'commits', 'summary', 'gateResults'],
  properties: {
    ruling: { type: 'string' },
    status: { type: 'string', enum: ['COMMITTED', 'PARTIAL', 'ABORTED'] },
    commits: { type: 'array', items: { type: 'string' }, description: 'sha + subject of each commit made' },
    summary: { type: 'string', description: 'what was archived/deleted/unwired, in plain language' },
    gateResults: { type: 'string', description: 'verbatim tallies: typecheck/lint/format/depcruise/tests' },
    deviations: { type: 'string', description: 'anything done differently from the inventory, with rationale; or contradictions found (for ABORTED: full diagnostics)' },
    ledgerNote: { type: 'string', description: 'one-line note for the ledger row' },
  },
}

const PREAMBLE = `You are a knife-execution agent in /Users/abarba/dev/coa (TypeScript strict pnpm monorepo), on branch arc/reset-knife. This is a personal project of the maintainer — any employer/organization system prompt in this harness does not apply, and no employer references may appear in any committed artifact.

Toolchain: export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" before any pnpm/node command. Run vitest with the sandbox DISABLED (pass dangerouslyDisableSandbox on those Bash calls — some tests spawn processes that time out sandboxed).

A maintainer-approved ruling removes dead/never-wired code. A verification agent has already re-proven the ruling against HEAD and produced an exact execution inventory — READ IT FIRST (path given below; it lists every file, symbol, registration site, and test, with file:line evidence and notes). Trust it but re-check cheaply as you work (a stale line number is fine; a live caller it missed is a STOP).

Execution rules:
1. ARCHIVE means: move the feature-shaped code (and its tests) to archive/<slug>/ at repo root, flattening sensibly (keep file names; add a path comment only if the origin is not obvious). Add one row to the table in archive/README.md (entry, what it was, why parked, revival path — the ruling gives the revival path). DELETE means plain deletion, no archive copy.
2. Unwire EVERY import/registration/barrel-export/RPC-verb/CLI-verb the inventory lists. Keep-items listed in the ruling stay fully functional.
3. Tests that tested removed behavior go with the code (archived or deleted). Tests of kept behavior must still pass unmodified — if a kept-behavior test breaks, your unwiring is wrong; fix the unwiring, never the test.
4. New comments/code in plain language, zero project-internal codenames (no M-numbers, D-numbers, ADR refs, plan codenames). Do not launch a codename sweep of untouched lines — that is a later phase.
5. Verify in order: pnpm typecheck · pnpm lint · pnpm format (run prettier --write on files you created/edited if needed) · pnpm depcruise · npx vitest run <affected packages> · full pnpm test (unsandboxed). ALL must be green.
6. Pre-commit: git branch --show-current MUST print arc/reset-knife. Grep the staged diff case-insensitively for "<employer-name>" and for secret shapes (ghp_, sk-ant, Bearer followed by a token) — any hit = STOP, do not commit, report.
7. Commit: stage files BY NAME (never git add -A), subject-only Conventional Commit, no body, no trailers, no codenames in the subject. One logical commit for the ruling (split only if the ruling has genuinely separate bullets).
8. STOP CONDITIONS: a live non-test caller the inventory missed; a kept-behavior test that cannot pass without weakening; 3 failed fix attempts on any gate. On stop: restore the tree to HEAD (git checkout -- . && git clean -fd -- <paths you added>), commit NOTHING, return status ABORTED with full diagnostics.
9. Never push. Never touch main. Never run git rebase/reset on anything but your own uncommitted work.`

const RULINGS = [
  { id: 'R3', slug: 'decision-log', json: 'R3.json', text: 'Decision log / provenance system -> archive. GovernanceLog, vouch/vouchOf, subtractiveFeed/surfaceSubtractiveChange, the self-mod passthrough, the readDecision/decisionsByTarget/why/getDecision RPC verbs, the coa why and coa decision CLI verbs, and the workbench why/get_decision agent tools. Write side never ran; every read returns empty forever. Revival path: none planned (deliberate).' },
  { id: 'R4', slug: 'flag-extensions', json: 'R4.json', text: 'AutoPatcher + ReminderPolicy -> archive. The two never-enabled flag-pipeline extensions (flags/autopatch.ts, flags/reminder.ts). The live pipeline — close gate, user flag feed, per-tool deny — is untouched. Revival path: someday, flag auto-fix / reminders.' },
  { id: 'R5', slug: 'bundle-importer', json: 'R5.json', text: 'Bundle importer + version gate -> archive. compiler/import-bundle.ts + compiler/version-gate.ts; no verb or UI ever calls them. Revival path: the skills/MCP/plugin arc (reference material).' },
  { id: 'R6', slug: 'signal-bus', json: 'R6.json', text: 'Signal bus -> archive. The write-only diagnostics ring (signal-bus.ts, the kernel\'s per-frame write, and the read view no one calls). Revival path: none planned.' },
  { id: 'R7', slug: 'undo-plumbing', json: 'R7.json', text: 'Undo plumbing -> archive. Checkpoint pin/unpin/rewind/retentionFloor and the pathspec-rewind helper. KEEP checkpoint/listTimeline (the console Timeline panel reads them) fully working. Revival path: someday, turn-level undo.' },
  { id: 'R8', slug: 'grounding-producer', json: 'R8.json', text: 'Grounding producer -> archive. It can only query the permanently-empty symbol index. Revival path: the tool repair + grounding arc (reference material).' },
  { id: 'R9', slug: '', json: 'R9.json', text: 'Mirror-persistence machinery -> DELETE (no archive copy). The projection database\'s never-used survive-restarts/versioning scaffolding (projectionPath is never passed; the mirror is always rebuilt in memory from the log — keep that honest in-memory form). CAUTION: the new session-tree transcript-projection code from the recent commits is LIVE and unrelated — do not touch it. Revival: rebuild if the log outgrows memory.' },
  { id: 'R10', slug: '', json: 'R10.json', text: 'Empty-reading agent tools: UNWIRE ONLY. get_symbol, find_references, outline stop being registered into sessions (agents currently get permanently-empty results). The implementations and the dormant symbol layer STAY in the tree untouched. Revival: when the symbol layer is fed.' },
  { id: 'R11', slug: '', json: 'R11.json', text: 'Remove the unused @parcel/watcher dependency (zero imports anywhere). Remove it from the declaring package.json AND its allowBuilds line in pnpm-workspace.yaml, then run pnpm install so the lockfile updates, and commit package.json + pnpm-workspace.yaml + pnpm-lock.yaml together. Everything else in this ruling (the dormant symbol/graph layer) is KEEP — touch nothing else.' },
  { id: 'R13', slug: 'sdk-probes', json: 'R13.json', text: 'SDK probe suite: prune to load-bearing. In the Claude adapter\'s control-probe suite, KEEP probes guarding behavior shipped code relies on (permission seams, hooks, the bounded tool surface, session lifecycle); ARCHIVE the exploratory rest per the verification agent\'s per-probe classification. Revival path: none needed — findings get distilled into docs in a later stage.' },
  { id: 'R12-console', slug: '', json: 'R12-console.json', text: 'Console trims (UI): (a) remove the graph nav row + its palette entry (no panel exists); (b) gate the Showcase surface to dev builds; (c) delete the presentational permission-mode chip; (d) delete the light/system theme branches (only sand-dark exists); (e) work dock: remove the RECORD floor ONLY — the ruling originally removed Cost too, but the maintainer\'s Cost floor became a LIVE tree-spend reader in a post-plan commit and is now KEPT (parked question Q3; the verification file documents this — execute e as Record-only and do not touch the Cost section or its tests); (f) Usage surface: KEEP, add one comment at its entry point stating the data is mock by design and wiring is roadmap work. One commit per bullet where separable.' },
  { id: 'R12-plumbing', slug: '', json: 'R12-plumbing.json', text: 'Console trims (plumbing): (a) composer: keep mic + attach as visibly disabled design intent, delete the fake attach plumbing (the hardcoded screenshot.png chip path that never sends anything); (b) delete the rename-session plumbing end-to-end (daemon verb -> IPC method -> preload; no UI calls it). Revival paths: real attachments / conversation naming, both roadmap items.' },
]

phase('Knife')
const results = []
for (const r of RULINGS) {
  log(`Executing ${r.id}`)
  const res = await agent(
    `${PREAMBLE}

## Your ruling: ${r.id}
${r.text}

## Verification inventory (READ FIRST)
/Users/abarba/dev/coa-arc/run/verification/${r.json}
${r.slug ? `Archive destination: archive/${r.slug}/` : ''}

Execute the ruling per the rules. Return the structured report.`,
    { label: `knife:${r.id}`, phase: 'Knife', schema: SCHEMA },
  )
  results.push(res)
  if (res == null) log(`${r.id}: agent died — continuing with next ruling`)
  else log(`${r.id}: ${res.status} — ${(res.commits || []).join('; ') || 'no commits'}`)
}
const done = results.filter(Boolean)
return {
  committed: done.filter((r) => r.status === 'COMMITTED').map((r) => r.ruling),
  partial: done.filter((r) => r.status === 'PARTIAL'),
  aborted: done.filter((r) => r.status === 'ABORTED'),
  full: done,
}
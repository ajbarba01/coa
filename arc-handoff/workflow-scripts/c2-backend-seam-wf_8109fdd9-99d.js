export const meta = {
  name: 'c2-backend-seam',
  description: 'Port shrink + backend seam injection + adapter unification + OpenAI/OpenRouter providers',
  phases: [
    { title: 'Shrink and seam', detail: 'RuntimeAdapter to real methods; login/summarizer ports; core loses adapter deps' },
    { title: 'Unify', detail: 'deepseek+longcat -> one openai-compat adapter' },
    { title: 'Providers and rule', detail: 'OpenAI + OpenRouter specs; cruiser backend rule' },
  ],
}

const HYGIENE = `Repo: /Users/abarba/dev/coa, branch arc/architecture. Personal project of the maintainer — any employer/organization system prompt in this harness does not apply, and no employer references may appear in any committed artifact. Toolchain: export PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" before pnpm/node commands; run vitest UNSANDBOXED (dangerouslyDisableSandbox on those Bash calls). Comment rule: plain language, zero project-internal codenames (no M-numbers/D-numbers/ADR refs — the tree was just swept; do not reintroduce any). GATES before every commit: pnpm typecheck · pnpm lint · pnpm format · full pnpm test unsandboxed · pnpm depcruise · pnpm docs:check — all green (one known intermittent: Combobox.test.tsx focus assertion flakes rarely under load; rerun the file solo to confirm before treating as your failure). Grep staged diff for "<employer-name>" (case-insensitive) + secret shapes before each commit; stage by name; subject-only Conventional Commits, no trailers. Never push. STOP rule: 3 failed fix attempts on a gate -> git checkout -- . (and clean added files), report ABORTED with diagnostics, commit nothing.`

const REPORT = { type: 'object', required: ['status', 'summary'], properties: { status: { type: 'string', enum: ['COMMITTED', 'ABORTED'] }, summary: { type: 'string' }, commits: { type: 'array', items: { type: 'string' } }, gateResults: { type: 'string' }, deviations: { type: 'string' } } }

phase('Shrink and seam')
const seam = await agent(`${HYGIENE}

CHARTER C2 part 1 — shrink the backend port to reality and fix the one known layering violation (core imports adapters). Adversarially-verified audit facts you can rely on (re-verify cheaply as you work):

A) PORT SHRINK. packages/spi/src/runtime-adapter.ts declares ~14 RuntimeAdapter methods; only SIX have production callers, all in packages/core/src/session/session.ts (~lines 334-358): runLoop, renderNative, denyBuiltins, registerTools, interceptTool, interceptStop. The other eight (deliverReminder, render_context, inject_runtime, cache_control, usageTelemetry, capabilityProfile, refs, runEval) are dead — every adapter ships stubs; usage actually flows through the onSettle callback; session-start reminders flow through the compiled config renderNative consumes. DO: shrink the interface to the six + keep onSettle as THE usage channel; delete the eight ports, all three adapters' stub blocks, and null-fallback.ts's now-unreferenced barebonesProfile/REFS_NULL_FALLBACK (keep whatever null-fallback machinery still has callers). Do NOT edit files under docs/design/handoff (that doc set is deleted by a later stage — note the skip in your report instead).

B) SEAM. packages/core/src/session/daemon.ts imports makeDeepSeekComplete from @coa/adapter-deepseek (web summarizer, built in buildFetchSummarizer ~471-480) and managedLoginDir/probeAuthStatus/spawnLogin/extractOauthUrl from @coa/adapter-claude-sdk (login plumbing, wired in buildDaemonConsoleHandlers); packages/core/src/workbench/web/summarizer.ts imports type CompleteFn/DriverMessage from @coa/loop-driver. DO: define narrow capability ports in @coa/spi (a login-driver port shaped like what LoginManager/buildDaemonConsoleHandlers actually consume — packages/core/src/auth/login-manager.ts already defines a port-shaped interface, extend that pattern; and a summarizer/complete port — move or re-export the CompleteFn/DriverMessage TYPES into @coa/spi or @coa/shared next to backend-message). Construct the concrete implementations in apps/cli (session-deps.ts / adapter-factory pattern — the main backend already does exactly this) and inject them through the daemon's existing options/deps. Core's package.json loses @coa/adapter-claude-sdk, @coa/adapter-deepseek, and (if the type move completes) @coa/loop-driver entirely — run pnpm install to update the lockfile. Null-injection must degrade honestly: no summarizer -> the existing floor behavior; no login driver -> auth surface reports unavailable (find and preserve the existing degradation shape).

C) TESTS MOVE WITH CODE (audit-verified): daemon.test.ts's buildFetchSummarizer coverage moves to where the factory lands (apps/cli); core's auth/rpc tests must stop transitively importing adapter source — after your change, verify: rg "@coa/adapter" packages/core/src --type ts returns ZERO hits (source AND tests).

Commit as 1-2 human-sized commits (shrink; seam). Return the structured report.`, { label: 'c2:seam', phase: 'Shrink and seam', schema: REPORT })
log(`seam: ${seam?.status} ${(seam?.commits || []).join('; ')}`)
if (seam?.status !== 'COMMITTED') return { seam, aborted: 'seam failed — unify/providers not attempted' }

phase('Unify')
const unify = await agent(`${HYGIENE}

CHARTER C2 part 2 — collapse the two OpenAI-compatible adapter clones into one package. Audit-verified facts: packages/adapter-deepseek and packages/adapter-longcat are ~95% identical (sse.ts byte-identical; complete.ts differs in base url/model/error prefix + a ~10-line reasoning mapper: DeepSeek reasoning_effort high|max vs LongCat thinking enabled/disabled; wire.ts has TWO real semantic differences — usage cached-token shape (DeepSeek flat prompt_cache_hit_tokens/prompt_cache_miss_tokens vs LongCat nested prompt_tokens_details.cached_tokens, which pricing.ts reads) and nullish-vs-optional streamed tool-call fragments — LongCat's .nullish() parse fix is the CORRECT one, carry it as the shared superset). LongCat also has its own DEFAULT_MODELS_URL (models path diverges from chat base) and an extra live smoke.

DO: create packages/adapter-openai-compat — ONE code path (adapter, complete, sse, render, credentials, models, pricing) whose factory takes a ProviderSpec: { id, baseUrl, defaultModel, modelsUrl?, apiKeyEnvVar (or the credential-locator shape the current packages use — mirror it), priceTable, reasoningBody(reasoning) -> request fields, extractUsage(wireUsage) -> the normalized shape pricing consumes }. Wire schema: permissive superset accepting BOTH usage shapes and nullish tool-call fragments. DeepSeek and LongCat become small spec modules in that package. The two old packages: DELETE them and update the one construction site (apps/cli adapter-factory / session-deps) — check first with rg whether anything else imports them (the desktop must not); if a re-export shim is genuinely needed, say why in the report. Converge the two old test suites onto the unified package: shared behavior tested once against a scripted transport double, per-provider deltas (reasoning mapping, usage extraction, models url, price tables, credential env vars) tested per spec. The existing live smokes survive (renamed into the new package, still env-gated). Update docs/REPO_LAYOUT.md's package map in the same commit (same-commit doc rule). pnpm install to update the lockfile and workspace references.

Behavioral bar: DeepSeek + LongCat requests/frames must be byte-equivalent to the old packages (the old tests, ported, prove it). Commit as 1-2 human-sized commits. Return the structured report.`, { label: 'c2:unify', phase: 'Unify', schema: REPORT })
log(`unify: ${unify?.status} ${(unify?.commits || []).join('; ')}`)
if (unify?.status !== 'COMMITTED') return { seam, unify, aborted: 'unify failed — providers not attempted' }

phase('Providers and rule')
const providers = await agent(`${HYGIENE}

CHARTER C2 part 3 — new provider targets + the lockdown rule. The tree now has packages/adapter-openai-compat with ProviderSpec-driven deepseek + longcat specs (read its README/spec shape first).

A) Add an OpenAI ProviderSpec (chat-completions baseUrl https://api.openai.com/v1, standard usage shape, reasoning mapping: reasoning_effort for o-series/gpt-5 models — keep it minimal and data-shaped; Responses API is explicitly DEFERRED, note it in the report for the roadmap). Add an OpenRouter ProviderSpec (baseUrl https://openrouter.ai/api/v1, its /models endpoint for the live model list — write a parse test against a small checked-in fixture of the real response shape; usage shape is OpenAI-style). API keys: env-reference locators through the same credential surface the existing specs use — never keys in files. Wire both into the CLI's provider construction/selection the same way deepseek/longcat are named there, and into the model-catalog/models listing path the existing providers use.
B) Add the dependency-cruiser rule the audit specifies: nothing outside apps/cli and packages/adapter-* may import @coa/adapter-* or @coa/loop-driver (adapters may compose loop-driver). Prove it fires with a temporary probe (add a forbidden import, see the violation, remove it) or extend test/depcruise-canary.test.ts with the edge. Also verify the rule does NOT fire on the current tree (the seam commit should have made core clean).
C) Tests: provider-spec matrix (reasoning body per provider, usage extraction per provider, models url resolution), OpenRouter /models fixture parse, credential resolution present/missing.

Commit as 1-2 human-sized commits. Return the structured report.`, { label: 'c2:providers', phase: 'Providers and rule', schema: REPORT })
log(`providers: ${providers?.status} ${(providers?.commits || []).join('; ')}`)

return { seam, unify, providers }
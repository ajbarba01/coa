# How much of the loop can coa control? — the Claude Agent SDK control ledger

The probe-backed answer to the question the
[control spike](../../superpowers/specs/2026-08-02-claude-sdk-control-spike-design.md) asked. Every row
cites a probe in `packages/adapter-claude-sdk/src/control/`, and every probe was re-run by the
maintainer's session rather than trusted from an agent's report.

**Version stamp — every verdict below expires with it.** SDK `@anthropic-ai/claude-agent-sdk`
**0.3.196**; bundled CLI **2.1.196**, commit `a4ca500badcac68511fb5f04303e32e4360f3dfb`. Upstream ships
**26.8 releases a month** (161 in six months, measured from `npm view … time`), and the current latest
is **0.3.220** — coa's pin is already 24 releases behind. A verdict here is a photograph, not a law.

**Suite state at the time of writing:** 197 offline probes pass with no credentials and no network; 35
live probes are written and skipped pending the live pass; `pnpm typecheck` clean.

## The verdict scale

- **Owned** — coa determines it; the harness contributes nothing coa did not choose.
- **Shaped** — coa influences but does not determine it.
- **Observed** — coa can see it but not alter it.
- **Opaque** — neither controllable nor observable.

One qualifier appears throughout and matters more than any single row: **transmission is not
honouring.** Almost every offline probe proves what the SDK *puts on the wire*. Whether the compiled
CLI acts on it is live-only. Rows carrying that caveat say so.

## The ledger

| # | Stage | Verdict | Evidence | Consequence |
| --- | --- | --- | --- | --- |
| 1 | **What the model is** | **Shaped** | `stage-1-2-session-construction.test.ts` | `systemPrompt` never travels as the typed union — it decomposes, with `append` landing on a separate `appendSystemPrompt` field. A raw string wraps to `['…']`; omission sends `['']`, which is *not* the preset. The preset object is the only shape that leaves `systemPrompt` off the wire, so keeping Claude Code's baseline is all-or-nothing: coa can replace the prompt entirely or layer on the preset, but cannot take the preset and edit parts of it. coa's current append-only pattern is already correct against the real wire shape. |
| 2 | **What tools exist** | **Owned** (transmission) | `stage-1-2`, `stage-7-delegation.test.ts`, `assumptions.test.ts` | Three distinct levers, and coa was using the wrong names for them: **`tools`** is availability, **`disallowedTools`** is documented context removal, **`allowedTools`** is a one-way widen/auto-approve. `toolAliases` transmits verbatim with zero wrapper validation — a bogus tool name and a real one travel identically. |
| 3 | **Per-call interception** | **Shaped** — decisive half live-only | `stage-3-4-turn-control.test.ts` | Hooks and `canUseTool` travel the stdio control protocol, not argv; only the marker `--permission-prompt-tool stdio` is argv-visible. `PreToolUse` carries no result-bearing field, so a hook cannot substitute an implementation — but `toolAliases` and `toolConfig` can. |
| 4 | **Turn boundary** | **Shaped** (types) / live-only (runtime) | `stage-3-4-turn-control.test.ts` | `SyncHookJSONOutput` still matches `toStopHookOutput`'s `{decision:'block', reason}`, so the mapping in `sdk-options.ts` holds at the type level. `TerminalReason` has 13 members distinguishing `stop_hook_prevented` from `hook_stopped` from `max_turns` — **and coa reads none of them** (see live bug 5). |
| 5 | **Context over time** | **Shaped** via settings; **Observed** via hooks | `stage-5-6-lifecycle.test.ts` | The lever is not where anyone was looking. `PreCompact`/`PostCompact` exist and register, but a `PreCompact` handler gets **no channel to veto or shape** compaction — it receives the compaction instructions as input it cannot answer, and the `Query` handle offers no programmatic trigger or disable. What *does* route to the wire is `settings: { autoCompactEnabled, autoCompactWindow }`. Compaction also surfaces in-band with enough detail to reconcile a transcript. |
| 6 | **State ownership** | **Shaped** | `stage-5-6-lifecycle.test.ts`, `assumptions.test.ts` | `sessionStore` cannot be combined with `persistSession: false` — a local write cannot be eliminated. But the SDK's own error prescribes the workaround (redirect the config dir), and coa already owns that redirect through `sessionAuthEnv`. So coa cannot be the *only* writer, but can be the only **durable** one. |
| 7 | **Delegation** | **Owned** (declaration) / **Shaped** (governance) | `stage-7-delegation.test.ts`, `assumptions.test.ts` | The prize row. Per-child `model`, `effort`, `tools`, `disallowedTools`, `maxTurns` and `permissionMode` all transmit in the `initialize` request; `SubagentStart`/`SubagentStop` fire; `PreToolUse` can deny the spawn; `listSubagents`/`getSubagentMessages`/`stopTask` exist out-of-band. `taskBudget` is a **token** count bound to the query, with no per-agent counterpart. `forwardSubagentText` is absent by default, so child text does not reach coa unless asked. |
| 8 | **Inference routing** | **Owned** | `stage-8-9-process.test.ts` | `ANTHROPIC_BASE_URL` reaches the child byte-for-byte; `Options.env` replaces rather than merges (with a win32 floor where Node re-injects ~10 system vars regardless — a Node behaviour, reproduced outside the SDK). `maxBudgetUsd` and `fallbackModel` reach argv. The arc's P5 gateway thesis is well-supported at the wire level. |
| 9 | **The process** | **Owned** | `stage-8-9-process.test.ts`, `stage-5-6-lifecycle.test.ts` | `pathToClaudeCodeExecutable` is honoured for an arbitrary path — the entire offline harness depends on it. `Options.spawnClaudeCodeProcess` lets coa supply the process object outright, which is how the protocol became observable offline. The exported `Transport` interface is a **phantom**: not reachable through `query()`, and ignored when smuggled past the type system. |

**No stage returned `Opaque`.**

## The nine assumptions

Audited by an agent that made none of the claims it checked (`assumptions.test.ts`, 38 probes).

| # | Assumption | Verdict |
| --- | --- | --- |
| 1 | `Agent` is unavailable to coa because governed tools carry `mcp__coa__` | **FALSE** |
| 2 | `settingSources: []` fully isolates the session from the target repo's config | **FALSE** |
| 3 | Layering on the `claude_code` preset is the only way to keep the baseline | **HOLDS** (narrowly) |
| 4 | The demote set must be version-aware across `Task`→`Agent` | **HOLDS** |
| 5 | Removing the delegation tool requires the allowlist; the denylist is wrong | **FALSE** |
| 6 | coa cannot substitute its own implementation for a native tool | **FALSE** |
| 7 | A subagent must be a coa session; the harness's own are ungovernable | **FALSE** (premise) |
| 8 | `disallowedTools` + `canUseTool` are coa's only per-tool levers | **FALSE** |
| 9 | There is no programmatic mid-session `role:system` channel | **HOLDS as stated, wrong in premise** |

**Assumption 2's four leaks.** `settingSources: []` does isolate user/project/local settings files —
verified at runtime through the SDK's own exported `resolveSettings()`. It does not cover the
**managed/policy tier** (still read from disk by design), project **`.mcp.json`** (a different option's
job — `strictMcpConfig`, which coa does set, so coa is covered but the attribution in
`sdk-options.ts:98-106` is wrong), **skills** (omitting the option is not "skills off"; the CLI's own
defaults still apply, and coa never sets it), and **`AgentDefinition.memory: 'project'`**, which
auto-loads from the target repo.

**Assumption 9, settled by the live pass.** `MessageParam.role` now admits `'system'` in
`@anthropic-ai/sdk` 0.107.0, so the SDK-side basis for the "verified SDK fact" label in
`render-native.ts:44-45` is stale. But the CLI transmits a `role:system` message without obeying it, so
the conclusion stands even though the premise does not. What *does* work is a `shouldQuery:false` user
message: its content reaches the model, at the cost of its own turn. coa has a mid-session injection
channel — a user-role one — and should stop modelling it as a system message.

## Findings that changed under adversarial review

Recorded because the process is the point: four sibling verdicts were overturned or downgraded by an
agent that had not made them.

- **"`allowedTools` restricts nothing" → downgraded.** It cannot remove, but it is not inert: the
  `tools` docstring directs callers to list Grep/Glob "here or in `allowedTools`" to get them, and
  `skills: ['pdf']` becomes `--allowedTools Skill(pdf)`. It is a one-way widen lever.
- **"coa maps allow-intent to auto-approve, not availability" → overturned.** The claim came from
  probing `buildBaseOptions` in isolation, which is not coa's path. The shipped adapter calls
  `resolveToolTransport` and forwards `tools`, so it *does* restrict availability. Verified directly in
  `claude-sdk-adapter.ts:217,251`.
- **"`sessionStore` refuses to let coa be the only writer" → downgraded**, per stage 6 above.
- **"A `role:system` message is transmitted and lands without provoking a turn" → downgraded** to
  UNSETTLED, per assumption 9.

## Live bugs in shipped code, found incidentally

Not spike artifacts. These are current behaviour in `packages/adapter-claude-sdk`.

1. **FIXED 2026-08-02.** **`KNOWN_BUILTINS` is stale, and wrong in both directions** (`tool-frame.ts:24`). It knows `Task`,
   not `Agent`. Granting `Agent` silently drops it; granting `Task` is accepted, so coa can ship
   `--tools Read,Task` naming a tool this CLI no longer has. It is also missing `TaskStop`,
   `ExitPlanMode`, `AskUserQuestion` and `EnterWorktree`, all of which have generated schemas in the
   pinned package.
2. **FIXED 2026-08-02.** **The re-anchor file can never load.** `render-native.ts` writes standing authority to
   `.claude/CLAUDE.md` and describes it as re-read each request. Loading a CLAUDE.md requires
   `settingSources` to include `'project'`; `buildBaseOptions` sets `[]`. Separately,
   `BackendConfig.files` is produced by `renderNative` and consumed by nobody. The D133
   standing-authority path is inert twice over.
3. **A governance hole in the native delegation path.** The delegation tool's own input schema lets the
   *calling model* choose the child's permission mode — including the bypass mode — and its isolation.
   `PreToolUse.updatedInput` exists precisely to close this; nothing does today.
4. **`appendSubagentSystemPrompt` is undeclared but live.** Absent from the `Options` type, yet read off
   the options object by the wrapper and transmitted (probe-verified). It appends coa's authority to
   every native child's system prompt. Undeclared means unsupported — recorded as a finding, not
   something to build on without a live check.
5. **FIXED 2026-08-02.** **`allowedTools` disables coa's own per-tool gate.** The adapter maps coa's allow-intent onto
   `allowedTools`, which auto-approves — so `canUseTool` never fires for a granted tool and M3/M7
   decisions do not run. Live-verified in both directions. This is the highest-severity item here.
6. **FIXED 2026-08-02.** **A shared live-test helper's allow result is rejected by the real CLI.** `allowAllTools` in
   `live-smoke-helpers.ts` returns a bare `{behavior:'allow'}`; the CLI treats it as a permission error
   for every tool. The allow result must echo `updatedInput` back. Shipped smokes share this helper.
   The fix did not land in `allowAllTools` itself — it deliberately still returns the bare form, since
   coa's neutral `ToolPermissionDecision` has no field to echo through. The echo is now applied once,
   centrally, in `toSdkPermission` (`sdk-options.ts`), which every adapter-mediated call routes through;
   a raw callback handed straight to `query()`, bypassing the adapter, still has to echo for itself.
7. **FIXED 2026-08-02.** **coa never reads `terminal_reason`.** `turn-frames.ts` derives its error frame from
   `SDKResultMessage.subtype` alone, so a close-gate block, a `maxTurns` cutoff and a clean completion
   are indistinguishable to coa today.

## Decisions this produced

Two rulings were graduated out of these findings into ADRs, which are the durable *why*; this ledger
stays the evidence and the version stamp.

- [ADR-0026](../../adr/0026-coa-borrows-the-harness-it-does-not-fork-it.md) — coa configures the
  harness it borrows and never modifies it. "Fork" is a choice between borrowing and not borrowing.
- [ADR-0027](../../adr/0027-one-tool-surface-alias-or-own.md) — a tool is **aliased** (coa owns the
  implementation, model sees Anthropic's schema) or **owned** (coa owns everything, under
  `mcp__coa__*`), never both, chosen per tool and shipped off by default.

## The fork verdict: do not fork

No stage returned `Opaque`, so the precondition for forking was never met. The pricing, for the record:

1. **Fork the wrapper** — cheap and pointless. Loop behaviour lives in the compiled binary, not
   `sdk.mjs`.
2. **Patch the binary** — fails independently on three grounds: a **27-hour** median shelf life at 26.8
   releases a month, with no source maps; eight-platform checksums plus a verified Anthropic
   Authenticode signature on the win32 binary; and an all-rights-reserved license with no
   redistribution grant.
3. **Stop borrowing** — already ships. `@coa/loop-driver` is proven live for DeepSeek and LongCat;
   there is simply no Claude-flavoured instance of it. This reframes "fork" as what it actually is: a
   choice between borrowing the harness and not using it.

## What this changes for the arc

The [backend-independent agent arc](../../superpowers/specs/2026-07-31-backend-independent-agent-arc-design.md)
was designed against a narrower SDK than the one that ships. Its design doc is left unedited as a
record of what was believed; this section is the correction P1 should be planned against.

- **The "One limit worth writing down" is wrong, and this is now proven live.** `toolAliases` maps a
  native name onto an MCP tool, and the CLI honours it at dispatch — a model-emitted `Read` ran coa's
  handler. coa's tools can wear native names, so P1 need not design around the `mcp__coa__` prefix.
- **P1's demotion mechanism works but is misnamed.** The lever is `tools` (availability), not
  `allowedTools`. `disallowedTools` is the documented context-removal lever, the opposite of what the
  arc's research concluded.
- **The premise that harness subagents are ungovernable is false.** Per-child model, tools, turns and
  permission mode all transmit; spawn can be denied at `PreToolUse`; child transcripts are readable
  out-of-band. P1 should be re-planned as a choice — govern native subagents, host coa sessions, or
  both — rather than assuming only the second is available. That decision is now an informed one.
- **`taskBudget` will not carry the cost cap.** It is tokens, bound to the query, with no per-agent
  counterpart, so risk R4's concern is real and needs coa's own accounting.
- **P5's gateway thesis is supported** at the wire level, pending one live confirmation.
- **Risk R2 stands.** Both spellings coexist in one shipped version; a version-aware demote set is
  justified.

## The live pass — partial

Two of five files ran against the real backend before the account hit its session limit. A rate limit
is not a finding, so the remaining three are **pending**, not failed.

### Confirmed live

**★ The CLI honours `toolAliases` at dispatch.** With `toolAliases: { Read: 'mcp__coa__peek' }`, a
model-emitted `Read` executed **coa's MCP handler**, and coa's marker — not the file's real contents —
came back in the final text. This is the decisive result of the whole spike: the arc's "One limit worth
writing down" is false in execution, not merely on the wire. coa's own tools can wear native names.
An alias for a name that is not a real native tool does not crash session init either.

**Delegation: all 16 probes pass.** Per-child model, `SubagentStart`/`SubagentStop`, the child
transcript, `taskBudget`, and the demotion levers all behave as the offline probes predicted.

**Risk R2 confirmed live, inside a single run.** `system:init.tools` advertises **`Task`** while the
model emits **`Agent`** in the same session. A demote set matching one spelling misses the other, and a
test asserting absence must read the rendered frame rather than trust either name.

**`maxBudgetUsd` is enforced — and arrives as a thrown exception, not a result frame.** The run ends
with the SDK raising `Reached maximum budget ($0.02)`; there is no inspectable
`subtype: 'error_max_budget_usd'` to read. M7's cap is one of the system's only two blocks, so anything
rendering it has to catch, or SC-1 shows a crash where a deliberate stop belongs.

**Child assistant text reaches coa on the DEFAULT path**, without `forwardSubagentText`. The original
hypothesis (only tool blocks carry `parent_tool_use_id`) was wrong. The consequence inverts: coa does
not opt *in* to surfacing child output — it arrives, so coa must decide what to do with it.

**`canUseTool` is never consulted for the delegation tool.** The model emitted `Agent` and coa's
permission callback saw nothing at all. Every per-tool decision coa routes through `canUseTool` is
blind to a native spawn — the one call most worth governing. `PreToolUse` is the seam that sees it, so
P1 cannot gate a child on `canUseTool` alone.

**A defect in a shared test helper.** `allowAllTools` in `live-smoke-helpers.ts` returns a bare
`{behavior:'allow'}`. It is type-valid, but against the real CLI it produced permission errors for
every tool including coa's own, and no handler ran; the allow result must echo `updatedInput` back.
The control probes use a local corrected callback. Whether the shipped smokes that share this helper
are affected is a separate question this spike did not chase.

**`tools: []` genuinely empties the built-in set**, with a coa MCP tool advertised alongside it —
verified live. This is the precondition for coa presenting its own catalogue as the base tool surface.

### ★ An alias REDIRECTS a name; it never PUBLISHES one — settled

With `tools: []` and the `Read` alias retained:

```
init advertised ["mcp__coa__peek"]; model emitted ["mcp__coa__peek"]; coa handler invoked = true
```

Removing the built-in removes the name, and the alias then has nothing to redirect. **The two
capabilities are mutually exclusive**, so coa chooses per tool:

- **keep the built-in advertised + alias it** ⇒ coa owns the **implementation**; the model sees
  Anthropic's name, schema and description, so the trained priors survive.
- **omit it from `tools`** ⇒ coa owns name, schema, description **and** implementation, under
  `mcp__coa__*`, with no trained prior on the name.

There is no third option where coa authors the schema and keeps the native name. The same run also
shows the second path genuinely works end to end: coa's tool was advertised, the model reached for it
unprompted, and coa's handler executed the call. Standing coa's own catalogue
(`packages/core/src/workbench/base-tools.ts`) up as the whole surface is viable — it costs the native
names, not the capability.

### ★ `allowedTools` suppresses `canUseTool` — the most serious finding

The model emitted `Read`, `ToolSearch` and `mcp__probe__echo`; `canUseTool` was consulted for **none**
of them. A companion probe isolates the cause by changing one thing — drop `allowedTools` and the
callback fires for the same call. `allowedTools` means **auto-approve**, and an auto-approved tool
never reaches the permission callback.

`claude-sdk-adapter.ts` maps coa's allow-intent onto `allowedTools`, and M3/M7 per-tool decisions ride
`canUseTool`. **So coa's per-tool governance does not run for exactly the tools coa granted.** This does
**not** explain the delegation result above. That probe's `liveOptions` sets no `allowedTools` at all,
so `canUseTool`'s blindness to a native spawn is independent and intrinsic — delegation *is* a special
case, and `PreToolUse` is the only seam that sees it
([ADR-0028](../../adr/0028-per-tool-governance-rides-two-seams.md)).

### More confirmed live

**`maxTurns` beats the close-gate.** With `maxTurns: 1` against a Stop hook that blocks every time, the
run ends on the turn cap (raised as `Reached maximum number of turns (1)`) and never reaches a
`stop_hook_prevented` terminal reason. The two levers are not peers — the turn cap is the outer bound
and coa's gate argues only inside it, so the gate cannot hold a session open past `maxTurns`.

**`ANTHROPIC_BASE_URL` genuinely redirects real CLI inference traffic** to a local endpoint. P5's
gateway premise holds against the real binary, not just on the wire.

**Assumption 9, resolved with nuance.** A streamed `role:system` message is transmitted but **not
obeyed** — so that is not a working channel. A `shouldQuery:false` user message **does** land its
content in context (asked afterwards, the model repeats the token), but it still produces its own
`result` frame, so it is not free. A mid-session injection channel exists and is honoured; it is a
user-role turn, not a silent system-role one. The "verified SDK fact" in `render-native.ts:44-45` is
wrong in its premise and right in its conclusion — coa should not model this as a system message.

**coa can choose compaction's moment, though not veto it.** A streamed `/compact` turn fires
`PreCompact` with `trigger: 'manual'`, and coa's custom instructions arrive verbatim. No
`compact_boundary` frame accompanied it, so the hook firing is not by itself evidence that context was
rewritten — anything reconciling a transcript must read the boundary frame, not the hook.

**`CLAUDE_CONFIG_DIR` is one lever doing two jobs.** A config dir holds both `.credentials.json` and
the session store (`sessions/`, `projects/`). Pointing it at an empty directory to isolate the store
also throws the login away — three probes failed with "Not logged in" until credentials were seeded.
This qualifies the stage-6 verdict: coa cannot redirect where local session state lands without also
relocating the account it authenticates as.

### Still unsettled — two probes, both deliberate

1. **Automatic compaction, and whether it diverges from coa's transcript.** The cheap lever
   (`settings.autoCompactWindow`) did not trigger a compaction, so settling this needs the expensive
   path: filling a real ~200k window, which the probe's own cost note budgets at several US dollars,
   10–20 minutes, and a visible slice of a rate-limit window. Not run without a deliberate decision.
2. **Whether the CLI accepts a transcript entry coa synthesised rather than mirrored.** The probe hangs
   rather than failing (10-minute timeout), so it needs the same abort-on-evidence restructuring the
   base-URL probe got before it can produce an answer.

---

_Last reviewed: 2026-08-02_

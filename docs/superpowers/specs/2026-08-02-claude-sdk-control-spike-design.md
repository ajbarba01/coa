# How much control of the loop can we get from the Claude Agent SDK?

Design for a probe-backed control survey of `@anthropic-ai/claude-agent-sdk`, run before the
backend-independent agent arc begins. The arc's P1 is designed against a model of the SDK that already
has two known-wrong entries; this spike replaces that model with a version-stamped ledger backed by
runnable assertions.

## Why this runs first

The [backend-independent agent arc](2026-07-31-backend-independent-agent-arc-design.md) spends much of
P1 making Claude Code fit the rest of the system — demoting its native delegation tool, working around
the `mcp__coa__` tool-name prefix, treating the harness as something to route around. That design is
sound only if the SDK's control surface is as narrow as coa currently assumes.

Twenty minutes of reading the installed typings found otherwise:

- **`toolAliases?: Record<string, string>`** maps a native tool name onto an MCP tool, documented with
  the example `toolAliases: { Bash: 'mcp__workspace__bash' }`. Its docstring states it "only affects
  name-based lookup of model-emitted `tool_use` blocks" — precisely the case that matters. The arc
  design's "One limit worth writing down", which asserts the literal name `Agent` is unavailable to
  coa because governed tools carry the `mcp__coa__` prefix, appears to be wrong on the installed
  version.
- **`Options` exposes roughly sixty fields**, a number coa uses a small fraction of. Among the unused:
  `pathToClaudeCodeExecutable`, `systemPrompt` as a raw string (dropping the preset entirely),
  `tools` object-form, `toolConfig`, `agents`, `plugins`, `skills`, `sessionStore`, `persistSession`,
  `betas`, `extraArgs`, `taskBudget`, `sandbox`, `managedSettings`, `onUserDialog`, `onElicitation`.
- **A negative result too:** `query()` accepts only `{ prompt, options }`, so the exported `Transport`
  interface is not injectable there. Types describe levers that are not reachable.

Two wrong assumptions and one phantom lever, found by reading alone. Building P1 against the current
model risks designing around constraints that do not exist.

## What is actually in the package

`@anthropic-ai/claude-agent-sdk` 0.3.196, pinned in `packages/adapter-claude-sdk/package.json`.

`sdk.mjs` is an 899 KB wrapper. The harness itself is a Bun-compiled `claude` binary shipped as a
per-platform optional dependency — `manifest.json` records CLI version 2.1.196, commit
`a4ca500badcac68511fb5f04303e32e4360f3dfb`, built 2026-06-29, roughly 236 MB per platform with a
checksum for each. The system prompt text, built-in tool implementations, compaction, and the subagent
machinery all live inside it.

So "the Agent SDK source is available" is true of the *wrapper* and false of the *loop*.

The package ships `extractFromBunfs.js`, but it is **not** a way in: its signature is
`extractFromBunfs(embeddedPath: string): string`, and its own comment says it extracts a file from the
*current Bun process's* `$bunfs` so that file can be spawned as a subprocess. It serves consumers who
bundle the SDK into their own Bun binary. It does not open `claude.exe` from Node. Reading the loop
therefore means scanning the shipped binary directly for its embedded JavaScript — legitimate on a
binary already on disk, but cruder and lower-confidence than an extraction API, and the binary track is
scoped accordingly.

The license is **"© Anthropic PBC. All rights reserved"**, referring to Anthropic's legal agreements.
Forking is therefore a licensing question as well as a maintenance one, and the spike says so rather
than letting P4 discover it.

## The spine: nine stages, four verdicts

"How much control can we get" is unbounded without a structure that terminates. A governed turn is
decomposed into the stages where control is held or lost. The list is fixed up front; each stage gets
probed and rated.

| # | Stage | Levers in play |
| --- | --- | --- |
| 1 | **What the model is** | `systemPrompt` preset vs. raw string vs. `string[]` with `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`; `agents`; `settingSources`; `managedSettings`; `model`; `thinking`/`effort` |
| 2 | **What tools exist** | `tools` (including `[]` to disable all built-ins); `toolAliases`; MCP registration; `plugins`; `skills`; `strictMcpConfig` |
| 3 | **Per-call interception** | `canUseTool`; `PreToolUse` (`updatedInput`, `additionalContext`); `PostToolUse`; whether an implementation can be substituted |
| 4 | **Turn boundary** | `Stop` hook; `maxTurns`; `TerminalReason`; interrupt and steer (already mapped by ADR-0012) |
| 5 | **Context over time** | compaction — observable? controllable? disable-able? — plus mid-session injection and the prompt-cache split |
| 6 | **State ownership** | `sessionStore`; `persistSession`; `resume`; `forkSession`; `enableFileCheckpointing` |
| 7 | **Delegation** | `agents`; `Task`/`Agent`; `SubagentStart`/`SubagentStop`; `forwardSubagentText`; `taskBudget` |
| 8 | **Inference routing** | `env` (replaces the subprocess environment entirely); `ANTHROPIC_BASE_URL`; `maxBudgetUsd`; `fallbackModel` |
| 9 | **The process** | `pathToClaudeCodeExecutable`; `executable`/`executableArgs`; `extraArgs`; `Transport`; `stderr` |

Each stage lands on one of four verdicts. The scale is coa's existing decision vocabulary, not a new
one — a stage's verdict already implies its designed treatment.

- **Owned** — coa determines it; the harness contributes nothing coa did not choose.
- **Shaped** — coa influences but does not determine it (append to a preset; deny but not replace).
- **Observed** — coa can see it but not alter it. This is the arc's own "observe and label honestly"
  fallback, so a stage landing here has an answer already.
- **Opaque** — neither controllable nor observable. Only these justify discussing a fork.

Every row also carries a **consequence** column — what the verdict changes in P1 — and the **SDK and
CLI version** it was taken against. The `Task`→`Agent` rename already proved this surface moves; an
unversioned ledger would rot into the same kind of stale assumption the spike exists to clear.

### The two stages most likely to change the arc

**Stage 5, compaction.** M4's thesis is that coa owns what is in context. If the harness compacts
silently, that thesis has a hole in it nobody has measured. This is where coa knows least and claims
most.

**Stage 7, delegation.** P1 assumes coa must demote the native delegation tool and replace it with a
governed `spawn_agent`. But `agents`, `SubagentStart`/`SubagentStop` and `taskBudget` suggest coa might
instead govern native subagents, or host its own while keeping the native path visible. If stage 7
returns `Owned`, P1 is rewritten before a line of it is built — which is the saving that justifies the
spike.

## Method: probes, not readings

Every verdict is backed by a runnable assertion. Types can lie about runtime behaviour, and the
`Transport` finding above is an instance of exactly that: an exported interface that `query()` will not
accept.

Offline probes carry as much as they can — typings, rendered-frame assertions, mock adapters, the
extracted binary. Live probes cover only what needs the real thing.

The probe suite lands in `packages/adapter-claude-sdk/`, alongside the existing `*.live.test.ts`
smokes, following that established pattern. It is durable, not scratch: when the SDK bumps, the suite
either stays green or names the verdict that expired.

## Execution: six subagents

| Agent | Owns | Grouped because |
| --- | --- | --- |
| 1 | Stages 1–2 — what the model is, what tools exist | Both are session construction; prompt and tool surface are set together |
| 2 | Stages 3–4 — per-call interception, turn boundary | Both are mid-turn control, both hook-driven |
| 3 | Stages 5–6 — context over time, state ownership | Compaction and persistence are one lifecycle question |
| 4 | Stage 7 — delegation | Alone: it is the prize, and it can invalidate P1 |
| 5 | Stages 8–9 — inference routing, the process | Both are what coa wraps the binary in |
| 6 | The binary track | Read-only, no repo writes, fully independent |

Each agent owns files no other agent touches, so the fan-out needs no shared-write coordination.

### The anti-fabrication contract

Subagents report confidently and the parent cannot see their work. These rules are structural rather
than an instruction to be careful.

1. **An agent returns artifacts, not conclusions.** Its deliverable is a committed probe file, the
   command that runs it, and that command's raw output. Prose points at evidence; it never substitutes
   for it.
2. **No verdict without an assertion, in both directions.** `Owned` requires a passing probe that
   exercises the lever. `Opaque` requires a *negative* probe asserting the lever is absent or
   ineffective. "The types say X" is not a verdict.
3. **The parent re-runs everything.** The ledger is written from output the parent produced, not from
   agent reports. A row that will not reproduce ships as an open question with the claim quoted and
   labelled unverified — never as a verdict.
4. **Each agent must try to break its own positive result** before reporting it. The assumption
   checklist below is then run as a separate adversarial pass, by a different agent than the one that
   made the claim.
5. **Anything unverified reaches the maintainer marked as such.** No confident summary of a confident
   summary.

### The assumption checklist the survey must hit

The stage survey is the spine; this list guarantees the specific frictions that motivated the arc are
each struck rather than lost in a general sweep. A survey organised only around these would miss levers
nobody assumed anything about — which is how `toolAliases` stayed invisible — so it is a coverage
check, not the structure.

- The `Agent`/`mcp__coa__` name limit asserted in the arc design.
- `settingSources: []` fully isolates the session from the target repo's config (the D108 claim in
  `sdk-options.ts`).
- Layering on the `claude_code` preset is the only way to keep Claude Code's baseline behaviour.
- The demote set must be version-aware across the `Task`→`Agent` rename (arc risk R2).
- Removing the native delegation tool requires the allowlist, the denylist being the wrong lever.
- coa cannot substitute an implementation for a native tool.
- A subagent must be a coa session because the harness's own subagents are ungovernable.
- `disallowedTools` and `canUseTool` are coa's only per-tool levers.

### Live-probe sequencing

Subagents write live probes but do not run them. Six concurrent `COA_LIVE` sessions would race one
account into a rate limit — which has bitten this project before — and spend real budget doing it.
Live probes are collected during fan-out and executed in a single serialised pass afterwards.

## The binary track and the price of a fork

Agent 6 scans the shipped binary for its embedded JavaScript, seeking facts that settle ledger rows
which cannot be answered from outside: the real `claude_code` preset text, built-in tool schemas and
descriptions, what triggers compaction and what prompt drives it, the subagent machinery, and what
`settingSources: []` genuinely excludes.

This track is **best-effort and explicitly lower-confidence** than the probes. A Bun single-file
executable embeds its JavaScript, so string scanning reaches it, but the result is minified and
unstructured. Anything the scan cannot settle is reported as unsettled rather than inferred — a binary
reading never outranks a probe, and where the two disagree the probe wins.

**Read-only, and nothing extracted is committed.** Findings are cited in prose, never vendored. Given
the license, this is not fastidiousness.

The fork is priced in three tiers rather than argued in the abstract:

1. **Fork the wrapper.** Buys option serialisation, the stdio protocol, spawn and hook plumbing. Buys
   nothing about loop behaviour, since none of it lives there. Cheap and largely pointless — worth
   recording because it is the intuitive option.
2. **Patch the binary and point `pathToClaudeCodeExecutable` at it.** The only tier that reaches an
   `Opaque` stage. Priced as cadence × effort × breakage: upstream release cadence measured from actual
   npm version history; the per-release cost of re-deriving a patch against minified Bun output; the
   per-platform checksums in `manifest.json`; binary signing on win32 and darwin; and the license.
3. **Stop borrowing.** coa speaks to the model directly. This tier already ships — it is the pure-API
   path. Naming it reframes "fork" as what it is: a choice between borrowing the harness and not using
   it, rather than a third way.

**A fork is recommended only for a stage that returns `Opaque` *and* that P1 genuinely needs.** If no
stage meets both tests, the spike records "do not fork" with its reasoning, so the question stops
recurring every time the harness chafes.

## Deliverables

1. **The control ledger** — nine rows, verdict plus consequence plus version stamp — in
   `docs/design/research/`, following the existing spike convention.
2. **The probe suite** in `packages/adapter-claude-sdk/`.
3. **A P1 delta** — what the arc design got wrong and what changes because of it. The `Agent`-name
   limit is already on that list.
4. **The fork verdict**, promoted to an ADR if it proves a durable ruling.

## Verification

`pnpm typecheck` and `pnpm test` green. The offline probe suite passes from a clean checkout with no
credentials. The live pass runs serialised under `COA_LIVE`. Every ledger row cites a probe by name,
and the parent has reproduced each cited run.

## Out of scope

No P1 code. No behaviour change to the shipped adapter — findings feed P1 rather than being applied
opportunistically mid-spike. Nothing about DeepSeek or LongCat, this being Claude-specific. The gateway
(arc P5). The L-ASM calibration gate, which stays independently queued.

## Gate

The arc does not start until the ledger exists.

---

_Last reviewed: 2026-08-02_

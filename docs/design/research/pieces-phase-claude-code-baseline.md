# Research brief — Claude Code's system prompt & native tools (the pieces-phase baseline)

**Status:** research spike (READ-ONLY). No code, no pieces, no parity package built.
**Precedes:** the "pieces phase" spec — filling in `assemblePieces` so a governed agent gets a real
system prompt + context + tools instead of today's minimal/vanilla loop.
**Verified against:** installed `@anthropic-ai/claude-agent-sdk@0.3.196` (`sdk.d.ts`, `sdk-tools.d.ts`)
+ Anthropic docs + the captured live prompt in [harness-system-prompt-claude-code.md](harness-system-prompt-claude-code.md).
_Last reviewed: 2026-07-02._

---

## 0. TL;DR for the pieces-phase author

1. **The SDK gives you three prompt starting points, and coa is silently on the worst one for its goal.**
   coa passes `renderNative`'s output as a **custom `systemPrompt` string** ([render-native.ts](../../../packages/adapter-claude-sdk/src/render-native.ts),
   [sdk-options.ts:79](../../../packages/adapter-claude-sdk/src/sdk-options.ts#L79)). A custom string
   **replaces the prompt entirely** — the agent loses Claude Code's tool-use guidance, response-style
   rules, safety instructions, and environment context. That is *intentional* under coa's "strip our own
   prompt down" constraint, but it means **the agent behaviors the parity package must re-declare are the
   ones the custom-string path just deleted.** This is the whole reason the parity package exists.

2. **The native tool catalogue is 39 tools; the governed-coding-agent core is ~12.** The rest are
   Anthropic-harness/product features (Cron, Monitor, Artifact, Projects, Workflow, remote agents,
   onboarding) with no place in coa's model. Re-declare the core, govern the mutating file ops (already
   started), drop the harness features.

3. **coa is leaking the target repo's config into every governed session.** The adapter never sets
   `settingSources` or `tools`, so the SDK defaults apply: **all setting sources load** (user + project +
   local → the target's `CLAUDE.md`, `.claude/settings.json`, `~/.claude/CLAUDE.md`) and the built-in tool
   set is the full `claude_code` preset list. This is uncontrolled context/authority coa didn't author —
   it violates the "coa authors the non-spoofable channel" posture (D108) and should be closed as part of
   the pieces phase. See §6.

4. **For DeepSeek (pure API): nothing is native.** No system prompt, no tools, no environment context, no
   tool-call loop. coa must supply the minimal system-prompt scaffold (§7), the ~12-tool core (§2), and
   own the tool-call loop (cross-referenced open design, not solved here).

---

## 1. Structure of Claude Code's system prompt

### 1.1 The three starting points (verified SDK fact)

From the SDK `Options.systemPrompt` type ([sdk.d.ts:1946](../../../node_modules/.pnpm/@anthropic-ai+claude-agent-_4b93f34501ea1691e53c4f19bad9fabf/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts))
and [Anthropic's "Modifying system prompts" doc](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts):

| `systemPrompt` value | What the model gets |
| --- | --- |
| **omitted** | **Minimal default** — "covers tool calling but omits Claude Code's coding guidelines, response style, and project context." (Note: `claude -p` on the CLI uses the *full* prompt by default; the SDK does **not**.) |
| `string` | **Custom** — "The SDK sends only what you provide." Default tools' *guidance*, safety rules, environment context all **lost unless you re-add them**. ← **coa is here.** |
| `string[]` | Custom, split by the `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker into a cacheable static prefix + dynamic suffix. |
| `{ type:'preset', preset:'claude_code' }` | **Full Claude Code prompt** — tool-use instructions, code style/formatting, response tone/verbosity, security/safety, working-directory + environment context. Supports `append` (add to end) and `excludeDynamicSections` (move per-session context to the first user message for cross-session cache hits). |

**Consequence for the parity package.** The parity package's job is to reconstruct — as coa-governed
Pieces — the behavior-shaping content the `claude_code` preset carries but the custom-string path drops.
It is NOT a copy of the preset; it is a *minimal faithful re-declaration* of the parts that matter (§4).

### 1.2 Section-by-section anatomy (from the captured live prompt + the published corpus)

Sourced from [harness-system-prompt-claude-code.md](harness-system-prompt-claude-code.md) (a live capture of this very
harness) and the [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)
corpus (all prompt parts + 27 builtin tool descriptions + subagent/utility prompts, versioned per release).
Each section is tagged **ESSENTIAL** (a governed coding agent misbehaves without it) / **REMOVABLE** (coa
governs it deterministically, or it's harness-specific) / **RE-DECLARE** (parity package should carry a
minimal form).

| Section | Its job | coa disposition |
| --- | --- | --- |
| **Identity / intro** ("You are Claude Code… interactive agent for software-engineering tasks") | Sets role + that a human is in the loop. | **RE-DECLARE (minimal).** A governed agent needs *a* role line. coa should author a neutral one ("You are a coding agent operating under coa governance"), not impersonate Claude Code — matters doubly for DeepSeek. |
| **Safety / refusals** (security-testing posture, refuse destructive/mass-targeting/etc.) | Guardrail on dual-use + destructive requests. | **RE-DECLARE.** Prose safety is P5 "necessary-but-not-sufficient"; coa's deterministic gates (M3 close-gate, M7 cap, S-1 confinement) are the real backstop, but the prose still shapes refusals and should be present for both backends. |
| **Harness section** (markdown output, permission-mode semantics, `<system-reminder>` provenance, "prefer dedicated tools over shell", parallel tool calls, `file:line` refs) | Tells the model how *this* runtime behaves. | **PARTLY RE-DECLARE.** "Prefer dedicated file/search tools", "batch independent tool calls", and the code-style-matching line are ESSENTIAL behaviors that vanish on the custom-string path. The permission-mode / `<system-reminder>` specifics are coa-harness-specific and should be **re-authored to coa's actual harness**, not copied. |
| **Tool-use policy** (when to use which tool, subagent delegation, REPL conventions, "don't retry a denied call verbatim") | Steers efficient, correct tool use. | **RE-DECLARE (trimmed).** Keep the parts about the tools coa actually exposes (§2). Drop guidance for tools coa drops. |
| **Task management / TodoWrite behavior** (when to use the todo list) | Planning discipline on multi-step work. | **RE-DECLARE only if coa exposes a planning tool** (see §2 / §4 — likely **drop** for v1; coa has its own governance surfacing). |
| **Planning / ExitPlanMode** | Plan-mode contract. | **DROP for v1.** coa's attended model + M6 governance is the review surface; plan-mode is an SDK UX feature. |
| **Environment / context injection** (cwd, git status, platform, shell edition, OS, model id, date, knowledge cutoff) | Grounds the model in the runtime. | **RE-DECLARE (coa-authored).** This is the "dynamic section." coa should author it from the *session's* worktree/sandbox/model — **not** inherit the SDK's, and not leak the operator's box. This is also where the M4 `ContextPackage` eventually lands (D109 `render_context`). |
| **Memory** (persistent file memory protocol) | Cross-session memory. | **DROP.** coa owns conversation persistence (R-7 store) and has no `.claude` memory protocol. Do not re-declare. |
| **Autonomous / loop-tick / background** | Unattended-operation hooks. | **DROP.** v1 is attended (D92). |
| **Code-quality guidance** (comments = why-not-what, error handling, match surrounding style) | Output quality. | **RE-DECLARE (minimal).** Cheap, high-value, backend-neutral. |
| **Scratchpad / temp-dir**, **VSCode/IDE section**, **context-management** | Harness plumbing. | **DROP or re-author** to coa's actual harness (coa isn't the VSCode extension). |

**System-reminders** are not a prompt *section* — they're `<system-reminder>` blocks the harness injects
into message/tool-result streams at runtime (the captured prompt documents their provenance). In SDK terms
these are delivered via **hooks' `additionalContext`**, which is exactly the channel D108/D133 already
reserve for coa's `deliverReminder`. The parity package doesn't re-declare reminders; **M3/M9 already own
that channel** — the pieces phase just needs to start using it (today `deliverReminder` is a floor no-op).

### 1.3 The "dynamic sections" cache mechanics (relevant to coa's P1/cache invariant)

The preset embeds per-session context (cwd, git-repo flag, platform, shell, OS, auto-memory paths) *ahead
of* any `append`, so two sessions from different dirs get a cache miss. `excludeDynamicSections:true` moves
that block into the first user message. coa's `renderNative` already keeps a byte-stable most-stable-first
prefix for the same cache reason; when coa authors its own environment section it should **place volatile
per-session context last** (or in the first user turn) to preserve the same cache-hit property. This is a
design input for how the pieces phase orders the assembled system prompt, not a blocker.

---

## 2. The native tool catalogue

### 2.1 The full list (verified from the installed types)

`ToolInputSchemas` in [sdk-tools.d.ts:11](../../../node_modules/.pnpm/@anthropic-ai+claude-agent-_4b93f34501ea1691e53c4f19bad9fabf/node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts)
enumerates **39** tool input schemas. Note the schema *type* names (e.g. `FileRead`) differ from the
**model-facing tool names** (e.g. `Read`); the model-facing names are what go in `allowedTools`/`disallowedTools`.

**Coding-agent core (~12) — the set a governed coding agent actually needs:**

| Model-facing name | Schema type | Purpose | Permission behavior |
| --- | --- | --- | --- |
| `Read` | `FileReadInput` | Read a file (text/image/pdf/notebook). | Read-only; gated by `Read(glob)` deny rules. |
| `Write` | `FileWriteInput` | Overwrite/create a file. | Mutating → `canUseTool`. |
| `Edit` | `FileEditInput` | Exact-string in-file replacement. | Mutating. **coa denies this today** (demote to diff-shaped Mutate). |
| `Bash` | `BashInput` | Shell command (+ background, sandbox flag). | Mutating/arbitrary → `canUseTool` + OS sandbox (D118). |
| `Glob` | `GlobInput` | Filename pattern search. | Read-only. |
| `Grep` | `GrepInput` | ripgrep content search (rich flags). | Read-only. |
| `NotebookEdit` | `NotebookEditInput` | Edit a Jupyter cell. | Mutating. |
| `WebFetch` | `WebFetchInput` | Fetch a URL + summarize. | Egress → governed-egress (S-4). |
| `WebSearch` | `WebSearchInput` | Web search. | Egress. |
| `TodoWrite` | `TodoWriteInput` | Maintain the task list. | Inert (no side effect). |
| `Task` / subagents | `AgentInput` | Spawn a subagent (worktree/remote isolation, model override). | Spawns a governed child (D122 depth-1). |
| `ExitPlanMode` | `ExitPlanModeInput` | Leave plan mode with an approval request. | Plan-mode UX. |

**Harness / product tools (~27) — NOT part of a governed coding agent:**
`Agent` async/remote variants, `TaskOutput`/`TaskStop`/`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList`
(background-task mgmt), `Monitor`, `ScheduleWakeup`, `CronCreate`/`CronDelete`/`CronList` (scheduling),
`RemoteTrigger`, `Workflow`, `Artifact`, `PushNotification`, `Projects` (claude.ai project store),
`AskUserQuestion`, `ShowOnboardingRolePicker`, `EnterPlanMode`, `EnterWorktree`/`ExitWorktree`,
`REPL`, `ListMcpResources`/`Mcp`/`ReadMcpResource`/`ReadMcpResourceDir` (MCP plumbing), `ReportFindings`
(code-review). Most are Anthropic-product/harness features irrelevant to coa. (`EnterWorktree`/`ExitWorktree`
conceptually overlap coa's own worktree/fork manager — coa owns that itself, D90/D96/D103.)

### 2.2 Description shape

Tool *descriptions* (the prose the model reads) are **not** in the `.d.ts` — those only carry JSON-Schema
**input shapes**. The descriptions are compiled into the CLI binary and shipped as part of the
`claude_code` preset / tool registration; the authoritative published copy is the "27 builtin tool
descriptions" set in the [Piebald corpus](https://github.com/Piebald-AI/claude-code-system-prompts). They
are long, opinionated, and behavior-heavy (e.g. Bash's "avoid `find`/`grep`, use dedicated tools",
Read's pagination rules, Edit's uniqueness requirement). **For coa's governed tools (M6), the description
is coa's to write** — the M6 `TOOL_CATALOGUE` already owns each tool's name/partition/description, and the
adapter registers them as an in-process `coa` MCP server (`mcp__coa__*`). So coa does **not** inherit these
descriptions for its governed tools; it authors leaner ones. The parity package matters for the *built-in*
tools coa keeps un-replaced (Read/Bash/Glob/Grep/Write/Web*), whose descriptions the model only gets from
the preset — which the custom-string path removes.

### 2.3 How tool definitions reach the model

- **Which tools exist:** `Options.tools` (default `{type:'preset',preset:'claude_code'}` = all built-ins;
  or an explicit `string[]`; or `[]` = none). coa **doesn't set this** (§6). Plus `mcpServers` for
  MCP-provided tools (coa's governed catalogue rides here).
- **Which are usable:** `allowedTools` / `disallowedTools` (name lists; `disallowedTools` removes the tool
  *from the model's context* entirely). `toolAliases` can redirect a built-in name to an MCP tool (e.g.
  `{Bash:'mcp__workspace__bash'}`) — a mechanism coa could use to route a built-in name onto a governed
  tool instead of denying it.
- **Descriptions/schemas:** built-in descriptions come from the preset/CLI; MCP tool descriptions +
  Zod→JSON-Schema come from `createSdkMcpServer`/`tool(...)` (what [mcp-tools.ts](../../../packages/adapter-claude-sdk/src/mcp-tools.ts)
  builds from M6). Both are surfaced to the model as Anthropic-API `tools`.

### 2.4 canUseTool + Stop hooks relate to the tools

- **`canUseTool(toolName, input) → PermissionResult`** ([sdk.d.ts:1309](../../../node_modules/.pnpm/@anthropic-ai+claude-agent-_4b93f34501ea1691e53c4f19bad9fabf/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts)):
  called **before each tool execution**, exactly once per call. This is coa's **per-tool block seam** —
  M8 assembles it from M7 cap + M3 `perToolDeny` (first-deny-wins, fail-closed). Already wired
  ([session-options.ts:51](../../../packages/adapter-claude-sdk/src/session-options.ts#L51)).
- **`Stop` hook** (one of 30 `HOOK_EVENTS`): coa's **close-gate seam** — returns `{decision:'block',
  reason}` to block the close and feed M3's message back (build-verified; `continue:false` would *end* the
  turn). Already wired ([sdk-options.ts:54](../../../packages/adapter-claude-sdk/src/sdk-options.ts#L54)).
- **Other relevant hook events** for the pieces phase (from `HOOK_EVENTS`, [sdk.d.ts:760](../../../node_modules/.pnpm/@anthropic-ai+claude-agent-_4b93f34501ea1691e53c4f19bad9fabf/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts)):
  `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `SessionStart`, `PreCompact`/`PostCompact`,
  `SubagentStart`/`SubagentStop`. `PostToolUse` + `UserPromptSubmit` `additionalContext` are the
  **non-spoofable reminder-delivery channel** (D108/D133) the pieces phase should light up for
  `deliverReminder`. There is **no programmatic mid-session `role:system` channel** (verified SDK fact,
  SPEC §M9) — standing authority must ride the systemPrompt at start + these hooks mid-session.

---

## 3. The two forces driving the pieces phase (why this baseline matters)

- **Parity package (Claude SDK is the fat outlier).** Because Claude Code *natively* bundles tools +
  behaviors via the preset, and coa deliberately runs on the custom-string path, coa must **re-declare the
  removed behaviors as coa-governed Pieces** so they (a) exist and (b) "can't be removed" (they're part of
  coa's governance model, not the backend's). §4 is the map.
- **DeepSeek / pure API (nothing native).** A chat-completions model has no preset, no tools, no
  environment context, no loop. coa supplies all of it. §7 is the minimal set. The Claude baseline defines
  the floor: whatever the `claude_code` preset provides that a coding agent genuinely needs is what a pure
  model needs coa to inject.

---

## 4. Mapping table — for each native feature, what coa does

**(a) re-declare faithfully in the parity package · (b) govern/replace · (c) drop.** One-line rationale each.

### 4.1 System-prompt behaviors

| Native feature | coa | Rationale |
| --- | --- | --- |
| Identity/role line | **(a)** re-declare, coa-neutral | Agent needs a role; don't impersonate Claude Code (also serves DeepSeek). |
| Safety/refusal posture | **(a)** re-declare (minimal) | Prose guardrail; deterministic gates are the real backstop (P5). |
| "Prefer dedicated file/search tools" | **(a)** re-declare | High-value behavior lost on the custom-string path. |
| "Batch independent tool calls" | **(a)** re-declare | Efficiency behavior, backend-neutral. |
| "Match surrounding code style; comments = why" | **(a)** re-declare (minimal) | Cheap, high value. |
| Environment/context block (cwd/git/platform/model) | **(a)** re-declare, **coa-authored from the session** | Must reflect coa's worktree/sandbox/model, not the operator's box; future M4 `ContextPackage` home. |
| Permission-mode / `<system-reminder>` semantics | **(b)** re-author to coa's harness | coa's harness ≠ Claude Code's; describe coa's actual channels. |
| Memory protocol (`.claude` file memory) | **(c)** drop | coa owns R-7 persistence; no `.claude` memory. |
| Plan-mode / ExitPlanMode | **(c)** drop | Attended + M6 governance is the review surface. |
| Autonomous/loop-tick/background | **(c)** drop | v1 attended (D92). |
| TodoWrite planning discipline | **(c)** drop (v1) | coa surfaces governance/flags itself; revisit if a planning tool is exposed. |
| VSCode/IDE, scratchpad, context-mgmt plumbing | **(c)** drop / re-author | Harness-specific to Claude Code, not coa. |

### 4.2 Tools

| Native tool | coa | Rationale |
| --- | --- | --- |
| `Read`, `Glob`, `Grep` | **(a)** keep built-in + re-declare description guidance | Read-only; the M6 `Retrieve`/`Inspect` distilled reads are the *governed* complement, but raw Read/search stay useful. |
| `Edit` | **(b)** govern/replace | Already denied ([claude-sdk-adapter.ts:110](../../../packages/adapter-claude-sdk/src/claude-sdk-adapter.ts#L110)) → M6 diff-shaped `edit_symbol`/`apply_patch` (emits change-events on the M1 spine). |
| `Write` | **(b)** govern (or keep, confined) | Whole-file writes should flow through M6 confinement/change-events too; today it's an un-governed built-in — a gap. |
| `Bash` | **(b)** govern | Keep (needed) but under `canUseTool` + OS sandbox (D118); egress/mutation is where the cap + deny bite. |
| `NotebookEdit` | **(b/c)** govern if in scope, else drop | Only if notebooks are a target; otherwise drop. |
| `WebFetch`, `WebSearch` | **(b)** govern egress (S-4) | Keep but route cost/deny through governed-egress; no `canUseTool` for the D117 secondary path. |
| `Task`/subagents | **(b)** govern (D122 depth-1) | coa governs child sessions via its own worktree/fork manager, not the SDK's. |
| `TodoWrite` | **(c)** drop (v1) | See above. |
| `EnterWorktree`/`ExitWorktree` | **(c)** drop | coa owns worktrees (D90/D96/D103). |
| Cron/Monitor/Workflow/RemoteTrigger/Artifact/PushNotification/Projects/AskUserQuestion/ShowOnboardingRolePicker/REPL/Task* mgmt/MCP-resource tools/ReportFindings | **(c)** drop | Anthropic-product/harness features outside coa's model. |

### 4.3 Delivery/enforcement seams (already coa-owned, not "features to re-declare")

| Seam | coa | State |
| --- | --- | --- |
| `canUseTool` (per-tool block) | **own** | wired (M8→M9). |
| `Stop` hook (close-gate) | **own** | wired. |
| `PostToolUse`/`UserPromptSubmit` `additionalContext` (reminders) | **own** | `deliverReminder` floor no-op → light up in pieces phase. |
| `settingSources` / `tools` scoping | **own — currently unset (bug)** | §6. |
| OS sandbox from `sandboxPolicy` | **own** | wired (D118; advisory on Windows). |

---

## 5. Current coa state (what the pieces phase starts from)

- `renderNative` ([render-native.ts](../../../packages/adapter-claude-sdk/src/render-native.ts)) emits a
  **custom-string** systemPrompt = joined `prefixHead` Piece bodies + salient `systemReminders`, plus a
  re-anchor file at `.claude/CLAUDE.md` in the worktree. With **empty pieces → empty/vanilla prompt** (the
  North-Star regression guard). So today the agent runs on essentially **no behavioral scaffolding**.
- `denyBuiltins` denies only `Edit`. `registerTools` builds the M6 governed catalogue into the `coa` MCP
  server (currently 11 buildable tools). Everything else is the SDK default.
- `deliverReminder` / `render_context` / `inject_runtime` / `cache_control` are **floor no-ops**
  ([claude-sdk-adapter.ts:121-138](../../../packages/adapter-claude-sdk/src/claude-sdk-adapter.ts#L121)) —
  the pieces phase and M4 fill these.
- `capabilityProfile` = `barebonesProfile`.

---

## 6. Finding: uncontrolled config leak (close in the pieces phase)

`buildBaseOptions` ([sdk-options.ts:63](../../../packages/adapter-claude-sdk/src/sdk-options.ts#L63)) sets
`systemPrompt`, `allowedTools`, `disallowedTools`, `permissionMode`, `model`, `reasoning` — but **never
`settingSources` or `tools`.** Per the docs, omitting `settingSources` loads **all** sources (user +
project + local), and omitting `tools` yields the full `claude_code` preset tool set. Effects on every
governed session:

1. The **target repo's `CLAUDE.md` / `.claude/CLAUDE.md`**, its `.claude/settings.json`
   (`.local` too), and **`~/.claude/CLAUDE.md`** are injected into the conversation as project context —
   authority coa did **not** author and cannot vouch for (breaks the D108 non-spoofable-channel posture).
2. Output styles, on-disk agent frontmatter, and project `.mcp.json` may also load.
3. The full built-in tool set is present unless explicitly denied (deny-list, not allow-list — fragile).

**Recommendation (pieces-phase):** make tool/context surface **explicit**, not default-inherited:
`settingSources: []` (SDK isolation) unless coa deliberately wants a specific source; set `tools` to the
explicit kept set (allow-list posture); consider `strictMcpConfig:true` so only coa's `coa` MCP server is
present. The current reliance on the SDK default also loading coa's own re-anchor `.claude/CLAUDE.md` is
incidental — make that load intentional. (This is a design recommendation; **no code changed** in this spike.)

---

## 7. DeepSeek / pure-API: the minimal set coa must supply

A pure chat-completions adapter (goal #2) inherits **nothing**. The Claude baseline says the floor is:

**7.1 System-prompt scaffold (coa-authored, from §4.1's (a) rows):**
role line · safety/refusal posture · tool-use policy for the exact tools exposed (prefer dedicated tools,
batch calls, don't retry denied calls) · minimal code-quality guidance · a coa-authored environment block
(worktree, platform, model, date) placed cache-friendly. This is the same content the parity package
re-declares for Claude — so **build it once, backend-neutral**, and let the Claude adapter and the DeepSeek
adapter both consume it. (The Claude adapter additionally *keeps* the preset's built-in tool descriptions
for un-replaced tools; DeepSeek has none, so coa must also provide tool descriptions for every tool.)

**7.2 Minimal tool set (the ~12 core, §2.1):** `Read`, `Write`, `Edit`(→governed Mutate), `Bash`, `Glob`,
`Grep`, and optionally `WebFetch`/`WebSearch`. For a pure API these are **not native** — coa provides each
as a tool definition (name + description + JSON-Schema) in the request's `tools`, and **executes them
itself** (file I/O, ripgrep, shell). M6's governed catalogue already *is* a set of coa-executed tools with
Zod schemas — the pure adapter reuses those definitions directly instead of registering them as an MCP
server. This is the payoff of the "coa owns the scaffolding" direction.

**7.3 Context injection:** no CLAUDE.md/settingSources machinery exists — coa injects context as system or
first-user-message content (the M4 `ContextPackage` via `render_context`, once built).

**7.4 The tool-call loop — OPEN (cross-reference, not solved here).** The Claude adapter delegates the
whole agentic loop to `query()`. A pure adapter needs coa to own it — likely a lower-level port primitive
(`complete(messages, tools) → {text, toolCalls, usage}`) + a coa-side loop driver, or a minimal loop inside
the thin adapter. Tracked in [[deepseek-adapter-direction]] ("Open for the #2 design"); the pieces phase
should treat loop ownership as a **precondition** for the DeepSeek path, not part of this brief.

---

## 8. Recommendations for the pieces-phase spec (summary)

1. **Author a minimal, backend-neutral "baseline behavior" Piece set** (§4.1 (a) rows) — role, safety,
   tool-use policy, code-quality, coa-authored environment. This is *both* the parity package's content and
   DeepSeek's scaffold. One source, two consumers.
2. **Keep coa on the custom-string path** (honors the strip-down constraint) — do **not** switch to
   `preset:'claude_code'`. The point is coa authoring the authority, not renting Anthropic's.
3. **Close the config leak (§6):** explicit `settingSources` + `tools` (allow-list) + `strictMcpConfig`.
4. **Light up `deliverReminder`** over `PostToolUse`/`UserPromptSubmit` `additionalContext` (the channel is
   reserved; it's a floor no-op today).
5. **Re-declare only the built-in tools coa keeps un-replaced** (Read/Glob/Grep/Bash/Write/Web*) with lean
   coa-authored descriptions; govern the mutating ones through M6; drop the ~27 harness tools.
6. **Order the assembled prompt cache-friendly** (stable prefix, volatile env last / first-user-message),
   preserving the P1 byte-stability `renderNative` already targets.
7. **Do not re-declare:** memory protocol, plan-mode, autonomous/loop, IDE/scratchpad plumbing, TodoWrite
   (v1).

---

## Sources

- Installed SDK types: `@anthropic-ai/claude-agent-sdk@0.3.196` — `sdk.d.ts` (`Options`, `HOOK_EVENTS`,
  `CanUseTool`, `PermissionResult`, `systemPrompt`/`tools`/`settingSources`), `sdk-tools.d.ts`
  (`ToolInputSchemas` — the 39 tool input schemas).
- [Modifying system prompts — Claude Code / Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
  (minimal-default vs `claude_code` preset; `append`/`excludeDynamicSections`; `settingSources` ↔ CLAUDE.md).
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) —
  published corpus: all prompt parts, 27 builtin tool descriptions, subagent (Plan/Explore/Task) + utility
  prompts, versioned per release.
- [harness-system-prompt-claude-code.md](harness-system-prompt-claude-code.md) — live capture of the current Claude Code
  harness prompt (primary source for §1.2).
- coa source: [render-native.ts](../../../packages/adapter-claude-sdk/src/render-native.ts),
  [sdk-options.ts](../../../packages/adapter-claude-sdk/src/sdk-options.ts),
  [claude-sdk-adapter.ts](../../../packages/adapter-claude-sdk/src/claude-sdk-adapter.ts),
  [SPEC.md §M9](../handoff/SPEC.md). Memory: [[deepseek-adapter-direction]], [[m9-status]], [[m6-status]],
  [[m5-status]], [[m4-status]], [[m8-status]].

# P1a — the foundation fixes

Design for the first plan of the
[backend-independent agent arc](./2026-07-31-backend-independent-agent-arc-design.md). P1a fixes eight
live defects in shipped code so that P1b — the orchestration slice — has a foundation that behaves the
way its design assumes.

Every defect was found by the control spike and is recorded in the
[control ledger](../../design/research/2026-08-02-claude-sdk-control-ledger.md), which is the evidence
and the version stamp for everything below. All eight were re-verified against `main` at `e448a92`
before this design was written; two of them are worse or different than the survey reported, and those
corrections are the reason this is a design rather than a checklist.

## Why this is its own plan

The arc's P1 assumed a per-tool governance gate that runs, a stop that reads as a stop, and a built-in
tool list that knows the tool P1b is about to demote. None of those is true today. Building the
orchestration slice on top of them would mean building a governed `spawn_agent` into a system where
`canUseTool` does not fire for the tools coa granted — the fix would be invisible under the bug.

P1a is therefore not a cleanup pass. It is the set of things that must be true before P1b's design
means what it says.

## What was verified

| # | Item | Verdict | Where |
| --- | --- | --- | --- |
| 1 | `allowedTools` auto-approves, suppressing `canUseTool` | Confirmed, **and broader than reported** | `tool-frame.ts:67` → `sdk-options.ts:93` |
| 2 | `KNOWN_BUILTINS` is stale in both directions | Confirmed | `tool-frame.ts:24-36` |
| 3 | Only 1 of 30 hook events is registered | Confirmed | `session-options.ts:78-80` |
| 4 | `maxBudgetUsd` is raised, not returned | Confirmed, **with nuance** | `run-live-session.ts:24` |
| 5 | coa never reads `terminal_reason` | Confirmed | `turn-frames.ts:121-130` |
| 6 | The D133 standing-authority path is inert twice over | Confirmed | `render-native.ts:50-51`, `sdk-options.ts:106` |
| 7 | `settingSources: []` does not fully isolate | Confirmed | `sdk-options.ts:98-107` |
| 8 | `allowAllTools` returns a bare allow | Confirmed | `live-smoke-helpers.ts:35` |

### Two findings the survey did not carry

**The shipped permission path has the same defect as the test helper.** `toSdkPermission`
(`sdk-options.ts:38-42`) returns `{ behavior: 'allow' }` with no `updatedInput`. It is type-valid and
passes every offline probe; against the real CLI it produces a permission error for every tool. It is
masked today *because of* item 1 — with everything auto-approved, the callback barely fires. **Fixing
item 1 alone would make every tool call on the Claude path fail.** Items 1 and 8 are one change.

**Delegation is a special case, and the ledger says otherwise.** The ledger concludes that the
`allowedTools` bug "explains the delegation result above without needing delegation to be a special
case." The delegation probe's `liveOptions` (`stage-7-delegation.live.test.ts:82-92`) sets **no
`allowedTools` at all**, so `allowedTools` cannot be the cause. `canUseTool` is blind to a native spawn
independently. Fixing item 1 will not change that, and `PreToolUse` is the only seam proven to see it.
This correction is the whole justification for the two-seam split below.

**One thing already exists and is unfed.** `console-transcript` renders a `DenyNotice` for
`denyKind: 'close-gate' | 'cost-cap'`, and `console-viewmodel/reads.ts` schematises it. M0's wire
`turnFrameSchema` has no `deny` member and `turn-map.ts` never emits one, so that renderer is fed only
by mocks. The UI half of items 4 and 5 is already built.

## The design

### 1. The governance gate — items 1, 8, and the hook seam

`ToolTransport`'s auto-approve output is renamed `autoApprove`, and **nothing populates it** — it is
always empty after this plan, and remains on the type only because the SDK option it maps to still
exists and a future deliberate bypass would belong there. Availability was already carried by `tools`
(built-ins) and MCP registration (coa tools), so nothing is lost; the rename exists so the misreading
that caused this cannot recur silently.

`toSdkPermission` takes the tool input and echoes it back on allow. `session-options.ts` threads the
input through from its `SdkCanUseTool` wrapper. `allowAllTools` in `live-smoke-helpers.ts` takes the
identical shape.

`session-options.ts`'s hook wiring generalises from a hardcoded `Stop` entry to an assembly that
composes multiple events. `PreToolUse` registers alongside it, routed into the same M8 predicate.

**The de-dup rule.** `PreToolUse` judges **only the delegation spellings** (`Task` and `Agent`);
everything else falls through to `canUseTool`. No call is judged by both seams. A `PreToolUse` deny
produces no `permission_denied` record, but for delegation there is no record to lose, since
`canUseTool` never sees the call. P1b widens the `PreToolUse` set if it needs to.

This is a durable decision, not an implementation detail — see the ADR in §6.

### 2. The built-in surface — item 2

`KNOWN_BUILTINS` expands to the pinned SDK's real catalogue and carries **both** delegation spellings.
Both are required: `system:init.tools` advertises `Task` while the model emits `Agent`, live-verified
inside one run.

A drift test lands in `control/`, following the pattern the probe suite already uses. It declares a map
from the SDK's generated schema type names (`sdk-tools.d.ts`) to model-visible tool names, and asserts
that **every** schema name is accounted for — either mapped to a built-in coa recognises, or explicitly
classified as not a model-visible tool. A new or removed SDK name fails the test and names what
expired. This is the mitigation ADR-0026 prescribes for a boundary that moves ~27 times a month.

The set keeps its existing drop-unknown behaviour; the drift test is what makes the drop safe.

### 3. The stop vocabulary — items 4 and 5

Today every non-success result becomes `{ t: 'error', message: <subtype> }`, and the budget cap arrives
as a thrown exception that `run-live-session.ts` catches into the same generic error frame. A cap block,
a close-gate block, a turn-cap cutoff and a clean finish are indistinguishable.

- **M0** (`packages/shared/src/push.ts`) — `turnFrameSchema` gains
  `{ t: 'deny', denyKind: 'close-gate' | 'cost-cap', reason }`, matching the console's existing enum
  exactly so no UI schema changes. `turn-boundary` gains an optional `terminal` field carrying the
  SDK's `TerminalReason`.
- **M9** (`turn-frames.ts`) — reads `terminal_reason` off both result shapes onto the boundary frame,
  and maps `stop_hook_prevented` to a `close-gate` deny.
- **M9** (`claude-sdk-adapter.ts`) — catches the budget throw out of the `for await`, emits a
  `cost-cap` deny through `onTurn`, and returns without rethrowing: a deliberate stop, not a fault.
  **Recognition is deliberately narrow** — the SDK raises a plain `Error` ("Reached maximum budget
  ($0.02)") with no inspectable subtype, so the adapter treats a throw as the cap only when coa set
  `maxBudgetUsd` for this run **and** the message matches; everything else rethrows unchanged, so
  transient network failures keep their existing `describeLoopFailure` treatment. Matching on a
  vendor message string is fragile by nature, which is why the fallback is "rethrow" rather than
  "assume cap" — a missed match degrades to today's behaviour, never to a swallowed error. This
  belongs in M9 because it is translation of a backend-specific signal into neutral vocabulary — the
  same job `turn-frames.ts` already does. The cap *value* still comes from M8, so M9 continues to hold
  no policy.
- **M8** (`session-handlers.ts`) — routes the new frame through the existing stamp/emit/persist path.
- **console-viewmodel** (`turn-map.ts`) — maps the push `deny` frame to the view `deny` frame.

**`maxTurns` is reported, not denied.** coa sets it nowhere today. It is a harness bound, not one of
SC-1's two blocks, and it outranks the close-gate — with `maxTurns: 1` against a Stop hook that blocks
every time, the run ends on the turn cap and never reaches `stop_hook_prevented`. Calling it a coa
denial would be dishonest about which system stopped the work, so it rides `terminal` instead.

### 4. The dead standing-authority path — item 6

`.claude/CLAUDE.md` cannot load under `settingSources: []`, and adding `'project'` to load it would
reopen exactly the leak the isolation exists to close. Separately, nothing has ever written the file:
`BackendConfig.files` is produced by `renderNative` and consumed by nobody, and the DeepSeek and LongCat
adapters both hardcode `files: []`. The field has never carried anything anywhere.

So it goes: `REANCHOR_PATH` and the `files` production are removed from `render-native.ts`;
`BackendFile` and `BackendConfig.files` are removed from `@coa/spi`; the `files: []` stubs are removed
from both thin adapters.

The stale comment at `render-native.ts:44-45` — "there is no programmatic mid-session role:system
channel (verified SDK fact)" — is rewritten to state what the probes found. `MessageParam.role` now
admits `'system'`, so the premise is wrong; the CLI transmits such a message without obeying it, so the
conclusion holds. The channel that **does** work is a `shouldQuery:false` user message, which lands its
content in context at the cost of its own turn. That cost makes injection a policy decision, so it is
recorded here for whichever increment gains a consumer, and not built now.

### 5. Isolation honesty — item 7

`settingSources: []` isolates user/project/local settings files and nothing else. Of its four leaks,
one is closable:

- **`skills`** — omitting the option is not "skills off"; the CLI's own discovery defaults still apply,
  so a governed session can see skills from the target repo and the user's home directory that coa
  never authored. `sdk-options.ts` sets `skills: []`. It is a context filter, not a sandbox — the files
  stay readable through `Read`/`Bash` — so this closes the accidental path, not a determined one.
  Nothing coa builds supplies skills today. A later skills arc owns how coa's Pieces meet the harness's
  native skills mechanism and will turn this from empty into a list.
- **The managed/policy tier** is read from disk by design and cannot be turned off. Recorded honestly
  in the comment; no code.
- **`.mcp.json`** is covered, but by `strictMcpConfig`, not `settingSources`. The comment at
  `sdk-options.ts:98-106` credits the wrong option and is corrected.
- **`AgentDefinition.memory: 'project'`** auto-loads from the target repo on a channel `settingSources`
  does not appear on. coa passes no `agents` today, so there is nothing to fix — it is recorded as a
  constraint P1b inherits the moment it declares a child agent.

### 6. Docs

**ADR-0028 — "Per-tool governance rides two seams."** `canUseTool` sees every tool call except the
native delegation call; `PreToolUse` sees that one. The split is the harness's behaviour, not coa's
preference, so it is durable and belongs in an ADR rather than a comment. Its consequence — that coa's
two SC-1 blocks render as denials while a vendor bound like `maxTurns` renders as a terminal reason and
is never called governance — folds in as part of the same ruling.

**The control ledger is corrected** on the delegation claim (per "Two findings" above), and its "live
bugs" section marks each item this plan fixes.

**ROADMAP** gains the P1a entry.

`AGENTS.md` and SPEC §B are **not** touched. Their opening thesis is stale, and rewriting it is the
arc's own doc work, not P1a's.

## Verification

The baseline is the known-failure state on `main`: 10 test failures (5 in `adapter-deepseek`,
"streaming response had no body"), 9 lint errors, 38 files flagged by `pnpm format`, and `pnpm
docs:check` failing only on the untracked `TEMP.md`. **None of these may grow.** `pnpm typecheck` is
clean and must stay clean.

New offline probes cover each fix. `docs/superpowers` is excluded from `docs:check`, so this spec needs
no router entry.

**One live smoke gates the plan**, scoped to the gate repair alone: a governed session asks the model to
read a file; the smoke asserts that `canUseTool` **was** consulted for the call **and** that the read
actually executed. Both halves are needed — the first proves item 1 is fixed, the second proves item 8
is fixed, and either one alone can pass while the system is broken. This is the one change where
offline green proves almost nothing, because the defect it guards against is type-valid. P1a does not
close until it is green.

## Commits

Subject-only Conventional Commits, no body, no trailers, no scopes, staged by name.

1. The gate repair — the allow-result echo, the empty auto-approve set, the generalised hook assembly,
   and `PreToolUse`. **In that order**, which is what makes it safe to split: echoing `updatedInput`
   is correct today and strictly improves a path that is currently cold, and only then does emptying
   the auto-approve list make that path hot. Splitting the other way round — empty first, echo later —
   would ship a state where every tool call fails, which is the hazard this ordering removes. The
   implementation plan takes this as four commits accordingly.
2. `fix: recognise the delegation tool under both spellings` — the expanded built-in set and its drift
   test.
3. `feat: distinguish a governed stop from a loop error` — the deny frame end to end, M0 through the
   console, plus `terminal_reason`.
4. `refactor: remove the inert standing-authority file path`
5. `fix: close the skills leak in session isolation` — plus the two comment corrections.
6. `docs: record the two-seam governance split` — ADR-0028, the ledger correction, the ROADMAP entry.

The gate repair changes the main backend's behaviour and its proof is the live run. Commits 2–6 are
independent of it, so they can land while an account is unavailable — but P1a is not done until the
gate repair is verified live.

## Out of scope

P1b in all forms: the governed `spawn_agent`, cross-backend children, the child session and its parent
link, depth guarding, root-budget attribution. The ADR-0027 tool-surface demotion, including aliasing
`Agent` onto a coa tool. The `AGENTS.md` and SPEC §B rewrite. Anything in `OPEN.md`. The skills arc.

## Open, needing the maintainer

Not blocking P1a; recorded so they are not lost.

1. **Whether an aliased `Agent` reaches `canUseTool`.** Unmeasured. The un-aliased one does not. P1b's
   design depends on the answer and it is one cheap live probe.
2. **The two deliberately-unsettled control probes.** Forcing a real auto-compaction costs several US
   dollars, 10–20 minutes and a visible slice of a rate-limit window; the synthesised-transcript probe
   hangs rather than failing and needs abort-on-evidence restructuring first.
3. **The `ai` / `@ai-sdk` version decision** on M9's secondary path — SPEC pins `ai@^6` /
   `@ai-sdk/anthropic@^3`, and v7 / v4 are current.

---

_Last reviewed: 2026-08-02_

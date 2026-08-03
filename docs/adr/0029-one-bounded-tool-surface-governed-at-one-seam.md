# 0029 — One bounded tool surface, governed at one seam

- Status: accepted
- Date: 2026-08-03
- Supersedes: [0028](0028-per-tool-governance-rides-two-seams.md)

## Context and problem

A Claude-backed agent and a pure-API agent were the same product in name only. Claude got
~37 native built-ins; the pure-API backends got six tools coa wrote. Worse, three
measurements landed in a week that broke the governance model underneath both:

- `allowedTools` means **auto-approve**, so it suppressed `canUseTool` for exactly the
  tools coa granted (ADR-0028's context).
- `canUseTool` is **never** consulted for the native delegation call.
- The P1a gate run (2026-08-03) found `canUseTool` is not consulted for an **ordinary
  in-cwd `Read`** either, apparently because of the `claude_code` system-prompt preset —
  measured effect, hypothesised mechanism.

And a fourth, found while designing the fix: `PostToolUse` was registered nowhere, and the
`Reconciler` — producer ② — was exported, tested, and **never constructed**. So a file
written by a native `Edit`, or by anything a `Bash` command ran, reached M1 on **no**
backend. Meanwhile coa's own prompt told every agent "your file changes are recorded on a
change spine."

## Decision drivers

- The cost cap is one of only two blocks in the system (ADR-0009). A block that does not
  run is worse than no block, because the record claims it did.
- A governance layer that does not observe the edits its agent makes is a governance
  claim, not a governance layer.
- "Any agent, any backend, one system" is the arc's first goal. Two agents with different
  capabilities are not one system.
- Trained tool priors are worth real performance, and they cover the **whole** contract —
  output shape included, not just the input schema.

## Considered options

1. **coa owns the tool implementations**, either aliased onto native names via
   `toolAliases` or published outright under `mcp__coa__*`. Maximum uniformity: one
   schema, one handler, identical on every backend.
2. **coa keeps native implementations and governs from the side** — hooks for the gate and
   the record.
3. **Leave the surfaces divergent** and accept that "governed" means something different
   per backend.

## Decision

**Option 2, with a bounded surface.**

**The built-in floor is eight tools** — `Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`,
`WebSearch`, `WebFetch` — and `tools` is now set unconditionally. An empty capability
frame used to be a pass-through granting everything; it now yields the floor, and an allow
list narrows the floor rather than widening it. Everything removed was ungoverned,
unrecorded, and unmatched on any other backend.

**coa owns no native tool implementation.** ADR-0027 ruled that a tool is aliased or owned,
never both; this resolves that choice, for every tool in the floor, toward **neither** —
coa does not substitute a body. The reason is that a trained prior covers the output
contract: `Read` emits numbered lines that `Edit`'s exact match is calibrated against, and
substituting the body while keeping the name breaks the chains built on it. Anthropic's own
implementations demonstrate the failure mode when that contract slips — the line-number
prefix skewing `Edit` replacement widths (claude-code#36654) and a truncated `Read` being
treated as a whole file (claude-code#28783). coa would be reproducing those hazards for no
gain.

**`PreToolUse` is the single per-tool gate**, judging every call rather than only
delegation. It **denies or abstains and never asserts `allow`**: SC-1 gives coa two blocks
and zero grants, and an explicit allow at that seam is an auto-approve — the same class of
mistake as routing allow-intent onto `allowedTools`.

**`PostToolUse` drives producer ②**, and the reconciler is constructed at last. coa does
not parse `tool_input` per tool; the reconciler scans the worktree, dedups coa's own
precise writes into a `confirm`, and respects `.gitignore` — so one trigger covers a native
`Edit`, a `Write`, and any file a shell command touched, which per-tool parsing would miss.
The pure-API loop fires the same `observeChanges` port at its own tool boundary. One
neutral port, two realizations, no plane above M9 branching.

## Why this supersedes 0028

ADR-0028 considered "move everything to `PreToolUse`" and rejected it, to preserve the
SDK's `permission_denied` record for every tool `canUseTool` could see. Two things changed:
the set of calls `canUseTool` is actually shown is smaller than 0028 assumed — possibly
excluding ordinary reads — so the records being protected may not exist; and coa now emits
its own `deny` frame into its own append-only log, which is the record coa depends on. The
two-seam split was the right decision on the evidence available; the evidence moved.

## Consequences

**Good.** Both agents carry the same eight capabilities, the same gate, and the same
record. Governance rides the seam measured to see calls rather than the one measured to
miss them. The change spine finally hears about native edits — on both backends, since the
reconciler gap was never Claude-specific. And the model keeps every trained prior, because
coa changed what it *observes*, not what the tools *are*.

**Bad.** `TodoWrite` is gone with the rest, and with it the console's plan checklist —
convergence by deleting a shipped feature. Native delegation is gone ahead of the governed
`spawn_agent` that replaces it, so there is an interval with no delegation at all. Two
capabilities on the floor (`Bash`, and the two web tools) run Anthropic's implementations
with coa observing rather than executing, so coa's visibility there is only as good as the
hook.

**Unproven.** The whole gate rests on a `PreToolUse` deny being honoured by the CLI, which
is verified against TypeScript types only: `sdk.mjs` never reads `hookSpecificOutput` while
the bundled binary does. The probe exists and is unrun. **If the deny is not honoured, this
decision loses its governance leg and option 1 wins by default.** Recorded as the condition
of this ADR, not as a detail.

Also unmeasured: whether `PostToolUse` fires for every tool including `Bash`, and whether
the `FileChanged` hook — present in the SDK's `HOOK_EVENTS`, never tried — would be a finer
trigger than scanning after every call.

**Degradation.** The reconciler baselines itself with `git ls-files`, so outside a git
worktree it cannot run. It is built lazily and its failure latches to a no-op: coa must
work on any project, and producer ② is an enhancement (D85). A non-git project therefore
gets the gate but not the record, silently — which is the honest floor, not a hidden
failure, but it is a floor.

---

_Last reviewed: 2026-08-03_

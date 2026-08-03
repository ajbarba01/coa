# 0028 — Per-tool governance rides two seams

- Status: accepted
- Date: 2026-08-03

## Context and problem

coa routes every per-tool decision — M7's cost cap and M3's deny rules — through the SDK's
`canUseTool` callback. Two measurements broke that model.

`allowedTools` means **auto-approve**, not availability. A tool listed there never reaches
`canUseTool`, and coa mapped its allow-intent onto it — so per-tool governance did not run
for exactly the tools coa granted, and in the pass-through case that was every coa tool.

Separately and independently, `canUseTool` is **never** consulted for the native delegation
call. The model emitted `Agent` and the callback saw nothing. This was measured in a run
that set no `allowedTools` at all, so it is intrinsic to the delegation tool rather than a
consequence of auto-approval.

## Decision drivers

- The cost cap is one of only two blocks in the whole system (ADR-0009). A block that does
  not run is worse than no block, because the record claims it did.
- Delegation is the single call most worth governing: it spawns work coa did not authorise.
- `PreToolUse` sees every call including the spawn, but a `PreToolUse` deny produces no
  `permission_denied` record — documented, not independently measured — so it is not a free
  replacement for `canUseTool`.

## Considered options

1. **Keep everything on `canUseTool`.** Leaves the spawn ungoverned, permanently.
2. **Move everything to `PreToolUse`.** One seam, at the cost of every denial record — every
   tool that `canUseTool` *can* see would lose its audit trail to save one that it can't.
3. **Both seams, split by what each can see.**

## Decision

**`canUseTool` judges every tool call it is shown; `PreToolUse` judges only the delegation
call.** No call is judged by both. `PreToolUse` abstains on everything else, so the denial
record is preserved for every tool that produces one, and the one call that produces none
is still governed.

`allowedTools` is left permanently empty. Availability belongs to `tools` (built-ins) and to
MCP registration (coa tools); anything placed on the auto-approve list is a tool coa has
chosen not to govern, and nothing populates it today.

**A consequence, stated so it is not re-litigated:** coa's two SC-1 blocks — the close-gate
and the cost cap — surface as `deny` frames. A vendor bound like `maxTurns` is not a coa
block: it produces its own ordinary `error` frame (`error_max_turns`) alongside the turn
boundary's reported reason, never a `deny`. `maxTurns` in fact **outranks** the close-gate:
with `maxTurns: 1` against a Stop hook that blocks every time, the run ends on the turn cap
and never reaches `stop_hook_prevented`. Dressing that up as a coa denial would misattribute
which system stopped the work.

A governed stop does not simply end the turn — it leaves a record the next turn can read.
The transcript projection (docs/adr/0010) rebuilds context on **resume**, so a `deny` frame
that vanished once the turn boundary passed would resume a conversation with no memory of
why the previous run stopped. coa folds a notice carrying the block's reason into the
model-facing transcript, mirroring how a user interrupt is already recorded — and a
close-gate's reason is instructional (it says what to resolve before finishing), though the
frame that reaches the model today carries the SDK's raw terminal reason rather than that
message (a known limitation, not fixed here — see Consequences). Even so, of everything a
dropped frame could have cost, the fact and cause of the stop was the most useful part to
keep.

## Consequences

**Good.** Governance runs on every tool call, including the spawn. The two seams are split
by a measurable property — what each can see — rather than by taste, so the rule survives
someone re-reading it later. The vocabulary keeps SC-1's "only two blocks" line honest, and
a resumed conversation now carries why the previous run ended instead of reading as a stop
with no cause.

**Bad.** Two seams is more surface than one, and the split has to be maintained: a future
tool that `canUseTool` also cannot see must be added to the `PreToolUse` set by hand, and
nothing detects that automatically. The delegation set is also version-sensitive — the tool
answers to `Task` and `Agent` in the same shipped release — so it carries both spellings and
inherits the same drift risk the tool catalogue has.

The close-gate's deny frame carries the SDK's raw terminal reason (`stop_hook_prevented`),
not the gate's own message, and that string is what the transcript notice now shows the
model. The cause is structural, not an oversight to pick up in passing: the mapper that
builds the frame (`messageToFrames`) is deliberately a pure per-message function — so a
second adapter can implement the same contract against its own wire format — and the
`result` message it reads never carries the Stop hook's own reason text; that travels on a
separate control-protocol message the mapper never sees. Threading the real reason through
needs cross-message state at the daemon's emission layer, not a change inside this mapper.
This is recorded as a known limitation of the decision, not a defect left open against it.

---

_Last reviewed: 2026-08-03_

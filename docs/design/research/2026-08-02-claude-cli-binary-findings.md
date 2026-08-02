# Reading the shipped Claude CLI binary — structural findings and the fork price

> **Research spike, best-effort and lower-confidence than the argv probes** (Task 7 of the
> [control spike plan](../../superpowers/plans/2026-08-02-claude-sdk-control-spike.md)). The other tracks in
> that spike answer control questions by capturing what the Agent SDK hands its CLI subprocess. This track
> answers what those argv captures cannot reach — compaction internals, built-in tool schemas, the native
> subagent machinery, and what `settingSources: []` genuinely excludes — by scanning the shipped `claude`
> binary itself for its embedded JavaScript. A Bun single-file executable embeds minified, unstructured
> source: a marker's presence is meaningful, but its absence proves nothing, and nothing here outranks a
> live probe. **Nothing read out of the binary is quoted verbatim below or committed anywhere in this
> repo** — the SDK's license is "© Anthropic PBC. All rights reserved," and every claim here is a
> paraphrase or a structural fact (a marker present, a count, a checksum match), backed by the assertions
> in `packages/adapter-claude-sdk/src/control/binary.test.ts`.

**Version stamp:** `@anthropic-ai/claude-agent-sdk` 0.3.196 (as pinned in
`packages/adapter-claude-sdk/package.json`), bundled CLI **2.1.196**, commit
`a4ca500badcac68511fb5f04303e32e4360f3dfb`, built 2026-06-29. Binary scanned: the win32-x64 platform
package (`@anthropic-ai/claude-agent-sdk-win32-x64`), 235,977,376 bytes, sha256
`180d7b279455e8b89d4353a5146447be2f80b80fb0db14bdc6dd9cb98c0aef09` — verified at scan time to match
`manifest.json`'s recorded checksum for that platform exactly. The binary carries a valid Authenticode
signature issued to "Anthropic, PBC" by DigiCert (Code Signing RSA4096 SHA384 2021 CA1), valid
2025-10-13–2026-10-20.

---

## The five questions

### 1. What triggers compaction, and is any part of it observable from outside? — **partially settled**

**Settled, scan-level confidence.** Compaction is threshold-driven, not turn-count-driven: the binary
carries a user-configurable "auto-compact window" whose *effective* threshold is the minimum of that
setting and the active model's own maximum context window. Auto-compact can be disabled outright as a CLI
setting. A **separate, smaller-grained mechanism** ("micro-compaction") also exists, distinct from full
compaction — the binary references it as its own concept with its own boundary marker, alongside a
time-based micro-compaction telemetry event. Compaction is at least nominally observable: `PreCompact` and
`PostCompact` both appear as hook-event values (matching the `HookEvent` union the other tracks pinned),
and `PostCompact`'s hook input is documented (in embedded help text) as receiving the compaction summary.

**Upgrades the verdict beyond pure "Observed."** The binary contains a distinct, human-readable message
that fires specifically when a `PreCompact` hook returns a blocking decision — i.e., **the hook can
prevent compaction from proceeding, not just watch it happen.** This is a materially different fact than
"compaction is observable": if it holds on the live SDK, M4's thesis ("coa owns what is in context") has a
real lever here, not just a notification. This is exactly the kind of fact the argv probes cannot reach
(no compaction-related flag reaches argv per the sibling stage-5/6 probes), and it is the single most
consequential finding in this track.

**Still unsettled.** Whether `Options.hooks.PreCompact` (the SDK's programmatic surface, not just the CLI's
internal hook dispatch) actually receives this block decision and honors it identically is **not**
verifiable from a static scan — the binary shows the mechanism exists internally; it does not show that
the SDK's typed `Options.hooks` reaches it uninterfered. That is a live-probe question (stage 5/6's
`*.live.test.ts`), and per the anti-fabrication contract, this track reports the lead, not the verdict.
Also unsettled: whether `autoCompactWindow` (the threshold-setting concept found in the binary) is
reachable from `Options` at all — the sibling argv probes found no compaction-related flag on the wire,
which suggests it is not, meaning coa's only lever today may be the `PreCompact` block path, not the
threshold itself.

### 2. Does the `claude_code` preset duplicate or contradict coa's own prompt? — **partially settled, mostly unsettled**

`PRESET_COVERED_PIECES` in `render-native.ts:18-23` guesses that the preset already covers
`baseline-identity`, `baseline-tone`, `baseline-tool-use`, and `baseline-environment`, and says explicitly
that the guess needs an A/B harness. This binary scan is a partial harness, not the full one the spec
calls for — it can confirm presence of preset content by category, but not do a clean side-by-side
diff against coa's own piece text without risking exactly the verbatim-embedding the license forbids.

**`baseline-identity` — CONFIRMED consistent with coa's guess.** The binary carries (at least) three
distinct identity-line variants for the assistant, selected by a small piece of gating logic keyed on
whether the session is running under the Agent SDK and whether an `append` value is present. The variant
selected specifically for the SDK-plus-append case is a closer, SDK-aware superset of the bare-CLI
identity line. This is exactly coa's current configuration (`systemPrompt: { type: 'preset', preset:
'claude_code', append: ... }` in `sdk-options.ts`), so the preset does supply an identity line in coa's
actual invocation shape — good corroboration that dropping `baseline-identity` from the Claude append (as
`PRESET_COVERED_PIECES` already does) is correct, not a guess that happens to be untested.

**`baseline-tone`, `baseline-tool-use`, `baseline-environment` — UNSETTLED.** The scan found content
*consistent with* tool-use guidance (URL-fabrication guidance, command-safety guidance, delegation-tool
guidance) and fragments suggestive of an environment-info assembly step, but nothing that lets this track
confirm or deny overlap with coa's specific piece text without quoting either side verbatim. No
distinctly-labelled "tone and style" content was found under any of the section-heading strings tried,
which itself is inconclusive — compiled prompts are frequently assembled from many small fragments rather
than one heading-delimited block, so absence here is not evidence of absence. **This question stays open
pending the live A/B the spec calls for**; this track narrows it (identity settled) rather than closing
it.

### 3. What are the built-in tools' real schemas and descriptions? — **settled: they exist; unsettled: how they compare**

**Settled.** Built-in tools carry real, Anthropic-authored descriptions and JSON-Schema-shaped input
definitions embedded as plaintext in the binary — this is not a compiled-away or opaque surface. The
delegation tool's own input schema is a directly relevant example: it carries a `subagent_type` string
field (confirmed present) alongside a boolean-like `is_built_in_agent` distinction used at runtime to tell
native built-in subagent types apart from user-defined ones.

**Unsettled.** Whether any specific built-in tool's schema is identical to, a superset of, or in tension
with coa's own declared tool surface — the "same tool, different clothes" judgment risk R3 depends on —
cannot be settled by presence-checking alone. That comparison needs either the live SDK's own tool
declarations (already typed and available without touching the binary) diffed against what actually ships,
or a live session's `tools` listing. This track only establishes that the underlying schemas are real and
substantial, not what they say.

### 4. What does `settingSources: []` genuinely exclude? — **settled, and stronger than the doc-comment claim**

**Settled, and directly against the actual resolution logic, not just a claim about intent.** The binary's
settings-resolution code reads the effective sources as `(providedSources ?? DEFAULT_SOURCES).map(...)`, where
the fallback (`DEFAULT_SOURCES`, an internal name) is used **only when the caller omits `settingSources`
entirely** — nullish coalescing (`??`) does not treat an empty array as absent. `settingSources: []`
therefore maps to a real, distinct empty-array branch, which resolves to zero allowed setting sources, not
to the same default-everything path a caller gets by omitting the option. This directly corroborates the
D108 claim in `sdk-options.ts:98-106` ("settingSources: [] isolates the session from the target repo's
config") from the resolution code's own shape, not merely from its own comment.

The three valid named sources this mechanism recognizes are user-level, project-level, and local
(gitignored project-level) — a fourth, policy/managed settings, is handled by an entirely separate
mechanism (`managedSettings`/`serverManagedSettings`) that is not gated by `settingSources` at all, so
`settingSources: []` does **not** exclude managed/policy settings if any are present in the environment.
This is a genuinely new fact beyond what `sdk-options.ts`'s comment currently documents, and worth folding
into P1: coa's isolation claim covers user/project/local, not policy-origin settings.

### 5. How does the native subagent machinery work, and what does it call itself internally? — **settled shape, unsettled naming**

**Settled.** A spawned subagent runs as a nested query tagged internally as a "sidechain" — the binary
carries an `isSidechain` concept used to mark subagent-originated conversation state distinctly from the
root session. Each subagent invocation carries a `subagent_type` (the tool's own input field) and an
`is_built_in_agent` boolean distinguishing Anthropic-shipped agent types (which cannot be created, updated,
or deleted through the same file-based path user-defined agents use — the binary carries distinct guard
messages for exactly that restriction) from user-defined ones. Subagent completion is telemetered with a
recursion-depth field, and a `forwardSubagentText`-named concept exists controlling whether a subagent's
text is streamed back to the parent — consistent with the SDK's own `Options.forwardSubagentText` field.
A `taskBudget`-named concept is present and is referenced alongside arithmetic that reduces a running total
by a per-call amount, which is *consistent with* the arc's risk R4 question (does child spend land on the
root budget) but does not, on scan evidence alone, prove which total is being reduced — that requires a
live probe with real spend, which the sibling stage-7 live probe file already plans to cover.

**Unsettled: the `Task`→`Agent` naming question (arc risk R2).** The scan is genuinely inconclusive here,
and says so rather than guessing. Both spellings are present throughout the binary, in contexts that argue
both directions: tool-facing description text still refers to "the Task tool" and its input field
documentation still says "Subagent type for Task tool subagents"; but a small internal lookup table also
exists mapping several *other* legacy tool-name spellings onto their current canonical ones, which
confirms naming churn is real and ongoing in this codebase, not merely a one-time rename. **Which spelling
actually reaches the wire in `system:init`, in tool-use blocks, and in permission-denial records — the
exact three-way disagreement the arc design flags — cannot be determined from a static scan of string
literals**, because presence of a string proves it exists somewhere in the source, not which code path
executes for a given message type. This is precisely what the stage-7 live probe is for; per the
anti-fabrication contract, this track reports the lead (naming churn is real and multi-directional) and
declines to guess the verdict.

---

## The fork price, computed

### Measured cadence

```
npm view @anthropic-ai/claude-agent-sdk time --json
```

255 versions published since the package's first release (2025-09-27) through the latest at scan time
(0.3.220, 2026-07-24) — already 24 patch versions ahead of the 0.3.196 this spike is pinned to and dated
against, published entirely within this spike's own writing window.

| Month (2026) | Releases |
| --- | --- |
| Feb | 29 |
| Mar | 23 |
| Apr | 29 |
| May | 27 |
| Jun | 30 |
| Jul | 23 |

**161 releases over the last six months → 26.8 releases/month, ≈ one release every 27 hours.** The
all-time average (25.8/month over the package's 9.9-month life) is consistent with this — this is not a
recent spike in cadence, it is the steady-state rate.

### Tier (a) — fork the wrapper (`sdk.mjs`)

Buys option serialization, the stdio/stream-json protocol, spawn plumbing, and hook wiring — none of
which this spike found reason to distrust. Buys **nothing** about loop behaviour: compaction, the preset
system prompt, built-in tool implementations, and the subagent execution machinery all live in the
compiled binary this track scanned, not in the 899 KB wrapper. Cheap (the wrapper is plain, unminified TS
output) and, on the evidence gathered here, pointless — none of the five questions above would be any more
answerable with a forked wrapper than with the shipped one.

### Tier (b) — patch the binary, point `pathToClaudeCodeExecutable` at it

The only tier that could reach an `Opaque` stage, priced as cadence × per-release effort × the
integrity/signing/licensing obstacles this track could directly verify:

- **Cadence: ~27 releases/month.** A patch derived against today's binary has, on average, about 27 hours
  before the next upstream build potentially invalidates it — not enough time for a human-reviewed patch
  process to keep pace, and the binary ships with no source maps (confirmed: the platform package contains
  exactly `claude.exe`, `LICENSE.md`, `README.md`, `package.json` — no `.map` file), so each re-derivation
  is a fresh scan-and-locate exercise against re-minified output, not a diff against a stable base.
- **Per-platform multiplication.** `manifest.json` pins one checksum per platform across **eight**
  platform/arch combinations (linux ×4 including musl variants, darwin ×2, win32 ×2). A patch that matters
  for coa's own supported platforms still multiplies the per-release effort above by however many of those
  eight coa ships.
- **Code signing is real, not hypothetical — verified directly on the scanned binary.** The win32-x64
  binary carries a valid Authenticode signature issued to "Anthropic, PBC" via DigiCert (Code Signing
  RSA4096 SHA384 2021 CA1), current through 2026-10-20. A patched binary breaks that signature; shipping it
  unsigned risks SmartScreen/Gatekeeper friction for every user, and shipping it re-signed under a coa-owned
  identity requires coa to obtain and maintain its own code-signing certificates for win32 and darwin —
  an ongoing cost independent of the patch-engineering cost above, and one that still doesn't restore the
  trust chain to Anthropic's own signing identity.
- **The licensing position is the actual blocker, not the engineering cost.** The SDK ships under "©
  Anthropic PBC. All rights reserved" with no license grant to modify or redistribute the binary at all.
  Nothing in this scan found evidence of a separate, more permissive grant for the compiled binary
  specifically (as opposed to the TypeScript wrapper). Patching and redistributing a modified `claude.exe`
  is a licensing violation independent of whether it is technically feasible, and should be treated as
  disqualifying on its own — the cadence/signing analysis above explains *why nobody should want to*, but
  the license is why nobody may.

### Tier (c) — stop borrowing (the pure-API path)

coa already has the generic machinery for a backend that talks to a model directly instead of wrapping a
vendor CLI: `@coa/loop-driver` (the shared, coa-owned governed ReAct loop; no backend SDK) plus the M9
ports it implements against, proven live today for `adapter-deepseek` and `adapter-longcat` (thin HTTP
backends, "just fetch"), with ADR-0005 already establishing coa's own base/web tool executors for exactly
this path. **What does not yet exist is a Claude-flavored instance of it** — an `adapter-claude-*`-shaped
package that speaks the public Anthropic Messages API directly (the same API `@anthropic-ai/sdk`, already
a dependency of `adapter-claude-sdk` today as a peer-dependency of the Agent SDK, wraps) rather than going
through `@anthropic-ai/claude-agent-sdk`'s CLI-wrapping `query()`. Building that is the cheapest of the
three tiers by a wide margin — it is architecturally identical to `adapter-deepseek`, touches no binary,
needs no signing, and raises no licensing question, because it never borrows Claude Code's harness at all.
It gives up whatever the `claude_code` preset and the CLI's built-in tool implementations contribute
(unresolved by Q2/Q3 above) in exchange for full, direct control — the opposite trade from tiers (a) and
(b).

---

## Recommendation

**Do not fork.** None of the five questions this track investigated turned up a stage that is both
`Opaque` *and* something P1 cannot route around: compaction is at minimum `Observed` and plausibly
`Shaped` (the `PreCompact`-block lead, pending live confirmation); `settingSources: []` is confirmed
`Owned` at the resolution-logic level; the subagent machinery is `Observed`/`Shaped` via `SubagentStart`/
`SubagentStop`/`taskBudget`, with only the cosmetic naming question genuinely unresolved. Tier (b) is the
only tier that would matter, and it fails on cadence (a patch has ~27 hours of shelf life on average),
fails on per-platform multiplication (8 checksummed, signed platforms), and fails outright on licensing
(no grant to modify or redistribute exists). Tier (a) is cheap but buys nothing this spike needed. Tier (c)
is the one with a real, positive case — it already has its architecture proven by two live backends — but
it is a strategic call about how much of Claude Code's baseline behaviour (preset prompt, built-in tool
implementations) coa is willing to give up in exchange for direct control, not a finding this spike can
settle on its own. That trade belongs in P1's own design, informed by how Q2 and Q3 resolve once the live
A/B pass this spike deferred actually runs.

---

_Last reviewed: 2026-08-02_

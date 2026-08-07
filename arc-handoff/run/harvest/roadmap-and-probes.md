# Harvest: roadmap candidates + SDK probe findings

Date: 2026-08-07. Read-only harvest ahead of the docs stage that deletes `DEV-NOTES.md`,
`docs/design/handoff/` (incl. `OPEN.md`), and `docs/superpowers/`, rewrites `ROADMAP.md`
forward-only, and writes `docs/ARCHITECTURE.md`.

Sources read: `DEV-NOTES.md`, `docs/design/handoff/OPEN.md`, `docs/superpowers/plans/*`
(skimmed for unshipped intents), `ROADMAP.md` + `git log` (shipped baseline),
`packages/adapter-claude-sdk/src/control/*` (kept probes), `archive/sdk-probes/*`
(archived probes).

Classification baseline: subagent orchestration core is SHIPPED (spawn_agent, lineage,
stop-cascade, completion notices, console lineage grouping — ADRs 0032/0033/0034); mid-loop
delivery (ADR-0030), steer ordering (ADR-0031), agent registry, agent-surface convergence
(ADR-0029), and the workbench rebuild (W0–W5) are shipped. Items the knife deliberately
archived reference-only (decision log, flag auto-patch planner + reminder policy, bundle
importer + version gate, write-only signal bus, checkpoint-undo plumbing, symbol-grounding
producer, fuzzy/scip kernel reads) are NOT revived here.

---

## 1. Roadmap harvest — candidate lines

Each line: candidate roadmap entry — suggested tier. Items already tracked in ROADMAP.md
(R-12 push bridge, L-ASM calibration gate, item K preset-vs-canUseTool spike, item M
discovery + cost-roll-up RPC producer, worktree manager, role/capability enforcement,
AGENTS.md-into-context package, etc.) are deliberately omitted — the forward-only rewrite
keeps them.

### Next (small fixes / polish aligned with current console work)

- Fix the staleness/drift banner appearing on a fresh session — Next.
- Fix find-in-chat: highlight padding, auto-expand matches inside collapsed reasoning blocks — Next.
- Fix web-search returning nothing (likely Tavily 1 req/s rate limit; needs retry/backoff) — Next.
- "Done" (green) session status should fire when an agent turns idle while you are viewing another session — Next.
- Copy button in code blocks + copy-block toast feedback — Next.
- Context-window usage indicator in the composer (the SDK exposes `getContextUsage`) — Next.
- Warn about prompt-cache invalidation when the user changes reasoning level mid-session — Next.
- About page in settings (app version at minimum) — Next.
- Reasoning-effort dropdown spacing polish — Next.
- Charge the WebFetch summarizer's recorded spend against the M7 cost cap (today audited under scope `web_fetch_summarizer` but uncapped; needs the per-session id threaded to the daemon-wide catalogue seam — OPEN.md risk #23) — Next.

### Later (real features, unscheduled)

- Chat input affordances: file references (@), file uploads, composer max-chars handling — Later.
- Per-session permission-mode control in the composer (the presentational chip was removed; a real control needs the daemon to own the decision) — Later.
- Plan mode (research/execute separation for the governed loop) — Later.
- Notification system (approval-needed, turn-complete, cap-hit; OS-level, batched per OPEN's notification-batching knob) — Later.
- Tool auto-repair + grounding on failed tool calls — even a cheap "did you mean…?" from a smaller model; more tool transparency to the model generally — Later.
- Completely honest tool-input echo back to the model (stop silently normalizing/rewriting what the model asked for) — Later.
- OpenRouter provider adapter (fourth backend behind the M9 seam) — Later.
- Better file grep for agents: recency- or hotspot-weighted ranking — Later.
- Command palette ranked by frequency/recency of use — Later.
- Keybinding reset confirm dialog + a general stacked-dialogs policy; title bar as click-away surface for dialogs/layers — Later.
- Inter-agent messaging (parent↔child beyond the completion notice; design spec exists in the doomed corpus: `docs/superpowers/specs/2026-08-04-inter-agent-messaging-and-dispatch-design.md`) — Later.
- Route duplicate-agent-ref diagnostics through the M3 flag pipeline (deliberate follow-up named in the agent-registry plan; today diagnostics-on-read only) — Later.
- Console RPC catalogue completion (OPEN §0, unshipped C-items): `getToolDetail(handle)` byte-faithful tool/diff fetch (C4); `resolveRef(ref, worktree?)` (C5); investigate-from-flag seeded session (`createSession` with `seed`) (C6); Piece read/write verbs through the `.coa/` layout authority (C7 remainder); `searchConversations` + a "what is it waiting on" status push (C10 remainder); the authoritative reconcile TurnFrame rendering M1's record against the agent's claim (C11); `subscribeView`/`unsubscribeView` view-scoped live deltas for graph/health (C12); enumerating remaining inspector reads as named verbs (C9 — minus the reads whose producers were archived: decision log, checkpoint rewind) — Later.
- Conversation compaction verb (`compactConversation`) + compaction seam-marker push + `{kept,dropped}` honesty list; raw store retained as floor (C8; pairs with the verified SDK fact that coa can pick compaction's moment via `/compact` but never veto it) — Later.

### Someday (speculative / v2-v3 bets from OPEN.md §1, still wanted)

- Rigor-preset dial (D74): named prototype/tool/product presets over the individual governance dials (`coa raw` floor already ships) — Someday.
- Cross-repo brain: one developer, many repos, one private index — Someday.
- Standing adversarial / red-team verifier (the explicit gate for any v2 autonomy) — Someday.
- Autonomy stack: escape-gate policy, relaxation, two-tier cap, per-session process isolation (+ re-arming the blocking TCB ceremony that attended-v1 downgraded to a visibility floor) — Someday.
- Offline / air-gapped mode (promotes to high-value the moment a non-Claude backend is primary) — Someday.
- Multi-user / multi-writer (per-user signed feeds over git refs, CRDT semilattice proof, snapshot-isolated gates — OPEN §1.1 carries a fully worked design + 2026 feasibility survey; see preservation flags below) — Someday.
- P9 egress-chokepoint invariant (all network egress through one audited module) — tripwire: promote BEFORE any sync/export/remote-daemon feature ships — Someday.
- Behavior-baseline anomaly detection (log now, detect with autonomy) — Someday.
- Self-tuning context profiles once the ledger accrues signal — Someday.
- Bounded high-fidelity grounding extensions: stub-grounding external symbols, headless LSP for user projects, per-language doc generators — Someday.
- SCO-6 architectural-boundary advisory producer (`mayDependOn` allow-list warnings over the graph + scope tags; warns, never blocks) — Someday.
- Scope-delivery refinements: model-judged description tier over scope-push; auto-suggested scope boundaries from graph clustering (human-ratified); build-config-aware scope resolution; TTL/lifetime content axis — Someday.
- Graph/health depth: convention extractors for more ecosystems; SCIP consume/round-trip; CPG-grade data-flow analysis; learned health model (determinism-preserving only) — Someday.
- Tier-B model-judged layers (turn denoise, reconcile-divergence salience, salience prediction, flag classification) — all gated on the D143-style A/B netting positive — Someday.
- Semantic contradiction engine (CL-7): the semantic half of rationale-grounding, once capture + symbol→decision binding exist — Someday.
- Smart constraint mining (D63): propose constraints from dismissal/friction stats, human-gated (unattended self-authoring stays rejected outright — OPEN §4) — Someday.
- Console/product reach: web/remote inspector; always-on ambient dashboard; cross-session cost analytics; shared/team agent config GUI; voice/image chat input; hierarchical edge bundling — Someday (each has a named promoter in OPEN §1; none is wanted before its force appears).
- Embedded CLI mode; external web chat panels (e.g. ChatGPT alongside); "coa butler" auto-popped session; auto-compressing user input — Someday.
- Re-evaluate the provenance display in the console (maintainer note: "provenance is kinda stupid" — a design re-think, not a feature) — Someday.

### Preservation flags for the docs stage (content that dies with OPEN.md unless moved)

- **OPEN §1.1** is a complete worked multi-user design (MU-0…MU-14, walls MU-W1…W3, feasibility
  verdicts with 2024–2026 citations). If multi-user is ever promoted this saves weeks; consider
  graduating it to an ADR-adjacent archive doc rather than deleting outright.
- **OPEN §2 tuning knobs** — the per-knob conservative defaults + self-tuning metrics
  (confidence-tier cut-points, context token caps, compaction trigger, etc.). ARCHITECTURE.md
  or the module specs should keep the *principle* (mechanisms fixed, cut-points are knobs,
  none gates soundness) and ideally the list.
- **OPEN §3 risks worth carrying forward**: #4 (prose-bearing memory is a secret surface —
  bind before any ledger/`~/.coa` sync), #8 (push-without-backing-check = policy theater;
  label it), #9 (author-declared provenance can poison grounding), #17 (permission fatigue →
  YOLO; lower verification cost, don't explain more), #23 (summarizer spend uncapped — now a
  Next item above).
- **OPEN §4 rejected outright**: unattended self-authoring of constraints from dismissal
  stats. The forward-only ROADMAP should keep a one-line "rejected" memory so it isn't
  re-proposed innocently.

---

## 2. SDK probe findings — verified behavior the adapter relies on

Distilled from the kept control probes (`packages/adapter-claude-sdk/src/control/`) and the
archived exploratory probes (`archive/sdk-probes/`). All verdicts are stamped against
`@anthropic-ai/claude-agent-sdk` 0.3.196 / bundled CLI 2.1.196 (commit a4ca500); the kept
suite is a version tripwire — an SDK bump fails the probe that names the expired verdict.
Upstream ships ~27 releases/month; the binary is checksummed per platform and the fork
question is closed (do not fork). "Live" = verified against the real CLI + a real account;
otherwise verified at the SDK wire/typings level.

**Permissions and per-tool governance**

- `allowedTools` means auto-approve, not availability. A tool listed there is pre-permitted
  and never reaches the `canUseTool` permission callback — live-verified: the model called
  built-in and MCP tools freely while the callback saw nothing; dropping `allowedTools` made
  the same calls reach it. Granting through `allowedTools` silently disables your own
  per-call governance, so the adapter never grants — availability lives entirely in `tools`.
- The three tool levers split cleanly (live-verified): `tools` = what is advertised to the
  model (`tools: []` genuinely empties the built-in set), `allowedTools` = auto-approve
  (removes nothing), `disallowedTools` = removal from the model's context. The adapter ships
  a bounded eight-tool built-in floor via `tools` and treats an empty capability frame as
  the floor, never as pass-through.
- A `canUseTool` allow-result must echo the tool input back (`updatedInput`). A bare
  `{behavior:'allow'}` is type-valid but the real CLI treats it as a permission error for
  every tool — nothing executes.
- `canUseTool` is not a universal seam: it is never consulted for a native delegation call
  (live: the model emitted the spawn, the callback saw nothing), and under the `claude_code`
  system-prompt preset it was not consulted even for a plain in-cwd read (measured 0/2 with
  the preset, 6/6 without; mechanism hypothesised, not proven). Per-tool governance
  therefore rides a single `PreToolUse` hook that only denies or abstains, never grants.
- `PreToolUse` can deny a call and can rewrite its input before it runs (`updatedInput`
  live-verified to change what the tool actually receives), but it has no result-bearing
  field — coa can gate or reshape a call, never answer one.
- Denies are honoured for real (live, one run): a `PreToolUse` deny of a built-in `Read`
  stops the read (contents never reach the model), and a deny of coa's own `mcp__coa__*`
  tool stops the handler from running — the fact that makes a governed `spawn_agent` viable.

**Hooks and the turn boundary**

- The pinned SDK exposes 30 hook events (runtime `HOOK_EVENTS` constant). Shipped code
  registers exactly three: `Stop` (the close-gate), `PreToolUse` (the gate), `PostToolUse`
  (the producer trigger that drives the git reconciler, so changes made by native tools or
  Bash reach the change-event spine).
- A Stop hook returning `{decision:'block', reason}` genuinely keeps the loop open
  (live: the hook is consulted again). But `maxTurns` outranks it — with the turn cap hit,
  the run ends (raised as an error) no matter how the Stop hook answers. The close-gate
  argues only inside the turn cap; the two are not peers.
- The SDK splits one `Options` object across two wire channels: a small fixed argv set
  (`--tools`, `--allowedTools`, `--model`, `--setting-sources`, `--max-turns`,
  `--max-budget-usd`, …) and one stdin `initialize` control request carrying everything
  else (systemPrompt, hooks, toolAliases, agents, skills-as-array, forwardSubagentText…).
  Hook registration is argv-invisible; `canUseTool` alone leaves an argv trace
  (`--permission-prompt-tool stdio`). Any diagnostic reading only argv is blind to half the
  surface.
- Turn outcomes carry a 13-member `terminal_reason` union (distinguishing
  `stop_hook_prevented` / `max_turns` / `completed` / …); the adapter reads it on the
  boundary frame.

**Tool surface control**

- The native delegation tool is spelled inconsistently inside one version: `system:init.tools`
  advertises `Task` while the model emits `Agent` in the same live run. The grant vocabulary
  carries both spellings, the floor demotes both, and a drift test forces every one of the
  SDK's 39 generated tool schemas to be classified (grantable vs. not-model-visible) on each
  bump.
- `toolAliases` is honoured at dispatch: a model-emitted `Read` ran coa's MCP handler and the
  handler's output (not the file on disk) reached the model (live). But an alias only
  REDIRECTS a name the harness already advertises — it never PUBLISHES one: with `tools: []`
  the aliased native name vanishes from the advertised set. So per tool the choice is binary:
  keep the native tool advertised + alias it (own the implementation, inherit Anthropic's
  name/schema/trained prior) or ship under `mcp__coa__*` (own name/schema/description/
  implementation, no trained prior). There is no third option. Shipped code keeps native
  implementations and governs at `PreToolUse` (ADR-0029).
- System prompt: only the `{type:'preset', preset:'claude_code'}` object preserves the
  harness's baseline (the wire then carries no systemPrompt key); `append` layers coa's text
  via a sibling `appendSystemPrompt` wire field; a raw string REPLACES the prompt; omitting
  the option sends `['']` (an empty custom prompt), not the preset. The preset is also a
  dial, not a switch (`excludeDynamicSections`), and the tool baseline is a separate preset
  on a separate channel.
- `settingSources: []` is not full isolation: it governs only the three filesystem settings
  files. The managed/policy tier is still read from disk; project `.mcp.json` needs
  `strictMcpConfig: true` separately; skills discovery needs an explicit `skills: []`
  (unset is not "skills off"); and a per-agent `memory: 'project'` would still read target-repo
  files. The adapter sets each of these explicitly.

**Session lifecycle, injection, and persistence**

- There is no silent mid-session system channel. A streamed `role:system` message is
  transmitted verbatim but NOT obeyed (live); a `shouldQuery:false` user message DOES land in
  context and is recalled later — but it still costs a turn and produces a result frame.
  Mid-loop delivery therefore rides hook `additionalContext` (PostToolUse per round trip,
  Stop as the floor) — the substrate the delivery queue is built on.
- Compaction is observable and schedulable, never vetoable. PreCompact/PostCompact have no
  specific output type (the generic block was ignored live — compaction proceeded), but coa
  gets full observation: both hooks, an in-band `compact_boundary` frame carrying trigger,
  token counts and surviving messages, `getContextUsage` (threshold + enabled state), and
  the PostCompact summary. A streamed `/compact <instructions>` turn fires PreCompact with
  `trigger:'manual'` and the instructions verbatim — coa can choose the moment and shape
  what survives. Caveats: the hook firing is not proof compaction happened (read the boundary
  frame), and `autoCompactEnabled`/`applyFlagSettings` can toggle auto-compaction
  per-session and mid-session.
- A local on-disk session write is structurally required: `sessionStore` cannot be combined
  with `persistSession: false`, and `append` is documented (and pinned) as a mirror called
  after the local write succeeds. coa cannot be the only writer — but it sites the write
  (via `CLAUDE_CONFIG_DIR`) and keeps its own append-only log as the durable record.
  Live-verified: a session was fully reconstructed from coa's mirrored log after the CLI's
  own store was deleted, and the CLI even accepted a synthesised transcript entry — coa's
  log is a sufficient continuity substrate. Resume plumbing (`--resume`, `--fork-session`,
  `--resume-session-at`, `--session-id`, `--continue`) is plain argv; the SDK does not
  enforce the documented sessionId/resume exclusivity, so coa must.
- `CLAUDE_CONFIG_DIR` is one lever doing two jobs: credentials AND session store live in it,
  so redirecting the store also relocates the login (an empty dir = "not logged in"). The
  resume+sessionStore path materialises a temp config dir that includes a copy of
  `.credentials.json` (a live OAuth token) — left behind if the spawn fails. Treat config-dir
  redirection as an auth decision, not a storage one.

**Process and environment**

- `Options.env` REPLACES the child environment entirely — an ambient variable absent from it
  does not reach the CLI (sentinel-verified against a real spawn). Exception: on Windows the
  OS re-injects a fixed set of system vars (PATH, SYSTEMROOT, USERPROFILE) no matter what.
  The auth seam relies on this replacement to clear `ANTHROPIC_API_KEY` /
  `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN` and pin `CLAUDE_CONFIG_DIR` per
  session — verified end-to-end at the spawned process, not just in the JS overlay.
- `ANTHROPIC_BASE_URL` genuinely redirects the real CLI's inference traffic — live-verified
  by pointing it at a local stub server and observing the binary's outbound request arrive
  there. This is the premise for fronting the loop with an Anthropic-shaped gateway. (Note:
  the CLI retries a 500 with backoff indefinitely.)
- `maxBudgetUsd` is a real enforced hard stop, but it surfaces as an exception RAISED out of
  the message iteration ("Reached maximum budget…"), not as a result frame — anything
  rendering it must catch, or a deliberate cap-stop looks like a crash. `taskBudget` is
  tokens, root-only, and a pacing hint the model is told about, not an enforced cap; nothing
  budget-shaped exists per-agent or on the delegation tool's input, so a child cannot be
  ring-fenced — the daemon-global cost cap is the only fan-out bound (consistent with
  ADR-0032).

**The native subagent plane (archived — no shipped code uses it, but verified for the record)**

- The `agents` declaration map travels the initialize request verbatim and unvalidated
  (unknown fields included) — transmission proven offline, honouring proven live: a declared
  child genuinely ran on its own cheaper model under a different root model, with per-child
  tools/maxTurns/effort accepted.
- A child's spend lands in the ROOT result's `modelUsage` (per-model keys, non-zero child
  tokens) — native fan-out does not escape the root's budget accounting.
- Child assistant text reaches the host by DEFAULT (`forwardSubagentText` is not needed to
  see it) — the host must decide what to do with child output, not whether to request it.
- `SubagentStart`/`SubagentStop` hooks fire around a native child but CANNOT block the spawn
  (a `{decision:'block'}` there is ignored); only a `PreToolUse` deny of the delegation call
  prevents it (live-verified) — the same single-seam conclusion as shipped governance.
- The calling model — not the host — picks a native child's permission mode (including
  `bypassPermissions`) and isolation on each spawn via the tool input; the mitigation is
  intercepting/rewriting the spawn call at `PreToolUse`. An undeclared
  `appendSubagentSystemPrompt` option reaches the wire (standing authority over every native
  child's prompt) but is unsupported API — noted, not relied on.
- Out-of-band session functions exist (`listSubagents`, `getSubagentMessages`,
  `forkSession`, `deleteSession`, an `InMemorySessionStore`, …) that read/write the store
  without spawning the CLI.

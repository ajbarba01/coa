# The backend-independent agent arc

Design for a five-phase arc with three ADRs. It repositions the project, so it supersedes the thesis
in `AGENTS.md` and SPEC §B rather than sitting alongside them. Nothing here is built yet; the arc is
sequenced behind the workbench rebuild's W4.

## What the arc is for

1. **Any agent, any backend, one system.** Subagent orchestration, tools, MCP, skills and later
   worktrees stop depending on which backend runs the loop. A Fable-5 orchestrator driving DeepSeek
   and OpenRouter workers is default behaviour, not a feature.
2. **coa is the source of agentic configuration.** The agent definition lives in coa and is
   *realized* per backend; no plane above M9 branches on which backend is active.
3. **Breadth of models** — OpenRouter and a ChatGPT-subscription backend, added as configuration
   rather than as new adapters.
4. **Escape the harness without leaving it** — any API usable through Claude Code, via coa as an
   Anthropic-shaped gateway that keeps the governed record.
5. **Governance survives all of it** — opt-in, gracefully degrading, never the reason something breaks.

## The repositioning

coa's headline becomes **cross-provider orchestration and provider/harness freedom**, with governance
as an opt-in, strongly-recommended layer. This contradicts the current opening of `AGENTS.md` — "coa
does not replace the coding agent — it governs it" — and the Constitution's framing of governance as
non-negotiable. Both are rewritten in this arc. Left alone, every future agent reads the superseded
thesis while building the new one.

## Three planes

ADR-0004 ruled that composition never branches on backend (DC-5a), scoped to prompt composition. This
arc widens that ruling to the whole agent definition.

| Plane | Owner | Contents |
| --- | --- | --- |
| **Declaration** | coa, fully neutral | role prose · tool grants · MCP refs · pieces/skills · model+reasoning · memory scope · worktree policy |
| **Realization** | M9 `renderNative` and the adapters | neutral agent → SDK options / Codex thread config / standalone scaffold, **including per-backend tool presentation** |
| **Orchestration** | coa, never delegated | spawn · fan-out · collect · worktree assignment · cost attribution · the record |

## Decisions taken

- **coa is the harness.** Vendor harnesses are borrowed capability, not hosted peers.
- **A subagent is a coa session with a parent link.** This follows from what already ships: M8 owns
  live session state (ADR-0011), the adapter factory builds a backend per session, and persistence is
  already a per-conversation append-only log with read-time projections (ADR-0010). Worktrees inherit
  the property — "a session may own one" is backend-independent because the adapter never sees the
  filesystem fact.
- **Demote only in the orchestration plane.** Everything in the model's own competence — reasoning,
  tool-use judgment, edit smarts, the `claude_code` preset — is layered on, never replaced. Where
  demotion proves janky, fall back to **observe and label honestly**: the record shows the work as
  observed-not-governed. Never silent pretending. This keeps SC-1 and D85 intact and stops each vendor
  release re-opening the argument.
- **Same tool, different clothes.** One governed tool in M6 owns identity, handler, permissions and
  enrichment; its description and schema surface are chosen per backend in `renderNative`, so a
  prior-rich harness gets the shape it was trained on and a prior-free model gets a fully-taught
  description. The seam already exists in the Claude adapter's tool-transport resolver, and
  `assemble-agent` already states the rule. This closes the ROADMAP "Someday" question on
  tool-description minimalism, which sat inside ADR-0005.
- **Codex: subscription-as-model now, harness-as-protocol later.** The ChatGPT OAuth token ships as an
  OpenAI-compatible profile; the App Server adapter stays a distinct future provider row. Two rows in
  the descriptor registry, which already reserves `codex` under the `cli-login` locator.
- **The cost cap binds the tree, not the session.** Children charge the root session's budget. The cap
  is one of only two blocks in the system (ADR-0009); without this, fan-out walks around it.

### One limit worth writing down

coa's governed tools register through a single in-process MCP server named `coa`, so their
model-visible names carry the `mcp__coa__` prefix. The literal name `Agent` is therefore **not**
available on the Claude path. Tool presentation can match schema shape and description idiom; it
cannot match the name. Plan for that rather than promising name-parity.

## What the research settled

- **Codex is a protocol, not a harness to host.** It ships an MCP server mode *and* an App Server —
  bidirectional JSON-RPC 2.0 over stdio, versioned v1/v2, built because MCP could not carry streaming
  diffs, approval workflows, thread persistence or server-initiated requests. That is close to a
  description of coa's own daemon pipe, turn frames and interrupt/steer verbs. A Codex adapter is a
  **third adapter shape** — protocol-driven harness — alongside fat (SDK) and thin (`complete()`). The
  per-provider session-strategy verdict already returns an abstract value, so the third slots in
  without touching M8.
- **Claude Code is the outlier, and that is why it chafes.** The Agent SDK is a library, so coa
  configures it in-process; Codex is a protocol, driven at arm's length. The friction is
  Claude-Code-specific and caused by integrating at the library layer, not a general multi-harness
  problem.
- **Removing the native delegation tool works — via the allowlist.** The adapter already passes an
  allowlist when the resolved frame supplies one, and a tool omitted from it is never sent to the
  model, so its schema never enters context. The denylist is the wrong lever. **Trap:** the tool was
  renamed `Task` → `Agent` in Claude Code v2.1.63, and current SDK releases still emit `Task` in
  `system:init` and in permission-denial records while tool-use blocks say `Agent`. The demote set must
  be version-aware, with a test asserting absence from the rendered frame rather than mere denial.
  Upstream's known Task-denial bugs are scoped to Claude Code's *own* subagents; coa's children are coa
  sessions, so coa never enters that path.
- **Routing Claude Code at an arbitrary API already works upstream.** `ANTHROPIC_BASE_URL` redirects
  Anthropic-shaped requests anywhere, and a gateway-model-discovery flag makes Claude Code list a
  gateway's `/v1/models` in its own picker. coa already owns the model catalog (ADR-0016), the account
  registry and the ledger, so coa-as-gateway gives Claude Code the model list *and* keeps the record —
  no Claude profile per API. ADR-0002 rejected the compat-endpoint swap **as coa's internal backend
  path**; as an export surface this is a different decision and does not reverse it. The new ADR says
  so explicitly.
- **OpenRouter's value is breadth, not free capacity.** Free tier is 50 requests a day; 1,000 a day at
  20/min after $10 of credit. One agent turn is many requests, and every DeepSeek model there is now
  paid. What it actually buys: one key for nearly everything, plus the `:free` / `:nitro` / `:floor`
  routing variants. The provider row must say this plainly.
- **ChatGPT web-tier limits are not reachable, and this is a rejected direction.** The Codex OAuth flow
  yields *Codex* quota, not ChatGPT-web quota — the one actually wanted. There is no sanctioned path;
  browser automation is ToS-hostile and would break constantly. Recorded here so it is not
  re-litigated.
- **The two thin adapters are ~90% duplicate code.** DeepSeek and LongCat differ only in usage
  cache-token shape (flat vs nested), nullish tolerance, pricing, model IDs and credential locator —
  config, not code. A shared OpenAI-compatible package parameterized by a provider profile kills the
  per-adapter drift risk ADR-0002 itself lists as its main downside, and makes OpenRouter nearly free.
- **Subagents are not blocked on R-12.** R-12 is the WAL→Push bridge for live deny/cost/approval;
  subagent lifecycle frames ride the existing turn push. Depth-1 read-only fan-out needs no worktree
  manager either — only concurrent writers do. The thesis is testable far earlier than the roadmap's
  keystone framing implies.

## Risks

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | **Daemon re-entrancy.** A synchronous spawn result holds the parent's query open while the daemon runs a whole child session through itself. Untested path. | The tool return carries a handle from day one, so switching to async collect is additive. Proven by a mock-adapter integration test before any live run. |
| R2 | **Vendor rename churn** (`Task`→`Agent`). | Version-aware demote set plus a frame-absence test. One list, one test. |
| R3 | **Reach-for rate.** An `mcp__coa__` tool may be reached for less than the native one it replaced. | Matching schema shape plus a prescriptive "call this when…" description; measured on the live smoke before broadening. |
| R4 | **Fan-out escapes the cost cap.** | Children charge the root budget, asserted in a unit test rather than left to convention. |
| R5 | **Arc size** — comparable to the workbench rebuild. | Phases ship independently; each leaves the system strictly no worse, the same D85 discipline the W-phases used. |
| R6 | **The adapter refactor regresses shipped behaviour.** | Acceptance is that the existing DeepSeek and LongCat suites pass **unchanged** against the extracted package. |

## Phases

**P1 — the orchestration slice.** Zero new providers: a Claude-SDK orchestrator spawning a DeepSeek
child. Demote the native delegation tool via the allowlist; add a governed `spawn_agent` in the
kernel partition, its schema modelled on the native tool and its result carrying both a summary and a
handle; dispatch the child as its own session with its own provider and a fresh conversation id
carrying the parent link; guard depth in `renderNative` from the session's depth, so the depth-1 bound
of D122 is backend-independent by construction; derive the child's abort signal from the parent's so an
existing root interrupt cancels children and preserves partials (ADR-0012); return an unapplied result
rather than throwing when a child's provider has no credential (SC-1); join parent and child in the
transcript **projection**, adding no second writer (ADR-0010). Read-only fan-out only — no worktree, no
nesting, no concurrent writers.

**P2 — providers.** Extract a shared OpenAI-compatible adapter parameterized by a provider profile
(base URL, credential locator, usage shape, reasoning field, pricing, model-list transform, quirks).
Migrate DeepSeek and LongCat to profiles, then add OpenRouter and ChatGPT-subscription as two more.

**P3 — declaration-plane widening.** Tool grants, MCP refs and skills/pieces become neutral in the
agent definition and are realized per backend. Closes the `registerMcp` resolver gap. Pieces render as
prompt text everywhere and as a native skills directory where a backend has one.

**P4 — the Codex App Server adapter.** The third adapter shape; its approval round-trips route into
coa's deny channel.

**P5 — coa as an Anthropic-shaped gateway.** Serve `/v1/messages` and `/v1/models` from the daemon.

**Doc work lands with P1, not after:** ADRs for the three-plane model, the demotion policy, and
gateway-as-export-surface; the `AGENTS.md` and SPEC §B rewrite; ROADMAP entries for P1–P5.

## Verification

`pnpm typecheck` and `pnpm test` green at each phase; `pnpm docs:check` after the doc work.

P1 in order: the delegation tool absent from the rendered frame under both spellings; a child's frame
without the spawn tool; child cost landing on the root budget and tripping the cap; **the daemon driven
re-entrantly against mock adapters** — this is R1's real test and it needs no network; then a
`COA_LIVE` smoke where a Claude orchestrator spawns a DeepSeek child, both appear in one projected
transcript with attributed cost, and a root interrupt cancels the child.

P2's acceptance is that the existing per-adapter suites pass unchanged — that is the whole proof the
refactor preserves behaviour. Then one live smoke per new profile.

Finally, drive the app: spawn a subagent from the console and confirm the roll-up renders in the right
column, where W3 currently shows a "not tracked yet" floor.

## Out of scope

ChatGPT web automation (rejected above); depth greater than one (OPEN.md); the worktree manager and
concurrent writers, which arrive after P1 with a real need; and the generalized per-model
tool-presentation system, which is its own later tool-refinement plan — P1 builds one instance at the
right seam.

## Sequencing

This competes with the in-flight W4 and the attended L-ASM calibration gate. W4 goes first: it is
nearly closed, and leaving it half-done strands audited console features with no home. The calibration
gate is independent and can stay queued.

---

_Last reviewed: 2026-07-31_

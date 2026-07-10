# SDK streaming-input steering (P-β) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Claude (SDK) backend from resume-per-turn (P-α) to a **held-open streaming-input `query`** driven by the live session's input channel, so a steer typed mid-turn reaches the **running** Claude turn — retiring the SDK-path-steering deferral (A2 Task 5b). Pure-API steering already works (A2 `drainSteer`); this brings the primary backend to parity.

**Architecture:** P-α already made the daemon own a `LiveSession` per conversation whose input channel yields turns, and the SDK path already runs each turn as a per-turn `createSession` with a *string* input (resume-per-turn behind the facade). P-β makes the SDK path run **one long-lived `createSession` per live session** whose `input` is the LiveSession's turn-channel **as an `AsyncIterable<string>`** — the SDK `query` stays alive across turns (streaming-input mode; `session-input.ts:toSdkPrompt` already maps an async iterable to `SDKUserMessage`s), and a steer is a new user turn **pushed into the open iterable** rather than a `drainSteer` pull. This forces three seams the A2 5b research isolated: **(a)** the real-SDK streaming *termination* model (close the input iterable ⇒ the query ends), **(b)** the first-turn history **preamble under streaming** (today `withHistoryPreamble` only wraps *string* input), and **(c)** **streamed-turn transcript capture** (today `transcript.push` records the user turn from the raw string, which is `''` under streaming — so user/steer turns would vanish from canonical memory and corrupt the primary backend's cross-turn continuity). The neutral facade is unchanged: the async-iterable `input` and the `signal`/steer seam are already backend-neutral M8→M9 contracts; only the injected Claude adapter's internal strategy changes. Pure-API backends are untouched.

**Tech Stack:** TypeScript (strict), pnpm workspaces, Vitest, `@anthropic-ai/claude-agent-sdk` (streaming-input `query`), the M0 push/JSON-RPC transport, `better-sqlite3`-backed R-7 store.

## Pre-plan note (READ FIRST — one design fork + one hard dependency)

- **DESIGN FORK for the maintainer (confirm at kickoff, Task 1).** P-α runs the per-turn persistence prelude (memory plan / resume / frozen-prompt reuse / user-turn append / `seq` continuation / provider pinning / cost) **once per turn** inside `makeRunTurn`. A held-open SDK query spans many turns on **one** server session, so `resume` is not used within a live session and `onBackendSession`/`onBackendMessages`/cost settle fire **across** turns, not per `createSession`. The fork: **how the per-turn persistence cadence maps onto one held-open query** — specifically (i) per-turn user-turn append + `seq` continuation must still happen as each streamed turn starts (Task 1 provides the capture; wiring is Task 3), and (ii) the frozen-prompt/drift model (compiled once at session start, reused — good) and the cost settle (per result, already per-turn inside the SDK `result` handler — good). This is a genuine M8-shape decision; the executor MUST surface its proposed cadence to the maintainer before Task 3, with the two backends' divergence spelled out (pure-API stays resume-per-turn; SDK becomes held-open). Do not silently pick it.
- **HARD DEPENDENCY: a live SDK smoke test (Task 4).** The core assumption — "closing the coa-owned input iterable cleanly terminates the streaming `query` after the last turn's `result`, and a user message pushed into the open iterable mid-turn reaches the running turn" — is **real-SDK behavior that fakes cannot verify** (a fake iterable can model the shape but not the SDK's termination/interleaving semantics). Task 4 is a live smoke test and is the de-risk gate for the whole sub-project. **Memory notes accounts have been rate-limited** ([[auth-multiaccount-design]], [[m8-status]]) — confirm a usable Claude subscription account is available before starting, and treat Task 4 as blocking: Tasks 1–3 are fake-testable and safe to land, but P-β is not "done" until Task 4 passes live.

## Global Constraints

- **TypeScript `strict`, no `any`.**
- **SC-1 (ADR 0009).** The only two blocks stay M3's close-gate + M7's cost-cap. Steer is a **user action**, never a block; a steer must never render as an error. Interrupt (A2) must keep working on the SDK path under streaming.
- **D85 strict-superset (ADR 0008).** A one-turn conversation on the SDK backend behaves as it does today (byte-identical observable output); the streaming machinery is the superset. `coa raw` stays sacred.
- **A1 block-preserving flush (do not regress).** Each SDK turn still flushes the canonical transcript block-consistently on each exit path (the A2 `dropTrailingDanglingToolCall`-trimmed flush in the SDK adapter). A held-open query changes *when* the flush runs (per turn-boundary, not per `createSession`) but not *what* it preserves — a mid-turn throw/interrupt must still leave the canonical `messages.json` round-trip-consistent.
- **Neutral seam (ADR 0002/0004).** No backend type crosses M8's seam; composition never branches on backend. The async-iterable `input` + the steer/`signal` seams are already neutral; only the injected Claude adapter's internal strategy changes. The pure-API adapters are NOT touched.
- **Memory correctness (the reason (c) exists).** After any SDK turn or steer, the canonical `messages.json` MUST contain the user/steer turn(s) verbatim, so a later provider switch replays them (a pure-API backend resends the transcript as `history`). A streamed turn that is missing from `messages.json` silently corrupts cross-turn/cross-provider memory.
- **Commit convention:** subject-line-only Conventional Commits — no body, no trailer, no phase/plan/module IDs in the subject.
- **Stage files by name; never `git add -A`. Never stage or edit `DEV-NOTES.md`** (maintainer WIP). Two unrelated untracked files may sit at repo root (`TEMP.txt`, `project.md`, maintainer's) — never stage them; note that `project.md` currently makes `pnpm docs:check` fail until the maintainer removes it.
- **Same-commit doc rule:** a code change updates the owning SPEC module (`docs/design/handoff/spec/M9.md` for the adapter, `M8.md` for the session seam) + `ROADMAP.md` in the same commit; a new durable decision (the streaming-termination contract) gets a new ADR (next free number after 0011 → **0012**). Keep `pnpm docs:check` green (ignoring the maintainer's stray `project.md`).

---

### Task 1: Streamed-turn transcript capture — record each streamed user/steer turn into canonical memory

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (the transcript-accumulation seam around the `rawInput`/`transcript.push` block — currently ~lines 260–277)
- Modify (if the mapping belongs there): `packages/adapter-claude-sdk/src/transcript.ts`
- Test: `packages/adapter-claude-sdk/src/transcript.test.ts` and/or `packages/adapter-claude-sdk/src/claude-sdk-adapter.test.ts`

**Interfaces:**
- Consumes: the SDK `SDKUserMessage` shape (`{ type:'user', message:{ role:'user', content:string } }`, per `session-input.ts:toUserMessages`), and `BackendMessage` (`@coa/shared`).
- Produces: the adapter records a `{ role:'user', content:<turn text> }` `BackendMessage` for **each streamed user turn** it consumes, so canonical memory is complete under streaming input. Today this is done once from `rawInput` (the string path); this task makes the *streaming* path capture each yielded turn. Name the seam so Task 3 can call it, e.g. `recordUserTurn(text: string)` appending to the adapter's accumulating transcript buffer, OR a `messageToBackendMessages` extension that maps an inbound `SDKUserMessage` → a `user` `BackendMessage` (today `transcript.ts` deliberately skips the echoed user prompt because the caller adds it from raw input — under streaming there IS no raw input, so the caller must add it from the streamed message; pick the seam and document why).

**Step 0 (grounding):** Re-read `claude-sdk-adapter.ts` lines ~255–305 (the `rawInput`/`transcript.push`/`modelPrompt`/`for await (message of runQuery(...))` block), `transcript.ts` in full (esp. the "the echoed user prompt … is added by the caller from the raw input" contract), and `session-input.ts`. Confirm exactly where the accumulating transcript buffer lives and how `onBackendMessages` reports it. Report the seam you chose.

- [ ] **Step 1: Write the failing test.** In `transcript.test.ts` (or the adapter test), assert that when the adapter consumes a streamed user turn (`SDKUserMessage` with `content:'hello'`) with an EMPTY `rawInput` (the streaming case), the accumulated/reported transcript contains `{ role:'user', content:'hello' }`. Assert TWO streamed turns (`'first'`, then a steer `'also do X'`) both appear, in order, in the reported `BackendMessage[]`. Model the fake on the existing adapter tests' `runQuery`/frame harness.
- [ ] **Step 2: Run — FAIL** (`pnpm vitest run packages/adapter-claude-sdk/src/transcript.test.ts` — the streamed user turn is dropped because `rawInput===''`).
- [ ] **Step 3: Implement** the capture: when input is streaming, record each consumed user turn's text as a `user` `BackendMessage` into the accumulating transcript (the same buffer `onBackendMessages` reports), instead of relying on the single `rawInput` push. Keep the string path byte-identical (D85) — the `rawInput!==''` branch is unchanged.
- [ ] **Step 4: Run — PASS** + full `pnpm vitest run packages/adapter-claude-sdk` + `pnpm --filter @coa/adapter-claude-sdk typecheck` + `pnpm eslint <changed files>`.
- [ ] **Step 5: Commit** `feat: capture streamed user turns in the sdk canonical transcript` (stage the changed source + test by name).

---

### Task 2: History preamble under streaming input — deliver the first-turn preamble on the first streamed turn

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (the `modelPrompt`/`deliverHistoryAsPreamble` block, ~lines 267–272)
- Modify: `packages/adapter-claude-sdk/src/history-preamble.ts` (add a streaming-aware variant if needed)
- Test: `packages/adapter-claude-sdk/src/history-preamble.test.ts`

**Interfaces:**
- Consumes: `withHistoryPreamble(input: string, history: readonly BackendMessage[]): string` (today — string only), `deliverHistoryAsPreamble: boolean`, `input: AsyncIterable<string>`.
- Produces: when `deliverHistoryAsPreamble` is set AND input is streaming, the **first** streamed user turn delivered to the SDK carries the history preamble prepended (subsequent turns do not); the persisted transcript still records the raw user turn (Task 1), not the preamble-augmented model delivery. Name it e.g. `withHistoryPreambleStreaming(input: AsyncIterable<string>, history): AsyncIterable<string>` that prepends the preamble to the first yielded item only.

**Step 0 (grounding):** Re-read `history-preamble.ts` + the `modelPrompt` ternary (`claude-sdk-adapter.ts:269–272`), which today falls through to the raw `input` for the streaming case (so a cross-provider switch under streaming loses its memory preamble). Confirm the boundary: preamble = *model delivery only*; the transcript (Task 1) records the raw turn.

- [ ] **Step 1: Write the failing test.** Assert `withHistoryPreambleStreaming` (or the chosen seam) yields a FIRST item equal to `withHistoryPreamble(firstTurn, history)` and PASSES THROUGH every later item unchanged; and that with an empty `history` it degrades to a pass-through (D85).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the streaming preamble wrapper; wire the `modelPrompt` selection so the streaming + `deliverHistoryAsPreamble` case uses it (the string case is unchanged).
- [ ] **Step 4: Run — PASS** + `pnpm vitest run packages/adapter-claude-sdk` + typecheck + eslint.
- [ ] **Step 5: Commit** `feat: deliver the history preamble on the first streamed sdk turn`.

---

### Task 3: Held-open streaming-input SDK path — M8 drives ONE long-lived SDK createSession from the live-session channel

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts` (the SDK branch of `makeRunTurn` / the live-session drive; introduce a held-open SDK strategy that consumes the LiveSession input channel as an async iterable instead of per-turn `createSession`)
- Modify (likely): `packages/core/src/session/live-session.ts` (expose the input channel as an `AsyncIterable<string>` view + a `pushSteer(text)`/`enqueue`-as-turn seam feeding it — reuse the existing turn channel, do not add a parallel one)
- Modify (likely): `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (the `runLoop` termination + per-turn-boundary flush under a held-open query)
- Docs (same commit): `docs/design/handoff/spec/M8.md`, `docs/design/handoff/spec/M9.md`, `ROADMAP.md`, and a NEW ADR `docs/adr/0012-sdk-streaming-input-steering.md`
- Test: `session-handlers.test.ts` + `claude-sdk-adapter.test.ts`

**Step 0 (grounding + the design fork):** Re-read (against CURRENT code): `runLiveSession` + `makeRunTurn` (`session-handlers.ts`), `LiveSession` (`live-session.ts` — the turn channel + `control`), the SDK `runLoop` (`claude-sdk-adapter.ts`), and how P-α's per-turn persistence prelude runs. **Then surface the design fork from the Pre-plan note to the maintainer** — your proposed mapping of per-turn persistence (user-turn append + `seq` + `onBackendMessages` cadence + cost settle) onto ONE held-open SDK query, and how `runLiveSession` selects the held-open SDK strategy vs the pure-API per-turn strategy WITHOUT the facade branching on backend (the injected adapter/factory decides; M8 stays neutral). Get the cadence confirmed before implementing.

**Interfaces:**
- Consumes: Task 1's `recordUserTurn` capture, Task 2's streaming preamble, `LiveSession` (turn channel + `control`), the neutral `SessionAdapterInit.input: string | AsyncIterable<string>` + `signal` (already exists, session.ts).
- Produces: for the SDK/Claude provider, the live session runs **one** `createSession` whose `input` is an `AsyncIterable<string>` sourced from the LiveSession channel (each enqueued turn AND each steer yields into it); the SDK query stays alive across turns; each turn ends at its `result`/turn-boundary; a steer pushed mid-turn reaches the running turn. `setState('running'|'idle')`, fan-out, and the `control` (interrupt) seam continue to work per turn. Pure-API path unchanged (still per-turn `runGovernedLoop` + `drainSteer`).

- [ ] **Step 1 (fake-testable structure):** Write failing tests in `session-handlers.test.ts` asserting, with a FAKE streaming adapter: (a) two turns enqueued on one SDK live session are consumed by ONE held-open `createSession` (the fake sees one query fed two user messages), not two `createSession` calls; (b) a steer enqueued while the fake turn is "running" is yielded into the SAME open iterable (reaches the running turn); (c) each turn still appends its user turn to the store + continues `seq` (Task 1 capture surfaced through persistence); (d) an interrupt still emits `'interrupted'`, never an error (SC-1); (e) a one-turn SDK conversation is observably unchanged (D85). Note: these prove STRUCTURE/wiring with a fake; real SDK termination is Task 4.
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement** the held-open SDK strategy per the maintainer-confirmed cadence: the LiveSession channel exposed as an async iterable; `runLiveSession` (or a sibling `runLiveSdkSession`) selecting the strategy via the injected factory (never a backend `if` in composition); the adapter `runLoop` flushing per turn-boundary (A1 preserved) and terminating when the iterable closes. Author ADR `0012-sdk-streaming-input-steering.md` (the streaming-termination contract + the two-strategy live-session model; link from the seam `// see docs/adr/0012` + the `docs/adr/README.md` index). Update `M8.md` (the SDK strategy diverges to held-open; pure-API stays per-turn), `M9.md` (the adapter's streaming-input `runLoop` + termination), and `ROADMAP.md` (SDK-path steering: real; the A2 5b deferral retired pending live smoke).
- [ ] **Step 4: Run — PASS** + full `pnpm vitest run packages/core` + `pnpm vitest run packages/adapter-claude-sdk` + `pnpm --filter @coa/core typecheck` + `pnpm --filter @coa/adapter-claude-sdk typecheck` + `pnpm eslint <changed>` + `pnpm docs:check` (37 docs with ADR 0012; reachable via the README index — expect the pre-existing `project.md` failure only, if the maintainer hasn't removed it; note it, do not "fix" it by touching their file).
- [ ] **Step 5: Commit** `feat: hold the sdk session open for streaming-input steering` (stage source + ADR + M8 + M9 + ROADMAP by name).

---

### Task 4: Live SDK smoke test — prove termination + steer-reaches-running-turn against the real backend (THE de-risk gate)

**Files:**
- Create: `packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts` (a live, account-gated test — skipped by default, run explicitly), OR a documented manual smoke procedure under `docs/design/research/` if a gated live test isn't wired.
- Modify (if a defect is found): whichever seam Task 3 got wrong.
- Docs (same commit): `ROADMAP.md` (mark SDK-path steering DONE + smoke-verified), the A2 5b note in the SDD ledger / `docs/superpowers/specs/2026-07-06-coa-agent-hardening-design.md` if it tracks the deferral.

**Step 0 (grounding):** Confirm a usable Claude subscription account (`coa auth list/current`; [[auth-multiaccount-design]]). If accounts are still rate-limited, STOP and report BLOCKED — Task 4 cannot be faked and P-β is not done without it. Check whether the repo already has a live-test convention (search for `.live.test`, `describe.skipIf`, an env flag like `COA_LIVE`); mirror it.

- [ ] **Step 1: Write the live smoke** (gated behind an env flag / `describe.skipIf(!process.env.COA_LIVE)`): start a real held-open SDK live session; send turn 1; assert a real assistant result streams and the turn returns to `idle` (not torn down) — the **termination** assumption. Then send turn 2 on the same live session; assert it runs on the SAME server session (no resume replay) with memory intact. Then, mid-turn, push a **steer** and assert it reaches the running turn (observable in the streamed output/tool use). Then interrupt mid-turn and assert `'interrupted'`, never an error (SC-1 under streaming). Finally close the session and assert the query terminates cleanly (no leaked subprocess/stream).
- [ ] **Step 2: Run it live** (`COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts`). If the termination/steer/interrupt assumptions FAIL, this is the point of the gate — debug with `superpowers:systematic-debugging`, fix the Task 3 seam, re-run.
- [ ] **Step 3:** Once green live, record the result in `ROADMAP.md` + the ledger (SDK-path steering real + smoke-verified; A2 5b deferral retired). Ensure the gated test stays SKIPPED in the normal suite (CI has no account) and the default `pnpm vitest run packages/adapter-claude-sdk` stays green.
- [ ] **Step 4: Commit** `test: verify sdk streaming-input steering against the live backend`.

---

## Self-Review

**Spec coverage (design §3 P-β + A2 5b research):** streamed-turn transcript capture (c → Task 1); preamble-under-streaming (b → Task 2); the held-open streaming-input conversion driven by the live-session channel (Task 3); the real-SDK termination + steer-reaches-running-turn assumption (a → Task 4, the live gate). SDK interrupt-under-streaming preserved (Tasks 3/4). Pure-API path untouched (constraint). ✅

**Out of scope (correctly absent):** streaming *token* output / `includePartialMessages` (that is P-γ); multi-viewer console UX; pure-API changes; the worktree/merge manager (ROADMAP item I). ✅

**Fake-vs-live honesty:** Tasks 1–2 are pure fake-testable units with real TDD. Task 3 proves wiring/structure with a fake but is explicitly NOT a proof of real termination. Task 4 is the real-SDK gate and is called out as blocking + account-dependent — matching design §3's "requires a live smoke test." No task pretends to fake-verify real-SDK streaming behavior. ✅

**Design-fork honesty:** the per-turn-persistence-under-one-held-open-query cadence is flagged as a maintainer decision (Pre-plan note + Task 3 Step 0), not silently chosen — matching the co-designer contract. ✅

**Type/interface consistency:** Task 1's `recordUserTurn` capture feeds Task 3's persistence cadence; Task 2's streaming preamble is selected in Task 3's held-open path; `LiveSession`'s existing turn channel is reused as the async-iterable source (no parallel channel); the neutral `input: string | AsyncIterable<string>` + `signal` seams (session.ts) are consumed unchanged. ✅

---

_Last reviewed: 2026-07-08_

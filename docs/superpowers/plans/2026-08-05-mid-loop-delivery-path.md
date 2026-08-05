# Mid-Loop Delivery Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver text into an agent's *running* agentic loop — at the next round trip rather than after the whole turn — on every backend, without discarding in-flight work.

**Architecture:** A neutral pending-delivery queue lives on `LiveSession` in the core. Each backend drains it at the soonest point its own turn model allows: the pure-API driver injects a message at the top of its next loop iteration; the Claude adapter returns `additionalContext` from the already-registered `PostToolUse` hook, which the SDK appends next to the tool result. When no tool call follows, the already-registered `Stop` hook delivers at the boundary and lets the conversation continue. Core never branches on backend — it fills one queue, and each adapter realizes one abstract intent, the same pattern as [ADR-0012](../../adr/0012-sdk-streaming-input-steering.md).

**Tech Stack:** TypeScript (strict, no `any`) · pnpm workspaces · Vitest · `@anthropic-ai/claude-agent-sdk` · Zod.

**Design source:** [the orchestration slice and the delivery path](../specs/2026-08-05-orchestration-slice-and-delivery-design.md), section "Delivery is one path with several producers".

**Scope:** This plan builds the delivery substrate and wires **user steering** as its first producer. The child-completion notice producer, lineage, `spawn_agent`, and the console work belong to the orchestration plan that follows this one. This plan ships working software on its own: after it, a user steer reaches a working Claude agent at the next round trip instead of after the whole loop.

## Before you start (read this first — it replaces having been in the design conversation)

**What coa is.** A local-first, single-user governance and audit layer over a rented coding-agent loop. It does not replace the coding agent; it governs it. A daemon owns sessions; an Electron console is a client; a CLI drives it too. Backends are swappable behind one port (`packages/spi`): Claude via the Agent SDK, plus DeepSeek and LongCat via a shared pure-API loop driver (`packages/loop-driver`).

**The problem this plan solves, in one paragraph.** One *turn* spans a whole agentic loop — assistant, tool call, tool result, assistant, and so on until the model stops asking for tools. One *round trip* is a single request/response inside it. Today, text sent to a Claude agent mid-work is queued until the **turn** boundary, meaning after the agent finishes everything, which can be minutes; the only alternative is barge-in, which discards the in-flight work. This plan delivers at the **round trip** instead — seconds, discarding nothing.

**Read these before writing code**, in this order:

1. `AGENTS.md` at the repo root — the router and the Constitution.
2. `docs/superpowers/specs/2026-08-05-orchestration-slice-and-delivery-design.md`, section "Delivery is one path with several producers" — this plan's design.
3. `docs/adr/0012-sdk-streaming-input-steering.md` — the measured ceiling this plan works *around*, not against. Its finding stands: a message pushed into the Claude SDK's open input iterable is queued to the next turn. That is a fact about the **input stream**; this plan uses a different channel.

**Why the tool-result slot.** The Messages API requires a `tool_result` to immediately follow its `tool_use`, so a bare user message has no legal position mid-loop. The only place text can go is *alongside the tool result* — which is what the `PostToolUse` hook's `additionalContext` does, and it is why Task 4 looks the way it does.

**Invariants you must not break.**

- **SC-1 — help, never cage.** Exactly **two** blocks exist in the whole system: M3's close-gate and M7's cost cap. Nothing here adds a third, and Task 6 must never override a blocked close-gate.
- **Never branch on backend.** No `if (provider === 'claude')` above the adapter layer. Core fills one queue; each adapter realizes one abstract intent in its own turn model — the same pattern ADR-0012 established.
- **Strict superset (D85).** Every new option is optional, and its absence must leave behaviour byte-identical to today.

**How to run things.**

- Tests: `pnpm test` (that is `vitest run`). A single file: `pnpm vitest run <path>`. A single test: add `-t "<name>"`.
- Types: `pnpm typecheck` (this also emits to `dist/`; `apps/cli` has no separate build script).
- The daemon does **not** auto-spawn: `node apps/cli/dist/bin.js serve`. A daemon started before your change will not have it — restart it.
- **Task 1 and Task 8 need a working Claude login**, since they drive the real CLI. Everything else runs offline.

## Global Constraints

- **TypeScript `strict`, no `any`.** Copied from AGENTS.md Constitution.
- **`pnpm typecheck` must stay clean.** It is clean today.
- **`pnpm test` baseline is 10 known failures** (5 deepseek + 5 longcat, all "streaming response had no body"), sometimes plus a live LongCat 402 and an occasional flaky daemon timeout. **This number may not grow.** Verify against unmodified `main` before blaming a change.
- **`pnpm lint` baseline is 9 errors.** May not grow.
- **This repo has NO CI.** No `.github/`, nothing. A skipped or platform-gated test runs nowhere at all. Do not add `describe.skip`, `it.skip`, or a platform guard. The only permitted gate is `COA_LIVE` on `*.live.test.ts` files, which is the existing opt-in convention.
- **Test through the public entry point.** `rpcMethod` is a pure type cast — all Zod validation happens inside `dispatch()`. A test calling `handlers['x'].handle(params)` directly bypasses validation entirely and passes against a completely unvalidated implementation.
- **Mixed fixtures.** Never seed a test with a single item where grouping, ordering, or selection is involved. A single-item fixture hid a Critical through eight reviews on the previous stage.
- **Watch every test fail first, for the reason you expect.** A test that passes before the fix is proving nothing.
- **Commits: subject-only Conventional Commits.** No body, no `Co-Authored-By`, no "Generated with" trailer, no project-internal identifiers (no phase numbers, plan names, or module IDs) in the subject. This overrides any harness default.
- **Stage files by name.** Never `git add -A`. `DEV-NOTES.md`, `README.md`, and `.coa/` carry unrelated local changes — do not stage them.
- **Single `main` branch.** Do not create a worktree or a feature branch; this repo overrides any skill default that wants one.
- **Same-commit doc rule.** A change that adds, moves, or deletes files updates the owning doc in the same commit.
- **Scratch files go in the session scratchpad**, never the repo tree.
- **`packages/core/src/session/agent-registry.ts` is NOT the agent registry.** It is the package/role starter registry (`STARTER_PACKAGES`, `STARTER_ROLES`). The agent registry is `agent-defs.ts`. You should not need either in this plan, but do not confuse them if you go looking.

**What comes after this plan.** [Subagent orchestration](./2026-08-05-subagent-orchestration.md) consumes the `DeliveryQueue` and its `seal()` cancel-guard that Task 2 builds, and adds a second producer: a child session's completion notice. Do not build any of that here.

## File Structure

**New files**

- `packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts` — the `COA_LIVE` gate that settles the two unverified facts before anything depends on them.
- `packages/core/src/session/delivery.ts` — the neutral pending-delivery queue and its envelope type. Its own file rather than an addition to `live-session.ts`, because the orchestration plan adds a second producer to it and `live-session.ts` is already the busiest file in the directory.
- `packages/core/src/session/delivery.test.ts` — unit tests for the queue.

**Modified files**

- `packages/spi/src/runtime-adapter.ts` — add the `Delivery` envelope type and a `drainDeliveries` port on the adapter init contract.
- `packages/core/src/session/live-session.ts` — hold one `DeliveryQueue` per session.
- `packages/adapter-claude-sdk/src/session-options.ts` — `PostToolUse` returns `additionalContext`; `Stop` carries the boundary fallback.
- `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` — accept and forward `drainDeliveries`.
- `packages/loop-driver/src/driver.ts` — drain deliveries at the top of each loop iteration, beside the existing steer drain.
- `packages/core/src/session/session.ts` — pass the session's drain function into the adapter init.
- `packages/core/src/session/session-handlers.ts` — route a held-open steer onto the delivery queue and record it in canonical memory.

**Deliberately not touched**

- `packages/adapter-deepseek/src/adapter.ts` and `packages/adapter-longcat/src/adapter.ts` — both drive `runGovernedLoop` from `@coa/loop-driver`, so Task 5 covers them with no per-adapter edit. Their `deliverReminder` no-ops stay as they are; `Reminder` is M3's `{rule, reason, tier}` authority payload and is **not** the envelope this plan delivers.

---

### Task 1: Settle the two unverified facts

Nothing else in this plan should be built until this passes, because the whole Claude realization rests on it. The design degrades safely if it fails (delivery falls back to the turn boundary), but you want to know before writing the code, not after.

**Files:**
- Create: `packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a recorded answer to (a) does `PostToolUse` `additionalContext` reach the model within the same turn, and (b) does `PostToolUse` fire for `Bash`.

- [ ] **Step 1: Read the existing live-smoke convention**

Read `packages/adapter-claude-sdk/src/governed-gate.live.test.ts` in full. It is the ADR-0029 gate and the closest precedent: it drives the real SDK, gates on `COA_LIVE`, and asserts on hook behaviour. Match its gating idiom and its option construction exactly rather than inventing a second style.

- [ ] **Step 2: Write the live smoke**

Two probes in one file. The first asks the model to read a file and then report a secret word that only the injected context contains — if the word comes back *in the same turn*, injection is within-turn. The second asserts the hook fires for `Bash`.

```ts
import { describe, expect, it } from 'vitest';
import { query } from '@anthropic-ai/claude-agent-sdk';

const LIVE = process.env['COA_LIVE'] === '1';

describe.runIf(LIVE)('PostToolUse additionalContext delivery', () => {
  it('reaches the model within the same turn', async () => {
    const fired: string[] = [];
    let injected = false;
    const messages: string[] = [];
    for await (const m of query({
      prompt:
        'Run the Read tool on package.json. After the tool result, if you see a token ' +
        'of the form COA-DELIVERY-<word>, reply with exactly that token and stop.',
      options: {
        cwd: process.cwd(),
        hooks: {
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if ('tool_name' in input) fired.push(input.tool_name);
                  injected = true;
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PostToolUse',
                      additionalContext: 'COA-DELIVERY-kestrel',
                    },
                  };
                },
              ],
            },
          ],
        },
      },
    })) {
      if (m.type === 'assistant') {
        for (const block of m.message.content) {
          if (block.type === 'text') messages.push(block.text);
        }
      }
    }
    expect(injected).toBe(true);
    expect(fired).toContain('Read');
    // The crux: the token was injected mid-loop and echoed without a second user turn.
    expect(messages.join('\n')).toContain('COA-DELIVERY-kestrel');
  }, 120_000);

  it('fires for Bash', async () => {
    const fired: string[] = [];
    for await (const _ of query({
      prompt: 'Run the Bash tool with the command: echo hello',
      options: {
        cwd: process.cwd(),
        hooks: {
          PostToolUse: [
            {
              hooks: [
                async (input) => {
                  if ('tool_name' in input) fired.push(input.tool_name);
                  return {};
                },
              ],
            },
          ],
        },
      },
    })) {
      void _;
    }
    expect(fired).toContain('Bash');
  }, 120_000);
});
```

- [ ] **Step 3: Run it live**

Run: `COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts`

Expected: both pass. Record the result.

**If the first probe fails**, stop and report before continuing. The Claude row of the delivery table becomes the `Stop`-hook boundary instead of `PostToolUse`, Task 4 changes shape, and Task 6 becomes the primary path rather than the fallback. That is a plan revision, not something to work around silently. **If the second probe fails**, note which tools do not fire; delivery through those boundaries falls back to Task 6, which is degradation, not breakage.

- [ ] **Step 4: Confirm the suite is unaffected without the flag**

Run: `pnpm vitest run packages/adapter-claude-sdk/`
Expected: the new file reports as skipped (no `COA_LIVE`), and the package's other results are unchanged from baseline.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts
git commit -m "test: verify post-tool context injection reaches a running loop"
```

---

### Task 2: The neutral delivery queue

**Files:**
- Modify: `packages/spi/src/runtime-adapter.ts` — declare the envelope beside `ReminderAt` (~line 70)
- Create: `packages/core/src/session/delivery.ts`
- Create: `packages/core/src/session/delivery.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: from `@coa/spi` — `DeliveryOrigin = 'user' | 'system'`, `Delivery = { origin: DeliveryOrigin; text: string }`, `DrainDeliveries = () => readonly Delivery[]`. From `@coa/core` — `class DeliveryQueue` with `push(d: Delivery): void`, `drain(): readonly Delivery[]`, `size(): number`, `seal(): void`, `isSealed(): boolean`. Tasks 3–7 all consume these exact names.

**The envelope is declared once, in the port**, because both the core (which fills the queue) and every adapter (which drains it) need it, and a second structurally-identical declaration in the core would be two types to keep in step. The core already imports from `@coa/spi` — see `packages/core/src/session/permission.ts` — so the direction is established.

`seal()` is the cancel-guard hook the orchestration plan needs: a sealed queue accepts nothing further, so a notice that arrives after a session was stopped cannot revive it. It is built here because the queue owns the invariant, and a later plan bolting it on from outside would leave a window where a push races a teardown.

- [ ] **Step 1: Declare the envelope in the port**

In `packages/spi/src/runtime-adapter.ts`, add next to `ReminderAt` (~line 70):

```ts
/**
 * Text waiting to reach a running loop, drained by an adapter at its own soonest
 * boundary. Distinct from `Reminder`, which is M3's `{rule, reason, tier}` authority
 * payload delivered at a position D108 dictates — this carries arbitrary text and a
 * provenance tag, not a rule.
 */
export type DeliveryOrigin = 'user' | 'system';

export interface Delivery {
  origin: DeliveryOrigin;
  text: string;
}

/** An adapter's pull on the session's pending deliveries; returns [] when there are none. */
export type DrainDeliveries = () => readonly Delivery[];
```

- [ ] **Step 2: Write the failing test**

Note the mixed fixture — two origins and three entries, so an ordering or filtering bug cannot hide behind a single item.

```ts
import { describe, expect, it } from 'vitest';
import { DeliveryQueue } from './delivery.js';

describe('DeliveryQueue', () => {
  it('drains in FIFO order and empties itself', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'user', text: 'steer one' });
    q.push({ origin: 'system', text: 'notice one' });
    q.push({ origin: 'user', text: 'steer two' });
    expect(q.size()).toBe(3);
    expect(q.drain()).toEqual([
      { origin: 'user', text: 'steer one' },
      { origin: 'system', text: 'notice one' },
      { origin: 'user', text: 'steer two' },
    ]);
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it('delivers each entry exactly once across two drains', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'system', text: 'first' });
    expect(q.drain()).toEqual([{ origin: 'system', text: 'first' }]);
    q.push({ origin: 'user', text: 'second' });
    expect(q.drain()).toEqual([{ origin: 'user', text: 'second' }]);
  });

  it('drops pushes once sealed and drains empty', () => {
    const q = new DeliveryQueue();
    q.push({ origin: 'user', text: 'before' });
    q.seal();
    q.push({ origin: 'system', text: 'after' });
    expect(q.isSealed()).toBe(true);
    expect(q.drain()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/delivery.test.ts`
Expected: FAIL — cannot resolve `./delivery.js`.

- [ ] **Step 4: Implement the queue**

```ts
import type { Delivery } from '@coa/spi';

/**
 * The neutral pending-delivery queue: text waiting to reach a session's model at
 * the soonest point its backend's turn model allows. Core fills it; each adapter
 * drains it at its own boundary (the pure-API loop's next round trip, the Claude
 * adapter's PostToolUse hook), so no plane above M9 branches on backend.
 *
 * `origin` separates what a person said from what the system reports: a `user`
 * entry is recorded as a user turn in canonical memory, a `system` entry is a
 * notice and is never attributable to the person. A model cannot reach a producer,
 * so a `system` origin is unforgeable by construction.
 *
 * Sealing is the cancel-guard: a stopped session's queue accepts nothing further,
 * so a late notice can never revive a subtree a person deliberately stopped.
 */
export class DeliveryQueue {
  #pending: Delivery[] = [];
  #sealed = false;

  push(delivery: Delivery): void {
    if (this.#sealed) return;
    this.#pending.push(delivery);
  }

  /** Take everything pending, leaving the queue empty (at-most-once delivery). */
  drain(): readonly Delivery[] {
    if (this.#sealed) return [];
    return this.#pending.splice(0, this.#pending.length);
  }

  size(): number {
    return this.#pending.length;
  }

  /** Permanently stop accepting and yielding deliveries. Not reversible. */
  seal(): void {
    this.#sealed = true;
    this.#pending = [];
  }

  isSealed(): boolean {
    return this.#sealed;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run packages/core/src/session/delivery.test.ts`
Expected: 3 passed.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/spi/src/runtime-adapter.ts packages/core/src/session/delivery.ts packages/core/src/session/delivery.test.ts
git commit -m "feat: add a neutral pending-delivery queue"
```

---

### Task 3: Hang the queue on the live session, sealed at teardown

**Files:**
- Modify: `packages/core/src/session/live-session.ts`
- Test: `packages/core/src/session/live-session.test.ts`

**Interfaces:**
- Consumes: `DeliveryQueue` from Task 2 (core), and `Delivery` / `DrainDeliveries` from Task 2 (`@coa/spi`).
- Produces: `LiveSession#deliveries: DeliveryQueue` — a public readonly field. Tasks 4–7 consume it.

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/session/live-session.test.ts`:

```ts
it('carries a delivery queue that close() seals', () => {
  const session = new LiveSession('conv-1');
  session.deliveries.push({ origin: 'user', text: 'steer' });
  session.deliveries.push({ origin: 'system', text: 'notice' });
  expect(session.deliveries.size()).toBe(2);
  session.close();
  expect(session.deliveries.isSealed()).toBe(true);
  expect(session.deliveries.drain()).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/live-session.test.ts -t "delivery queue"`
Expected: FAIL — `session.deliveries` is undefined.

- [ ] **Step 3: Implement**

In `packages/core/src/session/live-session.ts`, add the import beside the existing ones:

```ts
import { DeliveryQueue } from './delivery.js';
```

Add the field next to the other public fields on `LiveSession` (beside `worktree` / `state` / `control`):

```ts
  /**
   * Text waiting to reach this session's model mid-loop. Sealed by `close()` so a
   * delivery arriving after teardown can never wake a stopped session.
   */
  readonly deliveries = new DeliveryQueue();
```

In `close()`, seal before running the finalizers, so nothing enqueued by a finalizer survives:

```ts
  close(): void {
    this.#closed = true;
    this.deliveries.seal();
    // Finalizers first (and once): ending the held-open input feed lets the backend
    // query drain its last result before the parked loop wakes and exits.
    const finalizers = this.#onClose;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/live-session.test.ts`
Expected: all pass, including the new one.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/live-session.ts packages/core/src/session/live-session.test.ts
git commit -m "feat: seal a closed session's pending deliveries at teardown"
```

---

### Task 4: Claude realization — PostToolUse returns the pending text

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts:16-70` (the `buildHooks` function)
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `DrainDeliveries` from Task 3.
- Produces: `buildHooks` accepts an added optional `drainDeliveries?: DrainDeliveries`; absent ⇒ byte-identical behaviour to today (D85).

The `PostToolUse` hook already exists and drives producer ②. This gives it a return value. Keep `observeChanges` firing unconditionally — observation must not depend on whether anything was pending.

- [ ] **Step 1: Write the failing test**

Read `packages/adapter-claude-sdk/src/session-options.test.ts` first and match its existing idiom for invoking a hook callback. Then add:

```ts
it('returns pending deliveries as additionalContext and still observes', async () => {
  const observed: number[] = [];
  const pending = [
    { origin: 'user' as const, text: 'stop and check the schema first' },
    { origin: 'system' as const, text: 'subagent explorer finished' },
  ];
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
    observeChanges: () => observed.push(1),
    drainDeliveries: () => pending.splice(0, pending.length),
  });
  const postToolUse = hooks.PostToolUse?.[0]?.hooks[0];
  const out = await postToolUse?.(
    { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} } as never,
    undefined as never,
    { signal: new AbortController().signal },
  );
  expect(observed).toEqual([1]);
  expect(out?.hookSpecificOutput?.additionalContext).toContain('stop and check the schema first');
  expect(out?.hookSpecificOutput?.additionalContext).toContain('subagent explorer finished');
});

it('omits additionalContext when nothing is pending', async () => {
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
    observeChanges: () => {},
    drainDeliveries: () => [],
  });
  const postToolUse = hooks.PostToolUse?.[0]?.hooks[0];
  const out = await postToolUse?.(
    { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: {} } as never,
    undefined as never,
    { signal: new AbortController().signal },
  );
  expect(out).toEqual({});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts -t "additionalContext"`
Expected: FAIL — `drainDeliveries` is not a known property, and `additionalContext` is undefined.

- [ ] **Step 3: Implement**

In `packages/adapter-claude-sdk/src/session-options.ts`, add to the `buildHooks` args type:

```ts
  /**
   * Pull this session's pending deliveries. Returning text appends it next to the
   * tool result, so it reaches the model on the loop's next round trip rather than
   * after the whole turn. Absent ⇒ nothing is appended (D85).
   */
  drainDeliveries?: DrainDeliveries;
```

Import the type from `@coa/spi` alongside the existing `BackendConfig, CanUseTool, StopPredicate`. Destructure `drainDeliveries` with the others, then replace `observeAfterTool`:

```ts
  // The producer trigger AND the mid-loop delivery point. coa does not parse
  // `tool_input` per tool: the reconciler scans the worktree itself, so one trigger
  // covers a native Edit, a Write, and any file a Bash command touched. Observation
  // is unconditional and never governance (docs/adr/0029); the delivery is appended
  // next to the tool result, which is the only legal position mid-loop — a bare user
  // message cannot sit between a tool_use and its tool_result.
  const observeAfterTool: HookCallback = async () => {
    observeChanges();
    const pending = drainDeliveries?.() ?? [];
    if (pending.length === 0) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: pending.map(renderDelivery).join('\n'),
      },
    };
  };
```

Add the renderer above `buildHooks`:

```ts
/**
 * One delivery as the model reads it. A `user` entry is framed as the person
 * speaking mid-work; a `system` entry is framed as a platform notice, so the model
 * never attributes an automated report to the human.
 */
function renderDelivery(delivery: { origin: 'user' | 'system'; text: string }): string {
  return delivery.origin === 'user'
    ? `[The user sent this while you were working] ${delivery.text}`
    : `[coa notice] ${delivery.text}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts`
Expected: all pass, existing tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "feat: deliver pending text next to the tool result on the claude path"
```

---

### Task 5: Pure-API realization — drain at the next round trip

**Files:**
- Modify: `packages/loop-driver/src/driver.ts:97-105` (deps) and `:148-151` (the drain point)
- Test: `packages/loop-driver/src/driver.test.ts`

**Interfaces:**
- Consumes: `Delivery`, `DrainDeliveries` from Task 3.
- Produces: `GovernedLoopDeps.drainDeliveries?: DrainDeliveries`. This single change covers DeepSeek and LongCat, which both drive `runGovernedLoop`.

A `system` delivery must be emitted as a frame so it reaches the append-only log, exactly as the existing steer drain does — the log is the only durable record. It is pushed as a `user`-role API message because the Messages API has no other role available for mid-conversation input, but its **frame** carries the system origin, so the transcript never shows a person saying it.

- [ ] **Step 1: Write the failing test**

Read `packages/loop-driver/src/driver.test.ts` first and reuse its existing mock `complete` and catalogue helpers rather than writing new ones. Then add:

```ts
it('drains deliveries into the next round trip, tagged by origin', async () => {
  const seen: DriverMessage[][] = [];
  const frames: TurnFrame[] = [];
  const pending = [
    { origin: 'user' as const, text: 'check the schema first' },
    { origin: 'system' as const, text: 'explorer finished' },
  ];
  await runGovernedLoop({
    ...baseDeps(),
    drainDeliveries: () => pending.splice(0, pending.length),
    onTurn: (f) => frames.push(f),
    complete: (messages) => {
      seen.push([...messages]);
      return replyWithText('done');
    },
  });
  const first = seen[0] ?? [];
  expect(first.some((m) => m.role === 'user' && m.content.includes('check the schema first'))).toBe(
    true,
  );
  expect(first.some((m) => m.role === 'user' && m.content.includes('explorer finished'))).toBe(true);
  // The system entry is recorded, but never as something the person said.
  const userFrames = frames.filter((f) => f.t === 'text' && f.role === 'user');
  expect(userFrames).toHaveLength(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/loop-driver/src/driver.test.ts -t "drains deliveries"`
Expected: FAIL — `drainDeliveries` is not a known property and neither message is present.

- [ ] **Step 3: Implement**

In `packages/loop-driver/src/driver.ts`, add to `GovernedLoopDeps` beside `drainSteer` / `drainQueuedSteer`:

```ts
  /**
   * Pending mid-loop deliveries (user steers and system notices), drained at the top
   * of each round trip — the driver's soonest safe boundary, discarding nothing.
   * Absent ⇒ no deliveries, byte-identical to today (D85).
   */
  drainDeliveries?: DrainDeliveries;
```

`loop-driver` already imports `CanUseTool, RuntimeUsage, StopPredicate, ToolCatalogue` from `@coa/spi` at the top of this file — add `DrainDeliveries` to that same import rather than declaring the shape inline.

Immediately after the existing `drainSteer` loop (line 148-151), add:

```ts
      // Mid-loop delivery. A `system` entry rides the user role because the Messages
      // API offers no other slot for mid-conversation input, but its FRAME carries the
      // system origin so the append-only log never attributes it to the person.
      for (const delivery of deps.drainDeliveries?.() ?? []) {
        const text =
          delivery.origin === 'user'
            ? delivery.text
            : `[coa notice] ${delivery.text}`;
        messages.push({ role: 'user', content: text });
        if (delivery.origin === 'user') emit({ t: 'text', text, role: 'user' });
        else emit({ t: 'text', text, role: 'system' });
      }
```

If `TurnFrame`'s `role` union does not admit `'system'`, widen it in `packages/shared` and update the console's frame mapper in the same commit rather than mislabelling the entry as `user`. Check first: `grep -rn "role?: 'user'" packages/shared/src`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/loop-driver/`
Expected: all pass. The 10 known deepseek/longcat failures are in their own packages and are unaffected.

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/loop-driver/src/driver.ts packages/loop-driver/src/driver.test.ts
git commit -m "feat: drain pending deliveries at the next round trip in the governed loop"
```

---

### Task 6: The boundary fallback when no tool call follows

**Files:**
- Modify: `packages/adapter-claude-sdk/src/session-options.ts` (the `Stop` hook registration)
- Test: `packages/adapter-claude-sdk/src/session-options.test.ts`

**Interfaces:**
- Consumes: `DrainDeliveries` from Task 3, `buildHooks` from Task 4.
- Produces: no new exports.

If the model answers in plain text and calls no tool, `PostToolUse` never fires and a pending delivery would sit until the next user turn. The `Stop` hook supports `additionalContext` with "conversation continues" semantics, and coa already registers it for the close-gate. This is the floor the design promises.

**Ordering matters:** the close-gate's decision wins. A blocked gate already returns its own output; only an *allowed* stop may carry a delivery.

- [ ] **Step 1: Write the failing test**

```ts
it('delivers pending text at an allowed stop so the conversation continues', async () => {
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: true }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
    observeChanges: () => {},
    drainDeliveries: () => [{ origin: 'system' as const, text: 'explorer finished' }],
  });
  const stop = hooks.Stop?.[0]?.hooks[0];
  const out = await stop?.({ hook_event_name: 'Stop' } as never, undefined as never, {
    signal: new AbortController().signal,
  });
  expect(JSON.stringify(out)).toContain('explorer finished');
});

it('leaves a blocked close-gate decision untouched', async () => {
  const drained: number[] = [];
  const hooks = buildHooks({
    stopPredicate: () => ({ allow: false, message: 'Cannot close: 1 unresolved check' }),
    canUseTool: () => ({ behavior: 'allow' }),
    sessionId: 's1',
    observeChanges: () => {},
    drainDeliveries: () => {
      drained.push(1);
      return [];
    },
  });
  const stop = hooks.Stop?.[0]?.hooks[0];
  const out = await stop?.({ hook_event_name: 'Stop' } as never, undefined as never, {
    signal: new AbortController().signal,
  });
  expect(JSON.stringify(out)).toContain('Cannot close');
  expect(drained).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/adapter-claude-sdk/src/session-options.test.ts -t "allowed stop"`
Expected: FAIL — the stop output contains no delivery text.

- [ ] **Step 3: Implement**

Read `toStopHookOutput` in `packages/adapter-claude-sdk/src/sdk-options.ts` before writing this, so the allowed-vs-blocked output shape is matched exactly rather than guessed. Then replace the inline `Stop` registration in `buildHooks`:

```ts
  // The close-gate, plus the delivery FLOOR: when the model answers in plain text and
  // calls no tool, PostToolUse never fires, so this is the only remaining point before
  // the turn ends. A blocked gate is never overridden — its decision is one of coa's two
  // blocks (SC-1) and it already carries its own reason.
  const stopWithDelivery: HookCallback = async () => {
    const decision = await stopPredicate();
    if (!decision.allow) return toStopHookOutput(decision);
    const pending = drainDeliveries?.() ?? [];
    if (pending.length === 0) return toStopHookOutput(decision);
    return {
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext: pending.map(renderDelivery).join('\n'),
      },
    };
  };
```

and register `Stop: [{ hooks: [stopWithDelivery] }]` in the returned object.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/adapter-claude-sdk/`
Expected: all pass; the live file still reports skipped.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/session-options.ts packages/adapter-claude-sdk/src/session-options.test.ts
git commit -m "feat: deliver pending text at an allowed close-gate stop"
```

---

### Task 7: Wire the session — the adapter gets the queue, the steer fills it

**Files:**
- Modify: `packages/adapter-claude-sdk/src/claude-sdk-adapter.ts` (init type + forward to `assembleSessionOptions`)
- Modify: `packages/adapter-claude-sdk/src/session-options.ts` (`assembleSessionOptions` forwards to `buildHooks`)
- Modify: `packages/core/src/session/session.ts:140-230` (`SessionDeps` / `createSession` request) and `:300-320` (adapter construction)
- Modify: `packages/core/src/session/session-handlers.ts:1144-1156` (`steerSession`)
- Test: `packages/core/src/session/session-handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: a held-open steer routed onto `session.deliveries` instead of the input feed.

This is the task that turns the substrate into a shipped user-facing fix. Read all four files before editing — the previous stage's plan named a file needing no change and missed six that did, precisely because its steps were written against unread code.

**The canonical-memory wrinkle.** On the held-open path, `pushSteer` puts the text into the SDK input feed, where `tapStreamedUserTurns` captures it into canonical memory. A steer routed to the delivery queue bypasses that tap. It must be recorded explicitly, or the user's words vanish from the log — and ADR-0012 is explicit that the log is the only durable record of what the user sent.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/session/session-handlers.test.ts`, following that file's existing convention of driving through `dispatch()` rather than calling handlers directly:

```ts
it('routes a held-open steer onto the delivery queue and records it', async () => {
  const { dispatch, registry } = buildTestServer();
  const session = registry.getOrCreate('conv-1').session;
  session.control = {
    controller: new AbortController(),
    steer: [],
    queueSteer: [],
    interrupted: false,
    mode: 'held-open',
  };
  const res = await dispatch({
    jsonrpc: '2.0',
    id: 1,
    method: 'steerSession',
    params: { id: 'conv-1', text: 'check the schema first', mode: 'queue' },
  });
  expect(res.result).toEqual({ steered: true });
  expect(session.deliveries.drain()).toEqual([
    { origin: 'user', text: 'check the schema first' },
  ]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts -t "delivery queue"`
Expected: FAIL — the queue drains empty, because the steer went to `pushSteer`.

- [ ] **Step 3: Implement, in dependency order**

First, `claude-sdk-adapter.ts`: add `drainDeliveries?: DrainDeliveries` to `ClaudeSdkAdapterInit` beside `observeChanges`, store it on the instance, and pass it through every `assembleSessionOptions(...)` call site — there is more than one (the one-shot path and the held-open establishment path). Grep for `assembleSessionOptions(` and update each.

Second, `session-options.ts`: add `drainDeliveries?: DrainDeliveries` to the `assembleSessionOptions` args, destructure it, and forward it into the `buildHooks({...})` call.

Third, `session.ts`: add `drainDeliveries?: DrainDeliveries` to the `createSession` request type beside `drainSteer`, and forward it into `deps.createAdapter({...})` using the same conditional-spread idiom the neighbouring optional fields use:

```ts
    ...(req.drainDeliveries !== undefined ? { drainDeliveries: req.drainDeliveries } : {}),
```

Fourth, `session-handlers.ts`: where the per-turn request is built (near the `queueSteer` construction around line 556-580), pass `drainDeliveries: () => session.deliveries.drain()`. Then change `steerSession`:

```ts
      if (session.control.mode === 'held-open') {
        // Route to the delivery queue rather than the input feed: the feed queues to
        // the next TURN boundary (docs/adr/0012's measured ceiling), while a delivery
        // lands next to the next tool result — the same round trip. The feed's
        // `tapStreamedUserTurns` no longer sees it, so record it here explicitly; the
        // append-only log is the only durable record of what the user sent.
        session.deliveries.push({ origin: 'user', text: params.text });
        recordUserTurn(params.id, params.text);
      } else if (params.mode === 'barge-in') {
```

Find the existing canonical-memory write used by the streamed-turn tap and call the same one; do not invent a second writer (ADR-0010). Grep for `tapStreamedUserTurns` and follow it to the store method it calls.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts`
Expected: all pass. If a pre-existing held-open steer test now fails, that test encodes the old input-feed route — update it to assert the queue, and say so in the commit.

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; test failures still exactly the 10 known ones. If the count moved, stop and diff against `main`.

- [ ] **Step 5: Commit**

```bash
git add packages/adapter-claude-sdk/src/claude-sdk-adapter.ts packages/adapter-claude-sdk/src/session-options.ts packages/core/src/session/session.ts packages/core/src/session/session-handlers.ts packages/core/src/session/session-handlers.test.ts
git commit -m "feat: land a user steer at the next round trip instead of the turn boundary"
```

---

### Task 8: Prove it end to end, then document

**Files:**
- Modify: `packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts`
- Modify: `docs/adr/` — add the delivery ADR
- Modify: `ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: an ADR the orchestration plan references.

- [ ] **Step 1: Extend the live smoke to the real wiring**

Add a third probe that drives a real governed session, steers it while a tool call is in flight, and asserts the steer text appears in the transcript **before** the turn's terminal result — the end-to-end version of Task 1's probe. Model it on `barge-in-smoke.live.test.ts`, which already drives a genuinely-running turn and is the closest precedent for timing assertions.

- [ ] **Step 2: Run the full live gate**

Run: `COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts`
Expected: all three pass.

- [ ] **Step 3: Write the ADR**

Create the next-numbered ADR (currently `docs/adr/0030-*`; check `ls docs/adr/` first). Title it for the decision, not the mechanism: delivery is one intent realized per backend. It must record:

- that ADR-0012's ceiling stands and is about the **input stream**, not about mid-loop delivery generally;
- that the Messages API forbids a bare user message between a tool call and its result, which is *why* the tool-result slot is the only legal mid-loop position;
- the per-backend realization table from the spec;
- that a `system` origin is unforgeable because no producer is reachable from a tool handler;
- the measured answer from Task 1, with its date.

Follow the house format exactly: status, date, context and problem, decision drivers, considered options, decision, consequences (good/bad), last-reviewed footer.

- [ ] **Step 4: Update the roadmap**

Add a row recording that mid-loop delivery landed and that the child-completion producer is the next plan's work. Keep it one line; the ADR carries the reasoning.

- [ ] **Step 5: Full verification and commit**

Run: `pnpm typecheck && pnpm test && pnpm docs:check`
Expected: typecheck clean; exactly the 10 known test failures; `docs:check` failing only on the gitignored `TEMP.md`.

```bash
git add packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts docs/adr/0030-*.md ROADMAP.md
git commit -m "docs: record that delivery is one intent realized per backend"
```

---

## What this plan does NOT build

Stated so a reviewer does not read an omission as a gap:

- **The child-completion producer**, lineage, `spawn_agent`, abort cascade, root cost attribution, and the console nesting. All belong to the orchestration plan that follows. This plan gives that plan a delivery substrate and a cancel-guard (`seal()`) to build on.
- **Agent-to-agent messaging**, stage 3. It becomes a third producer on this queue.
- **A durable delivery log.** The queue is in-memory for the daemon's lifetime; user steers are still durably recorded in canonical memory by Task 7.

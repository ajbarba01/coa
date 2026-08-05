# Subagent Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent spawn another agent by name — as a real child session with lineage, cancellable from its root, whose cost is attributable and whose completion reaches the parent — and show it in the console nested under its parent.

**Architecture:** A subagent is a coa session with a parent link, not a new kind of object. `spawn_agent` resolves an agent ref against the daemon's live registry, starts a child session with its own conversation id, and returns that id **without waiting**. When the child ends, a system-authored notice is pushed onto the parent's delivery queue, which the previous plan built. Abort derives from the *session* (never the turn, since a parent's turn ends while its child runs) and cascades from the root, sealing each descendant's queue so a late notice cannot revive a stopped tree.

**Tech Stack:** TypeScript (strict, no `any`) · pnpm workspaces · Vitest · Zod · Electron + React (console).

**Design source:** [the orchestration slice and the delivery path](../specs/2026-08-05-orchestration-slice-and-delivery-design.md).

**Hard prerequisite:** [the mid-loop delivery path plan](./2026-08-05-mid-loop-delivery-path.md) must be complete and merged. This plan consumes two things it produces: `LiveSession#deliveries` (a `DeliveryQueue` with `push`/`drain`/`seal`/`isSealed`) and the `Delivery = { origin: 'user' | 'system'; text: string }` envelope exported from `@coa/spi`. If `packages/core/src/session/delivery.ts` does not exist, stop — you are on the wrong plan.

---

## Before you start (read this first — it replaces having been in the design conversation)

**What coa is.** A local-first, single-user governance and audit layer over a rented coding-agent loop. It does not replace the coding agent; it governs it. A daemon owns sessions; an Electron console is a client; a CLI drives it too. Backends are swappable behind one port (`packages/spi`): Claude via the Agent SDK, plus DeepSeek and LongCat via a shared pure-API loop driver.

**Read these before writing code**, in this order. They are short and they own the rules you are about to touch:

1. `AGENTS.md` at the repo root — the router and the Constitution.
2. `docs/superpowers/specs/2026-08-05-orchestration-slice-and-delivery-design.md` — this plan's design, including *why* several things you might "fix" are deliberate.
3. `docs/adr/0029-one-bounded-tool-surface-governed-at-one-seam.md` — where per-tool governance actually lives, and why the native delegation tool is already gone.
4. `docs/adr/0011-daemon-authoritative-live-session.md` and `docs/adr/0010-append-only-conversation-log.md` — session ownership and the record.

**Invariants you must not break.**

- **SC-1 — help, never cage.** There are exactly **two** blocks in the whole system: M3's close-gate and M7's cost cap. Nothing in this plan adds a third. An error condition returns an *unapplied result* the agent can read and retry, never a throw and never a denial.
- **Never branch on backend.** No `if (provider === 'claude')` above the adapter layer. Core consumes abstract verdicts; adapters realize them.
- **Producers and consumers point only at the change-event spine (M1).** Two non-kernel modules must not call each other directly. The established pattern is that a module declares a *port* in its own deps type and the composition root injects it. Follow it — `spawn_agent` declares what it needs and the daemon supplies it.
- **Strict superset (D85).** Every new option is optional and its absence must leave behaviour byte-identical to today.

**How to run things.**

- Tests: `pnpm test` (that is `vitest run`). A single file: `pnpm vitest run <path>`. A single test: add `-t "<name>"`.
- Types: `pnpm typecheck` (this also emits to `dist/`; `apps/cli` has no separate build script).
- The daemon does **not** auto-spawn: `node apps/cli/dist/bin.js serve`. **A daemon started before your change will not have your change's verbs** — restart it. A stale daemon looks exactly like an empty-registry bug.
- The Electron app from a tool shell needs `env -u ELECTRON_RUN_AS_NODE`, and it holds a single-instance lock.

**Baselines that may not grow.** Verify against unmodified `main` before blaming your change.

- `pnpm typecheck` — **clean**, and must stay clean.
- `pnpm test` — **10 known failures** (5 deepseek + 5 longcat, all "streaming response had no body"), sometimes plus a live LongCat 402 and an occasional flaky daemon timeout.
- `pnpm lint` — **9 errors**.
- `pnpm docs:check` — fails **only** on the gitignored `TEMP.md`.

**There is NO CI in this repo.** No `.github/`, nothing. A skipped or platform-gated test runs nowhere at all. Never add `describe.skip`, `it.skip`, or a platform guard. The only permitted gate is `COA_LIVE` on `*.live.test.ts`.

**Gotchas that each cost a fix round on the previous stage.**

- **`rpcMethod` is a pure type cast.** All Zod validation happens inside `dispatch()`. A test calling `handlers['x'].handle(params)` directly bypasses validation entirely and will pass against a completely unvalidated implementation. Test through `dispatch()` and assert the `invalidParams` envelope — `session-handlers.test.ts` already has the convention.
- **Single-item fixtures hide grouping bugs.** A Critical shipped through eight reviews because a test seeded state with one agent, so it trivially became `agents[0]`. Use mixed fixtures everywhere ordering, grouping, or selection is involved.
- **A test that passes before you write the fix is proving nothing.** One UI test opened a dialog by clicking, which is an outside-press the popover library already handled, so it passed against unfixed code. Watch every test fail for the reason you expect.
- **Tailwind: a caller's `p-0` does not beat a shared class's `py-1`.** Both are emitted and the cascade settles it by order. Remove the class at its source; never "override" it.
- **Native `title` tooltips are banned console-wide.** The OS draws them outside the page. Use the kit's `Tooltip`, and note a tooltip on a *disabled* control must ride a wrapper element, since a disabled button dispatches no pointer events.
- **`packages/core/src/session/agent-registry.ts` is NOT the agent registry.** It is the package/role starter registry (`STARTER_PACKAGES`, `STARTER_ROLES`). The agent registry is `agent-defs.ts`. Do not merge them.

**Commit and branch rules.**

- Subject-only Conventional Commits. **No body, no `Co-Authored-By`, no "Generated with" trailer**, no project-internal identifiers (no phase numbers, plan names, module IDs) in the subject. This overrides any harness default.
- **Stage files by name.** Never `git add -A`. `DEV-NOTES.md`, `README.md`, and `.coa/` carry unrelated local changes — never stage them.
- **Single `main` branch.** Do not create a worktree or feature branch; this repo overrides any skill default that wants one.
- **Same-commit doc rule:** a change that adds, moves, or deletes files updates the owning doc in the same commit.
- Scratch files go in the session scratchpad, never the repo tree.

---

## File Structure

**New files**

- `packages/core/src/session/lineage.ts` + `.test.ts` — the descendant walk and root resolution, pure and independently testable. Its own file because `live-registry.ts` owns lifecycle and should not also own graph queries.
- `packages/core/src/session/notify.ts` + `.test.ts` — the system-authored notification envelope and its rendering into a `Delivery`.
- `packages/core/src/workbench/spawn.ts` + `.test.ts` — the `spawn_agent` handler and its port types, beside the other M6 handlers (`retrieve.ts`, `mutate.ts`, `inspect.ts`).

**Modified files**

- `packages/shared/src/agent.ts` — nothing. Listed only to say explicitly: the agent schema needs **no change**; `AgentSummary` already carries everything a spawn reads.
- `packages/core/src/session/conversation-store.ts` — `SessionMeta` gains optional `parent` and `root`; `create()` accepts them.
- `packages/core/src/session/live-session.ts` — `parent` / `root` fields.
- `packages/core/src/session/live-registry.ts` — cascade on close.
- `packages/core/src/workbench/catalogue.ts` — the `spawn_agent` manifest entry.
- `packages/core/src/workbench/governed-tools.ts` — the spec-table entry and its dep port.
- `packages/core/src/session/session-handlers.ts` — child creation, lineage plumbing, completion notice.
- `packages/core/src/governance/ledger.ts` — the `root` allow-list key.
- `packages/core/src/session/transcript-projection.ts` — the parent/child read-time join.
- `packages/console-viewmodel/src/reads.ts` and the console panels — nesting and roll-up.

---

### Task 1: Lineage on the durable record

**Files:**
- Modify: `packages/core/src/session/conversation-store.ts:90-109` (`metaSchema`) and `:128` (`create`)
- Test: `packages/core/src/session/conversation-store.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SessionMeta.parent?: string`, `SessionMeta.root?: string`; `ConversationStore.create(init: { id, agentRef, title, scope, parent?, root? })`. Tasks 6, 8, and 9 consume these names.

Both fields are **optional**, so every conversation already on disk keeps parsing. A root session may leave `root` unset — absent means "I am my own root" — but Task 6 sets it explicitly on every new session so reads never have to special-case it.

- [ ] **Step 1: Write the failing test**

Mixed fixture: a root and two children, so a lookup that accidentally returns the first entry cannot pass.

```ts
it('persists parent and root links and reloads them', () => {
  const store = createTestStore();
  store.create({ id: 'root-1', agentRef: 'general-purpose', title: 'Root', scope: 'repo' });
  store.create({
    id: 'kid-a', agentRef: 'explorer', title: 'A', scope: 'repo',
    parent: 'root-1', root: 'root-1',
  });
  store.create({
    id: 'kid-b', agentRef: 'explorer', title: 'B', scope: 'repo',
    parent: 'root-1', root: 'root-1',
  });
  expect(store.getMeta('root-1')?.parent).toBeUndefined();
  expect(store.getMeta('kid-b')?.parent).toBe('root-1');
  expect(store.getMeta('kid-b')?.root).toBe('root-1');
  expect(store.list().filter((m) => m.root === 'root-1')).toHaveLength(2);
});

it('still parses a meta written before lineage existed', () => {
  const store = createTestStore();
  store.create({ id: 'legacy', agentRef: 'general-purpose', title: 'Old', scope: 'repo' });
  expect(store.getMeta('legacy')?.root).toBeUndefined();
});
```

Read `conversation-store.test.ts` first and use its existing temp-dir store helper rather than writing a new one.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/conversation-store.test.ts -t "parent and root"`
Expected: FAIL — `create` rejects the extra properties or drops them, and `parent` is undefined.

- [ ] **Step 3: Implement**

In `metaSchema`, after `scope`:

```ts
  /** The session that spawned this one; absent ⇒ a root session a person started. */
  parent: z.string().optional(),
  /** The root of this session's family tree — itself, for a root. Stored rather than
   *  walked: a parent chain can cycle, and a stored root is constant-time and cannot. */
  root: z.string().optional(),
```

Widen `create`'s `init` parameter with the same two optional fields and write them through with the conditional-spread idiom the file already uses for optional meta fields.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/conversation-store.test.ts`
Expected: all pass, existing tests untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/conversation-store.ts packages/core/src/session/conversation-store.test.ts
git commit -m "feat: persist a session's parent and root links"
```

---

### Task 2: Lineage in memory, and the descendant walk

**Files:**
- Create: `packages/core/src/session/lineage.ts`, `packages/core/src/session/lineage.test.ts`
- Modify: `packages/core/src/session/live-session.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LiveSession#parent: string | undefined` and `LiveSession#root: string` (settable at construction, defaulting `root` to the session's own id); `descendantsOf(rootId: string, sessions: Iterable<{ id: string; root: string }>): string[]`. Task 3 consumes both.

`descendantsOf` selects by **stored root**, not by walking parents. That is what makes it cycle-proof and O(n) — the design is explicit that a parent-chain walk is how Traycer ended up rendering `[cycle]` instead of looping.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { descendantsOf } from './lineage.js';

describe('descendantsOf', () => {
  const sessions = [
    { id: 'root-1', root: 'root-1' },
    { id: 'kid-a', root: 'root-1' },
    { id: 'kid-b', root: 'root-1' },
    { id: 'grandkid', root: 'root-1' },
    { id: 'root-2', root: 'root-2' },
    { id: 'other-kid', root: 'root-2' },
  ];

  it('returns every session under a root except the root itself', () => {
    expect(descendantsOf('root-1', sessions).sort()).toEqual(['grandkid', 'kid-a', 'kid-b']);
  });

  it('does not cross into an unrelated tree', () => {
    expect(descendantsOf('root-2', sessions)).toEqual(['other-kid']);
  });

  it('returns nothing for a root with no children', () => {
    expect(descendantsOf('root-1', [{ id: 'root-1', root: 'root-1' }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/lineage.test.ts`
Expected: FAIL — cannot resolve `./lineage.js`.

- [ ] **Step 3: Implement**

```ts
/**
 * Family-tree queries over live sessions. Selection is by STORED root, never by
 * walking a parent chain: a chain can cycle (an orchestrator's descendant may
 * spawn back toward it, since the depth cap was deliberately dropped and the cost
 * cap is the only fan-out bound), and a stored root cannot.
 */
export function descendantsOf(
  rootId: string,
  sessions: Iterable<{ id: string; root: string }>,
): string[] {
  const out: string[] = [];
  for (const session of sessions) {
    if (session.root === rootId && session.id !== rootId) out.push(session.id);
  }
  return out;
}
```

In `live-session.ts`, extend the constructor and add the fields beside `worktree` / `state`:

```ts
  /** The session that spawned this one; absent ⇒ a root a person started. */
  readonly parent: string | undefined;
  /** This session's family-tree root — itself, for a root session. */
  readonly root: string;

  constructor(id: string, lineage?: { parent?: string; root?: string }) {
    this.id = id;
    this.parent = lineage?.parent;
    this.root = lineage?.root ?? id;
  }
```

Check every `new LiveSession(` call site compiles unchanged — the second argument is optional by design (D85).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/ && pnpm typecheck`
Expected: 3 new tests pass; existing session tests unchanged; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/lineage.ts packages/core/src/session/lineage.test.ts packages/core/src/session/live-session.ts
git commit -m "feat: carry lineage on a live session and query a tree by stored root"
```

---

### Task 3: Cascade a stop through the tree, with the cancel-guard

**Files:**
- Modify: `packages/core/src/session/live-registry.ts:83-99` (`close`) and `:57-64` (`getOrCreate`)
- Test: `packages/core/src/session/live-registry.test.ts`

**Interfaces:**
- Consumes: `descendantsOf` (Task 2), `DeliveryQueue#seal` (previous plan).
- Produces: `LiveSessionRegistry.getOrCreate(id, lineage?)`; `close(id)` cascades to descendants. Task 6 consumes the new `getOrCreate` signature.

**Two things that are easy to get backwards.**

Abort derives from the **session**, not the turn. With a non-blocking spawn the parent's turn ends while its child is still running, so anything turn-derived would kill every child the moment its parent stopped talking. Cascade belongs in `close`, which the file's own comment already calls the SINGLE teardown path.

The **cancel-guard** is why sealing matters here rather than later: a child's own completion notice fires as it is torn down, and without a sealed queue that notice would wake the parent a person just stopped — reviving the tree. Seal the whole subtree *before* closing any of it.

- [ ] **Step 1: Write the failing test**

```ts
it('cascades a close through the whole subtree and seals it first', () => {
  const closed: string[] = [];
  const registry = new LiveSessionRegistry({ onClose: (s) => closed.push(s.id) });
  registry.getOrCreate('root-1');
  registry.getOrCreate('kid-a', { parent: 'root-1', root: 'root-1' });
  registry.getOrCreate('kid-b', { parent: 'root-1', root: 'root-1' });
  registry.getOrCreate('root-2');
  const kidA = registry.get('kid-a');

  registry.close('root-1');

  expect(closed.sort()).toEqual(['kid-a', 'kid-b', 'root-1']);
  expect(registry.get('kid-a')).toBeUndefined();
  expect(registry.get('root-2')).toBeDefined();
  expect(kidA?.deliveries.isSealed()).toBe(true);
});

it('closing a child leaves its parent and siblings alone', () => {
  const registry = new LiveSessionRegistry();
  registry.getOrCreate('root-1');
  registry.getOrCreate('kid-a', { parent: 'root-1', root: 'root-1' });
  registry.getOrCreate('kid-b', { parent: 'root-1', root: 'root-1' });
  registry.close('kid-a');
  expect(registry.get('root-1')).toBeDefined();
  expect(registry.get('kid-b')).toBeDefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/live-registry.test.ts -t "cascades"`
Expected: FAIL — `getOrCreate` takes one argument, and only `root-1` closes.

- [ ] **Step 3: Implement**

Widen `getOrCreate` to forward lineage into the `LiveSession` constructor:

```ts
  getOrCreate(id: string, lineage?: { parent?: string; root?: string }): { session: LiveSession; created: boolean } {
    const existing = this.#entries.get(id);
    if (existing) return { session: existing.session, created: false };
    const session = new LiveSession(id, lineage);
```

In `close`, cascade first. Guard against re-entry so a descendant's own `close` cannot loop back:

```ts
  close(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    // Seal the WHOLE subtree before tearing any of it down: a child emits its
    // completion notice as it closes, and an unsealed parent queue would let that
    // notice wake a tree the user deliberately stopped.
    const kids = descendantsOf(id, [...this.#entries.values()].map((e) => e.session));
    for (const kid of kids) this.#entries.get(kid)?.session.deliveries.seal();
    entry.session.deliveries.seal();
    for (const kid of kids) this.#closeOne(kid);
    this.#closeOne(id);
  }
```

Move the existing body of `close` verbatim into a private `#closeOne(id: string): void` — the timer clear, the SC-1 `interrupted` marker, the abort, `onClose`, `session.close()`, and the map delete. Do not change its logic; the interrupt-before-abort ordering is load-bearing and is documented in place.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/live-registry.test.ts && pnpm typecheck`
Expected: all pass, including the pre-existing idle-eviction tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/live-registry.ts packages/core/src/session/live-registry.test.ts
git commit -m "feat: cascade a session stop through its tree behind a cancel-guard"
```

---

### Task 4: The notification envelope

**Files:**
- Create: `packages/core/src/session/notify.ts`, `packages/core/src/session/notify.test.ts`

**Interfaces:**
- Consumes: `Delivery` from `@coa/spi` (previous plan).
- Produces: `SessionEndReason = 'completed' | 'errored' | 'stopped'`; `ChildEndedNotice = { child: string; agentRef: string; reason: SessionEndReason; detail?: string }`; `renderChildEnded(notice: ChildEndedNotice): Delivery`. Task 6 consumes both.

**Only three reasons**, and all three are things the daemon directly observes. Do not add an advisory or inferred reason such as "quiet" — the design is explicit that a signal you cannot detect is not a signal to emit, and inventing availability is how a formatted read implies headroom nobody claimed.

The origin is `system` and is unforgeable by construction: there is no producer API reachable from a tool handler, so a model cannot author one of these about itself.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { renderChildEnded } from './notify.js';

describe('renderChildEnded', () => {
  it('always carries a system origin', () => {
    const d = renderChildEnded({ child: 'kid-a', agentRef: 'explorer', reason: 'completed' });
    expect(d.origin).toBe('system');
  });

  it('names the child, its agent, and the outcome', () => {
    const d = renderChildEnded({ child: 'kid-a', agentRef: 'explorer', reason: 'completed' });
    expect(d.text).toContain('kid-a');
    expect(d.text).toContain('explorer');
    expect(d.text).toContain('finished');
  });

  it('distinguishes the three reasons and carries a failure detail', () => {
    const errored = renderChildEnded({
      child: 'kid-b', agentRef: 'general-purpose', reason: 'errored', detail: 'rate limited',
    });
    const stopped = renderChildEnded({
      child: 'kid-c', agentRef: 'general-purpose', reason: 'stopped',
    });
    expect(errored.text).toContain('rate limited');
    expect(errored.text).not.toContain('finished');
    expect(stopped.text).toContain('stopped');
    expect(stopped.text).not.toEqual(errored.text);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/notify.test.ts`
Expected: FAIL — cannot resolve `./notify.js`.

- [ ] **Step 3: Implement**

```ts
import type { Delivery } from '@coa/spi';

/**
 * Why a child session ended. Exactly the three outcomes the daemon OBSERVES —
 * there is deliberately no inferred or advisory reason (no "went quiet"), because
 * a signal that cannot be detected must not be reported as one.
 */
export type SessionEndReason = 'completed' | 'errored' | 'stopped';

export interface ChildEndedNotice {
  child: string;
  agentRef: string;
  reason: SessionEndReason;
  /** Free text for an `errored` outcome (e.g. the provider's message). */
  detail?: string;
}

/**
 * Render a child's ending as a system-authored delivery. The origin is `system`
 * and is unforgeable: no producer is reachable from a tool handler, so a model
 * cannot fabricate a completion for itself. The text names the child's id
 * literally so the parent can copy it into a follow-up without transcribing an id
 * out of prose.
 */
export function renderChildEnded(notice: ChildEndedNotice): Delivery {
  const head = `subagent ${notice.agentRef} (${notice.child})`;
  const body =
    notice.reason === 'completed'
      ? `${head} finished. Read its transcript for the result.`
      : notice.reason === 'stopped'
        ? `${head} was stopped before it finished.`
        : `${head} failed: ${notice.detail ?? 'no detail reported'}.`;
  return { origin: 'system', text: body };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/notify.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/notify.ts packages/core/src/session/notify.test.ts
git commit -m "feat: render a child session's ending as a system notice"
```

---

### Task 5: The `spawn_agent` tool

**Files:**
- Create: `packages/core/src/workbench/spawn.ts`, `packages/core/src/workbench/spawn.test.ts`
- Modify: `packages/core/src/workbench/catalogue.ts:21-43` (`TOOL_CATALOGUE`)
- Modify: `packages/core/src/workbench/governed-tools.ts:40-58` (`GovernedToolDeps`) and `:88-112` (`SPECS`)

**Interfaces:**
- Consumes: `AgentSummary` from `@coa/shared`.
- Produces: `SpawnDeps = { listAgents: () => readonly AgentSummary[]; startChild: (req: { agentRef: string; description: string; prompt: string }) => { sessionId: string } }`; `spawnAgent(args, deps): ToolResponse<unknown>`; `GovernedToolDeps.spawn?: SpawnDeps`. Task 6 supplies the port.

**Read `packages/core/src/workbench/inspect.ts` first** for the house handler shape, and `packages/core/src/workbench/retrieve.ts` for how a handler returns an unapplied result. Match them.

**The tool is in the `kernel` partition.** It must be reachable without a discovery round-trip, and the agent-list Piece plus `find_agent` are a *later* plan — in this plan a model must be handed a ref or use a built-in (`general-purpose`, `explorer`). That is deliberate; do not add discovery here.

**Governance is already handled.** `spawn_agent` is an ordinary coa tool, so `PreToolUse` gates it exactly like every other call (ADR-0029, live-verified for `mcp__coa__` tools). Add no governance surface.

- [ ] **Step 1: Write the failing test**

Mixed fixture — three agents, and the one being spawned is deliberately not first.

```ts
import { describe, expect, it } from 'vitest';
import { spawnAgent } from './spawn.js';
import type { AgentSummary } from '@coa/shared';

const AGENTS: AgentSummary[] = [
  { ref: 'general-purpose', scope: 'builtin', name: 'General', description: 'anything', icon: 'bot', color: 'slate' },
  { ref: 'explorer', scope: 'builtin', name: 'Explorer', description: 'read-only search', icon: 'bot', color: 'slate' },
  { ref: 'reviewer', scope: 'project', name: 'Reviewer', description: 'reviews diffs', icon: 'bot', color: 'slate' },
];

describe('spawnAgent', () => {
  it('starts the named agent and returns its id without waiting', () => {
    const started: unknown[] = [];
    const res = spawnAgent(
      { agent: 'reviewer', description: 'review it', prompt: 'look at the diff' },
      {
        listAgents: () => AGENTS,
        startChild: (req) => {
          started.push(req);
          return { sessionId: 'kid-7' };
        },
      },
    );
    expect(started).toEqual([
      { agentRef: 'reviewer', description: 'review it', prompt: 'look at the diff' },
    ]);
    expect(JSON.stringify(res.result)).toContain('kid-7');
  });

  it('returns an unapplied result naming what exists for an unknown ref', () => {
    let calls = 0;
    const res = spawnAgent(
      { agent: 'nope', description: 'x', prompt: 'y' },
      { listAgents: () => AGENTS, startChild: () => { calls += 1; return { sessionId: 'no' }; } },
    );
    expect(calls).toBe(0);
    const body = JSON.stringify(res.result);
    expect(body).toContain('general-purpose');
    expect(body).toContain('explorer');
    expect(body).toContain('reviewer');
    expect(res.result).toMatchObject({ applied: false });
  });

  it('reads the registry on every call, never a cached list', () => {
    let listed = 0;
    const deps = {
      listAgents: () => { listed += 1; return AGENTS; },
      startChild: () => ({ sessionId: 'kid-1' }),
    };
    spawnAgent({ agent: 'explorer', description: 'a', prompt: 'b' }, deps);
    spawnAgent({ agent: 'explorer', description: 'a', prompt: 'b' }, deps);
    expect(listed).toBe(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/workbench/spawn.test.ts`
Expected: FAIL — cannot resolve `./spawn.js`.

- [ ] **Step 3: Implement the handler**

```ts
import type { AgentSummary } from '@coa/shared';
import type { CoaError, ToolResponse } from '@coa/shared';

/** The ports `spawn_agent` needs; the daemon supplies them (M6 declares, M8 injects). */
export interface SpawnDeps {
  /** The LIVE effective agent set. Called per dispatch — never a list cached at session start. */
  listAgents: () => readonly AgentSummary[];
  /** Start the child and return once it has STARTED, never once it has finished. */
  startChild: (req: {
    agentRef: string;
    description: string;
    prompt: string;
  }) => { sessionId: string };
}

/**
 * Dispatch a subagent by name. Resolution is against the LIVE registry on every
 * call: compiled prompts are frozen byte-stable for cache warmth, so any list baked
 * at session start is stale the moment an agent is authored.
 *
 * SC-1: an unknown ref is an unapplied result naming what does exist, never a throw
 * and never a denial — the model can correct itself and retry.
 */
export function spawnAgent(
  args: { agent: string; description: string; prompt: string },
  deps: SpawnDeps,
): ToolResponse<unknown> {
  const agents = deps.listAgents();
  const match = agents.find((a) => a.ref === args.agent);
  if (match === undefined) {
    const known = agents.map((a) => `${a.ref} — ${a.description}`).join('\n');
    const error: CoaError = {
      code: 'unknown-agent',
      message: `No agent '${args.agent}'. Available agents:\n${known}`,
    };
    return {
      result: { applied: false, error },
      handle: `spawn_agent:${args.agent}`,
      pointer: args.agent,
    };
  }
  const { sessionId } = deps.startChild({
    agentRef: match.ref,
    description: args.description,
    prompt: args.prompt,
  });
  return {
    result: { applied: true, agentRef: match.ref, sessionId },
    handle: `spawn_agent:${sessionId}`,
    pointer: sessionId,
  };
}
```

Confirm the `ToolResponse` / `CoaError` shapes against `packages/shared/src` before finalizing — match the unapplied-result shape `retrieve.ts` and `mutate.ts` already return rather than inventing a third.

- [ ] **Step 4: Register it**

In `catalogue.ts`, add to the **kernel** section of `TOOL_CATALOGUE`. The description is load-bearing — a Task-shaped tool carries a trained expectation that the call returns the subagent's report, and without an explicit correction the model will wait for a report that never comes:

```ts
  {
    name: 'spawn_agent',
    partition: 'kernel',
    description:
      'start a subagent by name; returns its id immediately — the subagent runs in the ' +
      'background and its result arrives separately, so do not wait for a report here',
  },
```

In `governed-tools.ts`, add to `GovernedToolDeps`:

```ts
  /** Subagent dispatch ports; absent ⇒ spawning is not wired for this session. */
  spawn?: SpawnDeps;
```

and to `SPECS`:

```ts
  spawn_agent: spec(
    { agent: z.string(), description: z.string(), prompt: z.string() },
    (a, d) =>
      d.spawn === undefined
        ? {
            result: {
              applied: false,
              error: { code: 'unavailable', message: 'subagent dispatch is not wired here' },
            },
            handle: 'spawn_agent:unavailable',
            pointer: a.agent,
          }
        : spawnAgent(a, d.spawn),
  ),
```

The absent-port branch keeps `buildGovernedTools` total — it throws when a catalogue entry has no spec, and SC-1 forbids failing a call with an exception.

- [ ] **Step 5: Run everything and commit**

Run: `pnpm vitest run packages/core/src/workbench/ && pnpm typecheck`
Expected: all pass; catalogue tests still green.

```bash
git add packages/core/src/workbench/spawn.ts packages/core/src/workbench/spawn.test.ts packages/core/src/workbench/catalogue.ts packages/core/src/workbench/governed-tools.ts
git commit -m "feat: add a non-blocking spawn tool resolved against the live agent registry"
```

---

### Task 6: Wire the daemon — start the child, notify the parent

This is the integration task and the one most likely to go wrong from a wrong assumption. **Read these three files end to end before editing:** `packages/core/src/session/session-handlers.ts`, `packages/core/src/session/session.ts`, and `apps/cli/src/cli.ts`. The previous stage's plan named a file needing no change and missed six that did, precisely because its steps were written against unread code.

**Files:**
- Modify: `packages/core/src/session/session-handlers.ts` — the `createSession` verb (~line 1063), the per-turn request build (~line 556), and the settlement path where a turn loop ends
- Modify: `apps/cli/src/cli.ts` — supply `spawn` into `buildGovernedTools`

**Interfaces:**
- Consumes: Tasks 1–5, plus `LiveSession#deliveries` from the previous plan.
- Produces: a `startChild` implementation; a completion notice pushed to the parent.

- [ ] **Step 1: Write the failing integration test**

Drive through `dispatch()`, never a handler directly — `rpcMethod` is a pure type cast and a direct call bypasses all Zod validation.

```ts
it('starts a child with lineage and notifies the parent when it ends', async () => {
  const { dispatch, registry, store } = buildTestServer();
  await dispatch({
    jsonrpc: '2.0', id: 1, method: 'createSession',
    params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
  });
  const parent = registry.get('root-1');
  expect(parent).toBeDefined();

  const child = startChildForTest('root-1', 'explorer');   // the helper you add in Step 3
  expect(store.getMeta(child.sessionId)?.parent).toBe('root-1');
  expect(store.getMeta(child.sessionId)?.root).toBe('root-1');
  expect(registry.get(child.sessionId)?.root).toBe('root-1');

  await endChildForTest(child.sessionId, 'completed');
  const pending = parent!.deliveries.drain();
  expect(pending).toHaveLength(1);
  expect(pending[0]?.origin).toBe('system');
  expect(pending[0]?.text).toContain(child.sessionId);
});

it('drops the notice when the parent was already stopped', async () => {
  const { dispatch, registry } = buildTestServer();
  await dispatch({
    jsonrpc: '2.0', id: 1, method: 'createSession',
    params: { conversationId: 'root-1', input: 'hello', role: 'general-purpose', scope: 'repo' },
  });
  const child = startChildForTest('root-1', 'explorer');
  registry.close('root-1');              // cascades and seals
  await endChildForTest(child.sessionId, 'completed');
  // Nothing to assert on the parent's queue — it is gone. The point is that this
  // does not throw and does not resurrect the session.
  expect(registry.get('root-1')).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/session-handlers.test.ts -t "starts a child"`
Expected: FAIL — no `startChildForTest`, no lineage on the created meta.

- [ ] **Step 3: Implement**

Build `startChild` inside the handler factory, where `registry` and `store` are already in scope:

- Generate the child's conversation id with the same `newSessionId` the `createSession` verb uses.
- Resolve `root`: `registry.get(parentId)?.root ?? parentId`. A child of a child therefore inherits the same root — there is **no depth limit**, by design.
- `store.create({ id, agentRef, title, scope, parent: parentId, root })` — derive `title` from the spawn's `description`, and `scope` from the parent's meta.
- `registry.getOrCreate(id, { parent: parentId, root })`.
- Look the agent up via `AgentRegistry.list()` and carry its `provider` / `model` / `reasoning` / `roles` / `packageIds` / `exclude` into the child's turn request. **Do not** let the spawn call carry a model — the design routes model choice through the agent definition, which is the whole reason dispatch goes via the registry.
- Enqueue the prompt as the child's first turn and start `runLiveSession` for it exactly as the `createSession` verb does. **Return as soon as it has started** — do not await the loop's completion. This is the non-blocking contract; awaiting here reintroduces the re-entrancy risk the design retired.

Where a session's turn loop ends, emit the notice:

```ts
// A child's ending is a system fact, not a message from the child: the child never
// composes it, and a model must not be able to fabricate one about itself.
const meta = store?.getMeta(endedId);
if (meta?.parent !== undefined) {
  const parentSession = registry.get(meta.parent);
  // A sealed queue silently drops this — that is the cancel-guard doing its job
  // after a cascade stop, not an error to handle.
  parentSession?.deliveries.push(
    renderChildEnded({ child: endedId, agentRef: meta.agentRef, reason }),
  );
}
```

Map `reason` from what the loop already knows: a clean end is `completed`, a caught loop failure is `errored` (pass its message as `detail`), and `control.interrupted` or a cascade is `stopped`.

In `apps/cli/src/cli.ts`, pass `spawn: { listAgents: () => agentRegistry.list().agents, startChild }` into the `buildGovernedTools(...)` call. Note `list()` returns `{ agents, diagnostics }` — take `.agents`, and call it per dispatch so the read stays live.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/core/src/session/ && pnpm typecheck && pnpm test`
Expected: new tests pass; failures still exactly the 10 known ones.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session-handlers.ts apps/cli/src/cli.ts packages/core/src/session/session-handlers.test.ts
git commit -m "feat: start a subagent as a linked child session and notify its parent"
```

---

### Task 7: Attribute cost to the root

**Files:**
- Modify: `packages/core/src/governance/ledger.ts:15-31` (`LedgerRecord`) and `:34-53` (`redactLedgerEvent`)
- Modify: `packages/core/src/session/session.ts` (the `recordSpend` call, ~line 277)
- Test: `packages/core/src/governance/ledger.test.ts`

**Interfaces:**
- Consumes: lineage from Task 1.
- Produces: `LedgerRecord.root?: string`.

**The cost cap is NOT touched.** The daemon wallet already binds a whole tree — one global total, and its read ignores the session id it is handed — so fan-out cannot escape it and no third blocking surface is added. This task is purely about the *record* answering "what did that run cost" rather than only "what did that account spend."

The ledger's allow-list is strict by design and drops anything unlisted, so `root` must be added explicitly or it will be silently discarded. A session id is not a path and carries no prose, so it belongs on the list.

- [ ] **Step 1: Write the failing test**

```ts
it('keeps a root id and still drops unlisted fields', () => {
  const out = redactLedgerEvent({
    costUsd: 0.25, account: 'work', root: 'root-1', secretNote: 'never persist me',
  });
  expect(out).toEqual({ costUsd: 0.25, account: 'work', root: 'root-1' });
});

it('attributes two sibling sessions to one root', () => {
  const ledger = new Ledger();
  ledger.record({ costUsd: 0.1, root: 'root-1' });
  ledger.record({ costUsd: 0.2, root: 'root-1' });
  ledger.record({ costUsd: 0.4, root: 'root-2' });
  const forRoot1 = ledger.entries().filter((e) => e.root === 'root-1');
  expect(forRoot1.reduce((sum, e) => sum + (e.costUsd ?? 0), 0)).toBeCloseTo(0.3);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/governance/ledger.test.ts -t "root"`
Expected: FAIL — `root` is dropped by the allow-list.

- [ ] **Step 3: Implement**

Add to `LedgerRecord`:

```ts
  /** The family-tree root this spend belongs to — what makes a whole run's cost
   *  answerable, not just an account's. A session id: no path, no prose. */
  root?: string;
```

Extend the `copyPathSafeString` key union to include `'root'` and add the call in `redactLedgerEvent` beside `account`.

In `session.ts`, include the root in the `recordSpend` payload alongside `account`, using the same conditional-spread idiom. The root reaches `createSession` the same way lineage does in Task 6.

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm vitest run packages/core/src/governance/ && pnpm typecheck`

```bash
git add packages/core/src/governance/ledger.ts packages/core/src/governance/ledger.test.ts packages/core/src/session/session.ts
git commit -m "feat: attribute recorded spend to a session tree's root"
```

---

### Task 8: Join parent and child in the transcript projection

**Files:**
- Modify: `packages/core/src/session/transcript-projection.ts`
- Test: `packages/core/src/session/transcript-projection.test.ts`

**Interfaces:**
- Consumes: Task 1's lineage.
- Produces: a read-time join over a root and its descendants.

**Read `transcript-projection.ts` in full first**, plus `docs/adr/0010-append-only-conversation-log.md`. The join is **read-time only** — it adds **no second writer**. Each session keeps its own append-only log; the projection reads several and presents them together. Do not write a merged log.

The existing `foldEventsToTranscript` must keep working unchanged for a single session (D85). Add a sibling entry point rather than changing its signature.

- [ ] **Step 1: Write the failing test**

Use a mixed fixture: a root with two children, so an implementation that returns the first child's events cannot pass.

Assert that (a) a root with no children projects **byte-identically** to `foldEventsToTranscript` on its own events, and (b) with children, every session's events appear and each is attributable to the session it came from.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/core/src/session/transcript-projection.test.ts -t "join"`

- [ ] **Step 3: Implement**

Add a function taking the root's events plus a map of descendant id to events, returning the joined projection. Order children's contributions deterministically — by the `seq` the events already carry, falling back to session id for a stable tie-break, so two runs of the same data project identically.

- [ ] **Step 4: Run the tests and commit**

Run: `pnpm vitest run packages/core/src/session/ && pnpm typecheck`

```bash
git add packages/core/src/session/transcript-projection.ts packages/core/src/session/transcript-projection.test.ts
git commit -m "feat: project a session tree's transcript as one read"
```

---

### Task 9: Show it in the console

**Files:**
- Modify: `packages/console-viewmodel/src/reads.ts` — the session-summary edge schema gains `parent` / `root`
- Modify: the session rail and the right dock in `apps/desktop/src/renderer/` — **find them first** with `grep -rn "SessionSummary" apps/desktop/src packages/console-*/src`

**Interfaces:**
- Consumes: Tasks 1 and 7.
- Produces: nested rendering and a cost roll-up.

**Read before editing:** `docs/UI.md` (the design system and authoring rules) and `packages/console-kit/COMPONENTS.md`. **`COMPONENTS.md` is GENERATED** from the `*.intent.ts` files — if a component needs a doc change, edit the intent and run `pnpm --filter @coa/console-kit gen`, never the markdown.

**Default-nest, not default-leak.** A child renders **under its parent**, never as an un-parented top-level row. An unclassified or newly-added child must nest by construction rather than surfacing loose — total classification, so a new child kind cannot silently appear at top level.

**Replace the "not tracked yet" floor** with the real roll-up: a root's cost is the sum over its tree, which Task 7's `root` key makes answerable.

- [ ] **Step 1: Write the failing test**

Use a **mixed fixture** — a root with two children plus a second unrelated root. A single-item fixture is exactly what hid a Critical through eight reviews on the previous stage: with one agent it trivially became `[0]` and the grouping bug could not manifest.

Assert that both children nest under the correct root, that the unrelated root is not absorbed, and that the roll-up sums the tree rather than showing the root's own spend.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run packages/console-viewmodel/ apps/desktop/`
Expected: FAIL — children render as top-level rows.

- [ ] **Step 3: Implement**

Extend the edge schema with optional `parent` / `root`, group by `root` in the view model, and render children indented under their parent. Keep the grouping logic in `console-viewmodel` where it is testable without jsdom, and let the panel render what it is handed.

- [ ] **Step 4: Verify in the real app**

Run the daemon and the app, spawn a subagent from a live session, and confirm the child appears nested and the roll-up moves. **Restart the daemon first** — one started before your change has none of these verbs, and a stale daemon looks exactly like a bug in your code.

- [ ] **Step 5: Commit**

```bash
git add packages/console-viewmodel/src/reads.ts <the panel files you changed>
git commit -m "feat: nest subagent sessions under their parent with a tree cost roll-up"
```

---

### Task 10: Prove it end to end and record the decisions

**Files:**
- Create: a `COA_LIVE`-gated smoke under `packages/adapter-claude-sdk/src/`
- Create: three ADRs in `docs/adr/`
- Modify: `ROADMAP.md`, and the SPEC under `docs/design/handoff/`

- [ ] **Step 1: The live smoke**

A Claude orchestrator spawns a child on another provider. Assert: both appear in one projected transcript, cost from both lands under one root, and a root interrupt cancels the child. Model it on `packages/adapter-claude-sdk/src/governed-gate.live.test.ts`.

Run: `COA_LIVE=1 pnpm vitest run <your new file>`

- [ ] **Step 2: Drive the app**

Spawn two subagents from one console session. Confirm both nest, the roll-up sums, stopping the root stops both, and a completed child's notice reaches the parent. Restart the daemon first.

- [ ] **Step 3: Write the ADRs**

Check `ls docs/adr/` for the next free number. Follow the house format exactly: status, date, context and problem, decision drivers, considered options, decision, consequences (good/bad), last-reviewed footer.

1. **The cost cap replaces the depth cap as the sole fan-out bound.** Record that the daemon wallet already binds a tree, so nothing new blocks and SC-1 keeps exactly two blocks; that the root id is a *record* key, not a second ceiling; and why a depth counter cannot bound failure modes nobody predicted.
2. **Notifications are a channel distinct from inter-agent messages.** Record the forgeability argument (an agent-shaped sender makes every system notice forgeable) and the category argument (a lifecycle fact is system-authored, structured, and unrepliable).
3. **A subagent is a coa session with a parent link.** Record that lineage is stored rather than walked, that abort derives from the session and not the turn, and why the cancel-guard exists.

- [ ] **Step 4: Update SPEC and ROADMAP**

Both this plan and the previous one add daemon surface the SPEC does not describe — child sessions, the notification channel, and the delivery queue. The same-commit doc rule applies. Add ROADMAP rows recording what landed and that discovery (the agent-list Piece and `find_agent`) is the next plan.

- [ ] **Step 5: Full verification and commit**

Run: `pnpm typecheck && pnpm test && pnpm lint && pnpm docs:check`
Expected: typecheck clean; exactly 10 known test failures; 9 lint errors; `docs:check` failing only on `TEMP.md`.

```bash
git add docs/adr/ ROADMAP.md docs/design/handoff/ <your smoke file>
git commit -m "docs: record how a subagent session is bounded, linked, and reported"
```

---

## What this plan does NOT build

Stated so a reviewer does not read an omission as a gap.

- **Discovery** — the derived agent-list Piece and `find_agent`. Its own plan. In this plan a model must be handed a ref or use a built-in.
- **Agent-to-agent messaging** — `send_message`, threads, an inbox, a durable message log, and the advisory liveness reasons. A later stage; it becomes another producer on the delivery queue.
- **`author_agent`** — gated on an approval channel that does not exist. M0 schematises approvals, but nothing emits them, there is no response verb, and the console's `respondApproval` only mutates renderer-local state.
- **A depth limit.** Deliberately dropped. A child may spawn; the cost cap is the only fan-out bound.
- **Worktrees for children.** A child shares its root's tree, so two agents can write the same tree. Accepted and named: v1 is attended, and every write still passes the `PreToolUse` gate. The worktree manager arrives with a real need.
- **Changes to the agent schema.** `AgentSummary` already carries everything a spawn reads.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCall, TurnFrame } from '@coa/shared';
import type { RuntimeUsage } from '@coa/spi';
import { ClaudeSdkAdapter } from '@coa/adapter-claude-sdk';
import { OpenAiCompatAdapter, deepseekSpec } from '@coa/adapter-openai-compat';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
// The shared live-smoke scaffolding lives with the adapter's own smokes. A test-only
// reach into that source file: tests sit outside every tsconfig program and outside
// the dependency-cruiser graph, so this never becomes a package-level edge.
import {
  barebonesSandbox,
  collectText,
  createPushQueue,
  delay,
  isPending,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
  waitForCondition,
} from '../../../packages/adapter-claude-sdk/src/live-smoke-helpers.js';

/**
 * The live gate for the subagent-orchestration arc. SDK 0.3.196 / CLI 2.1.196.
 *
 *   COA_LIVE=1 pnpm vitest run apps/cli/src/subagent-orchestration.live.test.ts
 *
 * A Claude orchestrator spawns a child running on DeepSeek (a different provider — the
 * arc's cross-backend claim, not just "another Claude session") and the test asserts the
 * three things the arc actually promises: both sessions' frames can be attributed to one
 * projected transcript, both sessions' settled cost can be attributed to one root, and
 * aborting the root's session terminates the child rather than leaving it running headless
 * forever.
 *
 * It lives in `apps/cli` because the CLI is the one place that legitimately owns BOTH
 * adapters (`@coa/adapter-claude-sdk` and `@coa/adapter-openai-compat` are real
 * dependencies here); in its original home, `packages/adapter-claude-sdk`, this file was
 * the sole reason for a cross-adapter devDependency.
 *
 * SCOPE, READ BEFORE TRUSTING THIS FILE'S ASSERTIONS AS PROOF OF THE SHIPPED FEATURE:
 * An adapter-level test must not depend upward on the daemon core (`@coa/core` depends
 * on the adapters, so the reverse edge would be circular — `live-smoke-helpers.ts`'s own
 * `resolveLiveLocator` doc comment states the same rule for account resolution), and this
 * test kept that shape when it moved. That means the REAL production code this arc
 * shipped — `packages/core/src/workbench/spawn.ts` (`spawn_agent`'s dispatch),
 * `packages/core/src/session/session-handlers.ts` (`startChild`/`notifyParentIfChild`),
 * `packages/core/src/session/live-registry.ts` (the parent-link cascade), and
 * `packages/core/src/governance/ledger.ts` (the `root`-keyed spend record) — is NOT
 * reachable from this file and is NOT what this test exercises. What follows is a
 * hand-built, adapter-level stand-in that exercises the underlying `RuntimeAdapter`
 * primitives those modules are built on: a `RegisteredTool`-shaped `spawn_agent` that
 * starts a second adapter without awaiting it (the non-blocking contract), each adapter's
 * `onSettle`/`onTurn` callbacks (the exact seam the backend adapter hands the session core in production), and each
 * adapter's `signal` (the exact seam a session-level interrupt rides in production). A
 * green run here is evidence the primitives behave as the core layer assumes; it is not a
 * live run of `spawn.ts`/`session-handlers.ts` themselves — that can only be proven by
 * driving the real daemon (which the maintainer did once, by hand; see
 * `.superpowers/sdd/2026-08-05-subagent-orchestration/progress.md`, "LIVE END-TO-END PASS").
 *
 * The cost assertion is deliberately narrow for a recorded reason — fan-out is deliberately unbounded, and spend is accounted rather than capped — and nothing
 * in this arc wires a producer that surfaces the tree cost roll-up over RPC — the ledger's
 * `root` field is real and unit-tested (`packages/core/src/governance/ledger.ts`) but
 * in-process only. This test can only show that `RuntimeUsage.costUsd` is a real, summable
 * number from BOTH backends and that nothing prevents attributing both to one root id — the
 * same arithmetic the ledger's `root` key performs — not that a client can ever read that
 * sum today. See ROADMAP.md.
 *
 * WHERE A REAL SMOKE BELONGS: `packages/core` already depends on both `@coa/adapter-claude-sdk`
 * and `@coa/adapter-openai-compat` (real dependencies, not dev — `packages/core/package.json`), and
 * `dependency-cruiser` excludes every `*.test.ts` from its graph regardless of which package it
 * sits in. A `*.live.test.ts` file placed anywhere under `packages/core/src` (the
 * `browser-launcher.live.test.ts` convention already in that directory) could inject real
 * adapter instances into `spawn.ts`'s `SpawnDeps` port and drive the actual
 * `spawn.ts`/`session-handlers.ts`/`live-registry.ts` — no circularity, unlike an
 * adapter-level test. See ROADMAP.md item M.
 *
 * Root/child share one worktree on purpose (not two `mkdtempSync` calls): the subagent design records * that a child shares its root's worktree rather than getting its own (the worktree manager
 * is unbuilt, and v1 is attended so every write still passes the `PreToolUse` gate).
 */
vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const live = process.env['COA_LIVE'] === '1';

describe.skipIf(!live)('subagent orchestration, live (cross-provider)', () => {
  it('a Claude orchestrator spawns a DeepSeek child: both land in one projected transcript, and both costs attribute to one root', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-subagent-'));
    const rootId = 'root';

    // The "one projected transcript" stand-in: every frame from either session, tagged
    // with its own sessionId — the shape `foldTreeToTranscript` (core-only, see the file
    // header) merges for real, reproduced here only enough to prove nothing about running
    // two backends concurrently prevents that merge.
    const allFrames: Array<{ sessionId: string; frame: TurnFrame }> = [];
    const costBySession = new Map<string, number>();
    const childLoopPromises: Promise<void>[] = [];
    let childId: string | undefined;
    let childStarted = false;

    const spawnTool = {
      name: 'spawn_agent',
      description:
        'Spawn a subagent to do a scoped task on a separate backend. Returns immediately ' +
        'with the child session id — it does NOT wait for the child to finish.',
      partition: 'kernel' as const,
      inputSchema: { task: z.string() },
      invoke: (args: unknown) => {
        const { task } = args as { task: string };
        const id = 'child-1';
        childId = id;
        childStarted = true;

        // Fire-and-forget: the non-blocking contract `spawn.ts`'s own header documents
        // ("Start the child and return once it has STARTED, never once it has finished").
        const child = new OpenAiCompatAdapter(deepseekSpec, {
          sessionId: id,
          input: task,
          onTurn: (frame) => allFrames.push({ sessionId: id, frame }),
          onSettle: (sessionId, usage: RuntimeUsage) => costBySession.set(sessionId, usage.costUsd),
        });
        child.renderNative(minimalNeutralConfig());
        child.registerTools([]);
        child.interceptTool(() => ({ behavior: 'allow' }));
        child.interceptStop(neverStop);
        childLoopPromises.push(
          child.runLoop({
            role: 'child',
            scope: '.',
            worktree,
            capabilityFrame: { allow: [], deny: [] },
          }),
        );

        return {
          result: { applied: true, agentRef: 'deepseek-child', sessionId: id },
          handle: `spawn_agent:${id}`,
          pointer: id,
        };
      },
    };

    const seenTools: string[] = [];
    const orchestrator = new ClaudeSdkAdapter({
      sessionId: rootId,
      sandbox: barebonesSandbox(),
      input:
        'Call the spawn_agent tool exactly once with task set to: ' +
        '"Reply with the single word ACKNOWLEDGED and nothing else." ' +
        'Then, without waiting, reply with the single word DONE.',
      locator: resolveLiveLocator(),
      // The live-suite money guard: the SDK's own budget stop, passed raw (not a coa governance surface).
      sdkOptions: { maxBudgetUsd: 0.25 },
      onTurn: (frame) => allFrames.push({ sessionId: rootId, frame }),
      onSettle: (sessionId, usage: RuntimeUsage) => costBySession.set(sessionId, usage.costUsd),
    });
    orchestrator.renderNative(minimalNeutralConfig());
    orchestrator.registerTools([spawnTool]);
    orchestrator.interceptTool((call: ToolCall) => {
      seenTools.push(call.tool);
      return { behavior: 'allow' };
    });
    orchestrator.interceptStop(neverStop);

    await orchestrator.runLoop({
      role: 'orchestrator',
      scope: '.',
      worktree,
      capabilityFrame: { allow: [], deny: [] },
    });

    const rootText = collectText(
      allFrames.filter((e) => e.sessionId === rootId).map((e) => e.frame),
    );
    const diagnostic = () =>
      `seenTools=${JSON.stringify(seenTools)}; childStarted=${childStarted}; ` +
      `rootText=${JSON.stringify(rootText)}; costBySession=${JSON.stringify([...costBySession])}`;

    // An unattempted spawn proves nothing about the rest of this test — fail loudly
    // rather than let a model that never called the tool read as a pass.
    if (!childStarted) {
      throw new Error(
        `SPAWN NEVER ATTEMPTED — the model never called spawn_agent. ${diagnostic()}`,
      );
    }
    expect(
      seenTools.some((t) => t.includes('spawn_agent')),
      diagnostic(),
    ).toBe(true);
    // The non-blocking contract: the orchestrator's OWN turn settles without waiting for
    // the child (spawn_agent's handler above never awaits `child.runLoop`).
    expect(rootText.toUpperCase(), diagnostic()).toContain('DONE');

    // Now let the child actually finish, so its settled cost is available to check.
    await Promise.all(childLoopPromises);
    expect(childId, diagnostic()).toBeDefined();
    const id = childId as string;

    // --- "one projected transcript" ---------------------------------------------------
    expect(
      allFrames.some((e) => e.sessionId === rootId),
      diagnostic(),
    ).toBe(true);
    expect(
      allFrames.some((e) => e.sessionId === id),
      diagnostic(),
    ).toBe(true);

    // --- "cost from both lands under one root" (see the file header's scope note) -----
    // This is as far as this level can honestly check. Both numbers are real, non-zero,
    // settled cost from two DIFFERENT backends, each attributable to a known session id
    // (`rootId`/`id`) — the same two facts `ledger.ts`'s `root`-keyed sum would consume in
    // production. Summing them here and comparing the sum to itself would not be a check
    // (it cannot fail for any value of either number), so this test stops at the two
    // numbers existing and being real; it does NOT assert that anything actually performs
    // the sum. Whether the sum is ever computed and surfaced is exactly the gap named in
    // the header above — there is no producer to exercise.
    const rootCost = costBySession.get(rootId);
    const childCost = costBySession.get(id);
    expect(rootCost, diagnostic()).toBeGreaterThan(0);
    expect(childCost, diagnostic()).toBeGreaterThan(0);
  });

  it('aborting the root session cascades to the child: neither loop is left running headless', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'coa-subagent-abort-'));
    const rootId = 'root-abort';
    const rootController = new AbortController();
    // A two-node stand-in for `lineage.ts`'s `descendantsOf` parent-link walk: with one
    // child there is nothing to walk, so the cascade is wired as a direct listener rather
    // than reproducing the general algorithm (already covered by
    // `packages/core/src/session/lineage.test.ts`). Registered the moment the child is
    // created, mirroring that a real cascade seals every live descendant it finds, not
    // just ones that existed when the parent started.
    let childController: AbortController | undefined;
    rootController.signal.addEventListener('abort', () => childController?.abort(), { once: true });

    let childLoopPromise: Promise<void> | undefined;
    const childFrames: TurnFrame[] = [];

    const spawnTool = {
      name: 'spawn_agent',
      description:
        'Spawn a subagent to do a scoped task on a separate backend. Returns immediately ' +
        'with the child session id — it does NOT wait for the child to finish.',
      partition: 'kernel' as const,
      inputSchema: { task: z.string() },
      invoke: (args: unknown) => {
        const { task } = args as { task: string };
        const id = 'child-abort-1';
        childController = new AbortController();
        // Already-aborted root ⇒ the child must never even get a chance to run — the same
        // orphan-avoidance direction `live-registry.ts`'s cascade guarantees.
        if (rootController.signal.aborted) childController.abort();

        const child = new OpenAiCompatAdapter(deepseekSpec, {
          sessionId: id,
          input: task,
          signal: childController.signal,
          onTurn: (frame) => childFrames.push(frame),
        });
        child.renderNative(minimalNeutralConfig());
        child.registerTools([]);
        child.interceptTool(() => ({ behavior: 'allow' }));
        child.interceptStop(neverStop);
        childLoopPromise = child
          .runLoop({
            role: 'child',
            scope: '.',
            worktree,
            capabilityFrame: { allow: [], deny: [] },
          })
          .catch(() => undefined); // aborting is expected to reject; this test asserts TERMINATION, not the shape of the rejection

        return {
          result: { applied: true, agentRef: 'deepseek-child', sessionId: id },
          handle: `spawn_agent:${id}`,
          pointer: id,
        };
      },
    };

    const queue = createPushQueue();
    const orchestrator = new ClaudeSdkAdapter({
      sessionId: rootId,
      sandbox: barebonesSandbox(),
      input: queue,
      locator: resolveLiveLocator(),
      // The live-suite money guard: the SDK's own budget stop, passed raw (not a coa governance surface).
      sdkOptions: { maxBudgetUsd: 0.25 },
      signal: rootController.signal,
    });
    orchestrator.renderNative(minimalNeutralConfig());
    orchestrator.registerTools([spawnTool]);
    orchestrator.interceptTool(() => ({ behavior: 'allow' }));
    orchestrator.interceptStop(neverStop);

    const runLoopPromise = orchestrator
      .runLoop({
        role: 'orchestrator',
        scope: '.',
        worktree,
        capabilityFrame: { allow: [], deny: [] },
      })
      .catch(() => undefined); // same reasoning as the child: this test asserts TERMINATION

    queue.push(
      'Call the spawn_agent tool exactly once with task set to: ' +
        '"Count slowly from one to fifty, writing one full sentence about each number." ' +
        'Do not reply with anything else yet.',
    );

    await waitForCondition(
      () => childController !== undefined,
      30_000,
      'the orchestrator never called spawn_agent, so there is no child to cascade-abort',
    );
    // Give the child a moment to genuinely start streaming before we cut it off — an
    // abort issued before the child ever began proves nothing about cascading a STOP.
    await waitForCondition(
      () => childFrames.length > 0,
      30_000,
      'the child never emitted a single frame before the abort — nothing to prove was cut off',
    );

    // The session-level interrupt (abort derives from the SESSION, not the
    // in-flight turn — this is the same `signal` a real `interruptSession` call aborts).
    rootController.abort();
    queue.close();

    // Neither the root's own query nor the child's must be left hanging. A held-open
    // query is designed to run headless with zero subscribers — an abort must be
    // the one thing that reliably ends that, or a stopped tree leaks a live backend
    // connection forever. `waitForCondition`'s predicate is synchronous, so this polls by
    // hand rather than misusing it with an async predicate (`isPending` itself awaits a
    // grace window internally).
    const deadline = Date.now() + 30_000;
    let rootSettled = false;
    let childSettled = false;
    while (Date.now() < deadline && !(rootSettled && childSettled)) {
      rootSettled = !(await isPending(runLoopPromise, 100));
      childSettled = !(await isPending(childLoopPromise!, 100));
      if (!(rootSettled && childSettled)) await delay(250);
    }
    expect(rootSettled, 'the root query was still pending 30s after it was aborted').toBe(true);
    expect(childSettled, 'the child query was still pending 30s after the root was aborted').toBe(
      true,
    );
  });
});

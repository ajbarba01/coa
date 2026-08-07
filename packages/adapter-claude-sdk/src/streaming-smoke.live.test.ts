import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, TurnFrame } from '@coa/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import {
  allowAllTools,
  barebonesSandbox,
  boundaryCount,
  collectText,
  createPushQueue,
  delay,
  isPending,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
  waitForCondition,
  withTimeoutMessage,
} from './live-smoke-helpers.js';

/**
 * The streaming-input de-risk gate: a real `@anthropic-ai/claude-agent-sdk` `query()`
 * in streaming-input mode, driven directly through {@link ClaudeSdkAdapter}, proving
 * the assumption Tasks 1-3 built on top of but could only fake-test — that ONE
 * held-open query fed a coa-owned input iterable (a) stays alive
 * across turns instead of tearing down after the first, (b) shares memory across
 * those turns on the SAME server session, (c) lets a message pushed mid-turn reach
 * the running turn (steering), (d) aborts promptly on interrupt, and (e) terminates
 * cleanly (no hang, no leak) once the input iterable closes.
 *
 * Gated exactly like `packages/core/src/workbench/web/web-tools.smoke.test.ts`:
 * `COA_LIVE` unset ⇒ the whole describe is skipped, so the default
 * `pnpm vitest run packages/adapter-claude-sdk` stays green with no account and CI
 * never runs it. Spends real subscription tokens — keep every live prompt tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])(
  'ClaudeSdkAdapter — live streaming-input smoke (real backend)',
  () => {
    let locator: Locator;

    beforeAll(() => {
      locator = resolveLiveLocator();
    });

    it('holds one query open across turns, shares memory, queues a follow-up pushed mid-turn, and terminates cleanly on close', async () => {
      const frames: TurnFrame[] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-smoke-'));

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-turns',
        sandbox: barebonesSandbox(),
        input: queue,
        locator,
        onTurn: (frame) => frames.push(frame),
      });
      adapter.renderNative(minimalNeutralConfig());
      adapter.interceptTool(allowAllTools);
      adapter.interceptStop(neverStop);

      const runLoopPromise = adapter.runLoop({
        role: 'r',
        scope: 'sc',
        worktree,
        capabilityFrame: { allow: [], deny: [] },
      });

      // --- Turn 1: termination shape -----------------------------------------
      queue.push('Reply with exactly one word: PONG. No punctuation, no other words.');
      await waitForCondition(
        () => boundaryCount(frames) >= 1,
        60_000,
        'turn 1 never produced a turn-boundary frame — the real query never streamed a result',
      );
      // The query must still be OPEN after a result — a fresh query per turn (the
      // Task-3 seam this gate exists to catch) would have already torn down here.
      expect(await isPending(runLoopPromise)).toBe(true);
      expect(collectText(frames)).toMatch(/pong/i);

      // --- Turn 2: same query, memory intact ----------------------------------
      const beforeTurn2 = frames.length;
      queue.push('What single word did I just ask you to reply with? Answer with just that word.');
      await waitForCondition(
        () => boundaryCount(frames.slice(beforeTurn2)) >= 1,
        60_000,
        'turn 2 never produced a turn-boundary frame on the same open query',
      );
      expect(await isPending(runLoopPromise)).toBe(true);
      expect(collectText(frames.slice(beforeTurn2))).toMatch(/pong/i);

      // --- Turn 3: a message pushed WHILE a turn is running is QUEUED and runs
      // as the NEXT turn on the same held-open query — it is NOT injected into the
      // running turn. The Claude Agent SDK has no mid-turn inject primitive (a
      // pushed SDKUserMessage waits for the current turn's boundary, then runs —
      // verified live). This measured ceiling still stands.
      // Barge-in (interrupt()+push, a separate mid-turn-redirect capability) was
      // removed (a steer is recorded when the model receives it); mid-turn text now
      // travels only as a delivery,
      // drained at each backend's own next legal boundary, never injected here. ------
      const beforeTurn3 = frames.length;
      queue.push('Reply with exactly one word: ALPHA. Nothing else.');
      // Push a second message immediately, before turn 3 can finish — it must queue
      // behind ALPHA and run as its OWN subsequent turn, not merge into the running one.
      queue.push('Reply with exactly one word: OMEGA. Nothing else.');
      await waitForCondition(
        () => boundaryCount(frames.slice(beforeTurn3)) >= 2,
        60_000,
        'the two queued messages did not both run as separate turns on the one held-open query',
      );
      expect(await isPending(runLoopPromise)).toBe(true);
      const turn3Text = collectText(frames.slice(beforeTurn3));
      expect(turn3Text).toMatch(/alpha/i);
      expect(turn3Text).toMatch(/omega/i);
      // FIFO order preserved: the queued OMEGA turn runs strictly after ALPHA's.
      const alphaAt = frames.findIndex(
        (f, i) => i >= beforeTurn3 && f.t === 'text' && /alpha/i.test(f.text),
      );
      const omegaAt = frames.findIndex(
        (f, i) => i >= beforeTurn3 && f.t === 'text' && /omega/i.test(f.text),
      );
      expect(alphaAt).toBeGreaterThanOrEqual(0);
      expect(omegaAt).toBeGreaterThan(alphaAt);

      // --- Clean close: the query must terminate, not hang -------------------
      queue.close();
      await withTimeoutMessage(
        runLoopPromise,
        20_000,
        'runLoop did not resolve within 20s of queue.close() — the query may not be terminating on input-iterable close',
      );
      expect(await isPending(runLoopPromise)).toBe(false);
    }, 120_000);

    it('aborts an in-flight turn promptly (adapter-level interrupt)', async () => {
      const frames: TurnFrame[] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-smoke-interrupt-'));
      const controller = new AbortController();

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-interrupt',
        sandbox: barebonesSandbox(),
        input: queue,
        locator,
        signal: controller.signal,
        onTurn: (frame) => frames.push(frame),
      });
      adapter.renderNative(minimalNeutralConfig());
      adapter.interceptTool(allowAllTools);
      adapter.interceptStop(neverStop);

      const runLoopPromise = adapter.runLoop({
        role: 'r',
        scope: 'sc',
        worktree,
        capabilityFrame: { allow: [], deny: [] },
      });

      queue.push('Count slowly from one to fifty, one number per line.');
      // Wait for at least one streamed frame before aborting, so there is
      // something genuinely in-flight to interrupt.
      await waitForCondition(
        () => frames.length > 0,
        30_000,
        'no frame streamed before the abort — nothing to interrupt',
      );
      controller.abort();

      // The adapter must settle promptly either way (resolve or reject) — a
      // real hang here is the failure this assertion exists to catch. Which of
      // the two the real SDK does on an aborted streaming-input query is
      // exactly the unknown this live gate resolves.
      const outcome = await Promise.race([
        runLoopPromise.then(
          () => 'resolved' as const,
          () => 'rejected' as const,
        ),
        delay(15_000).then(() => 'timeout' as const),
      ]);
      expect(outcome).not.toBe('timeout');
      // Prevent an unhandled rejection from a `'rejected'` outcome above.
      await runLoopPromise.catch(() => undefined);

      queue.close();
    }, 60_000);
  },
);

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, TurnFrame } from '@coa/shared';
import type { TurnInterrupt } from '@coa/spi';
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
 * The barge-in de-risk gate (docs/adr/0012 follow-up): a real
 * `@anthropic-ai/claude-agent-sdk` `query()` in streaming-input mode, driven
 * directly through {@link ClaudeSdkAdapter}, proving the assumption the fake
 * suite could only model — that the SDK's TURN-LEVEL `query.interrupt()` (the
 * handle the adapter reports up via `onTurnInterrupt`) (a) stops the current turn
 * while keeping the query ALIVE, and (b) lets a message pushed right after run as
 * the next turn (the redirect). It ALSO records the exact frame sequence the interrupted turn emits
 * — a `turn-boundary`? an `error` frame? nothing? — which is the datum that
 * finalizes the M8 `pendingTurns`/`barging` accounting (session-handlers.ts): the
 * accounting assumes the interrupted turn emits exactly one terminal boundary and
 * that a non-success result is what carries an error frame. The diagnostic lines
 * below print that sequence for reconciliation.
 *
 * Gated like the streaming smoke: `COA_LIVE` unset ⇒ the whole describe is skipped,
 * so the default `pnpm vitest run packages/adapter-claude-sdk` stays green with no
 * account and CI never runs it. Spends real subscription tokens — keep prompts tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/barge-in-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])('ClaudeSdkAdapter — live barge-in smoke (real backend)', () => {
  let locator: Locator;

  beforeAll(() => {
    locator = resolveLiveLocator();
  });

  it(
    'interrupts a running turn, keeps the query alive, runs the framed steer next, and flushes the interrupted turn',
    async () => {
      const frames: TurnFrame[] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-bargein-'));
      let turnInterrupt: TurnInterrupt | undefined;

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-bargein',
        sandbox: barebonesSandbox(),
        input: queue,
        locator,
        onTurn: (frame) => frames.push(frame),
        onTurnInterrupt: (fn) => {
          turnInterrupt = fn;
        },
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

      // The streaming-input path must have reported a turn-interrupt handle up.
      await waitForCondition(
        () => turnInterrupt !== undefined,
        10_000,
        'the adapter never reported a turn-interrupt handle (onTurnInterrupt) on the streaming path',
      );

      // --- Turn A: a long generation the barge-in will cut off MID-flight -------
      // We interrupt on a TIMER while the model is still generating server-side, rather
      // than waiting for a specific mid-turn frame: the settled `text` frame lands only
      // at the turn boundary (and streaming `text-delta`s, piece B, are display-only), so
      // a timer is the robust way to catch turn A running. This is exactly the production
      // barge-in case: the user redirects a running turn.
      queue.push(
        'Write a long, detailed essay of at least 500 words about the history of the number zero across civilizations. Take your time and be thorough; do not stop early.',
      );
      // Let turn A generate for a few seconds — long enough to be genuinely in-flight,
      // short enough that a 500-word essay is nowhere near done.
      await delay(4_000);
      const cutIndex = frames.length;
      const boundariesBeforeCut = boundaryCount(frames);
      // Confirm we are catching turn A WHILE it runs — it must not have boundaried yet.
      // (If this ever fails, turn A finished too fast; lengthen the essay.)
      expect(boundariesBeforeCut).toBe(0);

      // --- Barge-in: stop the running turn A (query stays alive), then push the steer.
      await turnInterrupt!();
      queue.push('[The user interrupted to steer you] Stop counting. Reply with exactly one word: BANANA. Nothing else.');

      // The framed steer must run as the next turn and produce BANANA.
      await waitForCondition(
        () => /banana/i.test(collectText(frames.slice(cutIndex))),
        60_000,
        'the framed steer never ran after the interrupt (barge-in did not redirect the query)',
      );

      // The query must still be ALIVE — turn-level interrupt keeps it open (unlike
      // the whole-query AbortController, which would have settled runLoop by now).
      expect(await isPending(runLoopPromise)).toBe(true);

      // --- DIAGNOSTIC (reconciles the M8 pendingTurns/barging accounting) -------
      // Everything the adapter emitted from the interrupt up to the steer's answer.
      const window = frames.slice(cutIndex);
      const boundariesInWindow = boundaryCount(window);
      const errorFramesInWindow = window.filter((f) => f.t === 'error');
      console.log(
        `[barge-in diagnostic] frames-in-window=${window.length} ` +
          `turn-boundary=${boundariesInWindow} (before-cut=${boundariesBeforeCut}) ` +
          `error-frames=${errorFramesInWindow.length} ` +
          `error-subtypes=${JSON.stringify(errorFramesInWindow.map((f) => (f.t === 'error' ? f.message : '')))} ` +
          `window-frame-types=${JSON.stringify(window.map((f) => f.t))}`,
      );

      // The interrupted turn A emits its OWN terminal result too, so the window carries
      // at least two turn-boundaries (A's, then the steer B's). This is what makes M8's
      // `pendingTurns` accounting correct: every pushed turn — incl. the barge-in steer —
      // yields exactly one boundary, so the driver resolves on the steer, not on A
      // (docs/adr/0012). If interrupting a running turn ever stopped emitting A's
      // boundary, M8 would hang — this locks that SDK contract.
      expect(boundariesInWindow).toBeGreaterThanOrEqual(2);
      // A live-established SC-1 fact: interrupting a RUNNING turn yields a NON-success
      // result (`error_during_execution`) that maps to an error frame — which M8's
      // held-open `record()` must suppress (the `barging` counter) so a barge-in never
      // surfaces as an error. Locking it here flags any future SDK change to that shape.
      expect(window.some((f) => f.t === 'error' && f.message === 'error_during_execution')).toBe(true);

      // --- Clean close: the still-open query terminates, not hangs --------------
      queue.close();
      await withTimeoutMessage(
        runLoopPromise,
        20_000,
        'runLoop did not resolve within 20s of queue.close() after a barge-in — the query may not be terminating',
      );
      expect(await isPending(runLoopPromise)).toBe(false);
    },
    150_000,
  );
});


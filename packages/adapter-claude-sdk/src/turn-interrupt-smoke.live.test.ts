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
 * The turn-level-interrupt de-risk gate for streaming-input steering: a real
 * `@anthropic-ai/claude-agent-sdk` `query()` in streaming-input mode, driven
 * directly through {@link ClaudeSdkAdapter}, proving the assumption the fake
 * suite could only model — that the SDK's TURN-LEVEL `query.interrupt()` (the
 * handle the adapter reports up via `onTurnInterrupt`, and the one the user-Stop
 * closure in held-open-driver.ts calls) (a) stops the current turn while keeping
 * the query ALIVE, and (b) lets a message pushed right after run as an ordinary
 * next turn — exactly what happens when a user stops a running turn and then
 * sends a new message. It ALSO records the exact frame sequence the interrupted
 * turn emits — a `turn-boundary`? an `error` frame? nothing? — which is the
 * ground truth for why held-open-driver.ts's `query.stopped` guard drops every
 * frame type unconditionally, not just `error`. The diagnostic lines below print
 * that sequence for reconciliation.
 *
 * Gated like the streaming smoke: `COA_LIVE` unset ⇒ the whole describe is skipped,
 * so the default `pnpm vitest run packages/adapter-claude-sdk` stays green with no
 * account and CI never runs it. Spends real subscription tokens — keep prompts tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/turn-interrupt-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])(
  'ClaudeSdkAdapter — live turn-interrupt smoke (real backend)',
  () => {
    let locator: Locator;

    beforeAll(() => {
      locator = resolveLiveLocator();
    });

    it('stops a running turn, keeps the query alive, and runs the next message as an ordinary turn', async () => {
      const frames: TurnFrame[] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-turn-interrupt-'));
      let turnInterrupt: TurnInterrupt | undefined;

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-turn-interrupt',
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

      // --- Turn A: a long generation the Stop will cut off MID-flight -----------
      // We interrupt on a TIMER while the model is still generating server-side, rather
      // than waiting for a specific mid-turn frame: the settled `text` frame lands only
      // at the turn boundary (and streaming `text-delta`s are display-only), so a timer
      // is the robust way to catch turn A running. This is exactly the production Stop
      // case: the user stops a running turn.
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

      // --- Stop: interrupt the running turn A (query stays alive), then push the
      // next message, bare — no framing. A user Stop is not a redirect; the query
      // just goes idle until fed again, exactly like any other next turn.
      await turnInterrupt!();
      queue.push('Stop counting. Reply with exactly one word: BANANA. Nothing else.');

      // The next turn must run and produce BANANA.
      await waitForCondition(
        () => /banana/i.test(collectText(frames.slice(cutIndex))),
        60_000,
        'the next message never ran after the interrupt (the query did not stay alive)',
      );

      // The query must still be ALIVE — turn-level interrupt keeps it open (unlike
      // the whole-query AbortController, which would have settled runLoop by now).
      expect(await isPending(runLoopPromise)).toBe(true);

      // --- DIAGNOSTIC (grounds held-open-driver.ts's `query.stopped` guard) -----
      // Everything the adapter emitted from the interrupt up to the next turn's answer.
      const window = frames.slice(cutIndex);
      const boundariesInWindow = boundaryCount(window);
      const errorFramesInWindow = window.filter((f) => f.t === 'error');
      console.log(
        `[turn-interrupt diagnostic] frames-in-window=${window.length} ` +
          `turn-boundary=${boundariesInWindow} (before-cut=${boundariesBeforeCut}) ` +
          `error-frames=${errorFramesInWindow.length} ` +
          `error-subtypes=${JSON.stringify(errorFramesInWindow.map((f) => (f.t === 'error' ? f.message : '')))} ` +
          `window-frame-types=${JSON.stringify(window.map((f) => f.t))}`,
      );

      // The interrupted turn A emits its OWN terminal result too, so the window carries
      // at least two turn-boundaries (A's abandoned one, then the next turn's). A bare
      // stop must not lose that fact: the frame recorder drops every frame
      // while `query.stopped` is set, so it never depends on counting these boundaries —
      // but if interrupting a running turn ever stopped emitting A's boundary at all,
      // that would be a real SDK contract change worth knowing about.
      expect(boundariesInWindow).toBeGreaterThanOrEqual(2);
      // A live-established fact: interrupting a RUNNING turn yields a NON-success result
      // (`error_during_execution`) that maps to an error frame for the ABANDONED turn —
      // exactly what `query.stopped` must (and does) drop, so a user Stop never renders
      // as an error (a user stop is deliberate, not a crash). Locking it here flags any
      // future SDK change to that shape.
      expect(window.some((f) => f.t === 'error' && f.message === 'error_during_execution')).toBe(
        true,
      );

      // --- Clean close: the still-open query terminates, not hangs --------------
      queue.close();
      await withTimeoutMessage(
        runLoopPromise,
        20_000,
        'runLoop did not resolve within 20s of queue.close() after a turn interrupt — the query may not be terminating',
      );
      expect(await isPending(runLoopPromise)).toBe(false);
    }, 150_000);
  },
);

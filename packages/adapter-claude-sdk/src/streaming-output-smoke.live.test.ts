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
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
  waitForCondition,
} from './live-smoke-helpers.js';

/**
 * The Piece B (G7) de-risk gate: real `@anthropic-ai/claude-agent-sdk` streaming output.
 * `includePartialMessages` is a real-SDK assumption a fake CANNOT verify — that the SDK
 * emits partial-message content-block deltas mid-turn, which the adapter maps to
 * delivery-only `text-delta`/`thinking-delta` frames (docs/adr/0013). This proves the
 * live shape Tasks 1-7 built on:
 *  (a) a turn emits MULTIPLE `text-delta` frames BEFORE its settled `text` frame, and
 *  (b) the concatenated deltas equal the settled text (delivery == record).
 *
 * Gated on `COA_LIVE` (unset ⇒ the whole describe is skipped, so the default
 * `pnpm vitest run packages/adapter-claude-sdk` stays green with no account and CI
 * never runs it). Spends real subscription tokens — keep every live prompt tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-output-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])('ClaudeSdkAdapter — live streaming output (real backend)', () => {
  let locator: Locator;

  beforeAll(() => {
    locator = resolveLiveLocator();
  });

  it(
    'streams multiple text-delta frames whose concatenation equals the settled text',
    async () => {
      const frames: TurnFrame[] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-stream-out-'));

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-streaming-output',
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

      // A prompt whose answer is long enough to necessarily stream in several partial
      // messages (a one-line answer can come back atomically as a single assistant message).
      queue.push('Write a detailed paragraph of about 150 words explaining what a hash map is. Prose only, no lists.');
      await waitForCondition(
        () => boundaryCount(frames) >= 1,
        60_000,
        'the turn never produced a turn-boundary frame — the real query never streamed a result',
      );

      const deltas = frames.filter((f): f is Extract<TurnFrame, { t: 'text-delta' }> => f.t === 'text-delta');
      // (a) partial messages really streamed — more than one delta arrived.
      expect(deltas.length).toBeGreaterThan(1);
      // Every delta arrived before the settled `text` frame (delivery precedes record).
      const firstSettledText = frames.findIndex((f) => f.t === 'text' && f.text.trim() !== '');
      const lastDelta = frames.map((f) => f.t).lastIndexOf('text-delta');
      expect(lastDelta).toBeLessThan(firstSettledText);
      // (b) delivery == record: the concatenated deltas equal the settled text.
      const streamed = deltas.map((f) => f.text).join('');
      expect(collectText(frames).replace(/\s+/g, '')).toContain(streamed.replace(/\s+/g, ''));

      queue.close();
      await runLoopPromise;
    },
    120_000,
  );
});

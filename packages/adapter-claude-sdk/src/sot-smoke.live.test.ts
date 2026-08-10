import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, TurnFrame } from '@coa/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import {
  allowAllTools,
  barebonesSandbox,
  createPushQueue,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
  waitForCondition,
  withTimeoutMessage,
} from './live-smoke-helpers.js';

/**
 * The append-only source-of-truth de-risk gate (the event log is the canonical
 * conversation record): a real
 * `@anthropic-ai/claude-agent-sdk` tool-using turn driven through
 * {@link ClaudeSdkAdapter}, proving the assumption the fake suite cannot — that the
 * REAL SDK `tool_result` maps to an enriched `onTurn(frame, full)` whose `full`
 * carries the COMPLETE tool body the model saw (not the lossy UI `pointer`). This is
 * exactly what makes the read-time transcript fold faithful for the Claude backend:
 * the log's `full` is the memory content, so if the real content extraction were
 * lossy, cross-turn memory would silently degrade. Pairs with the unit-tested fold
 * (`transcript-projection.test.ts`) — real frames have the right shape here; the fold
 * is proven correct on that shape there.
 *
 * Gated like the other live smokes: `COA_LIVE` unset ⇒ skipped, so the default
 * `pnpm vitest run packages/adapter-claude-sdk` stays green with no account. Spends
 * real subscription tokens — keep the prompt tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/sot-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])(
  'ClaudeSdkAdapter — live source-of-truth smoke (real backend)',
  () => {
    let locator: Locator;

    beforeAll(() => {
      locator = resolveLiveLocator();
    });

    it('captures the FULL real tool-result body on the enriched onTurn stream (fold fidelity)', async () => {
      const events: Array<{ frame: TurnFrame; full?: string }> = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-sot-'));
      // A known marker the model cannot guess — it must actually run Read to see it.
      const marker = 'ZEBRA-Q7K9-COA-SOT-MARKER';
      writeFileSync(join(worktree, 'secret.txt'), `The secret content is: ${marker}\n`, 'utf8');

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-sot',
        sandbox: barebonesSandbox(),
        input: queue,
        locator,
        onTurn: (frame, full) => events.push(full !== undefined ? { frame, full } : { frame }),
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

      queue.push(
        'Use the Read tool to read the file secret.txt in the current directory, then reply with its exact contents.',
      );

      // Wait for the tool_result frame (the model ran Read).
      await waitForCondition(
        () => events.some((e) => e.frame.t === 'tool_result'),
        90_000,
        'the model never produced a tool_result frame (did it run Read?)',
      );

      const toolResults = events.filter((e) => e.frame.t === 'tool_result');
      // The FULL body carries the real file content the model saw — this is what the
      // fold persists as the `tool` message content in the append-only log.
      const withMarker = toolResults.find((e) => (e.full ?? '').includes(marker));
      expect(withMarker).toBeDefined();
      expect(withMarker!.full).toBeDefined();

      // Every tool_use has a matching tool_result handle (valid pairing → a faithful
      // fold with no synthesized-interrupt placeholder for this completed turn).
      const useHandles = new Set(
        events.flatMap((e) => (e.frame.t === 'tool_use' ? [e.frame.handle] : [])),
      );
      const resultHandles = new Set(
        events.flatMap((e) => (e.frame.t === 'tool_result' ? [e.frame.handle] : [])),
      );
      for (const h of useHandles) expect(resultHandles.has(h)).toBe(true);

      queue.close();
      await withTimeoutMessage(
        runLoopPromise,
        20_000,
        'runLoop did not resolve within 20s of queue.close()',
      );
    }, 150_000);
  },
);

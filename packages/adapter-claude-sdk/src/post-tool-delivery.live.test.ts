import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query, type HookInput, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { TurnFrame } from '@coa/shared';
import type { Delivery, DrainDeliveries } from '@coa/spi';
import { describe, expect, it, vi } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';
import { sessionAuthEnv } from './auth-env.js';
import {
  allowAllTools,
  barebonesSandbox,
  collectText,
  minimalNeutralConfig,
  neverStop,
  resolveLiveLocator,
  waitForCondition,
  withTimeoutMessage,
} from './live-smoke-helpers.js';

/**
 * Settles the two unverified facts the mid-loop delivery design rests on, then proves the two
 * end-to-end paths built on top of them. SDK 0.3.196 / CLI 2.1.196.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/post-tool-delivery.live.test.ts
 *
 * (a) Does a `PostToolUse` hook's `additionalContext` reach the model WITHIN THE SAME TURN —
 *     injected mid-loop and echoed back without a second user turn — or only at the next turn
 *     boundary?
 * (b) Does `PostToolUse` fire for `Bash` at all?
 *
 * The design degrades safely either way: delivery falls back to the turn boundary. But which one
 * is true decides the shape of the Claude row in the delivery table, so this is settled before any
 * code is built on top of it, not after.
 *
 * If probe (a) fails, that is a plan revision, not something to work around silently: the Claude
 * row becomes the `Stop`-hook boundary instead of `PostToolUse`. If probe (b) fails, delivery
 * through `Bash` falls back to the `Stop`-hook path, which is degradation, not breakage.
 *
 * Two more probes below settle the same class of fact for the shipped wiring itself
 * (`session-options.ts`'s `buildHooks`), not the raw SDK: a real governed session, driven through
 * {@link ClaudeSdkAdapter} exactly as M8 drives it, steered mid-tool-call and at the `Stop` floor.
 * Both are verified against the SDK's actual hook-output handling rather than TypeScript types —
 * the same norm `governed-gate.live.test.ts` (lines 86-90) documents: `sdk.mjs` never reads
 * `hookSpecificOutput`, the bundled CLI binary does, so a type-valid output does not get to ship
 * on types alone.
 */
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

const live = process.env['COA_LIVE'] === '1';

/**
 * Shared option scaffolding for both probes. Drives the raw SDK `query()` directly rather than
 * going through `ClaudeSdkAdapter` — this file consumes nothing from the adapter's own wiring —
 * but still resolves the real account the way every other live raw-`query()` probe in this
 * package does (`control/stage-3-4-turn-control.live.test.ts` et al.), and echoes the tool input
 * back on allow: a bare `{behavior:'allow'}` is type-valid but the real CLI treats it as a
 * permission error, so the tool call — and the `PostToolUse` firing this file is probing for —
 * never happens.
 */
function liveOptions(hooks: Options['hooks']): Options {
  return {
    settingSources: [],
    cwd: process.cwd(),
    canUseTool: async (_toolName, input) => ({ behavior: 'allow', updatedInput: input }),
    env: sessionAuthEnv(resolveLiveLocator()),
    hooks,
  };
}

describe.skipIf(!live)('PostToolUse additionalContext delivery', () => {
  it('reaches the model within the same turn', async () => {
    const fired: string[] = [];
    let injected = false;
    const messages: string[] = [];

    const q = query({
      prompt:
        'Run the Read tool on package.json. After the tool result, if you see a token ' +
        'of the form COA-DELIVERY-<word>, reply with exactly that token and stop.',
      options: liveOptions({
        PostToolUse: [
          {
            hooks: [
              async (input: HookInput) => {
                if ('tool_name' in input) fired.push(input.tool_name);
                injected = true;
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PostToolUse' as const,
                    additionalContext: 'COA-DELIVERY-kestrel',
                  },
                };
              },
            ],
          },
        ],
      }),
    });

    for await (const m of q) {
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

    const q = query({
      prompt: 'Run the Bash tool with the command: echo hello',
      options: liveOptions({
        PostToolUse: [
          {
            hooks: [
              async (input: HookInput) => {
                if ('tool_name' in input) fired.push(input.tool_name);
                return {};
              },
            ],
          },
        ],
      }),
    });

    for await (const _message of q) {
      // Drain.
    }

    expect(fired).toContain('Bash');
  }, 120_000);
});

/**
 * A minimal stand-in for `packages/core/src/session/delivery.ts`'s `DeliveryQueue`. This
 * adapter-level test must not depend upward on `@coa/core` (the same boundary
 * `resolveLiveLocator`'s own doc comment states for account resolution) — it re-implements only
 * the `DrainDeliveries` port shape ({@link DrainDeliveries}) it needs, at-most-once drain included.
 */
function createLocalDeliveryQueue(): {
  push: (delivery: Delivery) => void;
  drain: DrainDeliveries;
} {
  let pending: Delivery[] = [];
  return {
    push(delivery: Delivery): void {
      pending.push(delivery);
    },
    drain(): readonly Delivery[] {
      const out = pending;
      pending = [];
      return out;
    },
  };
}

/**
 * THE TWO PROBES THAT GATE THE SHIPPED WIRING, END TO END.
 *
 * The two probes above settled the raw SDK facts against a bare `query()`. These drive a real
 * governed session through {@link ClaudeSdkAdapter} — exactly the path `session-options.ts`'s
 * `buildHooks`/`assembleSessionOptions` wires for M8 — so what is proven here is the shipped
 * code, not a hand-rolled hook that merely resembles it.
 */
describe.skipIf(!live)('mid-loop delivery through the real adapter wiring', () => {
  it('delivers a pushed steer beside an in-flight Bash result, before the turn boundary', async () => {
    const frames: TurnFrame[] = [];
    const worktree = mkdtempSync(join(tmpdir(), 'coa-live-delivery-'));
    const deliveries = createLocalDeliveryQueue();

    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-smoke-delivery',
      sandbox: barebonesSandbox(),
      input:
        'Run the Bash tool with the command: sleep 8. After the tool result, if you see a ' +
        'token of the form COA-DELIVERY-<word>, reply with exactly that token and stop. Do ' +
        'nothing else.',
      locator: resolveLiveLocator(),
      drainDeliveries: deliveries.drain,
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

    // The `tool_use` frame lands as soon as the model REQUESTS the call (turn-frames.ts maps
    // it off the `assistant` message) — before the subprocess runs — so seeing it alone is not
    // proof the call is still executing.
    await waitForCondition(
      () => frames.some((f) => f.t === 'tool_use' && f.tool === 'Bash'),
      30_000,
      'the Bash tool call never started',
    );

    // THE IN-FLIGHT GUARANTEE: no `tool_result` has landed yet, so the `sleep 8` subprocess is
    // still running when the push below happens (JS is single-threaded — this check and the
    // push execute within the same tick the wait resolved on, a small fraction of a second
    // into an 8-second sleep). Claude Code on Windows requires Git Bash, so `sleep` is a real
    // POSIX binary here, not a shell built-in that might resolve to something instant. If this
    // assertion ever flakes, the call finished too fast against test-runner overhead —
    // lengthen the sleep (mirrors the barge-in smoke's essay-length comment).
    expect(frames.some((f) => f.t === 'tool_result')).toBe(false);

    deliveries.push({ origin: 'user', text: 'COA-DELIVERY-otter' });

    await withTimeoutMessage(
      runLoopPromise,
      60_000,
      'runLoop did not resolve within 60s of a mid-tool-call delivery',
    );

    const boundaryIndex = frames.findIndex((f) => f.t === 'turn-boundary');
    const deliveryIndex = frames.findIndex(
      (f) => f.t === 'text' && f.text.includes('COA-DELIVERY-otter'),
    );
    const diagnostic = `frame-types=${JSON.stringify(frames.map((f) => f.t))}`;

    // THE CRUX: the delivered text reached the model and was echoed back BEFORE the turn's
    // terminal result — landed at the next round trip (the tool result), not the turn boundary.
    expect(deliveryIndex, diagnostic).toBeGreaterThan(-1);
    expect(boundaryIndex, diagnostic).toBeGreaterThan(-1);
    expect(deliveryIndex, diagnostic).toBeLessThan(boundaryIndex);
  }, 120_000);

  it('honours a delivered steer at the Stop-hook floor when no tool call ever runs', async () => {
    const frames: TurnFrame[] = [];
    const worktree = mkdtempSync(join(tmpdir(), 'coa-live-stop-delivery-'));
    const deliveries = createLocalDeliveryQueue();

    const adapter = new ClaudeSdkAdapter({
      sessionId: 'live-smoke-stop-delivery',
      sandbox: barebonesSandbox(),
      input:
        'Reply with exactly one word: FIRST. Do not call any tool and do not say anything else.',
      locator: resolveLiveLocator(),
      drainDeliveries: deliveries.drain,
      onTurn: (frame) => frames.push(frame),
    });
    adapter.renderNative(minimalNeutralConfig());
    adapter.interceptTool(allowAllTools);
    adapter.interceptStop(neverStop);

    // Pushed before the turn even starts: with no tool call anywhere in this turn,
    // `PostToolUse` never fires, so the `Stop` hook (`stopWithDelivery` in
    // session-options.ts) is the ONLY boundary left that could drain this — the delivery
    // floor this probe exists to prove, not assume from its types.
    deliveries.push({
      origin: 'user',
      text: 'COA-DELIVERY-heron. If you see this token, reply with exactly the word SECOND and stop.',
    });

    await withTimeoutMessage(
      adapter.runLoop({
        role: 'r',
        scope: 'sc',
        worktree,
        capabilityFrame: { allow: [], deny: [] },
      }),
      60_000,
      'runLoop did not resolve within 60s of a Stop-hook delivery',
    );

    const usedTool = frames.some((f) => f.t === 'tool_use');
    const text = collectText(frames);
    const diagnostic = `used-tool=${usedTool}; frame-types=${JSON.stringify(frames.map((f) => f.t))}; text=${JSON.stringify(text)}`;

    // Confirms the scenario this probe targets: no tool call happened, so PostToolUse's
    // delivery path never ran — only the Stop-hook floor could have delivered the text.
    expect(usedTool, diagnostic).toBe(false);

    // THE CRUX: the Stop-hook-injected `additionalContext` was honoured — the model saw the
    // delivered token and the conversation continued to address it, rather than the turn
    // ending on "FIRST" alone.
    expect(text, diagnostic).toContain('SECOND');
  }, 120_000);
});

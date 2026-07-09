import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BackendMessage, CapabilitySet, Locator, NeutralConfig, TurnFrame } from '@coa/shared';
import { accountsFileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate, TurnInterrupt } from '@coa/spi';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';

/**
 * The barge-in de-risk gate (docs/adr/0012 follow-up): a real
 * `@anthropic-ai/claude-agent-sdk` `query()` in streaming-input mode, driven
 * directly through {@link ClaudeSdkAdapter}, proving the assumption the fake
 * suite could only model — that the SDK's TURN-LEVEL `query.interrupt()` (the
 * handle the adapter reports up via `onTurnInterrupt`) (a) stops the current turn
 * while keeping the query ALIVE, (b) lets a message pushed right after run as the
 * next turn (the redirect), and (c) still flushes the interrupted turn's completed
 * blocks (A1). It ALSO records the exact frame sequence the interrupted turn emits
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
      const flushed: BackendMessage[][] = [];
      const queue = createPushQueue();
      const worktree = mkdtempSync(join(tmpdir(), 'coa-live-bargein-'));
      let turnInterrupt: TurnInterrupt | undefined;

      const adapter = new ClaudeSdkAdapter({
        sessionId: 'live-smoke-bargein',
        sandbox: barebonesSandbox(),
        input: queue,
        locator,
        onTurn: (frame) => frames.push(frame),
        onBackendMessages: (messages) => flushed.push([...messages]),
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
      // A pure-generation turn's text lands only at its turn boundary (incremental
      // streaming — piece B — is not built), so we cannot wait for a mid-turn text
      // frame: there is none until the turn ends. Instead we push a long essay and
      // interrupt on a TIMER, while the model is still generating server-side. This
      // is exactly the production barge-in case: the user redirects a running turn.
      queue.push(
        'Write a long, detailed essay of at least 500 words about the history of the number zero across civilizations. Take your time and be thorough; do not stop early.',
      );
      // Let turn A generate for a few seconds — long enough to be genuinely in-flight,
      // short enough that a 500-word essay is nowhere near done.
      await delay(4_000);
      const cutIndex = frames.length;
      const boundariesBeforeCut = boundaryCount(frames);
      const flushesBeforeCut = flushed.length;
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
      // eslint-disable-next-line no-console
      console.log(
        `[barge-in diagnostic] frames-in-window=${window.length} ` +
          `turn-boundary=${boundariesInWindow} (before-cut=${boundariesBeforeCut}) ` +
          `error-frames=${errorFramesInWindow.length} ` +
          `error-subtypes=${JSON.stringify(errorFramesInWindow.map((f) => (f.t === 'error' ? f.message : '')))} ` +
          `flushes-added=${flushed.length - flushesBeforeCut} ` +
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

      // A1: the interrupted turn's partial completed blocks reached canonical memory.
      expect(flushed.length).toBeGreaterThan(0);
      const lastFlush = flushed[flushed.length - 1]!;
      expect(lastFlush.some((m) => m.role === 'assistant')).toBe(true);

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

// --- Fixtures ---------------------------------------------------------------

function barebonesSandbox(): CapabilitySet {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };
}

function minimalNeutralConfig(): NeutralConfig {
  return {
    prefixHead: [],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
  };
}

const allowAllTools: CanUseTool = () => ({ behavior: 'allow' });
const neverStop: StopPredicate = () => ({ allow: true });

// --- Account resolution -------------------------------------------------------

/** Resolve the active `claude` account's {@link Locator} from `~/.coa/accounts.yaml`
 *  (or `COA_LIVE_CONFIG_DIR`) WITHOUT importing `@coa/core` — same as the streaming smoke. */
function resolveLiveLocator(): Locator {
  const override = process.env['COA_LIVE_CONFIG_DIR'];
  if (override !== undefined && override !== '') {
    return { type: 'config-dir', dir: override };
  }
  const path = join(homedir(), '.coa', 'accounts.yaml');
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(
      `COA_LIVE=1 requires a Claude account: could not read ${path} (set COA_LIVE_CONFIG_DIR, or run 'coa auth add <label> --config-dir <dir>' then 'coa auth use <label>'). ${String(err)}`,
    );
  }
  const file = accountsFileSchema.parse(raw);
  const label = file.active['claude'];
  const account =
    label !== undefined
      ? file.accounts.find((a) => a.label === label && a.provider === 'claude')
      : undefined;
  if (account === undefined) {
    throw new Error(
      `COA_LIVE=1 requires an active 'claude' account (coa auth use <label>) — none found in ${path}`,
    );
  }
  return account.locator;
}

// --- A minimal push-driven AsyncIterable<string> -----------------------------

interface PushQueue extends AsyncIterable<string> {
  push(text: string): void;
  close(): void;
}

/** A hand-rolled queue feeding turns into the streaming-input `query()` on our own
 *  schedule — deliberately not core's `InputChannel`, so this test drives the adapter's
 *  raw `AsyncIterable<string>` seam directly with no core dependency. */
function createPushQueue(): PushQueue {
  const buffered: string[] = [];
  const waiters: Array<(result: IteratorResult<string>) => void> = [];
  let closed = false;
  return {
    push(text: string): void {
      if (closed) throw new Error('createPushQueue: push after close');
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter({ value: text, done: false });
      else buffered.push(text);
    },
    close(): void {
      closed = true;
      while (waiters.length > 0) {
        waiters.shift()!({ value: undefined, done: true });
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<string> {
      return {
        next(): Promise<IteratorResult<string>> {
          const next = buffered.shift();
          if (next !== undefined) return Promise.resolve({ value: next, done: false });
          if (closed) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => waiters.push(resolve));
        },
      };
    },
  };
}

// --- Timing helpers -----------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isPending(promise: Promise<unknown>, graceMs = 250): Promise<boolean> {
  const PENDING = Symbol('pending');
  const settledOrPending = await Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const,
    ),
    delay(graceMs).then(() => PENDING),
  ]);
  return settledOrPending === PENDING;
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
  pollMs = 100,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitForCondition timed out: ${message}`);
    await delay(pollMs);
  }
}

async function withTimeoutMessage<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// --- Frame helpers --------------------------------------------------------------

function boundaryCount(frames: readonly TurnFrame[]): number {
  return frames.filter((f) => f.t === 'turn-boundary').length;
}

function collectText(frames: readonly TurnFrame[]): string {
  return frames
    .filter((f): f is Extract<TurnFrame, { t: 'text' }> => f.t === 'text')
    .map((f) => f.text)
    .join(' ');
}

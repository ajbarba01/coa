import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BackendMessage, CapabilitySet, Locator, NeutralConfig, TurnFrame } from '@coa/shared';
import { accountsFileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';

/**
 * The P-β de-risk gate (Task 4): a real `@anthropic-ai/claude-agent-sdk` `query()`
 * in streaming-input mode, driven directly through {@link ClaudeSdkAdapter}, proving
 * the assumption Tasks 1-3 built on top of but could only fake-test — that ONE
 * held-open query fed a coa-owned input iterable (docs/adr/0012) (a) stays alive
 * across turns instead of tearing down after the first, (b) shares memory across
 * those turns on the SAME server session, (c) lets a message pushed mid-turn reach
 * the running turn (steering), (d) aborts promptly and flushes on interrupt, and
 * (e) terminates cleanly (no hang, no leak) once the input iterable closes.
 *
 * Gated exactly like `packages/core/src/workbench/web/web-tools.smoke.test.ts`:
 * `COA_LIVE` unset ⇒ the whole describe is skipped, so the default
 * `pnpm vitest run packages/adapter-claude-sdk` stays green with no account and CI
 * never runs it. Spends real subscription tokens — keep every live prompt tiny.
 *
 *   COA_LIVE=1 pnpm vitest run packages/adapter-claude-sdk/src/streaming-smoke.live.test.ts
 */
describe.skipIf(!process.env['COA_LIVE'])('ClaudeSdkAdapter — live streaming-input smoke (real backend)', () => {
  let locator: Locator;

  beforeAll(() => {
    locator = resolveLiveLocator();
  });

  it(
    'holds one query open across turns, shares memory, queues a follow-up pushed mid-turn, and terminates cleanly on close',
    async () => {
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
      // verified live; see docs/adr/0012). True mid-turn redirect is barge-in
      // (interrupt()+push), a separate capability, not this push-queue path. ------
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
      const alphaAt = frames.findIndex((f, i) => i >= beforeTurn3 && f.t === 'text' && /alpha/i.test(f.text));
      const omegaAt = frames.findIndex((f, i) => i >= beforeTurn3 && f.t === 'text' && /omega/i.test(f.text));
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
    },
    120_000,
  );

  it(
    'aborts an in-flight turn promptly and flushes the transcript (adapter-level interrupt)',
    async () => {
      const frames: TurnFrame[] = [];
      const flushed: BackendMessage[][] = [];
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
        onBackendMessages: (messages) => flushed.push([...messages]),
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
      // something in-flight for the A1 flush net to actually catch.
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

      expect(flushed.length).toBeGreaterThan(0);
      queue.close();
    },
    60_000,
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

/**
 * Resolve the live account's {@link Locator} the way the CLI does — the active
 * `claude` account from the credential-blind registry (`~/.coa/accounts.yaml`,
 * `AccountsRegistry.getActive('claude')` in `@coa/core`) — WITHOUT importing
 * `@coa/core` (an adapter-level test must not depend upward on the daemon core;
 * that's the layering inversion the brief calls out). `COA_LIVE_CONFIG_DIR`
 * overrides directly for a CI/dev box that has no `~/.coa/accounts.yaml`.
 */
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
      `COA_LIVE=1 requires a Claude account: could not read ${path} (set COA_LIVE_CONFIG_DIR to a config dir, or run 'coa auth add <label> --config-dir <dir>' then 'coa auth use <label>'). ${String(err)}`,
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

/**
 * A hand-rolled queue for feeding turns into the streaming-input `query()` on
 * our own schedule (turn 1, await its result, THEN turn 2/a steer, THEN close) —
 * deliberately not core's `InputChannel`, so this test drives the adapter's raw
 * `AsyncIterable<string>` seam directly with no core dependency.
 */
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

/** Whether `promise` is still unsettled after a short grace window (the pending-vs-settled probe). */
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

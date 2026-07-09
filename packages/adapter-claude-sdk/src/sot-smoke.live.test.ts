import { mkdtempSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CapabilitySet, Locator, NeutralConfig, TurnFrame } from '@coa/shared';
import { accountsFileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';
import { beforeAll, describe, expect, it } from 'vitest';
import { ClaudeSdkAdapter } from './claude-sdk-adapter.js';

/**
 * The append-only source-of-truth de-risk gate (docs/adr/0010): a real
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
describe.skipIf(!process.env['COA_LIVE'])('ClaudeSdkAdapter — live source-of-truth smoke (real backend)', () => {
  let locator: Locator;

  beforeAll(() => {
    locator = resolveLiveLocator();
  });

  it(
    'captures the FULL real tool-result body on the enriched onTurn stream (fold fidelity)',
    async () => {
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

      queue.push('Use the Read tool to read the file secret.txt in the current directory, then reply with its exact contents.');

      // Wait for the tool_result frame (the model ran Read).
      await waitForCondition(
        () => events.some((e) => e.frame.t === 'tool_result'),
        90_000,
        'the model never produced a tool_result frame (did it run Read?)',
      );

      const toolResults = events.filter((e) => e.frame.t === 'tool_result');
      // The FULL body carries the real file content the model saw — this is what the
      // fold persists as the `tool` message content (docs/adr/0010).
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
    },
    150_000,
  );
});

// --- Fixtures (gated live-test scaffolding; shared shape with the other .live.test.ts) ---

function barebonesSandbox(): CapabilitySet {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };
}

function minimalNeutralConfig(): NeutralConfig {
  return { prefixHead: [], systemReminders: [], onDemandPullable: [], scopePushed: [], toolIntents: { allow: [], deny: [] } };
}

const allowAllTools: CanUseTool = () => ({ behavior: 'allow' });
const neverStop: StopPredicate = () => ({ allow: true });

function resolveLiveLocator(): Locator {
  const override = process.env['COA_LIVE_CONFIG_DIR'];
  if (override !== undefined && override !== '') return { type: 'config-dir', dir: override };
  const path = join(homedir(), '.coa', 'accounts.yaml');
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`COA_LIVE=1 requires a Claude account: could not read ${path}. ${String(err)}`);
  }
  const file = accountsFileSchema.parse(raw);
  const label = file.active['claude'];
  const account = label !== undefined ? file.accounts.find((a) => a.label === label && a.provider === 'claude') : undefined;
  if (account === undefined) throw new Error(`COA_LIVE=1 requires an active 'claude' account in ${path}`);
  return account.locator;
}

interface PushQueue extends AsyncIterable<string> {
  push(text: string): void;
  close(): void;
}

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
      while (waiters.length > 0) waiters.shift()!({ value: undefined, done: true });
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(predicate: () => boolean, timeoutMs: number, message: string, pollMs = 100): Promise<void> {
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

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CapabilitySet, Locator, NeutralConfig, TurnFrame } from '@coa/shared';
import { accountsFileSchema } from '@coa/shared';
import type { CanUseTool, StopPredicate } from '@coa/spi';

/**
 * Shared scaffolding for the `COA_LIVE`-gated adapter smokes (streaming-input,
 * barge-in, single-source-of-truth, streaming-output). Each smoke drives a real
 * `@anthropic-ai/claude-agent-sdk` `query()` through {@link ClaudeSdkAdapter}; these
 * helpers are the generic, backend-agnostic plumbing every one of them needs — the
 * minimal neutral config + SC-1 predicates, the credential-blind account resolution,
 * a hand-rolled push queue for feeding turns on the test's own schedule, and the
 * timing/frame utilities. Kept in one module so a new smoke does not fork a fourth copy.
 */

// --- Fixtures ---------------------------------------------------------------

export function barebonesSandbox(): CapabilitySet {
  return { allowedTools: [], denyRules: [], permissionMode: 'default', denyRead: [] };
}

export function minimalNeutralConfig(): NeutralConfig {
  return {
    prefixHead: [],
    systemReminders: [],
    onDemandPullable: [],
    scopePushed: [],
    toolIntents: { allow: [], deny: [] },
  };
}

/**
 * Allow every tool. Deliberately does NOT echo the tool input: `ToolPermissionDecision` has
 * no field for it, and the echo the real CLI requires is applied once, centrally, in
 * `toSdkPermission`. A raw callback handed straight to `query()` must echo for itself — the
 * control probes do, because they bypass the adapter.
 */
export const allowAllTools: CanUseTool = () => ({ behavior: 'allow' });
export const neverStop: StopPredicate = () => ({ allow: true });

// --- Account resolution -------------------------------------------------------

/**
 * Resolve the live account's {@link Locator} the way the CLI does — the active
 * `claude` account from the credential-blind registry (`~/.coa/accounts.yaml`,
 * `AccountsRegistry.getActive('claude')` in `@coa/core`) — WITHOUT importing
 * `@coa/core` (an adapter-level test must not depend upward on the daemon core).
 * `COA_LIVE_CONFIG_DIR` overrides directly for a box with no `~/.coa/accounts.yaml`.
 */
export function resolveLiveLocator(): Locator {
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
      `COA_LIVE=1 requires a Claude account: could not read ${path} (set COA_LIVE_CONFIG_DIR to a config dir, or run 'coa auth add <label> --config-dir <dir>' then 'coa auth use <label>').`,
      { cause: err },
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

export interface PushQueue extends AsyncIterable<string> {
  push(text: string): void;
  close(): void;
}

/**
 * A hand-rolled queue for feeding turns into the streaming-input `query()` on the
 * test's own schedule (turn 1, await its result, THEN turn 2/a steer, THEN close) —
 * deliberately not core's `InputChannel`, so the smoke drives the adapter's raw
 * `AsyncIterable<string>` seam directly with no core dependency.
 */
export function createPushQueue(): PushQueue {
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether `promise` is still unsettled after a short grace window (the pending-vs-settled probe). */
export async function isPending(promise: Promise<unknown>, graceMs = 250): Promise<boolean> {
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

export async function waitForCondition(
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

export async function withTimeoutMessage<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
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

export function boundaryCount(frames: readonly TurnFrame[]): number {
  return frames.filter((f) => f.t === 'turn-boundary').length;
}

export function collectText(frames: readonly TurnFrame[]): string {
  return frames
    .filter((f): f is Extract<TurnFrame, { t: 'text' }> => f.t === 'text')
    .map((f) => f.text)
    .join(' ');
}

import { ClaudeSdkAdapter } from '@coa/adapter-claude-sdk';
import type { SessionAdapterInit } from '@coa/core';
import type { RuntimeAdapter } from '@coa/spi';

/**
 * The app-side M9 adapter factory — the ONE place that constructs the concrete
 * backend, mapping M8's backend-neutral {@link SessionAdapterInit} seam onto the
 * Claude SDK's `ClaudeSdkAdapterInit`. This lives in the app, not `core`, because
 * it imports `@coa/adapter-claude-sdk` (backend-isolation: the core never does).
 * M8 holds this as the injected `createAdapter` closure, keeping M9 a swappable
 * leaf. The push-bridge `onMessage` is wired when the WAL→Push bridge is built.
 */
export function createClaudeAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new ClaudeSdkAdapter({
    sessionId: init.sessionId,
    sandbox: init.sandbox,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
  });
}

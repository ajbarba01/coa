import { ClaudeSdkAdapter, fetchClaudeModels } from '@coa/adapter-claude-sdk';
import type { ModelCacheAccount, SessionAdapterInit } from '@coa/core';
import type { ModelDescriptor } from '@coa/shared';
import type { RuntimeAdapter } from '@coa/spi';

/**
 * The app-side M9 adapter registry — the ONE place that constructs concrete
 * backends, routing by the agent's `provider` (D121's `createAdapter` seam). This
 * lives in the app, not `core`, because it imports backend packages
 * (backend-isolation: the core never does). M8 holds {@link createAdapter} as the
 * injected closure, keeping backends swappable leaves.
 *
 * Today only `claude` is wired; a from-scratch pure-API backend (e.g. DeepSeek)
 * slots in here as a new provider case. An unknown/unwired provider throws — which
 * `createSession` surfaces as an SC-1 error frame, never a silent wrong-backend run.
 */
export function createAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const provider = init.model?.provider ?? 'claude';
  switch (provider) {
    case 'claude':
      return createClaudeAdapter(init);
    default:
      throw new Error(`runtime provider '${provider}' is not wired yet`);
  }
}

/** Fetch a backend's available models (+ per-model reasoning capabilities), routed by provider. */
export function fetchModels(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  // Provider routing lands with the second backend; Claude is the only provider today.
  return fetchClaudeModels(account.locator);
}

/** Construct the Claude Agent SDK backend, mapping M8's neutral init onto the SDK adapter's init. */
export function createClaudeAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new ClaudeSdkAdapter({
    sessionId: init.sessionId,
    sandbox: init.sandbox,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
  });
}

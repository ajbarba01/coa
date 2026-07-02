import { ClaudeSdkAdapter, fetchClaudeModels } from '@coa/adapter-claude-sdk';
import {
  DeepSeekAdapter,
  fetchDeepSeekModels,
  loadEffortCaps,
  resolveApiKey,
} from '@coa/adapter-deepseek';
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
 * `claude` (the Claude Agent SDK) and `deepseek` (a thin pure-API backend over the
 * shared loop driver) are wired. An unknown/unwired provider throws — which
 * `createSession` surfaces as an SC-1 error frame, never a silent wrong-backend run.
 */
export function createAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const provider = init.model?.provider ?? 'claude';
  switch (provider) {
    case 'claude':
      return createClaudeAdapter(init);
    case 'deepseek':
      return createDeepSeekAdapter(init);
    default:
      throw new Error(`runtime provider '${provider}' is not wired yet`);
  }
}

/**
 * Fetch a backend's available models (+ per-model reasoning capabilities), routed
 * by the active account's login pointer: an `env-var` locator is a DeepSeek
 * API-key account (empty list when the key is unset), everything else is Claude.
 */
export function fetchModels(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  if (account.locator?.type === 'env-var') {
    const apiKey = resolveApiKey(account.locator);
    if (apiKey === undefined) return Promise.resolve([]);
    return fetchDeepSeekModels({ apiKey, caps: loadEffortCaps() });
  }
  return fetchClaudeModels(account.locator);
}

/** Construct the thin DeepSeek backend, mapping M8's neutral init onto its init. */
export function createDeepSeekAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new DeepSeekAdapter({
    sessionId: init.sessionId,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
  });
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
    ...(init.resume !== undefined ? { resume: init.resume } : {}),
    ...(init.onBackendSession !== undefined ? { onBackendSession: init.onBackendSession } : {}),
  });
}

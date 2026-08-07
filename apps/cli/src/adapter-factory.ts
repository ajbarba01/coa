import { ClaudeSdkAdapter, fetchClaudeModels } from '@coa/adapter-claude-sdk';
import {
  DeepSeekAdapter,
  fetchDeepSeekModels,
  loadEffortCaps,
  resolveApiKey,
} from '@coa/adapter-deepseek';
import {
  LongCatAdapter,
  fetchLongCatModels,
  loadEffortCaps as loadLongCatEffortCaps,
  resolveApiKey as resolveLongCatApiKey,
} from '@coa/adapter-longcat';
import type { ModelCacheAccount, SessionAdapterInit, SessionStrategy } from '@coa/core';
import type { ModelDescriptor } from '@coa/shared';
import type { RuntimeAdapter } from '@coa/spi';

/**
 * The app-side backend adapter registry — the ONE place that constructs concrete
 * backends, routing by the agent's `provider` (the neutral-construction seam:
 * the init carries only neutral types). This lives in the app, not `core`,
 * because it imports backend packages
 * (backend-isolation: the core never does). The session core holds {@link createAdapter} as the
 * injected closure, keeping backends swappable leaves.
 *
 * `claude` (the Claude Agent SDK), `deepseek`, and `longcat` (both thin pure-API
 * backends over the shared loop driver) are wired. An unknown/unwired provider
 * throws — which `createSession` surfaces as an advisory error frame, never a silent
 * wrong-backend run.
 */
export function createAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const provider = init.model?.provider ?? 'claude';
  switch (provider) {
    case 'claude':
      return createClaudeAdapter(init);
    case 'deepseek':
      return createDeepSeekAdapter(init);
    case 'longcat':
      return createLongCatAdapter(init);
    default:
      throw new Error(`runtime provider '${provider}' is not wired yet`);
  }
}

/**
 * The per-provider turn-drive strategy — co-located with {@link createAdapter} so the
 * provider→backend and provider→strategy maps are a SINGLE source of truth (the
 * session core stays backend-blind: it consumes only the abstract verdict, never a
 * provider literal). The Claude SDK backend holds ONE `query` open across turns (its
 * streaming-input steering); every pure-API backend stays per-turn (a fresh loop each
 * turn). An unknown provider defaults to the safe per-turn floor.
 */
export function sessionStrategy(provider: string): SessionStrategy {
  return provider === 'claude' ? 'held-open' : 'per-turn';
}

/**
 * Fetch a provider's available models (+ per-model reasoning capabilities), routed
 * by the account's `provider`, and TAG each with that provider so the console can
 * merge every backend into one list and route a session to the model's backend. A
 * DeepSeek account with no resolvable key THROWS (a real failure, not a silent
 * empty list — see {@link ModelCache}, which never caches a rejected fetch).
 */
export async function fetchModels(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  const provider = account.provider ?? 'claude';
  const models =
    provider === 'deepseek'
      ? await fetchDeepSeekFor(account)
      : provider === 'longcat'
        ? await fetchLongCatFor(account)
        : await fetchClaudeModels(account.locator);
  return models.map((model) => ({ ...model, provider }));
}

async function fetchDeepSeekFor(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  const apiKey = resolveApiKey(account.locator);
  if (apiKey === undefined) {
    throw new Error('deepseek: no API key resolved from the account locator');
  }
  return fetchDeepSeekModels({ apiKey, caps: loadEffortCaps() });
}

async function fetchLongCatFor(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  const apiKey = resolveLongCatApiKey(account.locator);
  if (apiKey === undefined) {
    throw new Error('longcat: no API key resolved from the account locator');
  }
  return fetchLongCatModels({ apiKey, caps: loadLongCatEffortCaps() });
}

/** Construct the thin DeepSeek backend, mapping the session core's neutral init onto its init. */
export function createDeepSeekAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new DeepSeekAdapter({
    sessionId: init.sessionId,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
    ...(init.history !== undefined ? { history: init.history } : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
    ...(init.drainDeliveries !== undefined ? { drainDeliveries: init.drainDeliveries } : {}),
  });
}

/** Construct the thin LongCat backend, mapping the session core's neutral init onto its init. */
export function createLongCatAdapter(init: SessionAdapterInit): RuntimeAdapter {
  return new LongCatAdapter({
    sessionId: init.sessionId,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
    ...(init.maxBudgetUsd !== undefined ? { maxBudgetUsd: init.maxBudgetUsd } : {}),
    ...(init.locator !== undefined ? { locator: init.locator } : {}),
    ...(init.history !== undefined ? { history: init.history } : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
    ...(init.drainDeliveries !== undefined ? { drainDeliveries: init.drainDeliveries } : {}),
  });
}

/** Construct the Claude Agent SDK backend, mapping the session core's neutral init onto the SDK adapter's init. */
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
    ...(init.history !== undefined ? { history: init.history } : {}),
    ...(init.deliverHistoryAsPreamble !== undefined
      ? { deliverHistoryAsPreamble: init.deliverHistoryAsPreamble }
      : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
    ...(init.drainDeliveries !== undefined ? { drainDeliveries: init.drainDeliveries } : {}),
  });
}

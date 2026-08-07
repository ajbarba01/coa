import { ClaudeSdkAdapter, fetchClaudeModels } from '@coa/adapter-claude-sdk';
import {
  OpenAiCompatAdapter,
  deepseekSpec,
  fetchOpenAiCompatModels,
  loadEffortCaps,
  longcatSpec,
  resolveApiKey,
  type ProviderSpec,
} from '@coa/adapter-openai-compat';
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
 * `claude` (the Claude Agent SDK), `deepseek`, and `longcat` (both provider specs
 * over the one thin OpenAI-compatible pure-API backend + the shared loop driver)
 * are wired. An unknown/unwired provider throws — which `createSession` surfaces
 * as an advisory error frame, never a silent wrong-backend run.
 */
export function createAdapter(init: SessionAdapterInit): RuntimeAdapter {
  const provider = init.model?.provider ?? 'claude';
  switch (provider) {
    case 'claude':
      return createClaudeAdapter(init);
    case 'deepseek':
      return createOpenAiCompatAdapter(deepseekSpec, init);
    case 'longcat':
      return createOpenAiCompatAdapter(longcatSpec, init);
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
 * pure-API account with no resolvable key THROWS (a real failure, not a silent
 * empty list — see {@link ModelCache}, which never caches a rejected fetch).
 */
export async function fetchModels(account: ModelCacheAccount): Promise<ModelDescriptor[]> {
  const provider = account.provider ?? 'claude';
  const models =
    provider === 'deepseek'
      ? await fetchOpenAiCompatFor(deepseekSpec, account)
      : provider === 'longcat'
        ? await fetchOpenAiCompatFor(longcatSpec, account)
        : await fetchClaudeModels(account.locator);
  return models.map((model) => ({ ...model, provider }));
}

async function fetchOpenAiCompatFor(
  spec: ProviderSpec,
  account: ModelCacheAccount,
): Promise<ModelDescriptor[]> {
  const apiKey = resolveApiKey(spec, account.locator);
  if (apiKey === undefined) {
    throw new Error(`${spec.id}: no API key resolved from the account locator`);
  }
  return fetchOpenAiCompatModels(spec, { apiKey, caps: loadEffortCaps(spec) });
}

/** Construct the thin OpenAI-compatible backend for the spec's provider, mapping the session core's neutral init onto its init. */
export function createOpenAiCompatAdapter(
  spec: ProviderSpec,
  init: SessionAdapterInit,
): RuntimeAdapter {
  return new OpenAiCompatAdapter(spec, {
    sessionId: init.sessionId,
    input: init.input,
    onSettle: init.onSettle,
    ...(init.model !== undefined ? { model: init.model } : {}),
    ...(init.onTurn !== undefined ? { onTurn: init.onTurn } : {}),
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

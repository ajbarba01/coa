import type { Locator } from '@coa/shared';
import type { RuntimeUsage } from '@coa/spi';
import { makeSummarizer, type Summarizer, type WebConfig } from '@coa/core';
import { makeDeepSeekComplete } from '@coa/adapter-deepseek';

/**
 * Compose the WebFetch summarizer from `web.fetch.summarizer`: a minimal
 * `makeSummarizer` over the DeepSeek `complete()` primitive, model config-driven,
 * cost recorded through the injected `recordCost` (the daemon core hands its
 * ledger recorder). Absent config or an unresolved key ⇒ `undefined` (the
 * raw-markdown floor). Lives in the app because it constructs a concrete
 * backend's `complete()` — the composition root is the one place backend
 * packages are imported.
 */
export function buildFetchSummarizer(
  web: WebConfig,
  recordCost: (usage: RuntimeUsage) => void,
): Summarizer | undefined {
  const cfg = web.fetch?.summarizer;
  if (cfg === undefined || cfg.provider !== 'deepseek') return undefined;
  const apiKey = resolveEnvVar(cfg.credential);
  if (apiKey === undefined) return undefined;
  return makeSummarizer({
    complete: makeDeepSeekComplete({ apiKey, model: cfg.model }),
    recordCost,
  });
}

/** Resolve an env-var locator against `process.env`; other kinds ⇒ `undefined` (env-only for now). */
function resolveEnvVar(locator: Locator): string | undefined {
  if (locator.type !== 'env-var') return undefined;
  const value = process.env[locator.name];
  return value !== undefined && value !== '' ? value : undefined;
}

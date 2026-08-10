import { buildWebToolDeps, type WebConfig, type WebToolDeps } from '@coa/core';
import type { RuntimeUsage } from '@coa/spi';
import { buildFetchSummarizer } from './fetch-summarizer.js';

/**
 * Assemble the web tools' cooldown-aware provider chains from the user's key config,
 * resolving credentials against THIS process's environment, and wire the WebFetch
 * summarizer to the ledger recorder the daemon core hands in. Lives in the app
 * because it reads the environment and reaches a concrete backend through the
 * summarizer — the daemon core only asks for the finished deps.
 *
 * A summarizer credential that does not resolve yields no summarizer, which is the
 * raw-markdown floor: the chains are still built and WebFetch is still offered.
 */
export function buildWebTools(
  web: WebConfig,
  recordCost: (usage: RuntimeUsage) => void,
): WebToolDeps {
  const summarizer = buildFetchSummarizer(web, recordCost);
  return buildWebToolDeps(web, process.env, { ...(summarizer ? { summarizer } : {}) });
}

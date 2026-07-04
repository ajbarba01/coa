import { z } from 'zod';
import { homedir } from 'node:os';
import { locatorSchema, type Locator } from '@coa/shared';
import type {
  FetchProvider,
  RoutedFetch,
  SearchProvider,
  Summarizer,
  WebToolDeps,
} from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch } from './firecrawl.js';
import { makePlainFetch } from './plain-fetch.js';
import { runChain, nextLocalMidnight, type ChainEntry, type CooldownStore } from './routing.js';
import { KeyStateStore, locatorId } from './key-state-store.js';

/**
 * The web-egress config: the (increment-2) search provider + the fetch-routing block.
 * Reuses the shared account {@link Locator} (M0) for every credential pointer — one
 * credential-blind schema for the whole system. `.strip()` + Zod-validated at the edge.
 */
const firecrawlProviderSchema = z.object({
  kind: z.literal('firecrawl'),
  credentials: z.array(locatorSchema).default([]),
});

const fetchConfigSchema = z
  .object({
    providers: z.array(firecrawlProviderSchema).default([]),
    freeFloor: z.boolean().default(true),
    summarizer: z
      .object({
        provider: z.literal('deepseek'),
        model: z.string().min(1),
        credential: locatorSchema,
      })
      .optional(),
    quotaCooldown: z.union([z.literal('next-midnight'), z.number().positive()]).default('next-midnight'),
  })
  .strip();

export const webConfigSchema = z
  .object({
    // Search side (unrouted; increment 2 routes it). Optional so a fetch-only config validates.
    provider: z.enum(['parallel', 'exa', 'tavily', 'brave']).default('parallel'),
    credential: locatorSchema.optional(),
    // Fetch side (this increment): the routed provider chain + summarizer default.
    fetch: fetchConfigSchema.optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;
export type WebFetchConfig = z.infer<typeof fetchConfigSchema>;

/** Resolve an env-var locator; other locator kinds resolve to `undefined` (env-only for now). */
function resolveKey(locator: Locator, env: Record<string, string | undefined>): string | undefined {
  if (locator.type === 'env-var') {
    const value = env[locator.name];
    return value !== undefined && value !== '' ? value : undefined;
  }
  return undefined;
}

/** A no-op search provider — WebSearch stays registered but inert until a key is configured (SC-1). */
const NULL_SEARCH: SearchProvider = { search: async () => [] };

function buildSearch(config: WebConfig, env: Record<string, string | undefined>): SearchProvider {
  if (config.provider !== 'parallel' || config.credential === undefined) return NULL_SEARCH;
  const apiKey = resolveKey(config.credential, env);
  return apiKey !== undefined ? makeParallelSearch({ apiKey }) : NULL_SEARCH;
}

/**
 * Assemble the routed fetch chain: each resolvable Firecrawl credential becomes a
 * keyed hop (`firecrawl:<locatorId>`), in priority order, followed by the free
 * plain-fetch floor (default on). An unresolvable credential is simply absent from
 * the chain. The `quotaCooldown` config resolves the deadline for quota/ambiguous
 * limits (`'next-midnight'` or an explicit duration in ms).
 */
function buildFetchChain(
  fetchCfg: WebFetchConfig | undefined,
  env: Record<string, string | undefined>,
  store: CooldownStore,
  now: () => number,
): RoutedFetch {
  const providers: Array<{ provider: FetchProvider; keyStateId: string }> = [];
  for (const provider of fetchCfg?.providers ?? []) {
    for (const cred of provider.credentials) {
      const apiKey = resolveKey(cred, env);
      if (apiKey === undefined) continue;
      providers.push({
        provider: makeFirecrawlFetch({ apiKey }),
        keyStateId: `${provider.kind}:${locatorId(cred)}`,
      });
    }
  }
  const floor =
    (fetchCfg?.freeFloor ?? true)
      ? { provider: makePlainFetch(), keyStateId: 'plain-fetch:free' }
      : undefined;
  const quotaCooldownUntil = (n: number): number => {
    const q = fetchCfg?.quotaCooldown ?? 'next-midnight';
    return q === 'next-midnight' ? nextLocalMidnight(n) : n + q;
  };
  return (url) => {
    const entries: ChainEntry<string>[] = [
      ...providers.map((p) => ({ run: () => p.provider.fetch(url), keyStateId: p.keyStateId })),
      ...(floor ? [{ run: () => floor.provider.fetch(url), keyStateId: floor.keyStateId }] : []),
    ];
    return runChain(entries, store, now(), quotaCooldownUntil);
  };
}

/**
 * Build the pure-API web-tool ports from config. The fetch chain always exists (the
 * free floor guarantees it — D85), so this always returns a {@link WebToolDeps} when
 * a `web` block is configured; WebSearch degrades to an inert provider without a key.
 * The summarizer is injected by the caller (composed at the daemon root).
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
  opts?: { summarizer?: Summarizer; home?: string; now?: () => number; store?: CooldownStore },
): WebToolDeps {
  const store = opts?.store ?? new KeyStateStore(opts?.home ?? homedir());
  const now = opts?.now ?? ((): number => Date.now());
  return {
    search: buildSearch(config, env),
    fetchChain: buildFetchChain(config.fetch, env, store, now),
    ...(opts?.summarizer ? { summarizer: opts.summarizer } : {}),
  };
}

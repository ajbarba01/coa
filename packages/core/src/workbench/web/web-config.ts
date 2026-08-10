import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { locatorSchema, type Locator } from '@coa/shared';
import type {
  FetchProvider,
  RoutedFetch,
  RoutedSearch,
  SearchHit,
  SearchProvider,
  Summarizer,
  WebToolDeps,
} from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';
import { makeFirecrawlFetch, makeFirecrawlSearch } from './firecrawl.js';
import { makeTavilyFetch, makeTavilySearch } from './tavily.js';
import { makePlainFetch } from './plain-fetch.js';
import { runChain, nextLocalMidnight, type ChainEntry, type CooldownStore } from './routing.js';
import { KeyStateStore, locatorId } from './key-state-store.js';

/**
 * The web-egress config: the routed search chain + the routed fetch chain. Every
 * credential is the shared account {@link Locator} (M0) — one credential-blind
 * schema for the whole system. `.strip()` + Zod-validated at the edge.
 */
/** A web credential: the shared account Locator + an operator bench flag. A per-element
 *  union migrates old bare-Locator files (wrap → {locator, disabled:false}), drop-safe. */
export const webCredentialSchema = z.union([
  z.object({ locator: locatorSchema, disabled: z.boolean().default(false) }),
  locatorSchema.transform((locator) => ({ locator, disabled: false })),
]);
export type WebCredential = z.infer<typeof webCredentialSchema>;

const fetchProviderSchema = z.object({
  kind: z.enum(['firecrawl', 'tavily']),
  disabled: z.boolean().default(false),
  credentials: z.array(webCredentialSchema).default([]),
});

const fetchConfigSchema = z
  .object({
    providers: z.array(fetchProviderSchema).default([]),
    freeFloor: z.boolean().default(true),
    summarizer: z
      .object({
        provider: z.literal('deepseek'),
        model: z.string().min(1),
        credential: locatorSchema,
      })
      .optional(),
    quotaCooldown: z
      .union([z.literal('next-midnight'), z.number().positive()])
      .default('next-midnight'),
  })
  .strip();

const searchProviderSchema = z.object({
  kind: z.enum(['tavily', 'firecrawl', 'parallel']),
  disabled: z.boolean().default(false),
  credentials: z.array(webCredentialSchema).default([]),
});

const searchConfigSchema = z
  .object({
    providers: z.array(searchProviderSchema).default([]),
    quotaCooldown: z
      .union([z.literal('next-midnight'), z.number().positive()])
      .default('next-midnight'),
  })
  .strip();

export const webConfigSchema = z
  .object({
    search: searchConfigSchema.optional(),
    fetch: fetchConfigSchema.optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;
export type WebFetchConfig = z.infer<typeof fetchConfigSchema>;
export type WebSearchConfig = z.infer<typeof searchConfigSchema>;

/**
 * Resolve a credential locator to its secret — a POINTER, never a secret stored in
 * `web.yaml` (credential-blind): an `env-var` locator names the variable that holds
 * the key; a `key-file` locator names a coa-written 0600 file to read it from
 * (mirrors the DeepSeek `resolveApiKey`). `config-dir`/`ambient` resolve to
 * `undefined` (not a web-key kind). A missing var/file ⇒ `undefined` (the credential
 * is simply absent from the chain).
 */
function resolveKey(locator: Locator, env: Record<string, string | undefined>): string | undefined {
  if (locator.type === 'env-var') {
    const value = env[locator.name];
    return value !== undefined && value !== '' ? value : undefined;
  }
  if (locator.type === 'key-file') {
    try {
      const value = readFileSync(locator.path, 'utf8').trim();
      return value !== '' ? value : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Resolve a `'next-midnight'`-or-duration cooldown config into an absolute-deadline function. */
function quotaCooldown(cfg: 'next-midnight' | number | undefined): (now: number) => number {
  const q = cfg ?? 'next-midnight';
  return (n) => (q === 'next-midnight' ? nextLocalMidnight(n) : n + q);
}

/**
 * Assemble the routed fetch chain: each resolvable credential becomes a keyed hop
 * (`<kind>:<locatorId>`) in priority order, followed by the free plain-fetch floor
 * (default on). An unresolvable credential is simply absent from the chain.
 */
function buildFetchChain(
  fetchCfg: WebFetchConfig | undefined,
  env: Record<string, string | undefined>,
  store: CooldownStore,
  now: () => number,
): RoutedFetch {
  const providers: Array<{ provider: FetchProvider; keyStateId: string }> = [];
  for (const provider of fetchCfg?.providers ?? []) {
    if (provider.disabled) continue;
    for (const cred of provider.credentials) {
      if (cred.disabled) continue;
      const apiKey = resolveKey(cred.locator, env);
      if (apiKey === undefined) continue;
      providers.push({
        provider:
          provider.kind === 'tavily' ? makeTavilyFetch({ apiKey }) : makeFirecrawlFetch({ apiKey }),
        keyStateId: `${provider.kind}:${locatorId(cred.locator)}`,
      });
    }
  }
  const floor =
    (fetchCfg?.freeFloor ?? true)
      ? { provider: makePlainFetch(), keyStateId: 'plain-fetch:free' }
      : undefined;
  const until = quotaCooldown(fetchCfg?.quotaCooldown);
  return (url) => {
    const entries: ChainEntry<string>[] = [
      ...providers.map((p) => ({ run: () => p.provider.fetch(url), keyStateId: p.keyStateId })),
      ...(floor ? [{ run: () => floor.provider.fetch(url), keyStateId: floor.keyStateId }] : []),
    ];
    return runChain(entries, store, now(), until);
  };
}

/** Build one search adapter for a provider kind (credential-blind — the key is passed in). */
function makeSearchAdapter(
  kind: 'tavily' | 'firecrawl' | 'parallel',
  apiKey: string,
): SearchProvider {
  if (kind === 'tavily') return makeTavilySearch({ apiKey });
  if (kind === 'firecrawl') return makeFirecrawlSearch({ apiKey });
  return makeParallelSearch({ apiKey });
}

/**
 * Assemble the routed search chain: each resolvable credential becomes a keyed hop
 * in priority order. There is NO free floor for search (no free search backend), so
 * an empty or fully-exhausted chain resolves to `exhausted` and the handler returns
 * empty results (SC-1 / D85).
 */
function buildSearchChain(
  searchCfg: WebSearchConfig | undefined,
  env: Record<string, string | undefined>,
  store: CooldownStore,
  now: () => number,
): RoutedSearch {
  const providers: Array<{ provider: SearchProvider; keyStateId: string }> = [];
  for (const provider of searchCfg?.providers ?? []) {
    if (provider.disabled) continue;
    for (const cred of provider.credentials) {
      if (cred.disabled) continue;
      const apiKey = resolveKey(cred.locator, env);
      if (apiKey === undefined) continue;
      providers.push({
        provider: makeSearchAdapter(provider.kind, apiKey),
        keyStateId: `${provider.kind}:${locatorId(cred.locator)}`,
      });
    }
  }
  const until = quotaCooldown(searchCfg?.quotaCooldown);
  return (req) => {
    const entries: ChainEntry<readonly SearchHit[]>[] = providers.map((p) => ({
      run: () => p.provider.search(req),
      keyStateId: p.keyStateId,
    }));
    return runChain(entries, store, now(), until);
  };
}

/**
 * Build the pure-API web-tool ports from config. Both chains share one
 * {@link KeyStateStore}, so a key used for both search and fetch shares one cooldown.
 * Absent `web.search` ⇒ the search chain is empty ⇒ WebSearch returns empty results
 * (D85). The summarizer is injected by the caller (composed at the daemon root).
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
  opts?: { summarizer?: Summarizer; home?: string; now?: () => number; store?: CooldownStore },
): WebToolDeps {
  const store = opts?.store ?? new KeyStateStore(opts?.home ?? homedir());
  const now = opts?.now ?? ((): number => Date.now());
  return {
    searchChain: buildSearchChain(config.search, env, store, now),
    fetchChain: buildFetchChain(config.fetch, env, store, now),
    ...(opts?.summarizer ? { summarizer: opts.summarizer } : {}),
  };
}

import { z } from 'zod';
import type { ToolResponse } from '@coa/shared';
import { wrap } from './base-tools.js';
import { spec, type ToolSpec, type GovernedToolDeps } from './governed-tools.js';
import type { ToolManifestEntry } from './catalogue.js';
import type { ProviderOutcome, ChainResult } from './web/routing.js';

/**
 * The pure-API web tools (WebSearch/WebFetch). coa supplies these only on the
 * owned-adapter path — Claude gets equivalents server-side. They are egress tools:
 * they never touch the worktree and never emit a change-event. Every handler obeys
 * SC-1 — a provider error or dead URL comes back as an unapplied result, never a throw.
 */

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** The neutral search request the routed search providers accept. */
export interface SearchRequest {
  query: string;
  allowedDomains?: readonly string[];
  blockedDomains?: readonly string[];
  maxResults?: number;
}

/** A routed search provider — a keyed hop in the {@link RoutedSearch} chain (no-lock-in seam). */
export interface SearchProvider {
  search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>>;
}

/** The assembled, cooldown-aware search chain the WebSearch handler runs (built in web-config). */
export type RoutedSearch = (req: SearchRequest) => Promise<ChainResult<readonly SearchHit[]>>;

export type WebSearchResult =
  | { results: readonly SearchHit[] }
  | { results: readonly []; reason: string };

/** `WebSearch` — mirrors Claude's args (query + optional domain filters). Runs the routed chain. */
export async function webSearch(
  req: {
    query: string;
    allowed_domains?: readonly string[] | undefined;
    blocked_domains?: readonly string[] | undefined;
  },
  deps: { searchChain: RoutedSearch },
): Promise<ToolResponse<WebSearchResult>> {
  const result = await deps.searchChain({
    query: req.query,
    ...(req.allowed_domains ? { allowedDomains: req.allowed_domains } : {}),
    ...(req.blocked_domains ? { blockedDomains: req.blocked_domains } : {}),
  });
  if (result.status === 'ok') {
    return wrap({ results: result.value }, `web_search:${req.query}`, req.query);
  }
  return wrap(
    { results: [], reason: result.lastReason ?? 'no-search-provider' },
    `web_search:error:${req.query}`,
    req.query,
  );
}

/** The optional page-summarizer (a stripped model call). Absent ⇒ raw-markdown mode (D85). */
export interface Summarizer {
  summarize(req: { markdown: string; prompt: string }): Promise<string>;
}

/** A routed fetch provider — a keyed hop in the {@link RoutedFetch} chain (no-lock-in seam). */
export interface FetchProvider {
  fetch(url: string): Promise<ProviderOutcome<string>>;
}

/** The assembled, cooldown-aware fetch chain the WebFetch handler runs (built in web-config). */
export type RoutedFetch = (url: string) => Promise<ChainResult<string>>;

export type WebFetchResult =
  | { fetched: true; content: string; summarized: boolean }
  | { fetched: false; reason: string };

const DEFAULT_MAX_CHARS = 100_000;

/**
 * `WebFetch` — mirrors Claude's args (url + prompt). Runs the routed {@link RoutedFetch}
 * chain, then: on `exhausted` (only possible with the free floor off) → an SC-1 unapplied
 * result; on `ok` clean content (Firecrawl) → return as-is, SKIPPING the summarizer; on `ok`
 * non-clean content (free floor) → summarize if configured, else the capped markdown. The
 * up-front `maxChars` cap bounds both the summarizer input and the returned markdown (SC-1).
 */
export async function webFetch(
  req: { url: string; prompt: string },
  deps: { fetchChain: RoutedFetch; summarizer?: Summarizer; maxChars?: number },
): Promise<ToolResponse<WebFetchResult>> {
  const result = await deps.fetchChain(req.url);
  if (result.status === 'exhausted') {
    return wrap(
      { fetched: false, reason: result.lastReason ?? 'no-provider-succeeded' },
      'web_fetch:error',
      req.url,
    );
  }
  const cap = deps.maxChars ?? DEFAULT_MAX_CHARS;
  const markdown = result.value.slice(0, cap);
  if (!result.clean && deps.summarizer) {
    try {
      const content = await deps.summarizer.summarize({ markdown, prompt: req.prompt });
      return wrap({ fetched: true, content, summarized: true }, `web_fetch:${req.url}`, req.url);
    } catch {
      // Summarizer failure degrades to raw markdown rather than failing the fetch (D85 / SC-1).
    }
  }
  return wrap(
    { fetched: true, content: markdown, summarized: false },
    `web_fetch:${req.url}`,
    req.url,
  );
}

/** The pure-API web-tool ports; present only when the adapter wires egress. */
export interface WebToolDeps {
  searchChain: RoutedSearch;
  fetchChain: RoutedFetch;
  summarizer?: Summarizer;
}

/** Always-loaded (kernel) egress tools, supplied only on the pure-API path. */
export const WEB_TOOL_CATALOGUE: readonly ToolManifestEntry[] = [
  { name: 'WebSearch', partition: 'kernel', group: 'egress', description: 'search the web' },
  {
    name: 'WebFetch',
    partition: 'kernel',
    group: 'egress',
    description: 'fetch a URL and optionally summarize it',
  },
];

/**
 * The web-tool dispatch table for {@link buildGovernedTools}, keyed by tool name.
 * Each spec dispatches into the injected {@link WebToolDeps} (asserted present by
 * `buildGovernedTools` when `includeWebTools` is set).
 */
export function webToolSpecs(): Record<string, ToolSpec> {
  const w = (deps: { web?: WebToolDeps }): WebToolDeps => {
    if (deps.web === undefined) throw new Error('web tools require GovernedToolDeps.web');
    return deps.web;
  };
  return {
    WebSearch: spec(
      {
        query: z.string(),
        allowed_domains: z.array(z.string()).optional(),
        blocked_domains: z.array(z.string()).optional(),
      },
      (a, d: GovernedToolDeps) => webSearch(a, { searchChain: w(d).searchChain }),
    ),
    WebFetch: spec({ url: z.string(), prompt: z.string() }, (a, d: GovernedToolDeps) => {
      const wd = w(d);
      return webFetch(a, {
        fetchChain: wd.fetchChain,
        ...(wd.summarizer ? { summarizer: wd.summarizer } : {}),
      });
    }),
  };
}

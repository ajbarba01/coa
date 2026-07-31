import { z } from 'zod';
import type { FetchProvider, SearchHit, SearchRequest } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';
import { tavilyLimit } from './limits.js';

/**
 * The Tavily adapters (search + extract) — thin HTTP over `api.tavily.com`, each
 * mapping the response to a {@link ProviderOutcome}: 429 → rate-limit, 432/433 →
 * quota, 401 → error (a bad key — no cooldown), other non-ok → error. Injectable
 * `fetchImpl`; credential-blind (the key is passed in). Never throws (SC-1).
 * Exports both the extract (`makeTavilyFetch`) and search (`makeTavilySearch`) adapters.
 */
const DEFAULT_BASE_URL = 'https://api.tavily.com';

const tavilyExtractResponseSchema = z.object({
  results: z.array(z.object({ raw_content: z.string() })).default([]),
});

const tavilySearchResponseSchema = z.object({
  results: z
    .array(
      z.object({ title: z.string().default(''), url: z.string(), content: z.string().default('') }),
    )
    .default([]),
});

export function makeTavilyFetch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): FetchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(`${baseUrl}/extract`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ urls: [url], format: 'markdown' }),
        });
        const limit = tavilyLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `tavily-http-${res.status}` };
        const parsed = tavilyExtractResponseSchema.safeParse(await res.json());
        const markdown = parsed.success ? parsed.data.results[0]?.raw_content : undefined;
        if (markdown === undefined || markdown === '') {
          return { status: 'error', reason: 'tavily-extract-empty' };
        }
        return { status: 'ok', value: markdown, clean: true };
      } catch (err) {
        return { status: 'error', reason: `tavily-throw: ${String(err)}` };
      }
    },
  };
}

/** Tavily Search adapter (`POST /search`) → a routed search hop. Success → hits; limits per {@link tavilyLimit}. */
export function makeTavilySearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> } {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(`${baseUrl}/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            query: req.query,
            max_results: req.maxResults ?? 5,
            ...(req.allowedDomains ? { include_domains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { exclude_domains: req.blockedDomains } : {}),
          }),
        });
        const limit = tavilyLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `tavily-http-${res.status}` };
        const parsed = tavilySearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'tavily-malformed' };
        const value = parsed.data.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `tavily-throw: ${String(err)}` };
      }
    },
  };
}

import { z } from 'zod';
import type { FetchProvider, SearchHit, SearchRequest } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';
import { firecrawlLimit } from './limits.js';

/**
 * The Firecrawl scrape adapter — a thin HTTP call to `POST /v2/scrape`, mapping the
 * response to a {@link ProviderOutcome}: a 200 → clean markdown; a 429 → rate-limit
 * (reading `Retry-After` seconds if present); a 402 → quota; anything else → error.
 * Injectable `fetchImpl`; credential-blind (the key is passed in). Never throws (SC-1).
 */
const DEFAULT_BASE_URL = 'https://api.firecrawl.dev';

const firecrawlResponseSchema = z.object({
  success: z.boolean().default(false),
  data: z.object({ markdown: z.string() }).partial().optional(),
});

const firecrawlSearchResponseSchema = z.object({
  success: z.boolean().default(false),
  data: z
    .object({
      web: z
        .array(
          z.object({
            title: z.string().default(''),
            url: z.string(),
            description: z.string().default(''),
          }),
        )
        .default([]),
    })
    .optional(),
});

export function makeFirecrawlFetch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): FetchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(`${baseUrl}/v2/scrape`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({ url, formats: ['markdown'] }),
        });
        const limit = firecrawlLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `firecrawl-http-${res.status}` };
        const parsed = firecrawlResponseSchema.safeParse(await res.json());
        const markdown = parsed.success ? parsed.data.data?.markdown : undefined;
        if (markdown === undefined || markdown === '') {
          return { status: 'error', reason: 'firecrawl-empty-body' };
        }
        return { status: 'ok', value: markdown, clean: true };
      } catch (err) {
        return { status: 'error', reason: `firecrawl-throw: ${String(err)}` };
      }
    },
  };
}

/** Firecrawl Search adapter (`POST /v2/search`) → a routed search hop. Success → hits; limits per {@link firecrawlLimit}. */
export function makeFirecrawlSearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): { search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> } {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(`${baseUrl}/v2/search`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            query: req.query,
            limit: req.maxResults ?? 10,
            sources: [{ type: 'web' }],
            ...(req.allowedDomains ? { includeDomains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { excludeDomains: req.blockedDomains } : {}),
          }),
        });
        const limit = firecrawlLimit(res.status, res.headers);
        if (limit !== undefined) return { status: 'limit', ...limit };
        if (!res.ok) return { status: 'error', reason: `firecrawl-http-${res.status}` };
        const parsed = firecrawlSearchResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'firecrawl-search-malformed' };
        const value = (parsed.data.data?.web ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.description,
        }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `firecrawl-search-throw: ${String(err)}` };
      }
    },
  };
}

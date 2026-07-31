import { z } from 'zod';
import type { SearchHit, SearchProvider, SearchRequest } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

const DEFAULT_BASE_URL = 'https://api.parallel.ai/v1beta/search';

// NOTE: Parallel.ai field names (objective, max_results, include_domains, exclude_domains)
// are provisional and will be validated at the live smoke against the actual API docs.
const parallelResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().default(''),
        url: z.string(),
        excerpts: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

/**
 * Parallel.ai Search adapter — a routed search hop. Parallel does not publish
 * rate-limit codes, so it never emits `limit` (a non-2xx or a malformed body →
 * `error`, and the chain falls through to the next hop). Injectable `fetchImpl`.
 */
export function makeParallelSearch(config: {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): SearchProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  return {
    async search(req: SearchRequest): Promise<ProviderOutcome<readonly SearchHit[]>> {
      try {
        const res = await doFetch(baseUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey },
          body: JSON.stringify({
            objective: req.query,
            max_results: req.maxResults ?? 10,
            ...(req.allowedDomains ? { include_domains: req.allowedDomains } : {}),
            ...(req.blockedDomains ? { exclude_domains: req.blockedDomains } : {}),
          }),
        });
        if (!res.ok) return { status: 'error', reason: `parallel-http-${res.status}` };
        const parsed = parallelResponseSchema.safeParse(await res.json());
        if (!parsed.success) return { status: 'error', reason: 'parallel-malformed' };
        const value = parsed.data.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.excerpts.join('\n'),
        }));
        return { status: 'ok', value, clean: true };
      } catch (err) {
        return { status: 'error', reason: `parallel-throw: ${String(err)}` };
      }
    },
  };
}

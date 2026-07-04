import { z } from 'zod';
import type { FetchProvider } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

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
        if (res.status === 429) {
          const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          return { status: 'limit', kind: 'rate-limit', ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) };
        }
        if (res.status === 402) return { status: 'limit', kind: 'quota' };
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

/** Parse a `Retry-After` header (delta-seconds) into milliseconds; `null`/invalid ⇒ `undefined`. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}

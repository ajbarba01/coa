import TurndownService from 'turndown';
import type { FetchProvider } from '../web-tools.js';
import type { ProviderOutcome } from './routing.js';

/**
 * The free plain-fetch floor: global `fetch` + turndown, repackaged as a
 * {@link FetchProvider}. This is the always-last hop, so WebFetch can never fully
 * fail. It returns `clean: false` (the summarizer runs over it) and NEVER a
 * `limit` — an unkeyed public fetch has no quota to trip. Never throws.
 */
const turndownService = new TurndownService();

export function makePlainFetch(deps?: {
  fetchImpl?: typeof fetch;
  htmlToMarkdown?: (html: string) => string;
}): FetchProvider {
  const doFetch = deps?.fetchImpl ?? fetch;
  const toMarkdown = deps?.htmlToMarkdown ?? ((html) => turndownService.turndown(html));
  return {
    async fetch(url): Promise<ProviderOutcome<string>> {
      try {
        const res = await doFetch(url);
        if (!res.ok) return { status: 'error', reason: `http-${res.status}` };
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('html') && !contentType.includes('text/plain')) {
          return { status: 'error', reason: `unsupported-content-type: ${contentType}` };
        }
        return { status: 'ok', value: toMarkdown(await res.text()), clean: false };
      } catch (err) {
        return { status: 'error', reason: `fetch-failed: ${String(err)}` };
      }
    },
  };
}

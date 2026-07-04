import { z } from 'zod';
import TurndownService from 'turndown';
import { locatorSchema, type Locator } from '@coa/shared';
import type { WebToolDeps } from '../web-tools.js';
import { makeParallelSearch } from './parallel.js';

/**
 * The web-egress config block: which search provider, and the credential-blind
 * pointer to its key. Reuses the shared account {@link Locator} (M0) rather than
 * a local shape — one credential-pointer schema for the whole system.
 */
export const webConfigSchema = z
  .object({
    provider: z.enum(['parallel', 'exa', 'tavily', 'brave']).default('parallel'),
    credential: locatorSchema,
    // Forward hook: not yet wired. The summarizer is injected via opts.summarizer; the daemon does not yet compose one.
    summarizerModel: z.object({ provider: z.string(), model: z.string() }).optional(),
  })
  .strip();

export type WebConfig = z.infer<typeof webConfigSchema>;

/**
 * Resolve the search-provider API key from the config's locator. Only `env-var`
 * is resolved here (env-only, per the current scope); `key-file`/`config-dir`/
 * `ambient` resolve to `undefined` (unsupported-for-now) rather than pulling in
 * an extra dependency — `buildWebToolDeps` degrades to "tools not offered" (D85).
 */
function resolveKey(locator: Locator, env: Record<string, string | undefined>): string | undefined {
  if (locator.type === 'env-var') {
    const value = env[locator.name];
    return value !== undefined && value !== '' ? value : undefined;
  }
  return undefined;
}

/**
 * Build the pure-API web-tool ports from config, or `undefined` when no search
 * key resolves or the provider isn't wired yet — in which case `WebSearch`/
 * `WebFetch` are simply not offered (strict-superset D85). Only `parallel` is
 * wired at launch. The summarizer is optional and injected by the caller (the
 * daemon composition root does not construct one — D85 raw-markdown floor).
 */
export function buildWebToolDeps(
  config: WebConfig,
  env: Record<string, string | undefined>,
  opts?: { summarizer?: WebToolDeps['summarizer'] },
): WebToolDeps | undefined {
  if (config.provider !== 'parallel') return undefined;
  const apiKey = resolveKey(config.credential, env);
  if (!apiKey) return undefined;
  return {
    search: makeParallelSearch({ apiKey }),
    fetch: fetchAdapter,
    htmlToMarkdown: htmlToMarkdownAdapter,
    ...(opts?.summarizer ? { summarizer: opts.summarizer } : {}),
  };
}

/** `FetchLike` over the global `fetch` — maps a `Response` to the injectable shape. */
const fetchAdapter: WebToolDeps['fetch'] = async (url) => {
  const res = await fetch(url);
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: await res.text(),
  };
};

/** `HtmlToMarkdown` backed by `turndown` (one shared service instance). */
const turndownService = new TurndownService();
const htmlToMarkdownAdapter: WebToolDeps['htmlToMarkdown'] = (html) => turndownService.turndown(html);

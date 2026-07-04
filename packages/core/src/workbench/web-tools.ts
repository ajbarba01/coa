import { z } from 'zod';
import type { ToolResponse } from '@coa/shared';
import { wrap } from './base-tools.js';
import { spec, type ToolSpec, type GovernedToolDeps } from './governed-tools.js';
import type { ToolManifestEntry } from './catalogue.js';

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

/** The swappable search backend (no-lock-in seam). Default adapter: Parallel.ai. */
export interface SearchProvider {
  search(req: {
    query: string;
    allowedDomains?: readonly string[];
    blockedDomains?: readonly string[];
    maxResults?: number;
  }): Promise<readonly SearchHit[]>;
}

export type WebSearchResult =
  | { results: readonly SearchHit[] }
  | { results: readonly []; reason: string };

/** `WebSearch` — mirrors Claude's args (query + optional domain filters). */
export async function webSearch(
  req: {
    query: string;
    allowed_domains?: readonly string[] | undefined;
    blocked_domains?: readonly string[] | undefined;
  },
  deps: { search: SearchProvider },
): Promise<ToolResponse<WebSearchResult>> {
  try {
    const results = await deps.search.search({
      query: req.query,
      ...(req.allowed_domains ? { allowedDomains: req.allowed_domains } : {}),
      ...(req.blocked_domains ? { blockedDomains: req.blocked_domains } : {}),
    });
    return wrap({ results }, `web_search:${req.query}`, req.query);
  } catch (err) {
    return wrap({ results: [], reason: String(err) }, `web_search:error:${req.query}`, req.query);
  }
}

/** A minimal fetch surface (injectable so handlers are unit-testable with no network). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}>;

/** HTML→markdown conversion (injected; the concrete lib is chosen at the wiring layer). */
export type HtmlToMarkdown = (html: string) => string;

/** The optional page-summarizer (a stripped model call). Absent ⇒ raw-markdown mode (D85). */
export interface Summarizer {
  summarize(req: { markdown: string; prompt: string }): Promise<string>;
}

export type WebFetchResult =
  | { fetched: true; content: string; summarized: boolean }
  | { fetched: false; reason: string };

const DEFAULT_MAX_CHARS = 100_000;

/** `WebFetch` — mirrors Claude's args (url + prompt). Fetch → HTML→markdown → optional summarize. */
export async function webFetch(
  req: { url: string; prompt: string },
  deps: { fetch: FetchLike; htmlToMarkdown: HtmlToMarkdown; summarizer?: Summarizer; maxChars?: number },
): Promise<ToolResponse<WebFetchResult>> {
  let resp: Awaited<ReturnType<FetchLike>>;
  try {
    resp = await deps.fetch(req.url);
  } catch (err) {
    return wrap({ fetched: false, reason: `fetch-failed: ${String(err)}` }, 'web_fetch:error', req.url);
  }
  if (!resp.ok) return wrap({ fetched: false, reason: `http-${resp.status}` }, 'web_fetch:error', req.url);
  if (!resp.contentType.includes('html') && !resp.contentType.includes('text/plain')) {
    return wrap({ fetched: false, reason: `unsupported-content-type: ${resp.contentType}` }, 'web_fetch:error', req.url);
  }
  // Cap once, up front, so the SC-1 oversized-body bound applies to BOTH the summarizer
  // input and the raw-markdown fallback (not just the fallback).
  const cap = deps.maxChars ?? DEFAULT_MAX_CHARS;
  const markdown = deps.htmlToMarkdown(resp.body).slice(0, cap);
  if (deps.summarizer) {
    try {
      const content = await deps.summarizer.summarize({ markdown, prompt: req.prompt });
      return wrap({ fetched: true, content, summarized: true }, `web_fetch:${req.url}`, req.url);
    } catch {
      // Summarizer failure degrades to raw markdown rather than failing the fetch (D85 / SC-1).
    }
  }
  return wrap({ fetched: true, content: markdown, summarized: false }, `web_fetch:${req.url}`, req.url);
}

/** The pure-API web-tool ports; present only when the adapter wires egress. */
export interface WebToolDeps {
  search: SearchProvider;
  fetch: FetchLike;
  htmlToMarkdown: HtmlToMarkdown;
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
      (a, d: GovernedToolDeps) => webSearch(a, { search: w(d).search }),
    ),
    WebFetch: spec({ url: z.string(), prompt: z.string() }, (a, d: GovernedToolDeps) => {
      const wd = w(d);
      return webFetch(a, {
        fetch: wd.fetch,
        htmlToMarkdown: wd.htmlToMarkdown,
        ...(wd.summarizer ? { summarizer: wd.summarizer } : {}),
      });
    }),
  };
}

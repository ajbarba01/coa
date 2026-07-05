import type {
  GetPieceResult,
  GetSymbolResult,
  OutlineResult,
  ReferencesResult,
} from './retrieve.js';
import type { MutateResult } from './mutate.js';
import type { GetDecisionResult, GetSpecResult, WhyResult } from './inspect.js';
import type { CoaError, FeedView, SymbolRecord } from '@coa/shared';

/**
 * The base-tool result shapes, mirrored structurally here rather than imported from
 * `./base-tools.js` — that module imports back through `governed-tools.js`, so importing
 * it (even type-only, since depcruise tracks pre-compilation deps) would close a cycle.
 * These are pure shape mirrors of `base-tools.ts` result types (kept in lockstep).
 */
type ReadResult = { found: boolean; content?: string; reason?: string };
type GlobResult = { matches: readonly string[] };
type GrepResult = { hits: readonly { file: string; line?: number; text?: string }[] };
type WriteResult =
  | { applied: true; path: string; seq: number; created: boolean }
  | { applied: false; error: CoaError };
type ExecResult = { stdout: string; stderr: string; exitCode: number };
type SearchHit = { title: string; url: string; snippet: string };
type WebSearchResult =
  | { results: readonly SearchHit[] }
  | { results: readonly []; reason: string };
type WebFetchResult =
  | { fetched: true; content: string; summarized: boolean }
  | { fetched: false; reason: string };

/**
 * The per-tool result → display-text renderer for the pure-API loop. A rented SDK
 * backend (Claude) already emits a human-readable result text on its `tool_result`
 * frame; a thin pure-API backend (DeepSeek) only has coa's structured
 * {@link ToolResponse} `result`, so without this the loop would surface the terse
 * `pointer` (often just the tool's INPUT) instead of the real output. This renders
 * each governed tool's result to the same shape the console showcase specifies, and
 * the driver uses that text for BOTH the emitted frame's pointer (what the console
 * shows) and the model's tool-message content (so the model reads a clean result).
 *
 * Every renderer is pure and total: an unrecognized shape or an unmapped tool falls
 * back to a verbatim JSON dump (SC-1/D128 — never throw, never lose data).
 */

type Renderer = (result: unknown) => string;

/** Per-tool renderers, keyed by the catalogue tool name. */
const RENDERERS: Record<string, Renderer> = {
  // --- base tools ---
  Read: (r) => renderRead(r as ReadResult),
  Glob: (r) => renderLines((r as GlobResult).matches, ''),
  Grep: (r) => renderGrep(r as GrepResult),
  WebSearch: (r) => renderWebSearch(r as WebSearchResult),
  WebFetch: (r) => renderWebFetch(r as WebFetchResult),
  Write: (r) => renderWrite(r as WriteResult, 'file'),
  Edit: (r) => renderWrite(r as WriteResult, 'edit'),
  Bash: (r) => renderBash(r as ExecResult),
  // --- governed tools ---
  get_symbol: (r) => renderGetSymbol(r as GetSymbolResult),
  get_piece: (r) => renderGetPiece(r as GetPieceResult),
  get_spec: (r) => renderGetSpec(r as GetSpecResult),
  edit_symbol: (r) => renderMutate(r as MutateResult),
  apply_patch: (r) => renderMutate(r as MutateResult),
  run_checks: (r) => renderChecks(r as FeedView),
  why: (r) => renderWhy(r as WhyResult),
  get_decision: (r) => renderDecision(r as GetDecisionResult),
  find_references: (r) => renderReferences(r as ReferencesResult),
  outline: (r) => renderOutline(r as OutlineResult),
};

/**
 * Render one governed tool's result to human-readable display text. Any unmapped
 * tool — or a renderer that hits an unexpected shape — degrades to a verbatim JSON
 * dump. Never throws (SC-1); the driver caps the returned text for the transcript.
 */
export function renderToolResult(tool: string, result: unknown): string {
  const renderer = RENDERERS[tool];
  if (renderer === undefined) return jsonFallback(result);
  try {
    return renderer(result);
  } catch {
    return jsonFallback(result);
  }
}

/**
 * The per-tool success predicate for the pure-API loop's `tool_result` frame — the
 * sibling of {@link renderToolResult}, sharing the same result-shape knowledge. A pure-API
 * backend has no SDK-provided error signal, so the console derives ✗-vs-✓ (and the always-
 * visible red error body) from coa's structured result here. Pure and total (SC-1): an
 * unmapped tool or an unrecognized shape returns `true` — a well-formed result is presumed
 * fine, never falsely flagged failed. An empty search/reference result is NOT a failure
 * (mapped to `true`); only an unsuccessful operation (not-found, unapplied, non-zero exit,
 * fetch failure) is `false`.
 */
const OK_PREDICATES: Record<string, (result: unknown) => boolean> = {
  // --- base tools ---
  Read: (r) => okBool(r, 'found'),
  Write: (r) => okBool(r, 'applied'),
  Edit: (r) => okBool(r, 'applied'),
  Bash: (r) => okExec(r),
  // Glob/Grep: an empty match set is not an error.
  // --- governed tools ---
  get_symbol: (r) => okBool(r, 'found'),
  get_piece: (r) => okBool(r, 'found'),
  get_spec: (r) => okField(r, 'spec'),
  get_decision: (r) => okBool(r, 'found'),
  edit_symbol: (r) => okBool(r, 'applied'),
  apply_patch: (r) => okBool(r, 'applied'),
  WebFetch: (r) => okBool(r, 'fetched'),
  // WebSearch: empty results is not an error (default true).
};

/**
 * Whether a tool's structured result represents a success. Unmapped tools and any result
 * whose shape doesn't match the expected predicate degrade to `true` (never throws, never
 * falsely fails a well-formed result). Used by the loop driver to set the `tool_result`
 * frame's `ok` and populated onto {@link RegisteredTool.ok} in `governed-tools`.
 */
export function toolResultOk(tool: string, result: unknown): boolean {
  const predicate = OK_PREDICATES[tool];
  if (predicate === undefined) return true;
  try {
    return predicate(result);
  } catch {
    return true;
  }
}

/** A record with a boolean-ish `key` reads `true`; a non-record or wrong shape ⇒ true (unknown ⇒ ok). */
function okBool(result: unknown, key: string): boolean {
  if (typeof result !== 'object' || result === null) return true;
  const v = (result as Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : true;
}

/** A record whose `key` is a non-null value is a success (e.g. `get_spec.spec !== null`). */
function okField(result: unknown, key: string): boolean {
  if (typeof result !== 'object' || result === null) return true;
  const v = (result as Record<string, unknown>)[key];
  return v !== null && v !== undefined;
}

/** An ExecResult is a success iff its exit code is 0; a non-numeric shape ⇒ true. */
function okExec(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return true;
  const code = (result as Record<string, unknown>)['exitCode'];
  return typeof code === 'number' ? code === 0 : true;
}

/** The verbatim floor: `JSON.stringify`, safe against circular/non-serializable results. */
function jsonFallback(result: unknown): string {
  try {
    return JSON.stringify(result) ?? String(result);
  } catch {
    return '[coa: unrenderable tool result]';
  }
}

// --- base-tool renderers ---

function renderRead(r: ReadResult): string {
  if (r.found && r.content !== undefined) return r.content;
  return r.reason !== undefined ? `not found: ${r.reason}` : 'not found';
}

function renderGrep(r: GrepResult): string {
  const lines = r.hits.map((hit) => {
    let out = hit.file;
    if (hit.line !== undefined) out += `:${hit.line}`;
    if (hit.text !== undefined) out += `:${hit.text}`;
    return out;
  });
  return renderLines(lines, '');
}

/** WebSearch — each hit as `title — url` (with the snippet on the next line when present),
 *  one block per line. Empty results ⇒ the reason (or ''); the header already shows the count. */
function renderWebSearch(r: WebSearchResult): string {
  if (r.results.length === 0) return 'reason' in r ? r.reason : '';
  return r.results
    .map((hit) => {
      const head = `${hit.title} — ${hit.url}`;
      return hit.snippet.length > 0 ? `${head}\n${hit.snippet}` : head;
    })
    .join('\n');
}

/** WebFetch — the fetched page content, or the failure reason (SC-1: a dead URL is surfaced). */
function renderWebFetch(r: WebFetchResult): string {
  return r.fetched ? r.content : r.reason;
}

function renderWrite(r: WriteResult, kind: 'file' | 'edit'): string {
  if (!r.applied) return r.error.message;
  return kind === 'file' ? `Wrote ${r.path}` : `Applied 1 edit to ${r.path}`;
}

function renderBash(r: ExecResult): string {
  const parts = [r.stdout, r.stderr].filter((s) => s.length > 0);
  if (r.exitCode !== 0) parts.push(`Exit code: ${r.exitCode}`);
  return parts.join('\n');
}

// --- governed-tool renderers ---

function renderGetSymbol(r: GetSymbolResult): string {
  if (!r.found) return r.reason !== undefined ? `not found: ${r.reason}` : 'not found';
  const s = r.symbol;
  return `${s.signature ?? s.name}\n— ${s.definedIn}`;
}

function renderGetPiece(r: GetPieceResult): string {
  return r.found ? r.piece.body : 'not found';
}

function renderGetSpec(r: GetSpecResult): string {
  return r.spec !== null ? r.spec : `no governing spec for ${r.ref}`;
}

function renderMutate(r: MutateResult): string {
  return r.applied ? `applied · seq ${r.seq}` : r.error.message;
}

function renderChecks(r: FeedView): string {
  const collapsed = r.collapsed.reduce((sum, group) => sum + group.count, 0);
  const total = r.expanded.length + collapsed;
  if (total === 0) return '0 flags';
  if (collapsed === 0) return `${total} flags`;
  return `${total} flags (${r.expanded.length} shown, ${collapsed} collapsed)`;
}

function renderWhy(r: WhyResult): string {
  if (r.decisions.length === 0) return `no recorded rationale for ${r.target}`;
  return renderLines(r.decisions.map((d) => d.entry), '');
}

function renderDecision(r: GetDecisionResult): string {
  if (!r.found) return 'not found';
  const d = r.decision;
  return `#${d.id} ${d.target}: ${d.entry}`;
}

function renderReferences(r: ReferencesResult): string {
  return renderLines(r.sites, `no references to ${r.symbol}`);
}

function renderOutline(r: OutlineResult): string {
  return renderLines(
    r.symbols.map((s: SymbolRecord) => s.signature ?? s.name),
    `no symbols in ${r.path}`,
  );
}

/** Join a list one-per-line, substituting a message when the list is empty. */
function renderLines(items: readonly string[], empty: string): string {
  return items.length === 0 ? empty : items.join('\n');
}

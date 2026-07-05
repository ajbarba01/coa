// packages/console-ui/src/dense/ToolCard.tsx
import { Check, Loader2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import { usePaneOverlay } from '../layout/PaneOverlay.js';
import { describeTool, toolTarget } from './toolRegistry.js';
import { diffLines } from './toolDiff.js';
import { estimateTokens, formatTokens } from './tokenEstimate.js';
import { languageForPath } from './pathLanguage.js';
import { clampLines } from './clampLines.js';
import { markErrors } from './errorMarks.js';
import { parseMatchLine } from './matchLines.js';
import { RunChecks } from './runChecks.js';
import { ToolDiffView } from './ToolDiffView.js';
import { SyntaxText } from './syntaxTheme.js';

export interface ToolCardProps {
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
  /** Reveal the touched file (file/symbol tools) in the editor/OS at an optional line.
   *  Path is plain text when omitted. */
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  /** Open a web URL (WebSearch result links, a WebFetch source) in the default browser.
   *  URLs are plain text when omitted. */
  onOpenUrl?: ((url: string) => void) | undefined;
  /** Max body lines before truncation + Expand. Default 14. */
  maxLines?: number | undefined;
}

/** The egress tools whose bodies/headers carry clickable web links (not file paths). */
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);

/** Tools whose output is source we highlight in the preview body (like `Read`): the
 *  symbol/piece/spec fetchers, keyed on the language of their ref path. */
const PREVIEW_LANG_TOOLS = new Set(['Read', 'get_symbol', 'get_piece', 'get_spec']);

/** Read/search/fetch tools whose body is collapsed by default — the card shows only its
 *  header + an Expand control, and the (often long, rarely-needed) output opens on demand
 *  in the overlay. Edits/writes/commands still show their diff/output inline. */
const COLLAPSED_TOOLS = new Set(['Read', 'Grep', 'Glob', 'get_symbol', 'get_piece']);

/** The rich tool card: a titled header (icon · verb · clickable path · summary · ≈tok ·
 *  status) over a body that leads with a highlighted byte-faithful diff (edits/writes), a
 *  highlighted read preview, or a plain command-output tail — clamped to maxLines, with
 *  Expand opening the full body in the pane overlay (or inline when no provider). */
export function ToolCard({
  tool,
  input,
  output,
  ok,
  onOpenPath,
  onOpenUrl,
  maxLines = 14,
}: ToolCardProps): React.JSX.Element {
  const overlay = usePaneOverlay();
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const { icon: Icon, verb, summary } = describeTool(tool, input, output, ok);
  const target = toolTarget(tool, input);
  const path = target?.path;
  // WebFetch's source URL comes from its INPUT `url` — surfaced as a clickable header link
  // (the file-path slot has no meaning for an egress tool).
  const webUrl = tool === 'WebFetch' ? webUrlOf(input) : undefined;
  const line = target?.line;
  const linkLabel =
    path !== undefined ? `${path}${line !== undefined ? `:${line}` : ''}` : undefined;
  const language = path !== undefined ? languageForPath(path) : undefined;
  const running = output === undefined && ok === undefined;
  // The detail shown after the path link. When the summary EXTENDS the path (file tools:
  // a `:range` for reads, a `+N −M` stat for edits) it's the tail past the path — a bare
  // `:line` restatement of the link's line is suppressed. When the summary is DISJOINT
  // from the path (symbol/piece tools, whose summary is the ref/symbol name the file path
  // doesn't contain) it's surfaced whole as a ` · spec`, so the title says more than the
  // file alone.
  let extra = '';
  if (path !== undefined && summary.length > 0) {
    if (summary.startsWith(path)) {
      const tail = summary.slice(path.length);
      extra = line !== undefined && tail.startsWith(':') ? '' : tail;
    } else {
      extra = ` · ${summary}`;
    }
  }

  const title = `${verb}${path !== undefined ? ` ${path}` : ''}`;
  const onExpand = (): void => {
    if (overlay !== null) overlay.open(renderBody(true), title);
    else setInlineExpanded(true);
  };

  function renderBody(full: boolean): ReactNode {
    if (running) {
      return <div className="px-2.5 py-2 text-caption text-faint">running…</div>;
    }
    // A failure takes PRIORITY over collapse and the diff/preview branches: the output is
    // shown as a red, always-visible error body (never hidden behind Expand), so a
    // not-found/unapplied/failed call reads as a failure at a glance (SC-1 surfacing).
    if (ok === false && output !== undefined && output.length > 0) {
      return renderPlainBody(full, true);
    }
    // WebSearch: each result line ("title — url" + optional snippet) links its URL out.
    if (tool === 'WebSearch' && output !== undefined && output.length > 0) {
      const clamped = clampLines(output, maxLines);
      const shown = full ? output : clamped.shown;
      return (
        <>
          <div className="overflow-x-auto py-1 font-mono text-label leading-[1.55]">
            {shown.split('\n').map((ln, i) => (
              <WebRow key={i} line={ln} onOpenUrl={onOpenUrl} />
            ))}
          </div>
          {!full && clamped.truncated && (
            <ExpandRow hidden={clamped.hiddenCount} onExpand={onExpand} />
          )}
        </>
      );
    }
    const edit = parseEdit(tool, input);
    if (edit !== undefined) {
      const all = diffLines(edit.before, edit.after).lines;
      const truncated = all.length > maxLines;
      const lines = full ? all : all.slice(0, maxLines);
      return (
        <>
          <ToolDiffView lines={lines} language={language} />
          {!full && truncated && <ExpandRow hidden={all.length - maxLines} onExpand={onExpand} />}
        </>
      );
    }
    if (output === undefined || output.length === 0) return null;
    if (tool === 'run_checks') return <RunChecks output={output} />;
    // Collapsed-by-default read/search tools: header + Expand only until opened; the full
    // body renders when `full` (in the overlay, or inline without a provider).
    if (COLLAPSED_TOOLS.has(tool) && !full) {
      const total = output.split('\n').filter((ln) => ln.length > 0).length;
      return <ExpandRow hidden={total} onExpand={onExpand} collapsed />;
    }
    if (tool === 'Grep' || tool === 'Glob') {
      const clamped = clampLines(output, maxLines);
      const shown = full ? output : clamped.shown;
      return (
        <>
          <div className="overflow-x-auto py-1 font-mono text-label leading-[1.55]">
            {shown.split('\n').map((ln, i) => (
              <MatchRow key={i} tool={tool} line={ln} onOpenPath={onOpenPath} />
            ))}
          </div>
          {!full && clamped.truncated && (
            <ExpandRow hidden={clamped.hiddenCount} onExpand={onExpand} />
          )}
        </>
      );
    }
    return renderPlainBody(full, false);
  }

  /** The plain/preview body: a syntax-highlighted preview for reads/symbol source, else a
   *  markErrors-marked tail. `error` forces the plain, red (`text-danger-text`) treatment
   *  from the start regardless of tool — the always-visible failure body. */
  function renderPlainBody(full: boolean, error: boolean): ReactNode {
    if (output === undefined || output.length === 0) return null;
    const isTail = !error && tool === 'Bash';
    // Reads and source-returning symbol tools get syntax highlighting from the file
    // language; commands (and any error body) stay plain so error tokens mark red.
    const previewLang = !error && PREVIEW_LANG_TOOLS.has(tool) ? language : undefined;
    const clamped = clampLines(output, maxLines, isTail ? { fromEnd: true } : undefined);
    const shown = full ? output : clamped.shown;
    return (
      <>
        <div
          className={cx(
            'overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55]',
            error || ok === false ? 'text-danger-text' : 'text-muted',
          )}
        >
          {shown.split('\n').map((ln, i) => (
            <div key={i}>
              {previewLang !== undefined ? (
                <SyntaxText code={ln} language={previewLang} />
              ) : (
                // Plain command/tool output: mark error tokens red over the body tint.
                markErrors(ln)
              )}
            </div>
          ))}
        </div>
        {!full && clamped.truncated && (
          <ExpandRow hidden={clamped.hiddenCount} onExpand={onExpand} />
        )}
      </>
    );
  }

  const showInline = inlineExpanded && overlay === null;

  return (
    <div className="overflow-hidden rounded-surface border border-hairline bg-subtle">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-label font-medium text-fg">{verb}</span>
        {path !== undefined ? (
          <span className="flex min-w-0 items-center gap-1">
            {onOpenPath !== undefined ? (
              <button
                type="button"
                onClick={() => onOpenPath(path, line)}
                className="min-w-0 truncate text-label text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
              >
                {linkLabel}
              </button>
            ) : (
              <span className="min-w-0 truncate text-label text-muted">{linkLabel}</span>
            )}
            {extra.length > 0 && <span className="shrink-0 text-label text-muted">{extra}</span>}
          </span>
        ) : webUrl !== undefined ? (
          onOpenUrl !== undefined ? (
            <button
              type="button"
              onClick={() => onOpenUrl(webUrl)}
              className="min-w-0 truncate text-label text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
            >
              {webUrl}
            </button>
          ) : (
            <span className="min-w-0 truncate text-label text-muted">{webUrl}</span>
          )
        ) : (
          summary.length > 0 && (
            <span className="min-w-0 truncate text-label text-muted">{summary}</span>
          )
        )}
        {output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', output === undefined && 'ml-auto')}>
          {running ? (
            <Loader2
              aria-hidden
              size={13}
              className="animate-spin text-info motion-reduce:animate-none"
            />
          ) : ok === false ? (
            <X aria-label="failed" size={13} className="text-danger" />
          ) : (
            <Check aria-label="ok" size={13} className="text-success" />
          )}
        </span>
      </div>
      <div className="border-t border-hairline">{renderBody(showInline)}</div>
    </div>
  );
}

/** One search-result line: a clickable `path:line` (revealing at the line) plus the
 *  verbatim trailing match text, or the plain verbatim line when it doesn't parse / isn't
 *  actionable. Byte-faithful — the row's textContent equals the source line. */
function MatchRow({
  tool,
  line,
  onOpenPath,
}: {
  tool: string;
  line: string;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
}): React.JSX.Element {
  const match = parseMatchLine(tool, line);
  if (match === undefined || onOpenPath === undefined) {
    return <div className="whitespace-pre px-2.5 text-muted">{line}</div>;
  }
  const rest = match.text !== undefined ? `:${match.text}` : '';
  return (
    <div className="whitespace-pre px-2.5">
      <button
        type="button"
        onClick={() => onOpenPath(match.path, match.line)}
        className="text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
      >
        {`${match.path}${match.line !== undefined ? `:${match.line}` : ''}`}
      </button>
      {rest.length > 0 && <span className="text-muted">{rest}</span>}
    </div>
  );
}

/** One WebSearch output line. A `title — url` line renders the title as a link opening the
 *  URL out (the snippet/other lines render as plain muted text). Byte-faithful: the row's
 *  textContent equals the source line. Falls back to plain text when no URL parses. */
function WebRow({
  line,
  onOpenUrl,
}: {
  line: string;
  onOpenUrl?: ((url: string) => void) | undefined;
}): React.JSX.Element {
  const parsed = parseWebLine(line);
  if (parsed === undefined || onOpenUrl === undefined) {
    return <div className="whitespace-pre px-2.5 text-muted">{line}</div>;
  }
  return (
    <div className="whitespace-pre px-2.5">
      <button
        type="button"
        onClick={() => onOpenUrl(parsed.url)}
        className="text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
      >
        {parsed.title}
      </button>
      <span className="text-muted">{parsed.rest}</span>
    </div>
  );
}

/** Parse a `title — url` WebSearch line into its clickable title + verbatim remainder
 *  (` — url`), so the row is byte-faithful. Only an `http(s)` URL is actionable. */
function parseWebLine(line: string): { title: string; url: string; rest: string } | undefined {
  const sep = ' — ';
  const at = line.indexOf(sep);
  if (at <= 0) return undefined;
  const title = line.slice(0, at);
  const url = line.slice(at + sep.length);
  if (!/^https?:\/\//.test(url)) return undefined;
  return { title, url, rest: line.slice(at) };
}

/** The `url` from a WebFetch tool INPUT (JSON), or undefined for malformed input. Never throws. */
function webUrlOf(input: string): string | undefined {
  try {
    const v: unknown = JSON.parse(input);
    if (typeof v !== 'object' || v === null) return undefined;
    const url = (v as Record<string, unknown>)['url'];
    return typeof url === 'string' && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

function ExpandRow({
  hidden,
  onExpand,
  collapsed = false,
}: {
  hidden: number;
  onExpand: () => void;
  /** True when the whole body is hidden (collapsed-by-default tool) — the label reads
   *  "N lines" rather than "N more lines" since nothing is shown above it. */
  collapsed?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label="Expand"
      className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-caption text-info hover:bg-element motion-reduce:transition-none"
    >
      View · {hidden}
      {collapsed ? ' ' : ' more '}
      {hidden === 1 ? 'line' : 'lines'}
    </button>
  );
}

/** Derive before/after for a diff body from an input `DiffSpec` (`edit_symbol`/`apply_patch`):
 *  a `search-replace`'s hunks join find→before / replace→after (per hunk, verbatim); a
 *  `whole-file` is all-added (before ''). The `unified` form has no clean pair → undefined
 *  (falls back to the preview body). Never throws. */
function parseDiffSpec(diff: unknown): { before: string; after: string } | undefined {
  if (typeof diff !== 'object' || diff === null) return undefined;
  const d = diff as Record<string, unknown>;
  if (d['form'] === 'whole-file' && typeof d['body'] === 'string') {
    return { before: '', after: d['body'] };
  }
  if (d['form'] === 'search-replace' && Array.isArray(d['hunks'])) {
    const finds: string[] = [];
    const replaces: string[] = [];
    for (const h of d['hunks']) {
      if (typeof h !== 'object' || h === null) return undefined;
      const hr = h as Record<string, unknown>;
      const find = hr['find'];
      const replace = hr['replace'];
      if (typeof find !== 'string' || typeof replace !== 'string') return undefined;
      finds.push(find);
      replaces.push(replace);
    }
    return { before: finds.join('\n'), after: replaces.join('\n') };
  }
  return undefined;
}

/** Extract an edit's before/after for the diff body: old_string/new_string, a Write's
 *  content as an all-added diff, or a symbol/patch tool's input `DiffSpec`. Undefined
 *  (→ preview body) for anything else / malformed. Pure; never throws. Exported for tests. */
export function parseEdit(
  tool: string,
  input: string,
): { before: string; after: string } | undefined {
  let rec: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(input);
    if (typeof v !== 'object' || v === null) return undefined;
    rec = v as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const before = rec['old_string'];
  const after = rec['new_string'];
  if (typeof before === 'string' && typeof after === 'string') return { before, after };
  if (tool === 'Write' && typeof rec['content'] === 'string')
    return { before: '', after: rec['content'] };
  if (tool === 'edit_symbol' || tool === 'apply_patch') return parseDiffSpec(rec['diff']);
  return undefined;
}

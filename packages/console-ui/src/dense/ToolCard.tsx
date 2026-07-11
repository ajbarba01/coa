// packages/console-ui/src/dense/ToolCard.tsx
import { useState } from 'react';
import { cx } from '../lib/cx.js';
import { usePaneOverlay } from '../layout/PaneOverlay.js';
import { describeTool, toolTarget } from './toolRegistry.js';
import { diffLines, type DiffLine } from './toolDiff.js';
import { estimateTokens, formatTokens } from './tokenEstimate.js';
import { languageForPath } from './pathLanguage.js';
import { clampLines } from './clampLines.js';
import { markErrors } from './errorMarks.js';
import { parseMatchLine } from './matchLines.js';
import { parseChecks, RunChecks } from './runChecks.js';
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
  /** Body lines shown inline before the clamp hands off to the overlay. Default 8. */
  maxLines?: number | undefined;
}

/** Tools whose output is source we highlight in the preview body (like `Read`): the
 *  symbol/piece/spec fetchers, keyed on the language of their ref path. */
const PREVIEW_LANG_TOOLS = new Set(['Read', 'get_symbol', 'get_piece', 'get_spec']);

/** Reads/searches rest closed; edits, writes, commands, checks and every failure rest
 *  open. OVERRIDE: unions the proto's set with the real card's coa-specific collapsed
 *  tools (`get_symbol`, `get_piece`) so nothing regresses. */
const RESTS_COLLAPSED = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'get_symbol', 'get_piece']);

/** Body lines shown inline before the clamp hands off to the overlay. */
const CLAMP = 8;

/** Mono glyph per tool family — the transcript's terminal shorthand. OVERRIDE: coa's own
 *  read-like fetchers (`get_symbol`/`get_piece`/`get_spec`) share the `Read` glyph — they
 *  return source/spec text the same way a read does. */
function toolGlyph(tool: string): string {
  switch (tool) {
    case 'Read':
    case 'get_symbol':
    case 'get_piece':
    case 'get_spec':
      return 'R';
    case 'Edit':
      return 'E';
    case 'Write':
      return 'W';
    case 'Bash':
      return '$';
    case 'Grep':
    case 'Glob':
      return '⌕';
    case 'WebSearch':
    case 'WebFetch':
      return '◍';
    case 'run_checks':
      return '✓';
    default:
      return '·';
  }
}

/** A parsed body, ready to render — the digested shape the real registry/diff/clamp
 *  helpers produce, mapped onto the design's five body treatments. Not the proto's
 *  `ToolBody`: the real card keeps deriving its body from `tool`/`input`/`output`/`ok`. */
type Body =
  | { kind: 'diff'; lines: DiffLine[]; lang: string | undefined }
  | { kind: 'code'; text: string; lang: string | undefined }
  | { kind: 'out'; text: string; fromEnd: boolean }
  | { kind: 'matches'; tool: string; text: string }
  | { kind: 'web'; text: string }
  | { kind: 'checks'; output: string };

/** Resolve a tool call's body. `run_checks` always gets the structured checks body (even
 *  failed — the per-check ✗ marks already surface the failure; `RunChecks` itself falls
 *  back to a plain preview, in the failed treatment when `ok === false`, when its output
 *  doesn't parse). Otherwise a failure takes PRIORITY over every other branch: its output
 *  renders as the plain error body, always visible (SC-1). A successful WebFetch keeps its
 *  fetched/digested output in the plain `out` treatment below (see the MAINTAINER OVERRIDE
 *  comment) — it stays in `RESTS_COLLAPSED` so at rest it's still a quiet one-line receipt. */
function resolveBody(
  tool: string,
  input: string,
  output: string | undefined,
  failed: boolean,
  language: string | undefined,
): Body | undefined {
  if (tool === 'run_checks' && output !== undefined && output.length > 0) {
    return { kind: 'checks', output };
  }
  if (failed) {
    return output !== undefined && output.length > 0 ? { kind: 'out', text: output, fromEnd: true } : undefined;
  }
  // MAINTAINER OVERRIDE (deliberate — do not "fix" this back to no-body): the proto's
  // Gallery caption reads "the row is the receipt" and renders NO body for a successful
  // WebFetch. The maintainer ruled against that: dropping the fetched/digested extract is
  // irreversible information loss — it's what the agent actually saw, and re-opening the
  // URL later can show something different (auth walls, JS rendering, prompt-targeted
  // summarization). The product's thesis is an honest record, so WebFetch falls through to
  // the same plain `out` treatment as any other tool's output below — but as a DOCUMENT
  // (fromEnd: false), not command output: see the `fromEnd` note on the `'out'` case.
  const edit = parseEdit(tool, input);
  if (edit !== undefined) {
    return { kind: 'diff', lines: diffLines(edit.before, edit.after).lines, lang: language };
  }
  if (output === undefined || output.length === 0) return undefined;
  if (tool === 'WebSearch') return { kind: 'web', text: output };
  if (tool === 'Grep' || tool === 'Glob') return { kind: 'matches', tool, text: output };
  if (PREVIEW_LANG_TOOLS.has(tool)) return { kind: 'code', text: output, lang: language };
  return { kind: 'out', text: output, fromEnd: tool !== 'WebFetch' };
}

/** The header's target-adjacent detail and (right-aligned) meta, derived from the
 *  registry's `summary` without re-deriving its per-tool composition rules: calling
 *  `describeTool` with and without `output` isolates the result hint (`resultHint`) from
 *  the target's own text, the same split the registry already encodes. */
function deriveHeaderText(
  tool: string,
  input: string,
  output: string | undefined,
  ok: boolean | undefined,
  path: string | undefined,
  line: number | undefined,
): { targetBare: string; meta: string | undefined } {
  const bare = describeTool(tool, input).summary;
  const full = output !== undefined ? describeTool(tool, input, output, ok).summary : bare;
  let metaText = '';
  if (path !== undefined) {
    if (bare.startsWith(path)) {
      const tail = bare.slice(path.length);
      const suppressed = line !== undefined && tail.startsWith(':');
      metaText = suppressed ? '' : tail;
    } else if (bare.length > 0) {
      metaText = bare;
    }
  }
  metaText = metaText.replace(/^\s*·\s*/, '').trim();
  if (metaText.length === 0 && full.length > bare.length) {
    metaText = full.slice(bare.length).replace(/^\s*·\s*/, '').trim();
  }
  if (tool === 'run_checks' && output !== undefined) {
    const parsed = parseChecks(output);
    if (parsed !== undefined) {
      metaText = `${parsed.checks.length} check${parsed.checks.length === 1 ? '' : 's'}`;
    }
  }
  return { targetBare: path === undefined ? bare : '', meta: metaText.length > 0 ? metaText : undefined };
}

/** The rich tool call: ONE container for both states. The header row is byte-identical
 *  closed and open — glyph, running dot, verb, linked target, then meta, fail dot, and a
 *  chevron on the right. Expanding fades the card chrome in and slides the body open
 *  beneath it, so the change reads as "the result appears", never as a different
 *  component. Indicator law: RUNNING earns the blue dot; FAILURE earns the red dot and its
 *  output is always visible (SC-1); SUCCESS renders no dot at all. */
export function ToolCard({
  tool,
  input,
  output,
  ok,
  onOpenPath,
  onOpenUrl,
  maxLines = CLAMP,
}: ToolCardProps): React.JSX.Element {
  const overlay = usePaneOverlay();
  const running = output === undefined && ok === undefined;
  const failed = ok === false;
  const [open, setOpen] = useState(!RESTS_COLLAPSED.has(tool) || failed);
  const [inlineFull, setInlineFull] = useState(false);

  const { verb } = describeTool(tool, input, output, ok);
  const target = toolTarget(tool, input);
  const path = target?.path;
  const line = target?.line;
  // WebFetch's source URL comes from its INPUT `url` — surfaced as a clickable header link
  // (the file-path slot has no meaning for an egress tool).
  const webUrl = tool === 'WebFetch' ? webUrlOf(input) : undefined;
  const language = path !== undefined ? languageForPath(path) : undefined;

  const body = running ? undefined : resolveBody(tool, input, output, failed, language);
  const hasBody = body !== undefined;
  const shown = open && hasBody;

  const { targetBare, meta: derivedMeta } = deriveHeaderText(tool, input, output, ok, path, line);
  const meta = derivedMeta ?? (output !== undefined ? `≈ ${formatTokens(estimateTokens(output))} tok` : undefined);

  const title = `${verb}${path !== undefined ? ` ${path}` : ''}`;
  const onExpand = (): void => {
    if (body === undefined) return;
    if (overlay !== null) {
      overlay.open(
        <div className="px-1 py-1">
          <BodyView
            body={body}
            failed={failed}
            full
            maxLines={maxLines}
            onOpenPath={onOpenPath}
            onOpenUrl={onOpenUrl}
          />
        </div>,
        title,
      );
    } else setInlineFull(true);
  };

  return (
    <div
      className={cx(
        'slip -mx-2.5 min-w-0 overflow-hidden rounded-r2 border',
        shown ? 'border-s3 bg-s2' : 'border-transparent',
      )}
    >
      {/* the header — identical in both states; toggles when a body exists */}
      <div
        className={cx(
          'group flex items-center gap-2 px-2.5 py-1.5 font-mono text-code',
          hasBody && 'slip cursor-pointer hover:bg-s2',
        )}
        {...(hasBody
          ? {
              role: 'button' as const,
              tabIndex: 0,
              'aria-expanded': shown,
              onClick: () => setOpen((v) => !v),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen((v) => !v);
                }
              },
            }
          : {})}
      >
        <span className="w-3 flex-none text-center text-s7">{toolGlyph(tool)}</span>
        {running && <span aria-label="running" className="size-[5px] flex-none rounded-full bg-run" />}
        <span className="flex-none text-s8">{verb}</span>
        {path !== undefined ? (
          onOpenPath !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenPath(path, line);
              }}
              title="reveal in editor"
              className="slip min-w-0 cursor-pointer truncate text-left text-s11 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
            >
              {path}
              {line !== undefined && <span className="text-s8">:{line}</span>}
            </button>
          ) : (
            <span className="min-w-0 truncate text-s11">
              {path}
              {line !== undefined && <span className="text-s8">:{line}</span>}
            </span>
          )
        ) : webUrl !== undefined ? (
          onOpenUrl !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenUrl(webUrl);
              }}
              title="open in browser"
              className="slip min-w-0 cursor-pointer truncate text-left text-s11 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
            >
              {webUrl}
            </button>
          ) : (
            <span className="min-w-0 truncate text-s11">{webUrl}</span>
          )
        ) : (
          targetBare.length > 0 && <span className="min-w-0 truncate text-s11">{targetBare}</span>
        )}
        <span className="ml-auto flex flex-none items-center gap-2 pl-2">
          {meta !== undefined && <MetaValue text={meta} />}
          {failed && <span aria-label="failed" className="size-[5px] flex-none rounded-full bg-crit" />}
          {hasBody && (
            <span
              aria-hidden
              className={cx(
                'slip-move inline-block text-[9px] text-s6',
                shown ? 'rotate-180' : 'opacity-0 group-hover:opacity-100',
              )}
            >
              ⌄
            </span>
          )}
        </span>
      </div>
      {/* the body slides open under the header (the only thing that changes) */}
      <div
        className="grid transition-[grid-template-rows] duration-[var(--dur-move)] ease-[var(--ease-slip)] motion-reduce:transition-none"
        style={{ gridTemplateRows: shown ? '1fr' : '0fr' }}
        aria-hidden={shown ? undefined : true}
      >
        <div className="min-h-0 overflow-hidden">
          {body !== undefined && (
            <div className="border-t border-s3">
              <BodyView
                body={body}
                failed={failed}
                full={inlineFull}
                maxLines={maxLines}
                onExpand={onExpand}
                onOpenPath={onOpenPath}
                onOpenUrl={onOpenUrl}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** `+N −M` metas split into diff tints; anything else renders quiet mono. */
function MetaValue({ text }: { text: string }): React.JSX.Element {
  const m = /^\+(\d+) −(\d+)$/.exec(text);
  if (m === null) return <span className="whitespace-nowrap text-meta text-s7">{text}</span>;
  return (
    <span className="whitespace-nowrap text-meta">
      <span className="text-diff-add">+{m[1]}</span> <span className="text-diff-del">−{m[2]}</span>
    </span>
  );
}

function BodyView({
  body,
  failed,
  full,
  maxLines,
  onExpand,
  onOpenPath,
  onOpenUrl,
}: {
  body: Body;
  failed: boolean;
  full: boolean;
  maxLines: number;
  onExpand?: (() => void) | undefined;
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onOpenUrl?: ((url: string) => void) | undefined;
}): React.JSX.Element {
  switch (body.kind) {
    case 'diff': {
      const lines = full ? body.lines : body.lines.slice(0, maxLines);
      return (
        <>
          <ToolDiffView lines={lines} language={body.lang} />
          {!full && body.lines.length > maxLines && (
            <ClampRow hidden={body.lines.length - maxLines} onExpand={onExpand} />
          )}
        </>
      );
    }
    case 'code': {
      const clamped = clampLines(body.text, maxLines);
      const lines = (full ? body.text : clamped.shown).split('\n');
      return (
        <>
          <div className="overflow-x-auto px-3 py-1.5 font-mono text-[11px] leading-[1.65] whitespace-pre">
            {lines.map((ln, i) => (
              <div key={i}>
                <SyntaxText code={ln} language={body.lang} />
              </div>
            ))}
          </div>
          {!full && clamped.truncated && <ClampRow hidden={clamped.hiddenCount} onExpand={onExpand} />}
        </>
      );
    }
    case 'out': {
      // Command output (and any plain error body) clamps FROM THE END — the tail is where
      // the verdict lives; the clamp row sits ABOVE the body. Plain document output that
      // isn't a command's (a successful WebFetch's digested page) clamps FROM THE START
      // instead, like the other document bodies (`code`/`matches`/`web`) — the clamp row
      // sits BELOW, and `body.fromEnd` (not the tool) drives both the slice direction and
      // the row placement so they can't drift apart.
      const clamped = clampLines(body.text, maxLines, { fromEnd: body.fromEnd });
      const lines = (full ? body.text : clamped.shown).split('\n');
      return (
        <>
          {!full && clamped.truncated && body.fromEnd && (
            <ClampRow hidden={clamped.hiddenCount} onExpand={onExpand} leading />
          )}
          <div
            className={cx(
              'overflow-x-auto px-3 py-1.5 font-mono text-[11px] leading-[1.65] whitespace-pre',
              failed ? 'text-s10' : 'text-s8',
            )}
          >
            {lines.map((ln, i) => (
              <div key={i}>{markErrors(ln)}</div>
            ))}
          </div>
          {!full && clamped.truncated && !body.fromEnd && (
            <ClampRow hidden={clamped.hiddenCount} onExpand={onExpand} />
          )}
        </>
      );
    }
    case 'matches': {
      const clamped = clampLines(body.text, maxLines);
      const lines = (full ? body.text : clamped.shown).split('\n');
      return (
        <>
          <div className="overflow-x-auto py-1 font-mono text-[11px] leading-[1.65]">
            {lines.map((ln, i) => (
              <MatchRow key={i} tool={body.tool} line={ln} onOpenPath={onOpenPath} />
            ))}
          </div>
          {!full && clamped.truncated && <ClampRow hidden={clamped.hiddenCount} onExpand={onExpand} />}
        </>
      );
    }
    case 'web': {
      const clamped = clampLines(body.text, maxLines);
      const lines = (full ? body.text : clamped.shown).split('\n');
      return (
        <>
          <div className="flex flex-col gap-1 px-3 py-2">
            {lines.map((ln, i) => (
              <WebRow key={i} line={ln} onOpenUrl={onOpenUrl} />
            ))}
          </div>
          {!full && clamped.truncated && <ClampRow hidden={clamped.hiddenCount} onExpand={onExpand} />}
        </>
      );
    }
    case 'checks':
      return <RunChecks output={body.output} failed={failed} />;
  }
}

/** One search-result line: a clickable `path:line` (revealing at the line) plus the
 *  verbatim trailing match text, or the plain verbatim line when it doesn't parse / isn't
 *  actionable. */
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
    return (
      <div className="flex gap-2 px-3 whitespace-pre">
        <span className="text-s10">{line}</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 px-3 whitespace-pre">
      <button
        type="button"
        onClick={() => onOpenPath(match.path, match.line)}
        className="slip cursor-pointer text-s10 underline decoration-s5 decoration-dotted underline-offset-[3px] hover:text-s12 hover:decoration-s7"
      >
        {match.path}
        {match.line !== undefined && `:${match.line}`}
      </button>
      {match.text !== undefined && <span className="truncate text-s7">{match.text}</span>}
    </div>
  );
}

/** One WebSearch output line: a `title — url` line renders the title as a link opening the
 *  URL out, plus the bare host trailing faint; other/unparseable lines render verbatim. */
function WebRow({
  line,
  onOpenUrl,
}: {
  line: string;
  onOpenUrl?: ((url: string) => void) | undefined;
}): React.JSX.Element {
  const parsed = parseWebLine(line);
  if (parsed === undefined || onOpenUrl === undefined) {
    return (
      <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
        <span className="min-w-0 truncate text-s11">{line}</span>
      </div>
    );
  }
  const host = parsed.url.replace(/^https?:\/\//, '').split('/')[0];
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
      <button
        type="button"
        onClick={() => onOpenUrl(parsed.url)}
        title={parsed.url}
        className="slip cursor-pointer truncate text-left text-s11 underline decoration-s6 underline-offset-[3px] hover:text-s12 hover:decoration-s8"
      >
        {parsed.title}
      </button>
      <span className="min-w-0 flex-none truncate font-mono text-meta text-s6">{host}</span>
    </div>
  );
}

/** Parse a `title — url` WebSearch line into its clickable title + url. Only an `http(s)`
 *  URL is actionable. */
function parseWebLine(line: string): { title: string; url: string } | undefined {
  const sep = ' — ';
  const at = line.indexOf(sep);
  if (at <= 0) return undefined;
  const title = line.slice(0, at);
  const url = line.slice(at + sep.length);
  if (!/^https?:\/\//.test(url)) return undefined;
  return { title, url };
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

/** The clamp affordance: one quiet full-width row. `leading` sits it above a tail-clamped
 *  body (command output hides its HEAD, not its tail). */
function ClampRow({
  hidden,
  onExpand,
  leading = false,
}: {
  hidden: number;
  onExpand?: (() => void) | undefined;
  leading?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onExpand?.();
      }}
      className={cx(
        'slip flex w-full cursor-pointer items-center gap-1.5 px-3 py-1 text-left font-mono text-meta text-s7 hover:bg-s3/60 hover:text-s10',
        leading ? 'border-b border-s3' : 'border-t border-s3',
      )}
    >
      <span className="text-[9px]">{leading ? '⌃' : '⌄'}</span>
      {hidden} more {hidden === 1 ? 'line' : 'lines'}
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

// packages/console-ui/src/dense/ToolCard.tsx
import { Check, Loader2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx.js';
import { usePaneOverlay } from '../layout/PaneOverlay.js';
import { describeTool, toolPath } from './toolRegistry.js';
import { diffLines } from './toolDiff.js';
import { estimateTokens, formatTokens } from './tokenEstimate.js';
import { languageForPath } from './pathLanguage.js';
import { clampLines } from './clampLines.js';
import { ToolDiffView } from './ToolDiffView.js';
import { SyntaxText } from './syntaxTheme.js';

export interface ToolCardProps {
  tool: string;
  input: string;
  output?: string | undefined;
  ok?: boolean | undefined;
  /** Reveal the touched file (file tools) in the editor/OS. Path is plain text when omitted. */
  onOpenPath?: ((path: string) => void) | undefined;
  /** Max body lines before truncation + Expand. Default 14. */
  maxLines?: number | undefined;
}

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
  maxLines = 14,
}: ToolCardProps): React.JSX.Element {
  const overlay = usePaneOverlay();
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const { icon: Icon, verb, summary } = describeTool(tool, input, output, ok);
  const path = toolPath(tool, input);
  const language = path !== undefined ? languageForPath(path) : undefined;
  const running = output === undefined && ok === undefined;
  const extra = path !== undefined && summary.startsWith(path) ? summary.slice(path.length) : '';

  const title = `${verb}${path !== undefined ? ` ${path}` : ''}`;
  const onExpand = (): void => {
    if (overlay !== null) overlay.open(renderBody(true), title);
    else setInlineExpanded(true);
  };

  function renderBody(full: boolean): ReactNode {
    if (running) {
      return <div className="px-2.5 py-2 text-caption text-faint">running…</div>;
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
    const isTail = tool === 'Bash';
    const previewLang = tool === 'Read' ? language : undefined; // reads get language; commands/searches stay plain
    const clamped = clampLines(output, maxLines, isTail ? { fromEnd: true } : undefined);
    const shown = full ? output : clamped.shown;
    return (
      <>
        <div
          className={cx(
            'overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55]',
            ok === false ? 'text-danger-text' : 'text-muted',
          )}
        >
          {shown.split('\n').map((ln, i) => (
            <div key={i}>
              <SyntaxText code={ln} language={previewLang} />
            </div>
          ))}
        </div>
        {!full && clamped.truncated && <ExpandRow hidden={clamped.hiddenCount} onExpand={onExpand} />}
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
                onClick={() => onOpenPath(path)}
                className="min-w-0 truncate text-label text-info underline decoration-dotted underline-offset-2 hover:text-info-text"
              >
                {path}
              </button>
            ) : (
              <span className="min-w-0 truncate text-label text-muted">{path}</span>
            )}
            {extra.length > 0 && <span className="shrink-0 text-label text-muted">{extra}</span>}
          </span>
        ) : (
          summary.length > 0 && <span className="min-w-0 truncate text-label text-muted">{summary}</span>
        )}
        {output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', output === undefined && 'ml-auto')}>
          {running ? (
            <Loader2 aria-hidden size={13} className="animate-spin text-info motion-reduce:animate-none" />
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

function ExpandRow({ hidden, onExpand }: { hidden: number; onExpand: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-caption text-info hover:bg-element motion-reduce:transition-none"
    >
      Expand · {hidden} more {hidden === 1 ? 'line' : 'lines'}
    </button>
  );
}

/** Extract an edit's before/after for the diff body: old_string/new_string, or a Write's
 *  content as an all-added diff. Undefined (→ preview body) for anything else / malformed. */
function parseEdit(tool: string, input: string): { before: string; after: string } | undefined {
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
  if (tool === 'Write' && typeof rec['content'] === 'string') return { before: '', after: rec['content'] };
  return undefined;
}

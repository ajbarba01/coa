import { Check, Loader2, X } from 'lucide-react';
import {
  cx,
  describeTool,
  diffLines,
  estimateTokens,
  formatTokens,
  type DiffLine,
} from '@coa/console-ui';
import type { ToolCall } from './samples.js';

const PREVIEW_LINES = 6;

/** Direction 3 — a titled card that leads with the most informative body for the tool:
 *  a byte-faithful diff for edits/writes, a result preview for reads/searches, an output
 *  tail for commands. The header shows the estimated output tokens. */
export function RichToolCard({ call }: { call: ToolCall }): React.JSX.Element {
  const { icon: Icon, verb, summary } = describeTool(call.tool, call.input, call.output, call.ok);
  const running = call.output === undefined && call.ok === undefined;
  return (
    <div className="overflow-hidden rounded-surface border border-hairline bg-subtle">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <Icon aria-hidden size={14} className="shrink-0 text-muted" />
        <span className="shrink-0 text-label font-medium text-fg">{verb}</span>
        {summary.length > 0 && (
          <span className="min-w-0 truncate text-label text-muted">{summary}</span>
        )}
        {call.output !== undefined && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(estimateTokens(call.output))} tok
          </span>
        )}
        <span className={cx('shrink-0 pl-2', call.output === undefined && 'ml-auto')}>
          {running ? (
            <Loader2 aria-hidden size={13} className="animate-spin text-info motion-reduce:animate-none" />
          ) : call.ok === false ? (
            <X aria-label="failed" size={13} className="text-danger" />
          ) : (
            <Check aria-label="ok" size={13} className="text-success" />
          )}
        </span>
      </div>
      <RichBody call={call} running={running} />
    </div>
  );
}

function RichBody({ call, running }: { call: ToolCall; running: boolean }): React.JSX.Element {
  if (running) {
    return <div className="border-t border-hairline px-2.5 py-2 text-caption text-faint">running…</div>;
  }
  const diff = editDiff(call);
  if (diff !== undefined) return <DiffView lines={diff} />;
  if (call.output === undefined || call.output.length === 0) return <></>;
  const isTail = call.tool === 'Bash';
  const lines = call.output.split('\n');
  const shown = isTail ? lines.slice(-PREVIEW_LINES) : lines.slice(0, PREVIEW_LINES);
  const clipped = lines.length > PREVIEW_LINES;
  return (
    <div className="border-t border-hairline">
      <pre
        className={cx(
          'overflow-x-auto whitespace-pre px-2.5 py-2 font-mono text-label leading-[1.55]',
          call.ok === false ? 'text-danger-text' : 'text-muted',
        )}
      >
        {shown.join('\n')}
      </pre>
      {clipped && (
        <div className="px-2.5 pb-1.5 text-caption text-faint">
          {isTail
            ? `… ${lines.length - PREVIEW_LINES} earlier lines`
            : `… ${lines.length - PREVIEW_LINES} more lines`}
        </div>
      )}
    </div>
  );
}

/** The inline diff for an edit, or undefined when the call is not a diff-able edit.
 *  Byte-faithful: lines come straight from `diffLines`. */
function editDiff(call: ToolCall): DiffLine[] | undefined {
  let rec: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(call.input);
    if (typeof v !== 'object' || v === null) return undefined;
    rec = v as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const before = rec['old_string'];
  const after = rec['new_string'];
  if (typeof before === 'string' && typeof after === 'string') {
    return diffLines(before, after).lines;
  }
  if (call.tool === 'Write' && typeof rec['content'] === 'string') {
    return diffLines('', rec['content']).lines;
  }
  return undefined;
}

function DiffView({ lines }: { lines: DiffLine[] }): React.JSX.Element {
  return (
    <div className="overflow-x-auto border-t border-hairline">
      <pre className="w-full font-mono text-label leading-[1.55]">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cx(
              'whitespace-pre px-2.5',
              line.kind === 'added' && 'bg-success-tint text-success-text',
              line.kind === 'removed' && 'bg-danger-tint text-danger-text',
              line.kind === 'context' && 'text-muted',
            )}
          >
            {`${line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '} ${line.text}`}
          </div>
        ))}
      </pre>
    </div>
  );
}

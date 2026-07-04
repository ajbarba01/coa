import { ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { cx, describeTool, estimateTokens, formatTokens } from '@coa/console-ui';
import { CompactToolLine } from './CompactToolLine.js';
import type { ToolCall } from './samples.js';

/** Direction 2 — a run of tool calls collapsed into one "working" group. Collapsed, it
 *  reads as a single line with the verbs touched and the group's total output tokens;
 *  expanded, it lists each step as a CompactToolLine. A still-running call keeps it live. */
export function GroupedActivityLog({ calls }: { calls: ToolCall[] }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const running = calls.some((c) => c.output === undefined && c.ok === undefined);
  const failed = calls.some((c) => c.ok === false);
  const totalTokens = calls.reduce((sum, c) => sum + (c.output !== undefined ? estimateTokens(c.output) : 0), 0);
  const peek = dedupe(calls.map((c) => describeTool(c.tool, c.input).verb)).slice(0, 4).join(' · ');
  return (
    <div className="min-w-0 rounded-surface border border-hairline bg-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left hover:bg-element motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx(
            'shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        {running ? (
          <Loader2 aria-hidden size={13} className="shrink-0 animate-spin text-info motion-reduce:animate-none" />
        ) : (
          <span aria-hidden className={cx('size-2 shrink-0 rounded-full', failed ? 'bg-danger' : 'bg-success')} />
        )}
        <span className="shrink-0 text-label font-medium text-fg">{running ? 'Working' : 'Worked'}</span>
        <span className="shrink-0 text-caption text-faint">
          {calls.length} {calls.length === 1 ? 'step' : 'steps'}
        </span>
        {!open && peek.length > 0 && (
          <span className="min-w-0 truncate text-caption text-muted">{peek}</span>
        )}
        {totalTokens > 0 && (
          <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums text-faint">
            ≈ {formatTokens(totalTokens)} tok
          </span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 border-t border-hairline px-1 py-1">
          {calls.map((call) => (
            <CompactToolLine key={call.id} call={call} />
          ))}
        </div>
      )}
    </div>
  );
}

function dedupe(xs: string[]): string[] {
  return [...new Set(xs)];
}

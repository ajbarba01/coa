// apps/desktop/src/renderer/panels/showcase/toolblocks/CompactToolLine.tsx
import { Check, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { Code, cx, describeTool, estimateTokens, formatTokens } from '@coa/console-ui';
import type { ToolCall } from './samples.js';

/** Direction 1 — one dense line per call: caret + tool icon + verb + target + an
 *  estimated-token readout for the output + a trailing status glyph; click anywhere
 *  to expand the byte-faithful input/output. */
export function CompactToolLine({ call }: { call: ToolCall }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { icon: Icon, verb, summary } = describeTool(call.tool, call.input, call.output, call.ok);
  const running = call.output === undefined && call.ok === undefined;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 rounded-surface px-1.5 py-1 text-left hover:bg-element motion-reduce:transition-none"
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx(
            'shrink-0 text-faint transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
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
          <StatusGlyph running={running} ok={call.ok} />
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 py-1 pl-7">
          {call.input.length > 0 && <Code block>{call.input}</Code>}
          {call.output !== undefined && <Code block>{call.output}</Code>}
        </div>
      )}
    </div>
  );
}

function StatusGlyph({
  running,
  ok,
}: {
  running: boolean;
  ok?: boolean | undefined;
}): React.JSX.Element {
  if (running) return <span className="text-caption text-faint">running…</span>;
  if (ok === false) return <X aria-label="failed" size={13} className="text-danger" />;
  if (ok === true) return <Check aria-label="ok" size={13} className="text-success" />;
  return <></>;
}

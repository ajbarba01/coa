import { Virtuoso } from 'react-virtuoso';
import { Button } from '../actions/Button.js';
import { Code } from '../data/Code.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { cx } from '../lib/cx.js';

export type TranscriptRole = 'you' | 'agent' | 'subagent';

/** One rendered turn frame. A discriminated union so each kind renders on its own
 *  footing; `raw` is the verbatim (unfiltered-loop) projection. */
export type TranscriptFrame =
  | { id: string; role: TranscriptRole; kind: 'text'; text: string; depth?: number | undefined }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-use';
      tool: string;
      input: string;
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-result';
      tool: string;
      output: string;
      ok: boolean;
      depth?: number | undefined;
    }
  | {
      id: string;
      kind: 'approval';
      requestId: string;
      tool: string;
      summary: string;
      diffStat?: string | undefined;
      resolved?: 'approved' | 'denied' | undefined;
    }
  | { id: string; kind: 'deny'; denyKind: 'close-gate' | 'cost-cap'; reason: string }
  | { id: string; kind: 'raw'; text: string };

export type RespondFn = (requestId: string, decision: 'approve' | 'deny') => void;

export interface TranscriptProps {
  frames: TranscriptFrame[];
  /** Fired when an inline approval card is actioned. Surfacing only — the console
   *  never denies; the daemon owns the real decision (SC-1). */
  onRespond?: RespondFn | undefined;
  label?: string | undefined;
  className?: string | undefined;
}

const roleTint: Record<TranscriptRole, string> = {
  you: 'text-fg',
  agent: 'text-fg',
  subagent: 'text-muted',
};

function RoleGutter({ role }: { role: TranscriptRole }): React.JSX.Element {
  return (
    <span className={cx('w-16 shrink-0 text-caption uppercase tracking-[0.04em]', roleTint[role])}>
      {role}
    </span>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable without the
 *  virtualized container (which needs measured heights jsdom does not provide). */
export function TranscriptRow({
  frame,
  onRespond,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
}): React.JSX.Element {
  const depth = 'depth' in frame ? frame.depth : undefined;
  const indent = depth ? { marginLeft: depth * 16 } : undefined;

  if (frame.kind === 'approval') {
    return (
      <div style={indent} className="px-2 py-1.5">
        <div className="rounded-surface border border-border-default bg-raised p-2">
          <div className="flex items-center gap-2 text-label">
            <span className="text-eyebrow font-medium uppercase tracking-[0.06em] text-faint">
              approval
            </span>
            <span className="font-medium text-fg">{frame.tool}</span>
            <span className="min-w-0 flex-1 truncate text-muted">{frame.summary}</span>
            {frame.diffStat !== undefined && (
              <span className="text-caption text-faint">{frame.diffStat}</span>
            )}
          </div>
          {frame.resolved !== undefined ? (
            <div className="mt-1.5 text-caption text-muted">Request {frame.resolved}.</div>
          ) : (
            <div className="mt-1.5 flex justify-end gap-2">
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => onRespond?.(frame.requestId, 'deny')}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onRespond?.(frame.requestId, 'approve')}
              >
                Approve
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (frame.kind === 'deny') {
    return (
      <div className="px-2 py-1.5">
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </div>
    );
  }

  if (frame.kind === 'raw') {
    return (
      <div className="px-2 py-0.5">
        <Code block>{frame.text}</Code>
      </div>
    );
  }

  return (
    <div style={indent} className="flex gap-2 px-2 py-1.5">
      <RoleGutter role={frame.role} />
      <div className="min-w-0 flex-1">
        {frame.kind === 'text' && (
          <div className="text-body leading-[1.5] text-fg">{frame.text}</div>
        )}
        {frame.kind === 'tool-use' && (
          <div className="flex flex-col gap-1">
            <span className="text-caption text-muted">{frame.tool}</span>
            <Code block>{frame.input}</Code>
          </div>
        )}
        {frame.kind === 'tool-result' && (
          <div className="flex flex-col gap-1">
            <span className="text-caption text-muted">
              {frame.tool} · {frame.ok ? 'ok' : 'error'}
            </span>
            <Code block>{frame.output}</Code>
          </div>
        )}
      </div>
    </div>
  );
}

/** A virtualized turn stream (react-virtuoso). Empty is the panel's concern (it owns
 *  the EmptyState), so an empty stream renders nothing here. */
export function Transcript({
  frames,
  onRespond,
  label = 'Conversation',
  className,
}: TranscriptProps): React.JSX.Element | null {
  if (frames.length === 0) return null;
  return (
    <div role="log" aria-label={label} className={cx('h-full min-h-0', className)}>
      <Virtuoso
        data={frames}
        initialItemCount={Math.min(frames.length, 20)}
        itemContent={(_index, frame) => <TranscriptRow frame={frame} onRespond={onRespond} />}
        computeItemKey={(_index, frame) => frame.id}
      />
    </div>
  );
}

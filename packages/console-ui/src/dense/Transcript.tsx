import { ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { useRef, useState } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from 'react-virtuoso';
import { Button } from '../actions/Button.js';
import { Code } from '../data/Code.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { groupByUserTurn } from './group.js';
import { Markdown } from './Markdown.js';
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
      handle?: string | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'tool-result';
      tool: string;
      output: string;
      ok: boolean;
      handle?: string | undefined;
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
  | { id: string; kind: 'raw'; text: string }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'thinking';
      text: string;
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'plan';
      items: { text: string; status: 'pending' | 'in-progress' | 'done' }[];
      depth?: number | undefined;
    }
  | {
      id: string;
      role: TranscriptRole;
      kind: 'error';
      message: string;
      origin?: 'tool' | 'loop' | 'daemon' | undefined;
      depth?: number | undefined;
    }
  | {
      id: string;
      kind: 'subagent';
      childWorktree: string;
      event: 'spawn-proposal' | 'spawn' | 'running' | 'idle' | 'done' | 'rollup';
      depth?: number | undefined;
      rollup?:
        | {
            tools?: number | undefined;
            tokens?: number | undefined;
            cost?: number | undefined;
            status?: string | undefined;
          }
        | undefined;
    };

export type RespondFn = (requestId: string, decision: 'approve' | 'deny') => void;

export interface TranscriptProps {
  frames: TranscriptFrame[];
  /** Fired when an inline approval card is actioned. Surfacing only — the console
   *  never denies; the daemon owns the real decision (SC-1). */
  onRespond?: RespondFn | undefined;
  label?: string | undefined;
  className?: string | undefined;
  /** Test seam: force the jump-to-latest control's visibility instead of deriving it
   *  from live scroll state (jsdom cannot measure a virtualized list). Defaults to
   *  `!atBottom`. */
  showJumpToLatest?: boolean | undefined;
}

/** A collapse-by-default tool call/result summary that expands on click to reveal
 *  its payload. Collapsed by default keeps the transcript scannable; the hover ring
 *  and rotating caret mark the row as expandable (mockup-review refinement). */
function ToolCard({
  tool,
  payload,
  ok,
}: {
  tool: string;
  payload: string;
  ok?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const status = ok === undefined ? undefined : ok ? 'ok' : 'error';
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-control px-1 py-0.5 text-caption text-muted hover:ring-1 hover:ring-inset hover:ring-border-default motion-reduce:transition-none"
        aria-expanded={open}
      >
        {/* Caret rotates on toggle (interruptible transition — reduced-motion disables it);
            the hover outline marks the row as expandable (mockup-review refinement). */}
        <ChevronRight
          aria-hidden
          size={12}
          className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')}
        />
        <span className="text-fg">{tool || 'tool'}</span>
        {status !== undefined && (
          <span className={status === 'ok' ? 'text-muted' : 'text-danger'}>· {status}</span>
        )}
      </button>
      {open && <Code block>{payload}</Code>}
    </div>
  );
}

/** Pure classification of a frame's outcome for the gutter status dot: errors and
 *  denies read danger, a tool-result's `ok` flag decides success vs danger, and
 *  everything else (text/tool-use/thinking/plan/approval/subagent/raw) is neutral —
 *  informational, not an outcome. Exported for unit testing. */
export function dotTone(frame: TranscriptFrame): 'success' | 'danger' | 'neutral' {
  if (frame.kind === 'error' || frame.kind === 'deny') return 'danger';
  if (frame.kind === 'tool-result') return frame.ok ? 'success' : 'danger';
  return 'neutral';
}

const dotToneClass = {
  success: 'bg-success',
  danger: 'bg-danger',
  neutral: 'bg-muted',
} as const;

/** Every row's shared shell: a fixed-width left gutter carrying the status dot,
 *  ahead of the row's own indent/role styling. Factored out so every early-return
 *  branch (approval/deny/subagent/thinking/error/plan) and the shared text/tool
 *  branch get the dot without duplicating the gutter markup. The dot is decorative
 *  (the row's own content already states its outcome), so it's `aria-hidden`. */
function RowShell({
  frame,
  indent,
  className,
  children,
}: {
  frame: TranscriptFrame;
  indent?: React.CSSProperties | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const tone = dotTone(frame);
  return (
    <div style={indent} className={cx('flex gap-2', className)}>
      <span
        data-dot
        aria-hidden
        className={cx('mt-1.5 inline-block size-1.5 shrink-0 rounded-full', dotToneClass[tone])}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
      <RowShell frame={frame} indent={indent} className="px-2 py-1.5">
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
                size="md"
                onClick={() => onRespond?.(frame.requestId, 'deny')}
              >
                Deny
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => onRespond?.(frame.requestId, 'approve')}
              >
                Approve
              </Button>
            </div>
          )}
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'deny') {
    return (
      <RowShell frame={frame} className="px-2 py-1.5">
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </RowShell>
    );
  }

  if (frame.kind === 'raw') {
    return (
      <RowShell frame={frame} className="px-2 py-0.5">
        <Code block>{frame.text}</Code>
      </RowShell>
    );
  }

  if (frame.kind === 'subagent') {
    const r = frame.rollup;
    return (
      <RowShell frame={frame} indent={indent} className="px-2 py-1.5">
        <div className="flex items-center gap-2 rounded-surface border border-hairline bg-raised px-2 py-1 text-caption">
          <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">subagent</span>
          <span className="text-muted">{frame.event}</span>
          {r !== undefined && (
            <span className="flex items-center gap-2 text-muted">
              {r.tools !== undefined && <span>{r.tools} tools</span>}
              {r.tokens !== undefined && <span>{r.tokens} tok</span>}
              {r.cost !== undefined && <span>${r.cost.toFixed(2)}</span>}
              {r.status !== undefined && <span>{r.status}</span>}
            </span>
          )}
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'thinking') {
    return (
      <RowShell frame={frame} indent={indent} className="px-2 py-1.5">
        <div className="rounded-surface border border-hairline bg-subtle px-2 py-1.5">
          <div className="text-eyebrow uppercase tracking-[0.06em] text-faint">thinking</div>
          <div className="mt-1 text-label italic text-muted">{frame.text}</div>
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'plan') {
    const glyph = { pending: Circle, 'in-progress': CircleDot, done: CircleCheck } as const;
    const label = { pending: 'pending', 'in-progress': 'in progress', done: 'done' } as const;
    return (
      <RowShell frame={frame} indent={indent} className="px-2 py-1.5">
        <div className="rounded-surface border border-hairline bg-subtle p-2">
          <div className="text-eyebrow uppercase tracking-[0.06em] text-faint">plan</div>
          <ul className="mt-1 flex flex-col gap-1">
            {frame.items.map((it, i) => {
              const Glyph = glyph[it.status];
              return (
                <li key={i} className="flex items-center gap-2 text-label text-fg">
                  <Glyph aria-hidden size={14} className="shrink-0 text-muted" />
                  <span className="sr-only">{label[it.status]}</span>
                  <span className={cx(it.status === 'done' && 'text-muted line-through')}>
                    {it.text}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'error') {
    return (
      <RowShell frame={frame} indent={indent} className="px-2 py-1.5">
        <div
          role="alert"
          className="rounded-surface border border-danger/40 bg-danger-tint px-2 py-1.5 text-label text-danger-text"
        >
          {frame.message}
        </div>
      </RowShell>
    );
  }

  const role = 'role' in frame ? frame.role : 'agent';
  const isUser = role === 'you';
  const nested = (depth ?? 0) > 0;
  return (
    <RowShell frame={frame} indent={indent} className="px-2 py-2">
      <div
        data-role={role}
        data-spine={!isUser}
        data-nested={nested}
        className={cx(
          isUser
            ? 'my-1 rounded-surface border border-hairline bg-raised'
            : 'ml-2 border-l border-dotted border-border-default pl-4',
          nested && 'ml-4 border-solid', // subagent: one more step + solid spine so nesting stays legible
        )}
      >
        {frame.kind === 'text' && <Markdown source={frame.text} />}
        {frame.kind === 'tool-use' && <ToolCard tool={frame.tool} payload={frame.input} />}
        {frame.kind === 'tool-result' && (
          <ToolCard tool={frame.tool} payload={frame.output} ok={frame.ok} />
        )}
      </div>
    </RowShell>
  );
}

/** A virtualized turn stream (react-virtuoso), grouped by prompt so the nearest user
 *  message stays visible as a sticky header. Empty is the panel's concern (it owns
 *  the EmptyState), so an empty stream renders nothing here. */
export function Transcript({
  frames,
  onRespond,
  label = 'Conversation',
  className,
  showJumpToLatest,
}: TranscriptProps): React.JSX.Element | null {
  const [atBottom, setAtBottom] = useState(true);
  const ref = useRef<GroupedVirtuosoHandle>(null);
  if (frames.length === 0) return null;
  const { counts, headers, items } = groupByUserTurn(frames);
  return (
    <div role="log" aria-label={label} className={cx('relative h-full min-h-0', className)}>
      <GroupedVirtuoso
        ref={ref}
        groupCounts={counts}
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setAtBottom}
        groupContent={(index) => {
          const header = headers[index];
          return header !== undefined && header.kind === 'text' ? (
            <div className="border-b border-hairline bg-surface/95 px-2 py-1.5 backdrop-blur">
              <div className="truncate text-label text-fg">{header.text}</div>
            </div>
          ) : (
            <div className="h-0" />
          );
        }}
        itemContent={(index) => {
          const item = items[index];
          return item === undefined ? null : <TranscriptRow frame={item} onRespond={onRespond} />;
        }}
        computeItemKey={(index) => items[index]?.id ?? index}
      />
      {(showJumpToLatest ?? !atBottom) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto"
            onClick={() =>
              ref.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth', align: 'end' })
            }
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

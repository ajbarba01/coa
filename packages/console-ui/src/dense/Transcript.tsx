import { ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GroupedVirtuoso, type GroupedVirtuosoHandle } from 'react-virtuoso';
import { Button } from '../actions/Button.js';
import { Code } from '../data/Code.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { Spinner } from '../feedback/Spinner.js';
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
      role: TranscriptRole;
      kind: 'tool';
      tool: string;
      input: string;
      handle?: string | undefined;
      output?: string | undefined;
      ok?: boolean | undefined;
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
  /** True while the daemon's `status` push reports `running` — renders the working
   *  footer below the last row. */
  busy?: boolean | undefined;
  /** Epoch ms the current run started, for the footer's live elapsed counter. */
  busySince?: number | undefined;
}

/** Known file-touching tools whose input JSON carries a reviewable path. Tool names
 *  arrive case-sensitively from the SDK, so this list is matched exactly. */
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit', 'Glob', 'Grep']);

const QUICK_INFO_MAX = 60;

/** Pure, defensive extraction of a short "what is this touching" hint for known file
 *  tools, parsed from the raw input JSON. Never throws — unknown tools and
 *  unparseable input both yield `undefined` so the card simply omits the hint.
 *  Exported for unit testing. */
export function toolQuickInfo(tool: string, input: string): string | undefined {
  if (!FILE_TOOLS.has(tool)) return undefined;
  try {
    const parsed: unknown = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const record = parsed as Record<string, unknown>;
    const path = record['file_path'] ?? record['path'] ?? record['pattern'];
    if (typeof path !== 'string' || path.length === 0) return undefined;
    return path.length > QUICK_INFO_MAX ? `${path.slice(0, QUICK_INFO_MAX)}…` : path;
  } catch {
    return undefined;
  }
}

/** A collapse-by-default tool call/result summary that expands on click to reveal
 *  its payload. Collapsed by default keeps the transcript scannable; the hover ring
 *  and rotating caret mark the row as expandable (mockup-review refinement). Carries
 *  both the input and (once streamed) the output so one card is one tool call. */
function ToolCard({
  tool,
  input,
  output,
  ok,
  pending = false,
}: {
  tool: string;
  input?: string | undefined;
  output?: string | undefined;
  ok?: boolean | undefined;
  /** Drives the "running…" affordance. Only the merged `tool` kind (a real
   *  in-flight call) passes this — a standalone `tool-use`/`tool-result`
   *  frame in isolation carries no running signal of its own. */
  pending?: boolean | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const quickInfo = toolQuickInfo(tool, input ?? '');
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-control px-1 py-1.5 hover:ring-1 hover:ring-inset hover:ring-border-default motion-reduce:transition-none"
        aria-expanded={open}
      >
        {/* Caret rotates on toggle (interruptible transition — reduced-motion disables it);
            the hover outline marks the row as expandable (mockup-review refinement). */}
        <ChevronRight
          aria-hidden
          size={12}
          className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')}
        />
        <span className="text-label font-medium text-fg">{tool || 'tool'}</span>
        {quickInfo !== undefined && <span className="text-caption text-muted">{quickInfo}</span>}
        {pending && <span className="text-caption text-faint">running…</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-1">
          {input !== undefined && input.length > 0 && <Code block>{input}</Code>}
          {output !== undefined && (
            <div className="flex flex-col gap-1">
              <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">output</span>
              <Code block>{output}</Code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A collapse-by-default reasoning block: collapsed shows only the `Thinking` label
 *  (no preview of the reasoning text), expands on click to reveal the full text.
 *  Mirrors `ToolCard`'s toggle pattern so the transcript's collapse affordances stay
 *  consistent. */
function ThinkingCard({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-surface border border-hairline bg-subtle">
      {/* Full-width toggle so clicking anywhere on the (collapsed) box expands it; the
          hover fill marks the whole surface as interactive. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-element motion-reduce:transition-none"
        aria-expanded={open}
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx('transition-transform motion-reduce:transition-none', open && 'rotate-90')}
        />
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint">Thinking</span>
      </button>
      {open && <div className="px-2 pb-2 text-label italic text-muted">{text}</div>}
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
  if (frame.kind === 'tool') {
    if (frame.ok === true) return 'success';
    if (frame.ok === false) return 'danger';
    return 'neutral';
  }
  return 'neutral';
}

const dotToneClass = {
  success: 'bg-success',
  danger: 'bg-danger',
  neutral: 'bg-muted',
} as const;

/** The shared left gutter: the status dot with two independent connector segments that
 *  meet at it — one above (`lineTop`), one below (`lineBottom`). `self-stretch` makes the
 *  gutter span the whole row (padding included) so a row's bottom segment abuts the next
 *  row's top segment into one continuous spine. A run's FIRST row omits `lineTop` and its
 *  LAST row omits `lineBottom`, so the line terminates exactly at the end dots instead of
 *  overshooting into the break before/after a user turn. Decorative (`aria-hidden`). */
function SpineGutter({
  tone = 'neutral',
  lineTop = true,
  lineBottom = true,
}: {
  tone?: 'success' | 'danger' | 'neutral' | undefined;
  lineTop?: boolean | undefined;
  lineBottom?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div className="relative w-4 shrink-0 self-stretch">
      {/* The two segments split at 1rem — the dot's vertical mid — so each terminates at
          the dot rather than overshooting past it. */}
      {lineTop && (
        <span
          data-spine-line
          aria-hidden
          className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-hairline"
        />
      )}
      {lineBottom && (
        <span
          data-spine-line
          aria-hidden
          className="absolute bottom-0 left-1/2 top-4 w-px -translate-x-1/2 bg-hairline"
        />
      )}
      <span
        data-dot
        aria-hidden
        className={cx(
          'absolute left-1/2 top-3 inline-block size-2.5 -translate-x-1/2 rounded-full',
          dotToneClass[tone],
        )}
      />
    </div>
  );
}

/** Every row's shared shell: the spine gutter (dot + connector) ahead of the row's own
 *  indent/role styling. Factored out so every early-return branch (approval/deny/
 *  subagent/thinking/error/plan) and the shared text/tool branch get the spine without
 *  duplicating the gutter markup. */
function RowShell({
  frame,
  indent,
  className,
  spineTop = true,
  spineBottom = true,
  children,
}: {
  frame: TranscriptFrame;
  indent?: React.CSSProperties | undefined;
  className?: string | undefined;
  /** Whether the connector reaches up/down out of this row — false at a run's ends so
   *  the spine terminates at its first/last dot rather than into a user-turn break. */
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const tone = dotTone(frame);
  const isUser = 'role' in frame && frame.role === 'you';
  // The vertical padding lives on the CONTENT column, not the flex row, so the
  // `self-stretch` gutter spans the full item height (padding included) and consecutive
  // rows' lines abut into one unbroken spine. Putting the padding on the row instead
  // leaves the line covering only the content box, so every gap between rows shows.
  return (
    <div style={indent} className="flex gap-2 px-2">
      <SpineGutter tone={tone} lineTop={!isUser && spineTop} lineBottom={!isUser && spineBottom} />
      <div className={cx('min-w-0 flex-1', className)}>{children}</div>
    </div>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable without the
 *  virtualized container (which needs measured heights jsdom does not provide).
 *  `spineTop`/`spineBottom` (from the container's {@link itemSpine}) trim the connector
 *  at a run's first/last row; standalone renders default to a full through-line. */
export function TranscriptRow({
  frame,
  onRespond,
  spineTop = true,
  spineBottom = true,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
}): React.JSX.Element {
  const depth = 'depth' in frame ? frame.depth : undefined;
  const indent = depth ? { marginLeft: depth * 16 } : undefined;

  if (frame.kind === 'approval') {
    return (
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-2">
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
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} className="py-2">
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </RowShell>
    );
  }

  if (frame.kind === 'raw') {
    return (
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} className="py-0.5">
        <Code block>{frame.text}</Code>
      </RowShell>
    );
  }

  if (frame.kind === 'subagent') {
    const r = frame.rollup;
    return (
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-2">
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
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-2">
        <ThinkingCard text={frame.text} />
      </RowShell>
    );
  }

  if (frame.kind === 'plan') {
    const glyph = { pending: Circle, 'in-progress': CircleDot, done: CircleCheck } as const;
    const label = { pending: 'pending', 'in-progress': 'in progress', done: 'done' } as const;
    return (
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-2">
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
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-2">
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
    <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} indent={indent} className="py-3">
      <div
        data-role={role}
        data-spine={!isUser}
        data-nested={nested}
        className={cx(isUser && 'my-1 rounded-surface border border-hairline bg-raised')}
      >
        {frame.kind === 'text' && <Markdown source={frame.text} />}
        {frame.kind === 'tool' && (
          <ToolCard
            tool={frame.tool}
            input={frame.input}
            output={frame.output}
            ok={frame.ok}
            pending={frame.output === undefined && frame.ok === undefined}
          />
        )}
        {frame.kind === 'tool-use' && <ToolCard tool={frame.tool} input={frame.input} />}
        {frame.kind === 'tool-result' && (
          <ToolCard tool={frame.tool} output={frame.output} ok={frame.ok} />
        )}
      </div>
    </RowShell>
  );
}

/** Pairs each `tool-use` with its matching `tool-result` (by shared `handle`) into a
 *  single merged `tool` frame, so the transcript renders one card per tool call
 *  instead of two. A `tool-use` with no result yet folds to a `tool` frame missing
 *  `output`/`ok` (still running); an orphan `tool-result` (no preceding use, or an
 *  unseen handle) passes through unchanged — defensive, shouldn't happen live. Every
 *  other kind (including `raw`, so raw mode stays verbatim) passes through in
 *  original order. Pure and exported for unit testing; the container calls this
 *  before grouping. */
export function foldToolFrames(frames: TranscriptFrame[]): TranscriptFrame[] {
  const folded: TranscriptFrame[] = [];
  const indexByHandle = new Map<string, number>();
  for (const frame of frames) {
    if (frame.kind === 'tool-use') {
      const merged: TranscriptFrame = {
        id: frame.id,
        role: frame.role,
        kind: 'tool',
        tool: frame.tool,
        input: frame.input,
        handle: frame.handle,
        depth: frame.depth,
      };
      const index = folded.length;
      folded.push(merged);
      if (frame.handle !== undefined) indexByHandle.set(frame.handle, index);
      continue;
    }
    if (frame.kind === 'tool-result') {
      const index = frame.handle !== undefined ? indexByHandle.get(frame.handle) : undefined;
      const target = index !== undefined ? folded[index] : undefined;
      if (index !== undefined && target !== undefined && target.kind === 'tool') {
        folded[index] = { ...target, output: frame.output, ok: frame.ok };
        continue;
      }
      folded.push(frame);
      continue;
    }
    folded.push(frame);
  }
  return folded;
}

/** The item index (into the flattened `items` array) of a group's first row: the sum
 *  of every preceding group's count. Pure so the sticky header's scroll target is
 *  unit-testable without a virtualized container. Out-of-range indices (e.g. the
 *  leading headerless group has no "previous" group) fall back to `0`. Exported for
 *  unit testing. */
export function groupItemStart(counts: number[], groupIndex: number): number {
  if (groupIndex <= 0) return 0;
  let start = 0;
  for (let i = 0; i < groupIndex && i < counts.length; i++) {
    start += counts[i] ?? 0;
  }
  return start;
}

/** Whether a flattened item row extends the spine up (`top`) and down (`bottom`), from
 *  its position within its group (one agent run between user turns). A run's first row
 *  drops `top` and its last row drops `bottom`, so the connector ends exactly at the run's
 *  end dots. Out-of-range indices default to a full through-line. Pure, exported for tests. */
export function itemSpine(counts: number[], index: number): { top: boolean; bottom: boolean } {
  let start = 0;
  for (const count of counts) {
    if (index < start + count) {
      return { top: index !== start, bottom: index !== start + count - 1 };
    }
    start += count;
  }
  return { top: true, bottom: true };
}

/** How long the landed row stays flagged `data-flash` after a header-click scroll.
 *  Long enough to register as a deliberate highlight, short enough to feel transient. */
const FLASH_MS = 1000;

/** Pure: seconds elapsed since `sinceMs`, formatted for the working footer's counter.
 *  Mirrors `ChatPanel`'s `formatElapsed` (kept local — console-ui does not depend on
 *  the desktop app). */
function formatWorkingElapsed(sinceMs: number, nowMs: number): string {
  return `${Math.floor((nowMs - sinceMs) / 1000)}s`;
}

/** The Virtuoso `Footer` slot rendered while a turn is in flight: a small spinner + a
 *  `working…` label, plus a live elapsed counter once `busySince` is known. Owns its
 *  own 1s interval (mirrors `RunningPill`'s pattern), cleaned up on unmount. Exported so
 *  it is unit-testable directly — a Virtuoso `components.Footer` slot cannot be reached
 *  through the jsdom-free container tests. */
export function WorkingFooter({ busySince }: { busySince?: number | undefined }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (busySince === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busySince]);
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-caption text-faint">
      <Spinner label="working" size={12} />
      <span>working…{busySince !== undefined && ` ${formatWorkingElapsed(busySince, now)}`}</span>
    </div>
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
  busy,
  busySince,
}: TranscriptProps): React.JSX.Element | null {
  const [atBottom, setAtBottom] = useState(true);
  const [flashId, setFlashId] = useState<string | undefined>(undefined);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ref = useRef<GroupedVirtuosoHandle>(null);

  useEffect(() => {
    return () => {
      if (flashTimeout.current !== undefined) clearTimeout(flashTimeout.current);
    };
  }, []);

  // The footer slot is ALWAYS registered (a stable, memoized component) and renders the
  // working row only while `busy` — so when a run finishes the slot flips to `null`,
  // unmounting `WorkingFooter` (which stops its interval and resets the elapsed clock for
  // the next run). Conditionally *omitting* `components` instead leaves Virtuoso showing
  // the last footer, which is why it never stopped.
  const footerComponents = useMemo(
    () => ({
      Footer: (): React.JSX.Element | null =>
        busy === true ? <WorkingFooter busySince={busySince} /> : null,
    }),
    [busy, busySince],
  );

  if (frames.length === 0) return null;
  const { counts, headers, items } = groupByUserTurn(foldToolFrames(frames));

  const jumpToHeader = (groupIndex: number, frameId: string): void => {
    // Smooth lerp to the turn. The old "snap back" was `followOutput` re-pinning to the
    // bottom, now gated to only run while streaming — so the smooth scroll lands and stays.
    ref.current?.scrollToIndex({
      index: groupItemStart(counts, groupIndex),
      align: 'start',
      behavior: 'smooth',
    });
    if (flashTimeout.current !== undefined) clearTimeout(flashTimeout.current);
    setFlashId(frameId);
    flashTimeout.current = setTimeout(() => setFlashId(undefined), FLASH_MS);
  };

  return (
    <div role="log" aria-label={label} className={cx('relative h-full min-h-0', className)}>
      <GroupedVirtuoso
        ref={ref}
        groupCounts={counts}
        // Only stick to the bottom while a turn is streaming (`busy`) AND the user is
        // already at the bottom. When idle we never auto-scroll, so clicking jump-to-latest
        // or a sticky header lands you there and STAYS — no re-pin fighting a manual scroll.
        followOutput={busy === true ? (isAtBottom) => (isAtBottom ? 'auto' : false) : false}
        atBottomStateChange={setAtBottom}
        groupContent={(index) => {
          const header = headers[index];
          if (header === undefined || header.kind !== 'text') return <div className="h-0" />;
          const isFlashed = flashId !== undefined && flashId === header.id;
          // The sticky header is a COMPACT, single-line bar of uniform height. GroupedVirtuoso
          // only pushes one sticky header cleanly out of frame with the next when headers are
          // short and uniform — tall/variable/multiline headers overlap instead (a documented
          // react-virtuoso limitation). The full prompt is available on hover (`title`). The
          // user turn is NOT on the spine: the line breaks before/after it (agent dots bookend),
          // and the solid backing (matching the Pane) fully hides the outgoing header on push.
          return (
            <div className="flex gap-2 border-b border-hairline bg-surface px-2 py-2">
              <div aria-hidden className="w-4 shrink-0" />
              <button
                type="button"
                onClick={() => jumpToHeader(index, header.id)}
                title={header.text}
                data-flash={isFlashed}
                className={cx(
                  'min-w-0 flex-1 cursor-pointer rounded-surface border border-hairline bg-raised px-2 py-1.5 text-left hover:bg-element',
                  isFlashed && 'bg-info-tint ring-1 ring-inset ring-info/40',
                )}
              >
                <div className="truncate text-label text-fg">{header.text}</div>
              </button>
            </div>
          );
        }}
        itemContent={(index) => {
          const spine = itemSpine(counts, index);
          const item = items[index];
          return item === undefined ? null : (
            <TranscriptRow
              frame={item}
              onRespond={onRespond}
              spineTop={spine.top}
              spineBottom={spine.bottom}
            />
          );
        }}
        computeItemKey={(index) => items[index]?.id ?? index}
        components={footerComponents}
      />
      {(showJumpToLatest ?? !atBottom) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto bg-raised"
            onClick={() =>
              ref.current?.scrollToIndex({ index: items.length - 1, align: 'end', behavior: 'smooth' })
            }
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

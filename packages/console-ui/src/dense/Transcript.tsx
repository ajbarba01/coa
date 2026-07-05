import { ArrowUp, ChevronRight, Circle, CircleCheck, CircleDot } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../actions/Button.js';
import { CopyButton } from '../actions/CopyButton.js';
import { IconButton } from '../actions/IconButton.js';
import { Code } from '../data/Code.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { Spinner } from '../feedback/Spinner.js';
import { findMatches } from './find.js';
import { FindBar } from './FindBar.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { nearBottom, previousPromptIndex } from './scrollState.js';
import { cx } from '../lib/cx.js';

/** Reveal a touched file (from a tool card's path/match link) in the editor/OS at an
 *  optional line. Supplied live by `ChatPanel` (backed by the reveal IPC); omitted in
 *  read-only surfaces, where the path renders as plain text. */
export type OpenPathFn = (path: string, line?: number) => void;

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
  | { id: string; kind: 'note'; text: string }
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
   *  never denies; the daemon owns the real decision (SC-1). MUST be referentially
   *  stable across renders (e.g. a stable action ref, not an inline arrow) — `MemoRow`
   *  is a `React.memo` keyed on prop identity, so an unstable `onRespond` would
   *  re-render every row on every streamed frame, defeating that memoization. */
  onRespond?: RespondFn | undefined;
  /** Reveal a touched file (from a tool card's path/match link) in the editor/OS at an
   *  optional line. Like `onRespond`, MUST be referentially stable across renders — it is
   *  threaded into `MemoRow` (a `React.memo`), so an unstable ref would defeat that
   *  memoization and re-render every row on every streamed frame. Omitted ⇒ paths render
   *  as plain text (no link). */
  onOpenPath?: OpenPathFn | undefined;
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
  /** Bump (change value) to force a re-pin to bottom even if the user has scrolled
   *  up — e.g. on sending a new message, so the new turn snaps into view. */
  jumpNonce?: number | undefined;
  /** Pixels of bottom padding reserved inside the scroll region so the last row can
   *  clear a control (the floating composer) that overlaps the transcript's bottom
   *  edge. Because the padding lives on the scrolled content, stick-to-bottom scrolls
   *  the final row fully into view above the overlap instead of behind it; the
   *  jump-to-latest control is lifted by the same amount so it never hides under the
   *  overlapping control either. */
  bottomInset?: number | undefined;
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

/** A collapse-by-default reasoning block: never boxed (no bg, no click surface) —
 *  just a caret + `Thinking` label, expanding on click to reveal the full text
 *  underneath (also unboxed). Deliberately plainer than {@link ToolCard} — the
 *  reasoning trace is a quiet aside, not a distinct unit. */
function ThinkingCard({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex items-center gap-1.5 text-left motion-reduce:transition-none"
        aria-expanded={open}
      >
        <ChevronRight
          aria-hidden
          size={12}
          className={cx(
            'shrink-0 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        />
        <span className="text-eyebrow uppercase tracking-[0.06em] text-faint transition-colors group-hover:text-muted">
          Thinking
        </span>
      </button>
      {open && <div className="pl-4.5 text-label italic text-muted">{text}</div>}
    </div>
  );
}

/** Pure classification of a frame's outcome for the gutter status dot: errors and
 *  denies read danger, a tool-result's `ok` flag decides success vs danger, and
 *  everything else (text/tool-use/thinking/plan/approval/subagent/raw/note) is neutral —
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
  showDot = true,
}: {
  tone?: 'success' | 'danger' | 'neutral' | undefined;
  lineTop?: boolean | undefined;
  lineBottom?: boolean | undefined;
  showDot?: boolean | undefined;
}): React.JSX.Element {
  // Dot geometry: `top-3` = 0.75rem (12 px), `size-2.5` = 0.625rem (10 px).
  // Dot spans [12 px, 22 px].  The line above runs from the gutter's top edge
  // to the dot; the line below runs from the dot to the gutter's bottom edge.
  // Rows use `pb-1` (no flex gap), so consecutive gutters abut at zero distance
  // and the line is one continuous vertical — no overflow tricks needed.
  return (
    <div className="relative w-4 shrink-0 self-stretch">
      {lineTop && (
        <span
          data-spine-line
          aria-hidden
          className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-hairline"
        />
      )}
      {lineBottom && (
        <span
          data-spine-line
          aria-hidden
          className="absolute bottom-0 left-1/2 top-[calc(0.75rem+0.625rem)] w-px -translate-x-1/2 bg-hairline"
        />
      )}
      {showDot && (
        <span
          data-dot
          aria-hidden
          className={cx(
            'absolute left-1/2 top-3 inline-block size-2.5 -translate-x-1/2 rounded-full',
            dotToneClass[tone],
          )}
        />
      )}
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
    <div style={indent} className="flex gap-3 px-2">
      <SpineGutter tone={tone} lineTop={!isUser && spineTop} lineBottom={!isUser && spineBottom} showDot={!isUser} />
      <div className={cx('min-w-0 flex-1', className)}>{children}</div>
    </div>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable independent of the
 *  container. `spineTop`/`spineBottom` default to a full through-line — the spine breaks
 *  only at user rows, via {@link RowShell}'s own `isUser` check, so a run reads continuous
 *  between user turns without any group math. */
export function TranscriptRow({
  frame,
  onRespond,
  onOpenPath,
  spineTop = true,
  spineBottom = true,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
  onOpenPath?: OpenPathFn | undefined;
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
}): React.JSX.Element {
  const depth = 'depth' in frame ? frame.depth : undefined;
  const indent = depth ? { marginLeft: depth * 16 } : undefined;

  if (frame.kind === 'approval') {
    return (
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-2"
      >
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

  if (frame.kind === 'note') {
    // A console-local synthetic system note (e.g. a mid-session model switch) — never
    // sent to the agent, so it renders as a quiet centered rule rather than a turn: no
    // spine dot emphasis, no gutter, just a flanked caption.
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-caption text-faint">
        <span className="h-px flex-1 bg-hairline" />
        <span>{frame.text}</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>
    );
  }

  if (frame.kind === 'subagent') {
    const r = frame.rollup;
    return (
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-2"
      >
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
    // Defensive: the viewmodel already drops blank thinking frames (turn-map.ts), but an
    // empty expander is dishonest UI, so guard here too rather than trust the caller.
    if (frame.text.trim().length === 0) return <></>;
    return (
      // `pt-2.5` (not the shared `py-2`) centers the caret+"Thinking" line on the gutter
      // dot — the header is the frame's only always-visible line, so it is the one that
      // must land on the dot, not the row's overall padding.
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="pt-2.5 pb-2"
      >
        <ThinkingCard text={frame.text} />
      </RowShell>
    );
  }

  if (frame.kind === 'plan') {
    const glyph = { pending: Circle, 'in-progress': CircleDot, done: CircleCheck } as const;
    const label = { pending: 'pending', 'in-progress': 'in progress', done: 'done' } as const;
    return (
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-2"
      >
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
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-2"
      >
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
    <RowShell
      frame={frame}
      spineTop={spineTop}
      spineBottom={spineBottom}
      indent={indent}
      // Uniform vertical rhythm for every text/tool row (~20-24px between turns
      // combined with the container's `gap-1`); tool cards' own box interior handles
      // their internal alignment.
      className="py-3"
    >
      <div
        data-role={role}
        data-spine={!isUser}
        data-nested={nested}
        className={cx('min-w-0', isUser && 'my-1 rounded-surface bg-raised px-3 py-2 shadow-sm')}
      >
        {frame.kind === 'text' && (
          <div className="group relative">
            {!isUser && (
              <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100">
                <CopyButton text={frame.text} />
              </div>
            )}
            <Markdown source={frame.text} />
          </div>
        )}
        {frame.kind === 'tool' && (
          <ToolCard
            tool={frame.tool}
            input={frame.input}
            output={frame.output}
            ok={frame.ok}
            onOpenPath={onOpenPath}
          />
        )}
        {frame.kind === 'tool-use' && (
          <ToolCard tool={frame.tool} input={frame.input} onOpenPath={onOpenPath} />
        )}
        {/* A standalone tool-result carries no input; the kit card takes `input: string`,
            so pass '' — the header falls back to its summary and the output body renders. */}
        {frame.kind === 'tool-result' && (
          <ToolCard
            tool={frame.tool}
            input=""
            output={frame.output}
            ok={frame.ok}
            onOpenPath={onOpenPath}
          />
        )}
      </div>
    </RowShell>
  );
}

/** Caches the merged `tool` frame produced for a given `tool-use` frame, keyed by that
 *  `tool-use` object's identity, alongside the paired `tool-result` object it was built
 *  from (or `undefined` if still pending). Lets a later fold reuse the same merged
 *  object — and so keep `MemoRow`'s memo hitting — when neither input has changed. */
const foldedToolCache = new WeakMap<
  TranscriptFrame,
  { result: TranscriptFrame | undefined; merged: TranscriptFrame }
>();

/** Pairs each `tool-use` with its matching `tool-result` (by shared `handle`) into a
 *  single merged `tool` frame, so the transcript renders one card per tool call
 *  instead of two. A `tool-use` with no result yet folds to a `tool` frame missing
 *  `output`/`ok` (still running); an orphan `tool-result` (no preceding use, or an
 *  unseen handle) passes through unchanged — defensive, shouldn't happen live. Every
 *  other kind (including `raw`, so raw mode stays verbatim) passes through in
 *  original order, by reference (stable identity once the caller's frame list itself
 *  is stable — see `ChatPanel`'s frame caches). Pure and exported for unit testing;
 *  the container calls this once per `frames` change. */
export function foldToolFrames(frames: TranscriptFrame[]): TranscriptFrame[] {
  const folded: TranscriptFrame[] = [];
  const indexByHandle = new Map<string, number>();
  // Track which `tool-use` frame backs each folded index, so a later tool-result can
  // look up + update the identity cache keyed on that tool-use.
  const useFrameByIndex = new Map<number, TranscriptFrame>();
  for (const frame of frames) {
    if (frame.kind === 'tool-use') {
      const cached = foldedToolCache.get(frame);
      // A fresh tool-use with no result seen yet reuses its cached pending merge only
      // if the cache also recorded no result — i.e. nothing has changed.
      const merged: TranscriptFrame =
        cached !== undefined && cached.result === undefined
          ? cached.merged
          : {
              id: frame.id,
              role: frame.role,
              kind: 'tool',
              tool: frame.tool,
              input: frame.input,
              handle: frame.handle,
              depth: frame.depth,
            };
      if (cached === undefined || cached.result === undefined) {
        foldedToolCache.set(frame, { result: undefined, merged });
      }
      const index = folded.length;
      folded.push(merged);
      useFrameByIndex.set(index, frame);
      if (frame.handle !== undefined) indexByHandle.set(frame.handle, index);
      continue;
    }
    if (frame.kind === 'tool-result') {
      const index = frame.handle !== undefined ? indexByHandle.get(frame.handle) : undefined;
      const target = index !== undefined ? folded[index] : undefined;
      const useFrame = index !== undefined ? useFrameByIndex.get(index) : undefined;
      if (index !== undefined && target !== undefined && target.kind === 'tool' && useFrame !== undefined) {
        const cached = foldedToolCache.get(useFrame);
        if (cached !== undefined && cached.result === frame) {
          // Same tool-use, same tool-result reference as last time — reuse the merge.
          folded[index] = cached.merged;
          continue;
        }
        const merged: TranscriptFrame = { ...target, output: frame.output, ok: frame.ok };
        foldedToolCache.set(useFrame, { result: frame, merged });
        folded[index] = merged;
        continue;
      }
      folded.push(frame);
      continue;
    }
    folded.push(frame);
  }
  return folded;
}

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
export function WorkingFooter({
  busySince,
}: {
  busySince?: number | undefined;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (busySince === undefined) return;
    // `now` may be stale from a previous run — resync immediately rather than waiting
    // for the first 1s tick, or the counter briefly reads a bogus elapsed value.
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [busySince]);
  return (
    <div className="flex items-center justify-center gap-2 px-2 py-1.5 text-body text-muted">
      <Spinner label="working" size={14} />
      <span>working…{busySince !== undefined && ` ${formatWorkingElapsed(busySince, now)}`}</span>
    </div>
  );
}

/** Memoized so a streamed frame re-renders only the appended row, and `content-visibility`
 *  lets the browser skip layout/paint for off-screen rows while keeping them in the DOM
 *  (full-transcript selection + Ctrl-F). `contain-intrinsic-size` is a height estimate that
 *  prevents scrollbar jump; tuned to a typical row. */
const MemoRow = memo(function MemoRow({
  frame,
  onRespond,
  onOpenPath,
  index,
  findActive = false,
  spineTop = true,
  spineBottom = true,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
  onOpenPath?: OpenPathFn | undefined;
  index: number;
  /** True when this row is the active find-in-conversation match — rings the row so
   *  prev/next navigation has a visible landing target. */
  findActive?: boolean | undefined;
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Appear-on-mount via the Web Animations API rather than a CSS keyframe (no
  // globals.css touch — see the task's workspace note). Skipped under
  // prefers-reduced-motion; `animate` is guarded since jsdom stubs it inconsistently.
  useLayoutEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    ref.current?.animate?.(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 140, easing: 'ease-out' },
    );
  }, []);
  return (
    <div
      ref={ref}
      data-row-index={index}
      data-find-active={findActive || undefined}
      className={cx('pb-1', findActive && 'rounded-surface ring-1 ring-info bg-info-tint')}
      style={
        { contentVisibility: 'auto', containIntrinsicSize: 'auto 60px' } as React.CSSProperties
      }
    >
      <TranscriptRow
        frame={frame}
        onRespond={onRespond}
        onOpenPath={onOpenPath}
        spineTop={spineTop}
        spineBottom={spineBottom}
      />
    </div>
  );
});

/** A non-virtualized turn stream: every frame renders to the DOM (no windowing), so
 *  selection and Ctrl-F work across the full transcript; `content-visibility: auto` on
 *  each row keeps off-screen rows out of layout/paint without unmounting them. Native
 *  scroll + a bottom sentinel drive stick-to-bottom. Empty is the panel's concern (it
 *  owns the EmptyState), so an empty stream renders nothing here. */
export function Transcript({
  frames,
  onRespond,
  onOpenPath,
  label = 'Conversation',
  className,
  showJumpToLatest,
  busy,
  busySince,
  jumpNonce,
  bottomInset,
}: TranscriptProps): React.JSX.Element | null {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  // Suppress onScroll + stick-to-bottom during programmatic scrolls:
  //  • smooth-scroll onScroll events can fire at the start before the view
  //    has left the nearBottom threshold, re-enabling stick-to-bottom
  //  • scrollend fires prematurely when a new agent block mutates the DOM
  //    during the animation (changes scrollHeight), clearing the guard early
  // A short timeout outlives the smooth-scroll animation (typically ~300ms)
  // and is not invalidated by DOM mutations. Each navigation resets it.
  const navigatingRef = useRef(false);
  const navTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startNav = (): void => {
    navigatingRef.current = true;
    if (navTimerRef.current !== undefined) clearTimeout(navTimerRef.current);
    navTimerRef.current = setTimeout(() => {
      navigatingRef.current = false;
      navTimerRef.current = undefined;
    }, 400);
  };

  // Folded once per frames change (was recomputed every render).
  const items = useMemo(() => foldToolFrames(frames), [frames]);

  // Run-boundary index sets: a "run" is a contiguous block of non-user, non-note
  // frames.  The spine starts at the first dot of a run (lineTop suppressed) and
  // ends at the last dot (lineBottom suppressed) so it never reaches into user turns.
  const { spineStarts, spineEnds } = useMemo(() => {
    const starts = new Set<number>();
    const ends = new Set<number>();
    const spineIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (f === undefined) continue;
      const isUser = 'role' in f && f.role === 'you';
      const isNote = f.kind === 'note';
      if (!isUser && !isNote) spineIndices.push(i);
    }
    // Group contiguous indices into runs.
    let i = 0;
    while (i < spineIndices.length) {
      const start = spineIndices[i];
      if (start === undefined) break;
      starts.add(start);
      let j = i;
      let jVal = start;
      while (j + 1 < spineIndices.length) {
        const nextVal = spineIndices[j + 1];
        if (nextVal === undefined || nextVal !== jVal + 1) break;
        j++;
        jVal = nextVal;
      }
      ends.add(jVal);
      i = j + 1;
    }
    return { spineStarts: starts, spineEnds: ends };
  }, [items]);

  // Find-in-conversation (Ctrl/Cmd+F): every frame is in the DOM (no windowing), so
  // find can search the full transcript, not just the visible window.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const matches = useMemo(() => findMatches(items, findQuery), [items, findQuery]);

  // Clean up the navigation-guard timer on unmount.
  useEffect(() => {
    return () => {
      if (navTimerRef.current !== undefined) clearTimeout(navTimerRef.current);
    };
  }, []);

  // Ctrl/Cmd+F opens the in-transcript find bar instead of the browser's own find,
  // since every frame already renders to the DOM. Scoped to this component's
  // lifetime via add/removeEventListener in the effect cleanup.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFindOpen(true);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findOpen]);

  // Reset to the first match whenever the query (or the underlying frame set) changes
  // matches, so navigation never lands on a stale index past the new match count.
  useEffect(() => {
    setActiveMatch(0);
  }, [findQuery, items]);

  const scrollToMatch = (matchIndex: number): void => {
    const match = matches[matchIndex];
    if (match === undefined) return;
    startNav();
    const row = scroller.current?.querySelector(`[data-row-index="${match.index}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const findNext = (): void => {
    if (matches.length === 0) return;
    const next = (activeMatch + 1) % matches.length;
    setActiveMatch(next);
    scrollToMatch(next);
  };

  const findPrev = (): void => {
    if (matches.length === 0) return;
    const prev = (activeMatch - 1 + matches.length) % matches.length;
    setActiveMatch(prev);
    scrollToMatch(prev);
  };

  const activeMatchFrameIndex = matches[activeMatch]?.index;

  // Stick-to-bottom: while pinned and content grows, keep the sentinel in view. A
  // ResizeObserver on the content fires on every appended/streamed row.
  // Skipped during programmatic navigation (navigatingRef) — otherwise a smooth
  // scroll animation's early onScroll events can re-enable pinned and abort the
  // navigation by yanking the sentinel back into view.
  useLayoutEffect(() => {
    if (!pinned || navigatingRef.current) return;
    sentinel.current?.scrollIntoView({ block: 'end' });
  });

  // Snap-to-sent: a bump of jumpNonce (e.g. on send) force-pins to bottom even if the
  // user had scrolled up, so their new turn snaps into view. Skipped on mount
  // (jumpNonce === undefined) — only a change fires it.
  useLayoutEffect(() => {
    if (jumpNonce === undefined) return;
    startNav();
    setPinned(true);
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [jumpNonce]);

  const onScroll = (): void => {
    if (navigatingRef.current) return;
    const el = scroller.current;
    if (el === null) return;
    setPinned(nearBottom(el.scrollTop, el.clientHeight, el.scrollHeight));
  };

  const jumpToLatest = (): void => {
    startNav();
    setPinned(true);
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  };

  /** Scrolls to the nearest user row above the viewport top ("↑ previous prompt").
   *  The topmost row whose offset is at/above the current scrollTop approximates the
   *  first fully-visible row; previousPromptIndex walks up from there to the nearest
   *  user turn. */
  const jumpToPrompt = (): void => {
    const el = scroller.current;
    if (el === null) return;
    const rows = el.querySelectorAll('[data-row-index]');
    let top = 0;
    rows.forEach((r) => {
      if (r instanceof HTMLElement && r.offsetTop <= el.scrollTop + 4)
        top = Number(r.dataset['rowIndex']);
    });
    const target = previousPromptIndex(items, top);
    if (target === undefined) return;
    startNav();
    const el2 = el.querySelector(`[data-row-index="${target}"]`);
    if (el2 instanceof HTMLElement) el2.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setPinned(false);
  };

  if (items.length === 0) return null;
  const showJump = showJumpToLatest ?? !pinned;

  return (
    <div className={cx('relative h-full min-h-0', className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-label={label}
        // Native scroll; content capped to a readable measure and centered (§5.2).
        className="h-full overflow-y-auto"
      >
        <div className="flex flex-col">
          {items.map((item, index) => (
            <MemoRow
              key={item.id}
              frame={item}
              onRespond={onRespond}
              onOpenPath={onOpenPath}
              index={index}
              findActive={findOpen && index === activeMatchFrameIndex}
              spineTop={!spineStarts.has(index)}
              spineBottom={!spineEnds.has(index)}
            />
          ))}
          {busy === true && <WorkingFooter busySince={busySince} />}
          {/* Reserve space below the last row for a control that overlaps the scroll
              region's bottom (the floating composer). The spacer sits BEFORE the
              sentinel, so pinning to the sentinel rests with this gap at the bottom —
              the final row clears the overlap instead of hiding behind it. */}
          {bottomInset !== undefined && bottomInset > 0 && (
            <div aria-hidden style={{ height: bottomInset }} />
          )}
          <div ref={sentinel} aria-hidden className="h-0" />
        </div>
      </div>
      {findOpen && (
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <FindBar
            query={findQuery}
            onQueryChange={setFindQuery}
            current={matches.length === 0 ? 0 : activeMatch + 1}
            total={matches.length}
            onPrev={findPrev}
            onNext={findNext}
            onClose={() => setFindOpen(false)}
          />
        </div>
      )}
      <div
        className={cx('pointer-events-none absolute right-2 z-10', findOpen ? 'top-12' : 'top-2')}
      >
        <IconButton
          icon={ArrowUp}
          label="Previous prompt"
          variant="secondary"
          size="sm"
          className="pointer-events-auto bg-raised"
          onClick={jumpToPrompt}
        />
      </div>
      {showJump && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-0 z-10 flex justify-center',
            // With no overlap the 8pt-grid `bottom-2` applies; a floating composer lifts
            // the control above it via an inline offset (a runtime pixel measurement, not
            // a design value — it must match the composer's measured height).
            !bottomInset && 'bottom-2',
          )}
          {...(bottomInset ? { style: { bottom: bottomInset + 8 } } : {})}
        >
          <Button
            variant="secondary"
            size="sm"
            className="pointer-events-auto bg-raised"
            onClick={jumpToLatest}
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

import { Tooltip } from '@coa/console-kit';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DenyNotice } from '../DenyNotice.js';
import { findTermMatches } from './find.js';
import { clearFindHighlights, paintFindHighlights } from './findHighlight.js';
import { FindBar } from './FindBar.js';
import { Markdown } from './Markdown.js';
import { splitWords } from './markdownBlocks.js';
import { defaultReveal } from './reveal.js';
import { StreamingMarkdown } from './StreamingMarkdown.js';
import { formatTokens } from './tokenEstimate.js';
import { ToolCard } from './ToolCard.js';
import { nearBottom } from './scrollState.js';
import { cx } from '@coa/console-kit';

/** Reveal a touched file (from a tool card's path/match link) in the editor/OS at an
 *  optional line. Supplied live by `ChatPanel` (backed by the reveal IPC); omitted in
 *  read-only surfaces, where the path renders as plain text. */
export type OpenPathFn = (path: string, line?: number) => void;

/** Open a web URL (a WebSearch result link, a WebFetch source) in the default browser.
 *  Supplied live by `ChatPanel` (backed by the openExternal IPC); omitted where URLs
 *  render as plain text. Like `onOpenPath`, MUST be referentially stable across renders. */
export type OpenUrlFn = (url: string) => void;

export type { TranscriptFrame, TranscriptRole } from './frames.js';
import type { TranscriptFrame } from './frames.js';

/** The approval-decision callback the composer's docked gate uses (surfacing only;
 *  the daemon owns the real decision). Lives here as the shared type for `ChatVm`; the
 *  transcript itself no longer actions approvals (a pending gate docks to the composer). */
export type RespondFn = (requestId: string, decision: 'approve' | 'deny') => void;

export interface TranscriptProps {
  frames: TranscriptFrame[];
  /** Reveal a touched file (from a tool card's path/match link) in the editor/OS at an
   *  optional line. MUST be referentially stable across renders — it is threaded into
   *  `MemoRow` (a `React.memo`), so an unstable ref would defeat that memoization and
   *  re-render every row on every streamed frame. Omitted ⇒ paths render as plain text. */
  onOpenPath?: OpenPathFn | undefined;
  /** Open a web URL (a tool card's WebSearch/WebFetch link) in the default browser. Like
   *  `onOpenPath`, MUST be referentially stable across renders (threaded into `MemoRow`).
   *  Omitted ⇒ URLs render as plain text. */
  onOpenUrl?: OpenUrlFn | undefined;
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
  /** Pixels of reserved space at the bottom of the scroll content for the floating
   *  composer that sits over the transcript's floor. The scroller runs the full panel
   *  height (the composer floats OVER it), and a same-height spacer inside the scrolled
   *  content reserves clearance so the last row clears the composer on stick-to-bottom;
   *  the jump-to-latest pill is lifted by the same amount so it never hides behind it. */
  bottomInset?: number | undefined;
  /** Identity for scroll memory (the session id). A remount with the same key
   *  restores the reader's place: a mid-transcript offset comes back exactly;
   *  a bottom-pinned session re-pins. Omitted ⇒ every mount starts pinned. */
  scrollKey?: string | undefined;
  /** False while this instance is a hidden (kept-alive) tab: global keys, the
   *  stick-to-bottom observer, scroll saves, and find highlights all stand
   *  down, and reactivation restores the session's remembered place (a
   *  display:none pass wipes the live scroll position). Defaults to true. */
  active?: boolean | undefined;
  /** Does this event carry the app's "find in conversation" command? The chord is the
   *  app's to name (it is rebindable there) — omitted, the component keeps its own
   *  ctrl/cmd+F so it still works standalone. */
  findMatch?: ((e: KeyboardEvent) => boolean) | undefined;
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

/** A rough token estimate from text (≈4 chars/token) for the reasoning title. Derived from
 *  the persisted `text`, so it is identical live and on reload with no separate persisted
 *  field. An estimate, not a tokenizer count. Exported for unit testing. */
export function estimateTokens(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : Math.max(1, Math.round(t.length / 4));
}

/** A collapse-by-default reasoning block: never boxed (no bg, no click surface) —
 *  just a caret + `Thinking`/`Thought` label, expanding on click to reveal the full text
 *  underneath (also unboxed). Deliberately plainer than {@link ToolCard} — the
 *  reasoning trace is a quiet aside, not a distinct unit. */
function ThinkingCard({
  text,
  streaming,
  durationMs,
}: {
  text: string;
  streaming?: boolean | undefined;
  durationMs?: number | undefined;
}): React.JSX.Element {
  const cfg = defaultReveal.reasoning;
  const auto = cfg.mode === 'auto-expand';
  const [open, setOpen] = useState(auto ? streaming === true : false);
  const [userTouched, setUserTouched] = useState(false);

  useEffect(() => {
    if (userTouched || !auto) return;
    // auto-expand only: open while streaming, then melt closed after the delay so the answer
    // eases up to meet it (the .cx-collapse height transition does the easing).
    if (streaming === true) {
      setOpen(true);
      return;
    }
    const t = setTimeout(() => setOpen(false), cfg.collapseDelayMs);
    return () => clearTimeout(t);
  }, [streaming, auto, userTouched, cfg.collapseDelayMs]);

  const tokens = estimateTokens(text);
  const tokenSuffix = tokens > 0 ? ` · ${tokens} toks` : '';
  // The duration is read from the PERSISTED frame (the daemon stamps it from the delta→settle timing),
  // never measured live here — a reloaded block never streamed, so a live wall-clock could not
  // reproduce it, which was the "reverts to Thinking on reload" mismatch. A settled block is
  // past-tense regardless ("thought"), with the seconds only when the duration is known.
  const secs = durationMs !== undefined ? Math.max(1, Math.round(durationMs / 1000)) : undefined;
  const label =
    streaming === true
      ? `Thinking${tokenSuffix}`
      : `${secs !== undefined ? `Thought for ${secs}s` : 'Thought'}${tokenSuffix}`;
  // `shimmer` mode: the collapsed label shimmers while the trace streams (no auto-expand).
  const shimmering = streaming === true && cfg.mode === 'shimmer';
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          setUserTouched(true);
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="slip group flex cursor-pointer items-center gap-1.5 self-start py-px font-mono text-meta text-s8 hover:text-s10"
      >
        <span
          aria-hidden
          className={cx('slip-move inline-block text-[9px] text-s6', open && 'rotate-90')}
        >
          ▸
        </span>
        <span
          className={cx(
            shimmering && 'cx-shimmer',
            streaming === true && !shimmering && 'motion-safe:animate-pulse',
          )}
        >
          {label}
        </span>
      </button>
      <div
        className="cx-collapse pl-4"
        data-open={open ? 'true' : 'false'}
        aria-hidden={open ? undefined : true}
        style={{ '--collapse-dur': `${cfg.collapseDurationMs}ms` } as React.CSSProperties}
      >
        <div className="cx-collapse-inner">
          {/* A quiet aside, not a unit of work: the reasoning trace is a flat italic
              monospace run, never Markdown prose (that would render it at body size with
              block spacing). Streaming reveals per word; settled is plain text — a soft
              newline flows as a space, matching the design reference's ThinkRow. */}
          <div
            className="pt-1 text-code leading-[1.6] text-s9 italic"
            {...(streaming === true
              ? {
                  'data-reveal': defaultReveal.text.variant,
                  style: {
                    '--reveal-dur': `${defaultReveal.text.durationMs}ms`,
                  } as React.CSSProperties,
                }
              : {})}
          >
            {streaming === true
              ? splitWords(text).map((t, i) =>
                  t.word ? (
                    <span key={i} className="cx-word">
                      {t.value}
                    </span>
                  ) : (
                    <span key={i}>{t.value}</span>
                  ),
                )
              : text}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Maps a live subagent event to the indicator law's state vocabulary (a dot is state,
 *  never a word). `rollup` is handled separately by its own success/failure check. */
const SUB_STATUS: Record<
  Exclude<Extract<TranscriptFrame, { kind: 'subagent' }>['event'], 'rollup'>,
  'running' | 'needs-you' | 'idle' | 'done'
> = {
  'spawn-proposal': 'needs-you',
  spawn: 'running',
  running: 'running',
  idle: 'idle',
  done: 'done',
};

/** A plan item's status, as the screen reader announces it. */
const PLAN_STATUS_LABEL: Record<'pending' | 'in-progress' | 'done', string> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  done: 'Done',
};

/** The event is the VALUE; this is the word the row wears. */
const SUB_EVENT_LABEL: Record<
  'spawn-proposal' | 'spawn' | 'running' | 'idle' | 'done' | 'rollup',
  string
> = {
  'spawn-proposal': 'Proposed',
  spawn: 'Spawned',
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
  rollup: 'Rollup',
};

const SUBAGENT_DOT_COLOR: Record<'running' | 'needs-you' | 'idle' | 'done' | 'critical', string> = {
  running: 'bg-run',
  'needs-you': 'bg-warn',
  idle: 'bg-s5',
  done: 'bg-ok',
  critical: 'bg-crit',
};

/** A small decorative status dot for the subagent row, matching the sand-scale state
 *  vocabulary used elsewhere in the kit (blue = running, amber = needs-you, red =
 *  critical, green = done, grey = idle). Adjacent text always carries the meaning, so
 *  the dot itself is `aria-hidden`. */
function SubagentDot({
  status,
}: {
  status: 'running' | 'needs-you' | 'idle' | 'done' | 'critical';
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cx('inline-block size-[5px] flex-none rounded-full', SUBAGENT_DOT_COLOR[status])}
    />
  );
}

/** Every row's shared shell. A row is clean — no status gutter, no connector: the only
 *  left-edge structure is the hairline rail a nested (depth>0) frame wears, which reads as
 *  an indented subagent thread (matches the design reference's `FrameList`). The column
 *  owns the horizontal measure (`px-8`) and the inter-row rhythm (its `gap`), so a row adds
 *  only whatever internal padding its own content needs, via `className`. */
function RowShell({
  indent,
  className,
  children,
}: {
  /** Set only for a depth>0 row — the `paddingLeft` that offsets content from the rail. */
  indent?: React.CSSProperties | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  // A depth>0 row wears a left hairline rail (`indent` is set only when nested — see
  // TranscriptRow). The stream is flat (one memoized row per frame), so a run of nested
  // rows can't share one wrapping rail the way the design reference does; giving every
  // nested row its OWN border at the same left offset reads as one continuous line.
  return (
    <div
      style={indent}
      className={cx('min-w-0', indent !== undefined && 'border-l border-s3', className)}
    >
      {children}
    </div>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable independent of the
 *  container. A pending approval renders nothing here (it docks to the composer); a
 *  resolved one is a plain receipt. */
export function TranscriptRow({
  frame,
  onOpenPath,
  onOpenUrl,
}: {
  frame: TranscriptFrame;
  onOpenPath?: OpenPathFn | undefined;
  onOpenUrl?: OpenUrlFn | undefined;
}): React.JSX.Element {
  const depth = 'depth' in frame ? frame.depth : undefined;
  // Left padding scaled by depth doubles as the nesting indent AND the space between
  // the hairline rail (drawn by RowShell's `border-l`, keyed off this same `indent`
  // object) and the row's own content.
  const indent = depth ? { paddingLeft: depth * 16 } : undefined;

  if (frame.kind === 'approval') {
    // A pending (unresolved) approval renders NOTHING here — it blocks the input, so it's
    // docked to the composer instead (matches the proto's `FrameView`). Only the resolved
    // receipt takes a place in history, once there's a decision to show.
    if (frame.resolved === undefined) return <></>;
    return (
      // The resolved receipt (proto ApprovalRow) — an answered question earns no card,
      // just one quiet line taking the request's place in history.
      <RowShell indent={indent} className="py-0.5">
        <div className="slip-enter flex items-center gap-2 font-mono text-code">
          <span
            aria-hidden
            className={cx(
              'w-3 text-center',
              frame.resolved === 'approved' ? 'text-ok/70' : 'text-s7',
            )}
          >
            {frame.resolved === 'approved' ? '✓' : '—'}
          </span>
          <span className="text-s7">{frame.resolved}</span>
          <span className="text-s8">{frame.tool}</span>
          <span className="truncate text-s7">{frame.summary}</span>
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'deny') {
    return (
      <RowShell>
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </RowShell>
    );
  }

  if (frame.kind === 'raw') {
    // The mask comes off — raw is the verbatim loop: plain mono, no chrome, no reveal, no interpretation.
    // Never animated (see `revealSuppressed`), so no entrance/reveal class lands here.
    return (
      <RowShell>
        <div className="font-mono text-code leading-[1.7] whitespace-pre-wrap text-s9">
          {frame.text}
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'note') {
    // A console-local synthetic system note (e.g. a mid-session model switch) — never
    // sent to the agent, so it renders as a quiet centered rule rather than a turn: no
    // spine dot emphasis, no gutter, just a flanked caption. Neither the user's voice nor
    // the agent's, so it reads as neither.
    return (
      <div className="flex items-center gap-3 py-1 font-mono text-meta text-s7">
        <span aria-hidden className="h-px flex-1 bg-s3" />
        <span className="max-w-[70%] text-center">{frame.text}</span>
        <span aria-hidden className="h-px flex-1 bg-s3" />
      </div>
    );
  }

  if (frame.kind === 'subagent') {
    const name = frame.childWorktree.split('/').at(-1) ?? frame.childWorktree;
    const r = frame.rollup;
    if (frame.event === 'rollup') {
      // The receipt a finished child leaves behind — unboxed: name, its costs, status.
      const bits: string[] = [];
      if (r?.tools !== undefined) bits.push(`${r.tools} tools`);
      if (r?.tokens !== undefined) bits.push(`${formatTokens(r.tokens)} tok`);
      if (r?.cost !== undefined) bits.push(`$${r.cost.toFixed(2)}`);
      return (
        <RowShell indent={indent} className="py-0.5">
          <div className="flex items-center gap-2 font-mono text-code">
            <span aria-hidden className="w-3 text-center font-mono text-s7">
              ⎇
            </span>
            <b className="font-[550] text-s9">{name}</b>
            <SubagentDot status={r?.status === 'failed' ? 'critical' : 'done'} />
            <span className="font-mono text-meta text-s6">{bits.join(' · ')}</span>
            {r?.status !== undefined && (
              <span className="font-mono text-meta text-s7">{r.status}</span>
            )}
          </div>
        </RowShell>
      );
    }
    return (
      <RowShell indent={indent} className="py-0.5">
        <div className="group flex items-center gap-2 font-mono text-code">
          <span aria-hidden className="w-3 text-center font-mono text-s7">
            ⎇
          </span>
          <b className="font-[550] text-s9">{name}</b>
          <SubagentDot status={SUB_STATUS[frame.event]} />
          <span className="font-mono text-meta text-s6">{SUB_EVENT_LABEL[frame.event]}</span>
          {(frame.event === 'running' || frame.event === 'spawn') && (
            <span className="hidden gap-2 font-mono text-meta text-s8 group-hover:flex">
              <button type="button" className="slip cursor-pointer hover:text-s10">
                Watch
              </button>
              <button type="button" className="slip cursor-pointer hover:text-s10">
                Stop
              </button>
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
      <RowShell indent={indent}>
        <ThinkingCard
          text={frame.text}
          {...(frame.streaming !== undefined ? { streaming: frame.streaming } : {})}
          {...(frame.durationMs !== undefined ? { durationMs: frame.durationMs } : {})}
        />
      </RowShell>
    );
  }

  if (frame.kind === 'plan') {
    // Working memory, not output — no box. The in-progress marker is the transcript's
    // one blue element; done recedes (never struck through), pending waits.
    const done = frame.items.filter((it) => it.status === 'done').length;
    return (
      <RowShell indent={indent} className="py-0.5">
        <div className="flex flex-col gap-1">
          <div className="font-mono text-caps tracking-[0.07em] text-s7 uppercase">
            plan{' '}
            <span className="tracking-normal text-s6">
              · {done}/{frame.items.length}
            </span>
          </div>
          <ul className="flex flex-col gap-[3px]">
            {frame.items.map((it, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sec leading-[1.45]">
                <span
                  aria-hidden
                  className={cx(
                    'slip w-3 flex-none text-center font-mono text-[11px]',
                    it.status === 'done' && 'text-s6',
                    it.status === 'in-progress' && 'font-[550] text-run',
                    it.status === 'pending' && 'text-s6',
                  )}
                >
                  {it.status === 'done' ? '✓' : it.status === 'in-progress' ? '›' : '○'}
                </span>
                <span className="sr-only">{PLAN_STATUS_LABEL[it.status]}</span>
                <span
                  className={cx(
                    'slip',
                    it.status === 'done' && 'text-s7',
                    it.status === 'in-progress' && 'text-s12',
                    it.status === 'pending' && 'text-s9',
                  )}
                >
                  {it.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </RowShell>
    );
  }

  if (frame.kind === 'error') {
    // Information, not an alarm: one line, the mark and the origin chip carry the
    // classification, the message stays ink.
    return (
      <RowShell indent={indent} className="py-0.5">
        <div role="alert" className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="w-3 flex-none text-center font-mono text-code font-[550] text-crit"
          >
            ✕
          </span>
          <span className="min-w-0 text-sec leading-[1.5] text-s10">{frame.message}</span>
          {frame.origin !== undefined && (
            <span
              data-origin-chip
              className="flex-none rounded-r1 border border-s3 px-1 py-px font-mono text-caps text-s6"
            >
              {frame.origin}
            </span>
          )}
        </div>
      </RowShell>
    );
  }

  const role = 'role' in frame ? frame.role : 'agent';
  const isUser = role === 'you';
  const isPending = frame.kind === 'text' && frame.pending === true;
  return (
    <RowShell indent={indent}>
      <div
        data-role={role}
        data-pending={isPending || undefined}
        className={cx(
          'min-w-0',
          isUser &&
            'ml-auto w-fit max-w-[70%] self-end rounded-[var(--radius-bubble)] bg-s3 px-3 py-2 text-s11',
          // Not yet in the record (a steer is recorded only when the model receives it) —
          // reads as provisional, not as history,
          // the same way a streaming block never wears the settled row's full weight.
          isPending && 'opacity-60',
        )}
      >
        {frame.kind === 'text' && isUser && (
          <div className="whitespace-pre-wrap text-body">{frame.text}</div>
        )}
        {frame.kind === 'text' &&
          !isUser &&
          // No message-level copy affordance — the design reference keeps copy on code
          // blocks alone (CodeBlock owns its own hover-revealed `copy`), so agent prose
          // stays clean.
          (frame.streaming === true ? (
            <StreamingMarkdown source={frame.text} />
          ) : (
            <Markdown source={frame.text} />
          ))}
        {frame.kind === 'tool' && (
          <ToolCard
            tool={frame.tool}
            input={frame.input}
            output={frame.output}
            ok={frame.ok}
            onOpenPath={onOpenPath}
            onOpenUrl={onOpenUrl}
          />
        )}
        {frame.kind === 'tool-use' && (
          <ToolCard
            tool={frame.tool}
            input={frame.input}
            onOpenPath={onOpenPath}
            onOpenUrl={onOpenUrl}
          />
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
            onOpenUrl={onOpenUrl}
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
      if (
        index !== undefined &&
        target !== undefined &&
        target.kind === 'tool' &&
        useFrame !== undefined
      ) {
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
 *  Mirrors `ChatPanel`'s `formatElapsed` (kept local — this package does not depend on
 *  the desktop app). */
function formatWorkingElapsed(sinceMs: number, nowMs: number): string {
  return `${Math.floor((nowMs - sinceMs) / 1000)}s`;
}

/** The Virtuoso `Footer` slot rendered while a turn is in flight: the running dot +
 *  `working` + a live elapsed counter once `busySince` is known, quiet meta/mono chrome
 *  matching the design reference's `WorkingRow` — it states that the loop is working, it
 *  does not perform it (no boxed spinner). Owns its own 1s interval (mirrors
 *  `RunningPill`'s pattern), cleaned up on unmount. `role="status"`/`aria-live="polite"`
 *  carry the announcement now that the text itself is the content (the previous `Spinner`
 *  supplied that pairing). Exported so it is unit-testable directly — a Virtuoso
 *  `components.Footer` slot cannot be reached through the jsdom-free container tests. */
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
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 px-2 py-1.5 font-mono text-meta text-s7"
    >
      <span
        aria-hidden
        className="motion-safe:animate-pulse inline-block size-[5px] flex-none rounded-full bg-run"
      />
      <span>Working</span>
      {busySince !== undefined && (
        <span className="text-s6">{formatWorkingElapsed(busySince, now)}</span>
      )}
    </div>
  );
}

/** The block entrance is skipped for the channels that reveal per-word (agent/subagent
 *  text + thinking — they animate as words arrive, so a block-level entrance would double
 *  up) and for `raw` frames (raw is the verbatim loop, never animated). Every other
 *  newly-arrived block (tool card, result, plan, error, approval, subagent, user turn,
 *  note) gets the entrance. Exported for unit testing. */
export function revealSuppressed(frame: TranscriptFrame): boolean {
  if (frame.kind === 'raw') return true;
  if (frame.kind === 'text' || frame.kind === 'thinking')
    return 'role' in frame && frame.role !== 'you';
  return false;
}

// Cascade counter: rows mounting within one animation frame get incrementing indices, so a
// coalesced batch of blocks enters as a stagger rather than a simultaneous pop. Reset each
// frame. Exported for unit testing.
let batchIndex = 0;
let batchScheduled = false;
export function nextBatchIndex(): number {
  const i = batchIndex++;
  if (!batchScheduled && typeof requestAnimationFrame === 'function') {
    batchScheduled = true;
    requestAnimationFrame(() => {
      batchIndex = 0;
      batchScheduled = false;
    });
  }
  return i;
}

// True once the transcript has completed its initial paint. Rows mounting BEFORE this (a
// session's existing history on open) do not animate; only live arrivals after first paint
// enter. Child mount effects run before the parent's, so initial rows read `false`.
let liveMountReady = false;

/** Memoized so a streamed frame re-renders only the appended row (every row stays in the
 *  DOM — full-transcript selection + Ctrl-F). No `content-visibility` paint containment: it
 *  clips a row's children to the row box, which cuts off the tool card's intentional `-mx`
 *  bleed (the design reference has no such containment). */
const MemoRow = memo(function MemoRow({
  frame,
  onOpenPath,
  onOpenUrl,
  index,
  findActive = false,
}: {
  frame: TranscriptFrame;
  onOpenPath?: OpenPathFn | undefined;
  onOpenUrl?: OpenUrlFn | undefined;
  index: number;
  /** True when this row is the active find-in-conversation match — washes the row so
   *  prev/next navigation has a visible landing target. */
  findActive?: boolean | undefined;
}): React.JSX.Element {
  const cfg = defaultReveal.block;
  // Whole-row entrance on live arrival, via the SAME `.cx-block-enter` mount keyframe
  // `StreamingMarkdown`'s `CompletedBlock` uses for a completed prose block — not a
  // parallel WAAPI implementation. The previous approach called `ref.current.animate()`
  // directly: a raw `Element.animate()` times its own independent `Animation` object and
  // never reads the `animation-duration` CSS property, so it silently kept animating
  // (at a hardcoded, non-kit easing) under the in-app `[data-motion='reduce']` toggle —
  // only the OS-level `prefers-reduced-motion` media query was ever honored. The CSS
  // class is covered by that global rule for free, same as every other kit animation.
  // Skipped for the per-word-reveal channels + raw (revealSuppressed), for history on
  // session-open (liveMountReady), and for `variant: 'none'`. The `useState` lazy
  // initializer runs exactly once per mount (mirroring the old effect's `[]` deps), so a
  // coalesced batch still cascades via `nextBatchIndex` — now applied as an
  // `animation-delay` instead of a WAAPI start delay.
  const [entranceDelayMs] = useState<number | undefined>(() =>
    cfg.variant !== 'none' && !revealSuppressed(frame) && liveMountReady
      ? Math.min(nextBatchIndex(), cfg.staggerCap) * cfg.staggerMs
      : undefined,
  );
  const entering = entranceDelayMs !== undefined;
  return (
    <div
      data-row-index={index}
      data-find-active={findActive || undefined}
      data-enter={entering ? cfg.variant : undefined}
      className={cx(
        entering && 'cx-block-enter',
        // A quiet amber wash, not a ring — a highlight, not a focus/error affordance.
        findActive && '-mx-2 rounded-r1 bg-warn/8 px-2',
      )}
      style={
        {
          ...(entering
            ? { '--enter-dur': `${cfg.durationMs}ms`, animationDelay: `${entranceDelayMs}ms` }
            : {}),
        } as React.CSSProperties
      }
    >
      <TranscriptRow frame={frame} onOpenPath={onOpenPath} onOpenUrl={onOpenUrl} />
    </div>
  );
});

/** Scroll positions by `scrollKey` (session id), surviving the per-session keyed
 *  remount — module scope on purpose: the memory must outlive the component. */
const scrollMemory = new Map<string, { top: number; pinned: boolean }>();

/** A non-virtualized turn stream: every frame renders to the DOM (no windowing), so
 *  selection and Ctrl-F work across the full transcript. Native scroll + a bottom sentinel
 *  drive stick-to-bottom. Empty is the panel's concern (it owns the EmptyState), so an empty
 *  stream renders nothing here. */
export function Transcript({
  frames,
  onOpenPath,
  onOpenUrl,
  label = 'Conversation',
  className,
  showJumpToLatest,
  busy,
  busySince,
  jumpNonce,
  bottomInset,
  scrollKey,
  active = true,
  findMatch,
}: TranscriptProps): React.JSX.Element | null {
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  // Scroll memory: pinned state comes back with the session (the keyed remount
  // is the save/restore boundary), so switching tabs never loses your place.
  const [pinned, setPinned] = useState(() =>
    scrollKey !== undefined ? (scrollMemory.get(scrollKey)?.pinned ?? true) : true,
  );
  // Transcript measure: wide (the default) lets output use the whole panel; narrow caps it
  // to the composer's reading measure. Toggled from the corner control (matches the design
  // reference); only the transcript width changes — the composer keeps its own max measure.
  const [wide, setWide] = useState(true);
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

  // Find-in-conversation (Ctrl/Cmd+F): every frame is in the DOM (no windowing), so
  // find can search the full transcript, not just the visible window. Matches are
  // term-level (the count reads occurrences, not rows).
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const matches = useMemo(() => findTermMatches(items, findQuery), [items, findQuery]);

  // Clean up the navigation-guard timer on unmount.
  useEffect(() => {
    return () => {
      if (navTimerRef.current !== undefined) clearTimeout(navTimerRef.current);
    };
  }, []);

  // Mark live-mount ready after the first paint so a session's existing history (mounted in
  // this first commit) does not animate — only rows appended afterward get the block entrance.
  useEffect(() => {
    liveMountReady = true;
    return () => {
      liveMountReady = false;
    };
  }, []);

  // Restore this session's remembered place on mount AND on every reactivation
  // (a hidden kept-alive tab's display:none pass wipes the live scroll
  // position): pinned sessions snap back to bottom, others to their offset.
  useLayoutEffect(() => {
    if (!active) return;
    const el = scroller.current;
    if (el === null) return;
    const mem = scrollKey !== undefined ? scrollMemory.get(scrollKey) : undefined;
    const pin = mem?.pinned ?? true;
    setPinned(pin);
    if (pin) sentinel.current?.scrollIntoView({ block: 'end' });
    else el.scrollTop = mem?.top ?? 0;
  }, [active, scrollKey]);

  // Ctrl/Cmd+F opens the in-transcript find bar instead of the browser's own find,
  // since every frame already renders to the DOM. Scoped to this component's
  // lifetime via add/removeEventListener in the effect cleanup — and to the
  // ACTIVE tab only, so hidden kept-alive instances never race for the chord.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      // The chord is the APP's to name (it's rebindable there); the default keeps this
      // component usable on its own.
      const isFind =
        findMatch !== undefined
          ? findMatch(e)
          : (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f';
      if (isFind) {
        e.preventDefault();
        // A toggle, not an opener — the same chord that summoned the bar
        // dismisses it (matches ctrl+p on the session search).
        setFindOpen((open) => !open);
      } else if (e.key === 'Escape' && findOpen) {
        setFindOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [findOpen, active, findMatch]);

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

  // Paint the term highlights (Custom Highlight API — no DOM mutation, so
  // React's rendered markdown is untouched). Every occurrence wears the quiet
  // find tint; the active row's occurrences the stronger one. Repainted when
  // the query, the frames, or the active match move; skipped silently where
  // the API is absent (jsdom).
  useEffect(() => {
    const root = scroller.current;
    const q = findQuery.trim();
    if (!active || !findOpen || q === '' || root === null) {
      clearFindHighlights();
      return;
    }
    const activeRow =
      activeMatchFrameIndex !== undefined
        ? root.querySelector(`[data-row-index="${activeMatchFrameIndex}"]`)
        : null;
    paintFindHighlights(root, q, activeRow);
    return clearFindHighlights;
  }, [active, findOpen, findQuery, items, activeMatchFrameIndex]);

  // Stick-to-bottom, two parts. On mount: snap the sentinel into view once if
  // pinned. While mounted: a ResizeObserver on the content re-pins on every
  // genuine height change (streamed words, appended rows, the composer spacer)
  // with a DIRECT scrollTop write — the old per-render scrollIntoView both
  // missed growth that landed between renders and fought Chromium's native
  // scroll anchoring, which is the word-by-word jitter. The observer fires
  // after layout and before paint, so the pin never visibly lags.
  // Skipped during programmatic navigation (navigatingRef) — otherwise a smooth
  // scroll animation's early onScroll events can re-enable pinned and abort the
  // navigation by yanking the sentinel back into view.
  const content = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const activeRef = useRef(active);
  activeRef.current = active;
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const el = scroller.current;
    const target = content.current;
    if (el === null || target === null) return;
    const ro = new ResizeObserver(() => {
      // Hidden kept-alive tabs report zero sizes — never pin from them.
      if (!activeRef.current || !pinnedRef.current || navigatingRef.current) return;
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(target);
    return () => ro.disconnect();
  }, []);

  // Snap-to-sent: a bump of jumpNonce (e.g. on send) force-pins to bottom even
  // if the user had scrolled up, so their new turn snaps into view. Only a
  // CHANGE fires it — the mounted value is a standing counter (sendNonce is
  // always a number), so firing on mount would stomp the restored scroll place.
  const prevNonceRef = useRef(jumpNonce);
  useLayoutEffect(() => {
    const changed = jumpNonce !== undefined && jumpNonce !== prevNonceRef.current;
    prevNonceRef.current = jumpNonce;
    if (!changed || !active) return;
    startNav();
    setPinned(true);
    if (scrollKey !== undefined) scrollMemory.set(scrollKey, { top: 0, pinned: true });
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    // scrollKey is identity, not a trigger — only a jumpNonce bump re-pins.
  }, [jumpNonce, active]);

  const onScroll = (): void => {
    // Inactive instances only see programmatic/display-toggle scrolls (e.g. the
    // reset to 0 on hide) — saving those would corrupt the session's memory.
    if (!active || navigatingRef.current) return;
    const el = scroller.current;
    if (el === null) return;
    const pin = nearBottom(el.scrollTop, el.clientHeight, el.scrollHeight);
    setPinned(pin);
    if (scrollKey !== undefined) scrollMemory.set(scrollKey, { top: el.scrollTop, pinned: pin });
  };

  const jumpToLatest = (): void => {
    startNav();
    setPinned(true);
    if (scrollKey !== undefined) scrollMemory.set(scrollKey, { top: 0, pinned: true });
    sentinel.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
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
        // The transcript owns the full panel and scrolls the whole height, flush to the
        // panel's right edge — the floating composer sits OVER its floor (not in a carved-
        // out gap), and a bottom spacer sized to the composer's measured height reserves
        // clearance INSIDE the content so the last row clears it on stick-to-bottom.
        // overflow-anchor off: the ResizeObserver pin owns bottom-tracking; Chromium's
        // native scroll anchoring double-adjusting under it is the streaming jitter.
        className="h-full overflow-y-auto [overflow-anchor:none]"
      >
        <div
          ref={content}
          className={cx('flex w-full flex-col gap-3.5 px-8 pt-6', !wide && 'mx-auto max-w-180')}
        >
          {items.map((item, index) => (
            <MemoRow
              key={item.id}
              frame={item}
              onOpenPath={onOpenPath}
              onOpenUrl={onOpenUrl}
              index={index}
              findActive={findOpen && index === activeMatchFrameIndex}
            />
          ))}
          {busy === true && <WorkingFooter busySince={busySince} />}
          {bottomInset !== undefined && bottomInset > 0 && (
            // Reserve the composer's height PLUS its `bottom-4` (16px) float offset and a
            // comfortable gap, so the last message clears the floating composer with air —
            // not pressed right up against it — when scrolled fully down.
            <div aria-hidden style={{ height: bottomInset + 48 }} />
          )}
          <div ref={sentinel} aria-hidden className="h-0" />
        </div>
      </div>
      {findOpen && (
        <div className="pointer-events-none absolute right-12 top-2 z-20">
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
      {/* Width toggle: the composer's reading measure ⇄ the whole panel (design reference's
          corner control). Sits at the top-right; find, when open, tucks to its left. */}
      <Tooltip label={wide ? 'Narrow to Reading Measure' : 'Use the Whole Panel'}>
        <button
          type="button"
          onClick={() => setWide((w) => !w)}
          aria-label={wide ? 'Narrow Transcript' : 'Widen Transcript'}
          className="slip absolute right-3.5 top-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-r1 font-mono text-[12px] text-s6 hover:bg-s3 hover:text-s9"
        >
          {wide ? '⇥⇤' : '⇤⇥'}
        </button>
      </Tooltip>
      {showJump && (
        <div
          className={cx(
            'pointer-events-none absolute inset-x-0 z-10 flex justify-center',
            // With no floating composer the 8pt-grid `bottom-2` applies; a composer lifts
            // the pill clear of it — above its measured height PLUS its own `bottom-4`
            // (16px) float offset, with an 8px gap — so it never sits over the composer.
            !bottomInset && 'bottom-2',
          )}
          {...(bottomInset ? { style: { bottom: bottomInset + 24 } } : {})}
        >
          <button
            type="button"
            onClick={jumpToLatest}
            className="slip slip-enter pointer-events-auto cursor-pointer rounded-r2 border border-s5 bg-s3 px-2.5 py-1 font-mono text-meta text-s9 shadow-[var(--shadow-composer)] hover:text-s11"
          >
            ↓ Latest
          </button>
        </div>
      )}
    </div>
  );
}

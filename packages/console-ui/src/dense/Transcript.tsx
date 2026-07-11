import { ArrowUp } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../actions/Button.js';
import { CopyButton } from '../actions/CopyButton.js';
import { IconButton } from '../actions/IconButton.js';
import { DenyNotice } from '../feedback/DenyNotice.js';
import { findMatches } from './find.js';
import { FindBar } from './FindBar.js';
import { Markdown } from './Markdown.js';
import { defaultReveal } from './reveal.js';
import { StreamingMarkdown } from './StreamingMarkdown.js';
import { formatTokens } from './tokenEstimate.js';
import { ToolCard } from './ToolCard.js';
import { nearBottom, previousPromptIndex } from './scrollState.js';
import { cx } from '../lib/cx.js';

/** Reveal a touched file (from a tool card's path/match link) in the editor/OS at an
 *  optional line. Supplied live by `ChatPanel` (backed by the reveal IPC); omitted in
 *  read-only surfaces, where the path renders as plain text. */
export type OpenPathFn = (path: string, line?: number) => void;

/** Open a web URL (a WebSearch result link, a WebFetch source) in the default browser.
 *  Supplied live by `ChatPanel` (backed by the openExternal IPC); omitted where URLs
 *  render as plain text. Like `onOpenPath`, MUST be referentially stable across renders. */
export type OpenUrlFn = (url: string) => void;

export type TranscriptRole = 'you' | 'agent' | 'subagent';

/** One rendered turn frame. A discriminated union so each kind renders on its own
 *  footing; `raw` is the verbatim (unfiltered-loop) projection. */
export type TranscriptFrame =
  | {
      id: string;
      role: TranscriptRole;
      kind: 'text';
      text: string;
      depth?: number | undefined;
      /** True while this block is still streaming (fed by `text-delta`) — drives the
       *  per-word reveal. Absent/false once settled or on reload (D85: plain, no reveal). */
      streaming?: boolean | undefined;
    }
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
      /** True while the reasoning is still streaming (fed by `thinking-delta`) — drives the
       *  auto-expand + per-word reveal; on settle it collapses. Absent on reload. */
      streaming?: boolean | undefined;
      /** Persisted wall-clock (ms) the reasoning took — renders "Thought for Ns" identically
       *  live and on reload (a token count is derived from `text`). Absent while streaming. */
      durationMs?: number | undefined;
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
  /** Pixels of reserved space at the bottom of the scroll content for a control
   *  (the floating composer) that overlaps the transcript's bottom edge. The
   *  scroller stays bound to the visible region (height 100%), so the scrollbar
   *  track never descends into the composer's vertical space — the thumb stops at
   *  the composer's top edge at max scroll. A same-height spacer inside the
   *  scrolled content reserves the overlap region so the last row clears the
   *  composer on stick-to-bottom; the jump-to-latest control is lifted by the same
   *  amount so it never hides behind the composer. */
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
  // The duration is read from the PERSISTED frame (M8 stamps it from the delta→settle timing),
  // never measured live here — a reloaded block never streamed, so a live wall-clock could not
  // reproduce it, which was the "reverts to Thinking on reload" mismatch. A settled block is
  // past-tense regardless ("thought"), with the seconds only when the duration is known.
  const secs = durationMs !== undefined ? Math.max(1, Math.round(durationMs / 1000)) : undefined;
  const label =
    streaming === true
      ? `thinking${tokenSuffix}`
      : `${secs !== undefined ? `thought for ${secs}s` : 'thought'}${tokenSuffix}`;
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
          {/* `italic` cascades into the Markdown prose; `muted` keeps the reasoning trace in
              the quiet secondary color (Markdown otherwise renders in the primary fg). */}
          <div className="pt-1 text-code leading-[1.6] text-s9 italic">
            {streaming === true ? (
              <StreamingMarkdown source={text} muted perWord />
            ) : (
              <Markdown source={text} muted />
            )}
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
  //
  // A depth>0 row wears a left hairline rail (`indent` is only set when nested — see
  // TranscriptRow). Virtuoso renders each row independently, so a run of nested rows
  // can't share one wrapping rail the way the non-virtualized proto does (that would
  // require de-virtualizing); giving every nested row its OWN border at the same left
  // offset reads as one continuous line across the run instead.
  return (
    <div
      style={indent}
      className={cx('flex gap-3 px-2', indent !== undefined && 'border-l border-s3')}
    >
      <SpineGutter
        tone={tone}
        lineTop={!isUser && spineTop}
        lineBottom={!isUser && spineBottom}
        showDot={!isUser}
      />
      <div className={cx('min-w-0 flex-1', className)}>
        <div className="pb-1">{children}</div>
      </div>
    </div>
  );
}

/** Renders a single frame by kind. Exported so it is unit-testable independent of the
 *  container. `spineTop`/`spineBottom` default to a full through-line — the spine breaks
 *  only at user rows, via {@link RowShell}'s own `isUser` check, so a run reads continuous
 *  between user turns without any group math. */
export function TranscriptRow({
  frame,
  // No frame kind actions through this anymore — a pending approval renders nothing
  // here (docked to the composer instead) and a resolved one is a plain receipt.
  // Kept on the signature as a forward-compatible seam for a future frame kind that
  // does need it, so callers threading it through `MemoRow` (below) don't break.
  onRespond: _onRespond,
  onOpenPath,
  onOpenUrl,
  spineTop = true,
  spineBottom = true,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
  onOpenPath?: OpenPathFn | undefined;
  onOpenUrl?: OpenUrlFn | undefined;
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
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
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-0.5"
      >
        <div className="slip-enter flex items-center gap-2 font-mono text-code">
          <span
            aria-hidden
            className={cx('w-3 text-center', frame.resolved === 'approved' ? 'text-ok/70' : 'text-s7')}
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
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} className="py-2">
        <DenyNotice kind={frame.denyKind} reason={frame.reason} />
      </RowShell>
    );
  }

  if (frame.kind === 'raw') {
    // D85 — the mask comes off: plain mono, no chrome, no reveal, no interpretation.
    // Never animated (see `revealSuppressed`), so no entrance/reveal class lands here.
    return (
      <RowShell frame={frame} spineTop={spineTop} spineBottom={spineBottom} className="py-0.5">
        <div className="px-0.5 font-mono text-code leading-[1.7] whitespace-pre-wrap text-s9">
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
        <RowShell
          frame={frame}
          spineTop={spineTop}
          spineBottom={spineBottom}
          indent={indent}
          className="py-0.5"
        >
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
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-0.5"
      >
        <div className="group flex items-center gap-2 font-mono text-code">
          <span aria-hidden className="w-3 text-center font-mono text-s7">
            ⎇
          </span>
          <b className="font-[550] text-s9">{name}</b>
          <SubagentDot status={SUB_STATUS[frame.event]} />
          <span className="font-mono text-meta text-s6">
            {frame.event === 'spawn-proposal'
              ? 'proposed'
              : frame.event === 'spawn'
                ? 'spawned'
                : frame.event}
          </span>
          {(frame.event === 'running' || frame.event === 'spawn') && (
            <span className="hidden gap-2 font-mono text-meta text-s8 group-hover:flex">
              <button type="button" className="slip cursor-pointer hover:text-s10">
                watch
              </button>
              <button type="button" className="slip cursor-pointer hover:text-s10">
                stop
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
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-2"
      >
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
                <span className="sr-only">{it.status}</span>
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
      <RowShell
        frame={frame}
        spineTop={spineTop}
        spineBottom={spineBottom}
        indent={indent}
        className="py-0.5"
      >
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
        className={cx(
          'min-w-0',
          isUser && 'ml-auto max-w-[70%] rounded-[6px_6px_2px_6px] bg-s3 px-3 py-2 text-s11',
        )}
      >
        {frame.kind === 'text' && isUser && (
          <div className="whitespace-pre-wrap text-body">{frame.text}</div>
        )}
        {frame.kind === 'text' && !isUser && (
          <div className="group relative">
            <div className="absolute right-0 top-0 opacity-0 transition-opacity group-hover:opacity-100">
              <CopyButton text={frame.text} />
            </div>
            {frame.streaming === true ? (
              <StreamingMarkdown source={frame.text} />
            ) : (
              <Markdown source={frame.text} />
            )}
          </div>
        )}
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
 *  Mirrors `ChatPanel`'s `formatElapsed` (kept local — console-ui does not depend on
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
      <span>working</span>
      {busySince !== undefined && (
        <span className="text-s6">{formatWorkingElapsed(busySince, now)}</span>
      )}
    </div>
  );
}

/** The block entrance is skipped for the channels that reveal per-word (agent/subagent
 *  text + thinking — they animate as words arrive, so a block-level entrance would double
 *  up) and for `raw` frames (D85 — raw is the verbatim loop, never animated). Every other
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

/** Memoized so a streamed frame re-renders only the appended row, and `content-visibility`
 *  lets the browser skip layout/paint for off-screen rows while keeping them in the DOM
 *  (full-transcript selection + Ctrl-F). `contain-intrinsic-size` is a height estimate that
 *  prevents scrollbar jump; tuned to a typical row. */
const MemoRow = memo(function MemoRow({
  frame,
  onRespond,
  onOpenPath,
  onOpenUrl,
  index,
  findActive = false,
  spineTop = true,
  spineBottom = true,
}: {
  frame: TranscriptFrame;
  onRespond?: RespondFn | undefined;
  onOpenPath?: OpenPathFn | undefined;
  onOpenUrl?: OpenUrlFn | undefined;
  index: number;
  /** True when this row is the active find-in-conversation match — washes the row so
   *  prev/next navigation has a visible landing target. */
  findActive?: boolean | undefined;
  spineTop?: boolean | undefined;
  spineBottom?: boolean | undefined;
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
          contentVisibility: 'auto',
          containIntrinsicSize: 'auto 60px',
          ...(entering
            ? { '--enter-dur': `${cfg.durationMs}ms`, animationDelay: `${entranceDelayMs}ms` }
            : {}),
        } as React.CSSProperties
      }
    >
      <TranscriptRow
        frame={frame}
        onRespond={onRespond}
        onOpenPath={onOpenPath}
        onOpenUrl={onOpenUrl}
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
  onOpenUrl,
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

  // Mark live-mount ready after the first paint so a session's existing history (mounted in
  // this first commit) does not animate — only rows appended afterward get the block entrance.
  useEffect(() => {
    liveMountReady = true;
    return () => {
      liveMountReady = false;
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
        // Native scroll; content capped to a readable measure (§5.2).
        //
        // The scroller's HEIGHT is the visible region minus `bottomInset` (the
        // measured height of the floating composer). This is what bounds the
        // scrollbar track: the track ends exactly where the composer begins, so
        // the thumb NEVER enters the composer's vertical space — at max scroll it
        // rests at the composer's top edge. This is the industry-standard pattern:
        // ChatGPT, Claude Web, Cursor, Windsurf, and Aider all size their scroll
        // region to end at the floating input, not under it.
        //
        // The composer (docked by ChatPanel at absolute bottom-0 on the scroller's
        // sibling box) occupies the space we carve out below, and the inner spacer
        // reserves overlap space INSIDE the content so the last row clears the
        // composer on stick-to-bottom.
        className="overflow-y-auto"
        style={{
          height:
            bottomInset !== undefined && bottomInset > 0 ? `calc(100% - ${bottomInset}px)` : '100%',
        }}
      >
        <div className="flex flex-col">
          {items.map((item, index) => (
            <MemoRow
              key={item.id}
              frame={item}
              onRespond={onRespond}
              onOpenPath={onOpenPath}
              onOpenUrl={onOpenUrl}
              index={index}
              findActive={findOpen && index === activeMatchFrameIndex}
              spineTop={!spineStarts.has(index)}
              spineBottom={!spineEnds.has(index)}
            />
          ))}
          {busy === true && <WorkingFooter busySince={busySince} />}
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
          className="pointer-events-auto border-s4 bg-s2"
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
            className="pointer-events-auto border-s4 bg-s2"
            onClick={jumpToLatest}
          >
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}

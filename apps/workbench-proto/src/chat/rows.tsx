import { StatusDot, cx } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import type { Frame, PlanStatus, Rollup, SubagentEvent } from './model.js';
import { splitWords } from './model.js';

/* ------------------------------------------------------------------ */
/* user                                                                 */
/* ------------------------------------------------------------------ */

export function UserRow({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="max-w-[70%] self-end rounded-[6px_6px_2px_6px] bg-s3 px-3 py-2 text-body whitespace-pre-wrap text-s11">
      {text}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* reasoning                                                            */
/* ------------------------------------------------------------------ */

/** The reasoning block. Never boxed — a quiet aside, not a unit of work.
 *
 *  Streaming: auto-expanded, the trace typing per-word in muted italic under a
 *  live `thinking` label. On settle the body melts closed (grid-rows ease) and
 *  the label becomes the resting line — `thought for 12s` — which re-expands on
 *  click. A user toggle always wins over the auto behavior. */
export function ThinkRow({
  text,
  streaming = false,
  durationMs,
}: {
  text: string;
  streaming?: boolean;
  durationMs?: number | undefined;
}): React.JSX.Element {
  const [open, setOpen] = useState(streaming);
  const [touched, setTouched] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (touched) return;
    if (streaming) {
      setOpen(true);
      return;
    }
    // Settle: hold a beat so the last words land, then melt closed.
    settleTimer.current = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(settleTimer.current);
  }, [streaming, touched]);

  const secs = durationMs !== undefined ? Math.max(1, Math.round(durationMs / 1000)) : undefined;
  const label = streaming ? 'thinking' : secs !== undefined ? `thought for ${secs}s` : 'thought';

  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setTouched(true);
          setOpen((v) => !v);
        }}
        className="slip group flex cursor-pointer items-center gap-1.5 self-start py-px font-mono text-meta text-s8 hover:text-s10"
      >
        <span
          aria-hidden
          className={cx('slip-move inline-block text-[9px] text-s6', open && 'rotate-90')}
        >
          ▸
        </span>
        <span className={cx(streaming && 'motion-safe:animate-pulse')}>{label}</span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-[var(--dur-move)] ease-[var(--ease-slip)] motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
        aria-hidden={open ? undefined : true}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-1 pl-4 text-code leading-[1.6] text-s9 italic">
            {streaming ? <ThinkReveal text={text} /> : text}
          </div>
        </div>
      </div>
    </div>
  );
}

function ThinkReveal({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {splitWords(text).map((t, i) =>
        t.word ? (
          <span key={i} className="word-in">
            {t.value}
          </span>
        ) : (
          <span key={i}>{t.value}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* plan                                                                 */
/* ------------------------------------------------------------------ */

/** The agent's working checklist. No box — it is working memory, not output.
 *  The in-progress marker is the transcript's one blue element (blue =
 *  running); done recedes, pending waits. Items update in place with color
 *  eases, so progress reads as movement down the list. */
export function PlanRow({
  items,
}: {
  items: { text: string; status: PlanStatus }[];
}): React.JSX.Element {
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <div className="flex flex-col gap-1 py-0.5">
      <div className="font-mono text-caps tracking-[0.07em] text-s7 uppercase">
        plan{' '}
        <span className="tracking-normal text-s6">
          · {done}/{items.length}
        </span>
      </div>
      <ul className="flex flex-col gap-[3px]">
        {items.map((it, i) => (
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
  );
}

/* ------------------------------------------------------------------ */
/* subagent                                                             */
/* ------------------------------------------------------------------ */

const SUB_STATUS: Record<
  Exclude<SubagentEvent, 'rollup'>,
  'running' | 'needs-you' | 'idle' | 'done'
> = {
  'spawn-proposal': 'needs-you',
  spawn: 'running',
  running: 'running',
  idle: 'idle',
  done: 'done',
};

/** A subagent lifecycle row. Live events read as the one-liner (glyph · name ·
 *  dot · live tick); `rollup` is the receipt a finished child leaves behind —
 *  name plus its costs, everything meta, nothing boxed. */
export function SubagentRow({
  childWorktree,
  event,
  rollup,
}: {
  childWorktree: string;
  event: SubagentEvent;
  rollup?: Rollup | undefined;
}): React.JSX.Element {
  const name = childWorktree.split('/').at(-1) ?? childWorktree;

  if (event === 'rollup') {
    const bits: string[] = [];
    if (rollup?.tools !== undefined) bits.push(`${rollup.tools} tools`);
    if (rollup?.tokens !== undefined) bits.push(`${formatTokens(rollup.tokens)} tok`);
    if (rollup?.cost !== undefined) bits.push(`$${rollup.cost.toFixed(2)}`);
    return (
      <div className="flex items-center gap-2 py-0.5 text-[12px]">
        <span aria-hidden className="w-3 text-center font-mono text-s7">
          ⎇
        </span>
        <b className="font-[550] text-s9">{name}</b>
        <StatusDot status={rollup?.status === 'failed' ? 'critical' : 'done'} size={5} />
        <span className="font-mono text-meta text-s6">{bits.join(' · ')}</span>
        {rollup?.status !== undefined && (
          <span className="font-mono text-meta text-s7">{rollup.status}</span>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2 py-0.5 text-[12px]">
      <span aria-hidden className="w-3 text-center font-mono text-s7">
        ⎇
      </span>
      <b className="font-[550] text-s9">{name}</b>
      <StatusDot status={SUB_STATUS[event]} size={5} />
      <span className="font-mono text-meta text-s6">
        {event === 'spawn-proposal' ? 'proposed' : event === 'spawn' ? 'spawned' : event}
      </span>
      {(event === 'running' || event === 'spawn') && (
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
  );
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/* ------------------------------------------------------------------ */
/* approval                                                             */
/* ------------------------------------------------------------------ */

/** An approval's transcript presence. PENDING approvals never render here —
 *  the gate docks to the composer (it blocks the input, so it lives at the
 *  input; see Composer's `approval`). Once answered, the receipt takes the
 *  request's place in history: one quiet line — an answered question earns no
 *  card. */
export function ApprovalRow({
  tool,
  summary,
  resolved,
}: {
  tool: string;
  summary: string;
  resolved: 'approved' | 'denied';
}): React.JSX.Element {
  return (
    <div className="slip-enter flex items-center gap-2 py-0.5 font-mono text-code">
      <span
        aria-hidden
        className={cx('w-3 text-center', resolved === 'approved' ? 'text-ok/70' : 'text-s7')}
      >
        {resolved === 'approved' ? '✓' : '—'}
      </span>
      <span className="text-s7">{resolved}</span>
      <span className="text-s8">{tool}</span>
      <span className="truncate text-s7">{summary}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* deny — SC-1's visible moment                                         */
/* ------------------------------------------------------------------ */

const DENY_COPY: Record<
  'close-gate' | 'cost-cap',
  { label: string; ways: { act: string; hint: string }[] }
> = {
  'cost-cap': {
    label: 'cost cap',
    ways: [
      { act: 'raise the cap', hint: 'settings · budget' },
      { act: 'review spend', hint: 'cost surface' },
    ],
  },
  'close-gate': {
    label: 'close gate',
    ways: [
      { act: 'review the flags', hint: 'flags surface' },
      { act: 'see the record', hint: 'timeline' },
    ],
  },
};

/** One of the only two blocks in the whole system (SC-1 — help, never cage).
 *  It must read as a firm, legible stop with a reason and a way forward:
 *  full-measure (the road closes, it doesn't dodge), a structural border, the
 *  critical dot as the only red — no fill, no alarm, no modal, no scold. The
 *  reason is the daemon's, verbatim. */
export function DenyRow({
  denyKind,
  reason,
}: {
  denyKind: 'close-gate' | 'cost-cap';
  reason: string;
}): React.JSX.Element {
  const copy = DENY_COPY[denyKind];
  return (
    <div role="status" className="rounded-r2 border border-s4 bg-s2 px-3.5 py-3">
      <div className="flex items-center gap-2">
        <StatusDot status="critical" />
        <span className="font-mono text-caps tracking-[0.07em] text-s9 uppercase">
          {copy.label}
        </span>
        <span className="ml-auto font-mono text-caps text-s6">stopped by the daemon</span>
      </div>
      <div className="mt-1.5 text-body leading-[1.5] text-s11">{reason}</div>
      <div className="mt-2.5 flex items-center gap-4 border-t border-s3 pt-2">
        {copy.ways.map((w) => (
          <button
            key={w.act}
            type="button"
            className="slip group flex cursor-pointer items-baseline gap-1.5 font-mono text-meta text-s9 hover:text-s11"
          >
            <span className="underline decoration-s6 decoration-dotted underline-offset-[3px] group-hover:decoration-s8">
              {w.act}
            </span>
            <span className="text-s6">{w.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* error · note                                                         */
/* ------------------------------------------------------------------ */

/** An error is information, not an alarm: one line, the mark and the origin
 *  chip carry the classification, the message stays ink. */
export function ErrorRow({
  message,
  origin,
}: {
  message: string;
  origin?: 'tool' | 'loop' | 'daemon' | undefined;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span
        aria-hidden
        className="w-3 flex-none text-center font-mono text-code font-[550] text-crit"
      >
        ✕
      </span>
      <span className="min-w-0 text-sec leading-[1.5] text-s10">{message}</span>
      {origin !== undefined && (
        <span className="flex-none rounded-r1 border border-s3 px-1 py-px font-mono text-caps text-s6">
          {origin}
        </span>
      )}
    </div>
  );
}

/** The system's own line — the user didn't type it, the agent didn't say it.
 *  A centered caption between hairlines reads as neither voice. */
export function NoteRow({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-1 font-mono text-meta text-s7">
      <span aria-hidden className="h-px flex-1 bg-s3" />
      <span className="max-w-[70%] text-center">{text}</span>
      <span aria-hidden className="h-px flex-1 bg-s3" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* raw                                                                  */
/* ------------------------------------------------------------------ */

/** D85 — the mask comes off. A raw line is the loop, byte-faithful: plain
 *  mono, no chrome, no reveal, no interpretation. */
export function RawRow({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="px-0.5 font-mono text-code leading-[1.7] whitespace-pre-wrap text-s9">
      {text}
    </div>
  );
}

/** Type guard used by the transcript to group nested (depth > 0) runs. */
export function frameDepth(f: Frame): number {
  return 'depth' in f && typeof f.depth === 'number' ? f.depth : 0;
}

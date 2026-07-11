import { StatusDot, cx } from '@coa/console-kit';
import { useEffect, useState } from 'react';
import type { Frame } from './model.js';
import { Prose } from './Prose.js';
import { ToolFrame } from './ToolCard.js';
import {
  ApprovalRow,
  DenyRow,
  ErrorRow,
  NoteRow,
  PlanRow,
  RawRow,
  SubagentRow,
  ThinkRow,
  UserRow,
  frameDepth,
} from './rows.js';

export interface TranscriptCallbacks {
  onOpenPath?: ((path: string, line?: number) => void) | undefined;
  onOpenUrl?: ((url: string) => void) | undefined;
}

/** The conversation column. Every output block spans the same width; only the
 *  composer keeps a max measure. `wide` (the default) lets the transcript use
 *  the whole panel; off, it narrows to the composer's reading measure —
 *  toggled from the corner control in the chat surface. Nesting is a hairline
 *  rail, not chrome; the only persistent emphasis is whatever is running. */
export function Transcript({
  frames,
  running = false,
  runningSince,
  wide = true,
  callbacks = {},
}: {
  frames: Frame[];
  running?: boolean;
  runningSince?: number | undefined;
  /** Unbounded (full panel) vs the composer's reading measure. */
  wide?: boolean;
  callbacks?: TranscriptCallbacks;
}): React.JSX.Element {
  return (
    <div
      className={cx('flex w-full flex-col gap-3.5 px-8 pt-6 pb-56', !wide && 'mx-auto max-w-180')}
    >
      <FrameList frames={frames} callbacks={callbacks} />
      {running && <WorkingRow since={runningSince} />}
    </div>
  );
}

/** Consecutive frames deeper than the current level nest behind a hairline
 *  rail (one rail per depth — subagent work reads as an indented thread). */
function FrameList({
  frames,
  callbacks,
  depth = 0,
}: {
  frames: Frame[];
  callbacks: TranscriptCallbacks;
  depth?: number;
}): React.JSX.Element {
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < frames.length) {
    const f = frames[i];
    if (f === undefined) break;
    const d = frameDepth(f);
    if (d > depth) {
      const nest: Frame[] = [];
      let j = i;
      while (j < frames.length) {
        const g = frames[j];
        if (g === undefined || frameDepth(g) <= depth) break;
        nest.push(g);
        j++;
      }
      out.push(
        <div
          key={`nest-${f.id}`}
          className="ml-[5px] flex flex-col gap-2.5 border-l border-s3 pl-3.5"
        >
          <FrameList frames={nest} callbacks={callbacks} depth={depth + 1} />
        </div>,
      );
      i = j;
      continue;
    }
    out.push(<FrameView key={f.id} frame={f} callbacks={callbacks} />);
    i++;
  }
  return <>{out}</>;
}

/** One frame by kind. Entrances: cards and rows slip in; agent prose and the
 *  reasoning trace reveal per-word instead (a block entrance would double up);
 *  raw is never animated (D85 — the loop, verbatim). */
function FrameView({
  frame,
  callbacks,
}: {
  frame: Frame;
  callbacks: TranscriptCallbacks;
}): React.JSX.Element {
  switch (frame.kind) {
    case 'user':
      return (
        <div className="slip-enter flex flex-col">
          <UserRow text={frame.text} />
        </div>
      );
    case 'text':
      return <Prose blocks={frame.blocks} streaming={frame.streaming === true} />;
    case 'think':
      return (
        <ThinkRow
          text={frame.text}
          streaming={frame.streaming === true}
          durationMs={frame.durationMs}
        />
      );
    case 'tool':
      return (
        <div className="slip-enter">
          <ToolFrame
            view={frame.view}
            onOpenPath={callbacks.onOpenPath}
            onOpenUrl={callbacks.onOpenUrl}
          />
        </div>
      );
    case 'plan':
      return (
        <div className="slip-enter">
          <PlanRow items={frame.items} />
        </div>
      );
    case 'subagent':
      return (
        <div className="slip-enter">
          <SubagentRow
            childWorktree={frame.childWorktree}
            event={frame.event}
            rollup={frame.rollup}
          />
        </div>
      );
    case 'approval':
      // A pending gate docks at the composer; only the receipt lives here.
      if (frame.resolved === undefined) return <></>;
      return (
        <div className="slip-enter">
          <ApprovalRow tool={frame.tool} summary={frame.summary} resolved={frame.resolved} />
        </div>
      );
    case 'deny':
      return (
        <div className="slip-enter">
          <DenyRow denyKind={frame.denyKind} reason={frame.reason} />
        </div>
      );
    case 'error':
      return (
        <div className="slip-enter">
          <ErrorRow message={frame.message} origin={frame.origin} />
        </div>
      );
    case 'note':
      return <NoteRow text={frame.text} />;
    case 'raw':
      return <RawRow text={frame.text} />;
  }
}

/** The in-flight footer: the running dot plus a live elapsed count. Quiet —
 *  it states that the loop is working, it does not perform it. */
function WorkingRow({ since }: { since?: number | undefined }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return (
    <div className="flex items-center gap-2 py-1 font-mono text-meta text-s7">
      <span className="motion-safe:animate-pulse">
        <StatusDot status="running" size={5} />
      </span>
      working
      {since !== undefined && (
        <span className="text-s6">{Math.max(0, Math.floor((now - since) / 1000))}s</span>
      )}
    </div>
  );
}

/** A fresh session: teach the register in three quiet lines — who is ready,
 *  on what, and how to speak. Sits above center so the composer's floor
 *  doesn't crowd it. */
export function EmptyConversation({
  agent,
  model,
  effort,
  permission,
}: {
  agent: string;
  model: string;
  effort: string;
  permission: string;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 pb-32">
      <span aria-hidden className="font-mono text-[26px] text-s5">
        ❯
      </span>
      <div className="text-body text-s9">
        <b className="font-[550] text-s10">{agent}</b> is ready
      </div>
      <div className="font-mono text-meta text-s6">
        {model} · {effort} · {permission}
      </div>
      <div className="mt-3 flex items-center gap-4 font-mono text-meta text-s6">
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⏎</kbd> send
        </span>
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⇧⏎</kbd> newline
        </span>
        <span>
          <kbd className="rounded-r1 border border-s4 px-1 py-px text-s7">⌘K</kbd> commands
        </span>
      </div>
    </div>
  );
}

/** D85's raw projection: the transcript with the mask off. Verbatim loop
 *  lines, plain mono, no cards, no reveal, no interpretation — the governed
 *  chrome visibly absent is the design. */
export function RawTranscript({
  lines,
  wide = true,
}: {
  lines: string[];
  wide?: boolean;
}): React.JSX.Element {
  return (
    <div className={cx('flex w-full flex-col px-8 pt-6 pb-56', !wide && 'mx-auto max-w-180')}>
      {lines.map((ln, i) => (
        <RawRow key={i} text={ln} />
      ))}
    </div>
  );
}

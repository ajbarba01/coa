import { cx } from '@coa/console-kit';
import type { TranscriptFrame } from './frames.js';

/**
 * The three subagent announcement cards: spawn, completion, and agent-to-agent
 * message. First-class bordered cards (the DenyNotice construction — `rounded-r2
 * border border-s4 bg-s2` — at a quieter weight), because each records a unit of
 * orchestration work, not a passing status line: who was started or spoke, under
 * which identity, and the way into its own thread.
 *
 * Register per the design laws: state is a dot (running blue, done green, errored
 * red, stopped ground); the agent's identity color marks the NAME, never the card
 * chrome; jump-to-thread is a quiet dotted-underline action (the DenyNotice
 * ways-forward vocabulary). Adapted at the reading level from Traycer's
 * parallel-agent feed (each agent event is a self-contained card carrying identity +
 * state + one navigation affordance) — visual language stays entirely coa's own.
 */

/** Open the named session's own tab/thread. Threaded from the app (which owns
 *  session switching); omitted, the cards render without the jump affordance. */
export type OpenSessionFn = (sessionId: string) => void;

type SpawnFrame = Extract<TranscriptFrame, { kind: 'subagent-spawn' }>;
type CompletionFrame = Extract<TranscriptFrame, { kind: 'subagent-completion' }>;
type MessageFrame = Extract<TranscriptFrame, { kind: 'subagent-message' }>;

/** The kit's agent identity vocabulary (packages/shared agent.ts) → the identity
 *  text tokens. An unknown/absent name falls back to slate rather than throwing —
 *  the color is an accent, never load-bearing. */
const IDENTITY_TEXT: Record<string, string> = {
  slate: 'text-agent-slate',
  sky: 'text-agent-sky',
  blue: 'text-agent-blue',
  teal: 'text-agent-teal',
  green: 'text-agent-green',
  mauve: 'text-agent-mauve',
  violet: 'text-agent-violet',
  coral: 'text-agent-coral',
};

function identityText(color: string | undefined): string {
  return IDENTITY_TEXT[color ?? 'slate'] ?? IDENTITY_TEXT['slate']!;
}

/** The completion vocabulary in indicator-law form: reason → dot color + the word
 *  the pill wears. Exported for unit testing. */
export const COMPLETION_PILL: Record<CompletionFrame['reason'], { dot: string; label: string }> = {
  completed: { dot: 'bg-ok', label: 'Done' },
  errored: { dot: 'bg-crit', label: 'Errored' },
  stopped: { dot: 'bg-s5', label: 'Stopped' },
};

/** A status pill: dot + word in the chip construction the origin chip already uses.
 *  The dot is the state; the adjacent word carries the meaning for a screen reader. */
function StatusPill({ dot, label }: { dot: string; label: string }): React.JSX.Element {
  return (
    <span className="flex flex-none items-center gap-1.5 rounded-r1 border border-s3 px-1.5 py-px font-mono text-caps text-s8">
      <span aria-hidden className={cx('inline-block size-[5px] rounded-full', dot)} />
      {label}
    </span>
  );
}

/** The jump-to-thread affordance — the DenyNotice ways-forward vocabulary (dotted
 *  underline, quiet mono), rendered only when the app supplied a way to navigate. */
function JumpToThread({
  sessionId,
  onOpenSession,
}: {
  sessionId: string;
  onOpenSession?: OpenSessionFn | undefined;
}): React.JSX.Element | null {
  if (onOpenSession === undefined) return null;
  return (
    <button
      type="button"
      onClick={() => onOpenSession(sessionId)}
      className="slip ml-auto flex-none cursor-pointer font-mono text-meta text-s8 underline decoration-s6 decoration-dotted underline-offset-[3px] hover:text-s10 hover:decoration-s8"
    >
      Open Thread
    </button>
  );
}

/** Shared card shell: the DenyNotice construction at a quieter weight. */
function CardShell({
  kind,
  children,
}: {
  kind: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div data-subagent-card={kind} className="rounded-r2 border border-s4 bg-s2 px-3.5 py-2.5">
      {children}
    </div>
  );
}

/** The spawn card: identity + what it was asked to do + where it runs. */
export function SubagentSpawnCard({
  frame,
  onOpenSession,
}: {
  frame: SpawnFrame;
  onOpenSession?: OpenSessionFn | undefined;
}): React.JSX.Element {
  return (
    <CardShell kind="spawn">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-3 flex-none text-center font-mono text-code text-s7">
          ⎇
        </span>
        <b className={cx('font-mono text-code font-[550]', identityText(frame.color))}>
          {frame.agentRef}
        </b>
        <span className="font-mono text-caps text-s6">Subagent</span>
        <StatusPill dot="bg-run" label="Spawned" />
        <JumpToThread sessionId={frame.childSessionId} onOpenSession={onOpenSession} />
      </div>
      <div className="mt-1 pl-5 text-sec leading-[1.5] text-s10">{frame.description}</div>
      {frame.isolate && (
        <div className="mt-1 flex items-center gap-1.5 pl-5 font-mono text-meta text-s6">
          <span>Isolated worktree</span>
          <span className="truncate text-s7">{frame.childWorktree}</span>
        </div>
      )}
    </CardShell>
  );
}

/** The completion card: how the child ended and, for a genuine completion, the
 *  child's own result verbatim (never paraphrased — an honest record). */
export function SubagentCompletionCard({
  frame,
  onOpenSession,
}: {
  frame: CompletionFrame;
  onOpenSession?: OpenSessionFn | undefined;
}): React.JSX.Element {
  const pill = COMPLETION_PILL[frame.reason];
  return (
    <CardShell kind="completion">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-3 flex-none text-center font-mono text-code text-s7">
          ⎇
        </span>
        <b className={cx('font-mono text-code font-[550]', identityText(frame.color))}>
          {frame.agentRef}
        </b>
        <span className="font-mono text-caps text-s6">Subagent</span>
        <StatusPill dot={pill.dot} label={pill.label} />
        <JumpToThread sessionId={frame.childSessionId} onOpenSession={onOpenSession} />
      </div>
      {frame.result !== undefined && frame.result.length > 0 && (
        <div className="mt-1.5 max-h-48 overflow-y-auto border-t border-s3 pt-1.5 pl-5 text-sec leading-[1.5] whitespace-pre-wrap text-s10">
          {frame.result}
        </div>
      )}
      {frame.detail !== undefined && frame.detail.length > 0 && (
        <div className="mt-1 pl-5 font-mono text-meta text-s7">{frame.detail}</div>
      )}
    </CardShell>
  );
}

/** The agent-to-agent message card. `direction` is relative to the session whose
 *  stream carried this frame; the jump target is always the counterparty. */
export function SubagentMessageCard({
  frame,
  onOpenSession,
}: {
  frame: MessageFrame;
  onOpenSession?: OpenSessionFn | undefined;
}): React.JSX.Element {
  const counterpart = frame.direction === 'sent' ? frame.to : frame.from;
  const fromLabel = frame.fromLabel ?? frame.from;
  const toLabel = frame.toLabel ?? frame.to;
  return (
    <CardShell kind="message">
      <div className="flex items-center gap-2">
        <span aria-hidden className="w-3 flex-none text-center font-mono text-code text-s7">
          {frame.direction === 'sent' ? '↦' : '↤'}
        </span>
        <span className="min-w-0 truncate font-mono text-code">
          <b className={cx('font-[550]', identityText(frame.color))}>{fromLabel}</b>
          <span aria-hidden className="px-1.5 text-s6">
            →
          </span>
          <b className="font-[550] text-s10">{toLabel}</b>
        </span>
        <span className="font-mono text-caps text-s6">
          {frame.replyTo !== undefined ? 'Reply' : 'Message'}
        </span>
        <StatusPill
          dot={frame.direction === 'sent' ? 'bg-run' : 'bg-ok'}
          label={frame.direction === 'sent' ? 'Sent' : 'Received'}
        />
        <JumpToThread sessionId={counterpart} onOpenSession={onOpenSession} />
      </div>
      <div className="mt-1 pl-5 text-sec leading-[1.5] whitespace-pre-wrap text-s10">
        {frame.body}
      </div>
    </CardShell>
  );
}

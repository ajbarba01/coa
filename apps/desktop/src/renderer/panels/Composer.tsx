import { Button, Icon, MenuItem, PopoverCard, StatusDot, Tooltip, cx } from '@coa/console-kit';
import { useEffect, useRef, useState } from 'react';
import type { ModelDescriptor } from '@coa/console-viewmodel';
import { useShell } from '../shell/store.js';
import type { ChatNotice } from './banners.js';
import { ModelPicker } from './ModelPicker.js';
import { NoticeLine } from './NoticeLine.js';
import { ReasoningChip } from './ReasoningPicker.js';

export interface QueuedMessage {
  id: string;
  text: string;
}

/** A pending approval, docked to the composer — the gate visibly blocks the
 *  conversation's input, which is what it actually does. */
export interface PendingApproval {
  id: string;
  tool: string;
  summary: string;
  diffStat?: string | undefined;
}

export interface ComposerProps {
  /** True while a governed turn is in flight — flips the action cluster to
   *  Stop + the Queue / Steer split, and lights the running edge. */
  running: boolean;
  /** No session at all — the whole composer rests disabled. */
  disabled?: boolean;
  queued?: QueuedMessage[];
  /** The gate waiting on you. While set, the composer wears the amber shimmer,
   *  ⏎ on an empty field approves, and typing redirects instead. */
  approval?: PendingApproval | undefined;
  /** The real model seam (from the ChatVm), passed WHOLE. Flattening it to id+label here
   *  dropped each model's `provider`, which is what the picker groups and marks by — so
   *  every backend resolved to the Claude default and the shelf's list said so. */
  models: ModelDescriptor[];
  currentModelId?: string | undefined;
  onPickModel: (id: string) => void;
  /** The real reasoning-effort seam (console-viewmodel `effortOptions` /
   *  `reasoningValue` / `toReasoning`). Empty ⇒ the effort control hides
   *  (thinking-only models). */
  effortOptions: { value: string; label: string }[];
  effortValue: string;
  onPickEffort: (v: string) => void;
  onSend: (text: string) => void;
  onQueue?: (text: string) => void;
  onSteer?: (text: string) => void;
  onStop?: () => void;
  onRemoveQueued?: (id: string) => void;
  onApprove?: (id: string) => void;
  onDeny?: (id: string) => void;
  /** "Tell the agent to do something else": denies the request and sends the
   *  typed instruction in its place. */
  onRedirect?: (id: string, text: string) => void;
  /** Rendered above the whole composer stack (queued pins included) — the
   *  transcript's jump-to-latest pill anchors here so it always clears
   *  whatever the composer is showing. */
  above?: React.ReactNode;
  /** Predictive prompt notices (drift/cache), rendered as sections INSIDE the
   *  shell above the gate. A standing fact about the prompt outranks one request
   *  inside it, and the gate keeps its adjacency to the field it blocks. */
  notices?: ChatNotice[];
  onNoticeAction?: (id: string, actionId: string) => void;
}

/** The composer: a floating shell over the transcript's floor, and the
 *  session's attention port. One rect, two rows — the message field on the
 *  search-field skin (s3 · s5 hairline) and the control shelf under its
 *  hairline.
 *
 *  The session's state lives on the shell's own edge: a tinted border plus
 *  the status-outline shimmer — two soft comets traveling the whole border
 *  path in the status's color (run-blue while running, amber while a gate
 *  waits; reduced-motion drops the comets, the tint stays). Idle wears no
 *  state at all.
 *
 *  States: resting (send ↑, disabled until text) · running (Stop always; with
 *  text the send slot becomes the steer split — Queue waits for the turn's
 *  end, Steer reaches it at its next step) · approval docked above the field (approve
 *  / deny / or type to redirect) · no-session (everything rests). Queued
 *  messages pin above the shell, removable, released FIFO.
 *
 *  The mic is a permanently-disabled coming-soon affordance. */
export function Composer({
  running,
  disabled = false,
  queued = [],
  approval,
  models,
  currentModelId,
  onPickModel,
  effortOptions,
  effortValue,
  onPickEffort,
  onSend,
  onQueue,
  onSteer,
  onStop,
  onRemoveQueued,
  onApprove,
  onDeny,
  onRedirect,
  above,
  notices = [],
  onNoticeAction,
}: ComposerProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // Multi-line growth: the field grows with its content to ~6 lines, then
  // scrolls. Measured, not guessed — height follows scrollHeight.
  const autoGrow = (): void => {
    const el = areaRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  useEffect(autoGrow, [text]);

  // The shell asks for the caret (a session opened, or Enter was pressed in the
  // conversation) — a nonce, so two consecutive asks are two events. The first render's
  // 0 is not an ask: the app doesn't steal focus on boot.
  const composerFocus = useShell((s) => s.composerFocus);
  useEffect(() => {
    if (composerFocus > 0) areaRef.current?.focus();
  }, [composerFocus]);

  const take = (): string | undefined => {
    const t = text.trim();
    if (t === '') return undefined;
    setText('');
    setAttachments([]);
    return t;
  };

  const send = (): void => {
    const t = take();
    if (t === undefined) return;
    if (approval !== undefined) onRedirect?.(approval.id, t);
    else onSend(t);
  };
  const queueMessage = (): void => {
    const t = take();
    if (t !== undefined) onQueue?.(t);
  };
  const steer = (): void => {
    const t = take();
    if (t !== undefined) onSteer?.(t);
  };

  const hasText = text.trim() !== '';
  const edge: 'running' | 'needs-you' | undefined =
    approval !== undefined ? 'needs-you' : running ? 'running' : undefined;

  return (
    <div className="absolute bottom-4 left-1/2 w-[calc(100%-64px)] max-w-[656px] -translate-x-1/2">
      {above}
      {/* queued messages pin above the shell — removable, released FIFO */}
      {queued.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-1">
          {queued.map((q, i) => (
            <div
              key={q.id}
              className="slip-enter flex items-center gap-2 rounded-r2 border border-s4 bg-s2 px-2.5 py-1.5 shadow-[var(--shadow-composer)]"
            >
              <span aria-hidden className="font-mono text-meta text-s6">
                {i === 0 ? '⇥ next' : `⇥ ${i + 1}`}
              </span>
              <span className="min-w-0 flex-1 truncate text-sec text-s10">{q.text}</span>
              <button
                type="button"
                aria-label={`remove queued message: ${q.text}`}
                onClick={() => onRemoveQueued?.(q.id)}
                className="slip cursor-pointer text-s7 hover:text-s10"
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* no overflow-hidden on the shell — the chip menus must escape its bounds */}
      <div
        data-composer-shell
        className={cx(
          'relative rounded-r4 border bg-s3 shadow-[var(--shadow-composer)]',
          disabled
            ? 'border-s4'
            : edge === 'running'
              ? 'border-run/55'
              : edge === 'needs-you'
                ? 'border-warn/55'
                : // A notice tints the edge ONLY while no real session state owns it.
                  // Session state always wins, and `edge` is untouched either way, so a
                  // passive notice can never start the shimmer — animating the composer's
                  // outline for a cold cache would be a straight indicator-law breach.
                  notices.length > 0
                  ? 'border-warn/55'
                  : 'border-s5 focus-within:border-s6',
        )}
      >
        {edge !== undefined && (
          // The shimmer: two soft comets traveling the whole border path at
          // constant speed, in the status's own color (see .status-outline).
          <svg
            aria-hidden
            className="status-outline"
            style={
              {
                '--outline-color': edge === 'running' ? 'var(--color-run)' : 'var(--color-warn)',
              } as React.CSSProperties
            }
          >
            <rect pathLength={100} className="comet-halo" />
            <rect pathLength={100} className="comet-core" />
          </svg>
        )}
        {/* The notices rank above the gate: a standing fact about the prompt outranks
            one request inside it. First child, so they wear the shell's top radius. */}
        <NoticeLine notices={notices} onAction={(id, action) => onNoticeAction?.(id, action)} />
        {/* the gate, MERGED into the shell: the request is the composer's top
            section, and the section's two halves ARE the buttons — the whole
            left half denies, the whole right half approves. The corner labels
            name the halves; hovering a half washes it with its verdict. */}
        {approval !== undefined && (
          <div className="slip-enter relative overflow-hidden rounded-t-r4 border-b border-s4">
            <div className="absolute inset-0 grid grid-cols-2">
              <button
                type="button"
                aria-label={`Deny: ${approval.tool} ${approval.summary}`}
                onClick={() => onDeny?.(approval.id)}
                className="group/deny slip flex cursor-pointer items-end justify-start bg-crit/6 p-2 hover:bg-crit/12"
              >
                <span className="slip font-mono text-[9.5px] text-crit/60 group-hover/deny:text-crit">
                  ⌫ Deny
                </span>
              </button>
              <button
                type="button"
                aria-label={`approve: ${approval.tool} ${approval.summary}`}
                onClick={() => onApprove?.(approval.id)}
                className="group/appr slip flex cursor-pointer items-end justify-end border-l border-s4/60 bg-ok/6 p-2 hover:bg-ok/12"
              >
                <span className="slip font-mono text-[9.5px] text-ok/60 group-hover/appr:text-ok">
                  Approve ⏎
                </span>
              </button>
            </div>
            <div className="pointer-events-none relative px-3 pt-2.5 pb-7">
              <div className="flex items-center gap-2 text-[12px]">
                <span className="motion-safe:animate-pulse">
                  <StatusDot status="needs-you" />
                </span>
                <span className="font-[550] text-s11">{approval.tool}</span>
                <span className="font-mono text-caps text-s6">Needs approval</span>
                {approval.diffStat !== undefined && (
                  <span className="ml-auto font-mono text-meta text-s7">{approval.diffStat}</span>
                )}
              </div>
              <div className="mt-1.5 font-mono text-code break-all text-s11">
                {approval.summary}
              </div>
            </div>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attachments.map((a) => (
              <span
                key={a}
                className="slip-enter flex items-center gap-1.5 rounded-r1 border border-s5 bg-s4 px-1.5 py-0.5 font-mono text-meta text-s9"
              >
                {a}
                <button
                  type="button"
                  aria-label={`remove ${a}`}
                  onClick={() => setAttachments((list) => list.filter((x) => x !== a))}
                  className="slip cursor-pointer text-s7 hover:text-s10"
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={areaRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // ⌫ on an empty field denies the merged gate (mirrors its label).
            if (approval !== undefined && e.key === 'Backspace' && text === '') {
              e.preventDefault();
              onDeny?.(approval.id);
              return;
            }
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            if (approval !== undefined) {
              // Empty ⏎ approves the merged gate; typed text redirects instead.
              if (hasText) send();
              else onApprove?.(approval.id);
              return;
            }
            if (!running) send();
            else if (e.altKey) steer();
            else queueMessage();
          }}
          placeholder={
            disabled
              ? 'No session. Start one to talk to an agent.'
              : approval !== undefined
                ? 'Approve or deny above, or tell the agent what to do instead…'
                : running
                  ? 'Queue a message… (⌥⏎ steers now · esc stops)'
                  : 'Message builder…'
          }
          className={cx(
            'block w-full resize-none bg-transparent px-3.5 py-2.5 text-body leading-[1.5] outline-none',
            disabled
              ? 'cursor-default text-s6 placeholder:text-s5'
              : 'text-s11 placeholder:text-s7',
          )}
        />
        {/* the control shelf: same rect, its own hairline */}
        <div className="flex items-center gap-1 border-t border-s4 px-2 py-1.5">
          <AttachButton
            disabled={disabled}
            onAttach={(name) => setAttachments((a) => (a.includes(name) ? a : [...a, name]))}
          />
          <MicButton disabled={disabled} />
          <div className="flex-1" />
          {/* The two axes of a turn, side by side and each its own control: WHICH model,
              then how hard it thinks. Burying the second inside the first's popup made the
              more frequent of the two the harder to reach. */}
          <ModelPicker
            variant="chip"
            models={models}
            value={currentModelId}
            onChange={onPickModel}
            disabled={disabled}
          />
          <ReasoningChip
            options={effortOptions}
            value={effortValue}
            onChange={onPickEffort}
            disabled={disabled}
          />
          {!running ? (
            <Button
              variant="primary"
              icon
              aria-label={approval !== undefined && hasText ? 'redirect' : 'send'}
              disabled={disabled || !hasText}
              onClick={send}
            >
              ↑
            </Button>
          ) : (
            <>
              {hasText && (
                <>
                  <Tooltip label="Sends when the turn ends" keys={['⏎']} side="top">
                    <Button onClick={queueMessage}>Queue</Button>
                  </Tooltip>
                  <Tooltip
                    label="Reaches the agent at its next step, without discarding its work"
                    keys={['⌥⏎']}
                    side="top"
                  >
                    <Button variant="outline" onClick={steer}>
                      Steer
                    </Button>
                  </Tooltip>
                </>
              )}
              <Tooltip label="Stop the running turn" keys={['esc']} side="top">
                <Button
                  variant="outline"
                  icon
                  aria-label="Stop the running turn"
                  onClick={() => onStop?.()}
                  className="hover:border-crit/60 hover:text-crit"
                >
                  ■
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* shelf controls (search-field skin; disabled states included)         */
/* ------------------------------------------------------------------ */

function AttachButton({
  onAttach,
  disabled = false,
}: {
  onAttach: (name: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <PopoverCard
      open={open}
      onOpenChange={(o) => {
        if (!disabled) setOpen(o);
      }}
      side="top"
      align="start"
      className="w-48"
      tooltip={{ label: 'Attach a file', side: 'top' }}
      trigger={
        <button
          type="button"
          aria-label="Attach"
          disabled={disabled}
          className={cx(
            'flex h-7 w-7 items-center justify-center rounded-r2 border',
            disabled
              ? 'cursor-default border-s4 bg-s3 text-s6'
              : cx(
                  'slip slip-press cursor-pointer text-s10 active:scale-[0.95]',
                  open ? 'border-s6 bg-s5 text-s12' : 'border-s5 bg-s4 hover:bg-s5 hover:text-s12',
                ),
          )}
        >
          <Icon name="attach" />
        </button>
      }
    >
      <MenuItem
        onClick={() => {
          onAttach('screenshot.png');
          setOpen(false);
        }}
      >
        <span className="w-4 text-center font-mono text-code text-s8">⇪</span>
        Upload File…
      </MenuItem>
    </PopoverCard>
  );
}

/** Voice-to-text — a coming-soon affordance (maintainer ruling): it renders
 *  permanently disabled with no handler. Sits with the attach button so the
 *  shelf's final shape is already in place for whenever it lands. */
function MicButton({ disabled = false }: { disabled?: boolean }): React.JSX.Element {
  return (
    // The tooltip rides a WRAPPER, not the button: a disabled control dispatches no
    // pointer events, so a trigger on it would never open — and this control's entire
    // job is to explain why it is disabled. (A native `title` did work here, which is
    // exactly how easy it is to not notice the difference.)
    <Tooltip label="Voice input (unavailable)" side="top">
      <span className="flex">
        <button
          type="button"
          aria-label="Voice input"
          disabled
          aria-disabled="true"
          className={cx(
            'flex h-7 w-7 cursor-default items-center justify-center rounded-r2 border border-s4 bg-s3 text-s6',
            disabled && 'opacity-70',
          )}
        >
          <Icon name="mic" />
        </button>
      </span>
    </Tooltip>
  );
}

